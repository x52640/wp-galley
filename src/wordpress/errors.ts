/**
 * WordPress REST 的錯誤分類。
 *
 * 為什麼要自己一套，不直接把 WordPress 的錯誤丟出去：
 *
 * 1. **要分得出能不能重試。** 網路斷線、502、429 重試有意義；密碼錯重試一百次
 *    只會被安全外掛鎖帳號。這個判斷必須在同一個地方做完，不能散在呼叫端。
 * 2. **訊息要看得懂。** `rest_cannot_create` 對使用者沒有意義，要翻成
 *    「這個帳號沒有建立文章的權限」。
 * 3. **不能夾帶秘密。** 這個檔案不碰密碼，但錯誤訊息會被丟進 log 與 API 回應，
 *    所以呼叫端（client.ts）在建立錯誤前一定要先過 scrubber。
 *
 * 這裡刻意不 import server/errors.js：依賴方向是 server → wordpress，反過來
 * 會讓這層被綁死在 HTTP 框架上。轉成 AppError 是 route 的工作。
 */

export const wordpressErrorCodes = {
  /** 連不上：DNS、TLS、逾時、連線被拒。 */
  NETWORK: 'WP_NETWORK',
  /** 帳號或 Application Password 不對。 */
  AUTH: 'WP_AUTH',
  /** 認證過了但權限不足。 */
  FORBIDDEN: 'WP_FORBIDDEN',
  /** 找不到文章、分類或端點。 */
  NOT_FOUND: 'WP_NOT_FOUND',
  /** 送出去的參數不合法。 */
  INVALID_REQUEST: 'WP_INVALID_REQUEST',
  /** 被限流。 */
  RATE_LIMITED: 'WP_RATE_LIMITED',
  /** WordPress 自己出錯（5xx）。 */
  SERVER_ERROR: 'WP_SERVER_ERROR',
  /** 回應不是預期的 JSON——通常是安全外掛或快取層擋在前面回了一頁 HTML。 */
  BAD_RESPONSE: 'WP_BAD_RESPONSE',
  /** 回應是 JSON 但結構跟 schema 對不起來。 */
  SCHEMA_MISMATCH: 'WP_SCHEMA_MISMATCH',
} as const;

export type WordPressErrorCode = (typeof wordpressErrorCodes)[keyof typeof wordpressErrorCodes];

export class WordPressError extends Error {
  override readonly name = 'WordPressError';

  constructor(
    readonly code: WordPressErrorCode,
    message: string,
    readonly options: {
      /** WordPress 回的 HTTP 狀態碼；連不上時是 null。 */
      readonly status?: number | null;
      /** WordPress 自己的錯誤代碼，例如 rest_cannot_create。 */
      readonly wordpressCode?: string | null;
      /** 再試一次有沒有意義。 */
      readonly retryable?: boolean;
      /** 已經重試過幾次。 */
      readonly attempts?: number;
      /** 伺服器 Retry-After 標頭給的秒數；有的話退避就聽它的。 */
      readonly retryAfter?: number;
      readonly cause?: unknown;
    } = {},
  ) {
    super(message);
  }

  get status(): number | null {
    return this.options.status ?? null;
  }

  get retryable(): boolean {
    return this.options.retryable ?? false;
  }
}

/** WordPress REST 的標準錯誤格式。 */
export interface WordPressErrorBody {
  readonly code?: string;
  readonly message?: string;
  readonly data?: { readonly status?: number } & Record<string, unknown>;
}

/**
 * WordPress 錯誤代碼 → 看得懂的訊息。
 *
 * 只列真的會遇到而且需要不同處置的。沒列到的會退回用狀態碼判斷，
 * 並附上 WordPress 的原始訊息（它自己的訊息通常是中文的，因為站台語言是 zh-TW）。
 */
const CODE_MESSAGES: Record<string, string> = {
  // 認證
  invalid_username: '找不到這個 WordPress 使用者，檢查 WORDPRESS_USERNAME',
  incorrect_password:
    'Application Password 不正確。注意：重設 WordPress 登入密碼會讓所有 Application Password 立即失效，需要重新產生',
  invalid_application_password: 'Application Password 已被撤銷或不存在，需要重新產生',
  application_passwords_disabled: '這個站台停用了 Application Password，無法用 REST 發布',
  rest_not_logged_in: 'WordPress 沒有收到認證資訊。常見原因是伺服器把 Authorization 標頭擋掉了',
  // 權限
  rest_forbidden: '這個帳號沒有執行這個操作的權限',
  rest_cannot_create: '這個帳號沒有建立這種內容的權限',
  rest_cannot_edit: '這個帳號沒有編輯這篇內容的權限',
  rest_cannot_edit_others: '這個帳號不能編輯別人建立的內容',
  rest_cannot_publish: '這個帳號只能存成草稿，沒有發布的權限',
  rest_cannot_assign_term: '這個帳號沒有指定這個分類的權限',
  rest_cannot_read: '這個帳號沒有讀取這篇內容的權限',
  // 找不到
  rest_no_route:
    '這個 REST 端點不存在。若是自訂內容類型，通常代表它沒有開啟 show_in_rest',
  rest_post_invalid_id: '找不到這篇文章，可能已被刪除',
  rest_term_invalid: '找不到這個分類項目',
  // 參數
  rest_invalid_param: '送出的欄位不合法',
  rest_missing_callback_param: '缺少必要欄位',
  // 上傳
  rest_upload_no_content_disposition: '上傳缺少檔名資訊',
  rest_upload_unknown_error: 'WordPress 無法處理這個上傳的檔案',
  rest_upload_file_too_big: '檔案超過這個站台允許的上傳大小',
  rest_upload_sideload_error: 'WordPress 拒絕了這個檔案類型。SVG 預設就是被擋掉的',
};

/** 這些狀態碼再試一次有機會成功。 */
function isRetryableStatus(status: number): boolean {
  // 408 逾時、429 限流、5xx 伺服器暫時性問題。
  // 501（未實作）是永久的，排除掉。
  return status === 408 || status === 429 || (status >= 500 && status !== 501);
}

function codeForStatus(status: number): WordPressErrorCode {
  if (status === 401) return wordpressErrorCodes.AUTH;
  if (status === 403) return wordpressErrorCodes.FORBIDDEN;
  if (status === 404) return wordpressErrorCodes.NOT_FOUND;
  if (status === 429) return wordpressErrorCodes.RATE_LIMITED;
  if (status >= 500) return wordpressErrorCodes.SERVER_ERROR;
  return wordpressErrorCodes.INVALID_REQUEST;
}

/**
 * 認證失敗有時候會以 403 回來（安全外掛改過），所以先看 WordPress 自己的代碼，
 * 對不上再退回狀態碼。
 */
const AUTH_CODES = new Set([
  'invalid_username',
  'incorrect_password',
  'invalid_application_password',
  'application_passwords_disabled',
  'rest_not_logged_in',
]);

export function mapWordPressError(
  status: number,
  body: WordPressErrorBody | null,
  fallbackText: string,
): WordPressError {
  const wpCode = body?.code ?? null;

  const code = wpCode && AUTH_CODES.has(wpCode) ? wordpressErrorCodes.AUTH : codeForStatus(status);

  // 訊息優先序：我們的翻譯 → WordPress 自己的訊息 → 狀態碼。
  const message =
    (wpCode ? CODE_MESSAGES[wpCode] : undefined) ??
    body?.message ??
    `WordPress 回應 HTTP ${status}：${fallbackText.slice(0, 200)}`;

  return new WordPressError(code, message, {
    status,
    wordpressCode: wpCode,
    // 認證與權限問題重試只會被安全外掛鎖帳號。
    retryable: code === wordpressErrorCodes.AUTH ? false : isRetryableStatus(status),
  });
}
