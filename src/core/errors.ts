/**
 * CoreService 的錯誤型別。
 *
 * 刻意不 import server/errors.js：依賴方向是 server → core，反過來會把核心綁死在
 * Fastify 上，階段 6 的 MCP 就用不了。把這些錯誤翻成 HTTP 狀態碼是 route 的工作
 * （見 src/server/routes/jobs.ts 的 mapCoreError）。
 *
 * 每個錯誤都帶一個穩定的 code，UI 與 MCP 都靠 code 分辨，不要去比對訊息文字。
 */

export const coreErrorCodes = {
  JOB_NOT_FOUND: 'JOB_NOT_FOUND',
  INVALID_TRANSITION: 'INVALID_TRANSITION',
  /** 只有本機 UI 能建立核准。 */
  APPROVAL_FORBIDDEN: 'APPROVAL_FORBIDDEN',
  /** 送來的 contentHash 跟目前 revision 對不上。 */
  CONTENT_CHANGED: 'CONTENT_CHANGED',
  /** 內容不符模板 schema／版型規則，使用者要改內容。 */
  CONTENT_INVALID: 'CONTENT_INVALID',
  /** 發布前置檢查沒過。任何一項沒過都不會送出請求。 */
  PUBLISH_BLOCKED: 'PUBLISH_BLOCKED',
  MEDIA_ERROR: 'MEDIA_ERROR',
  AGENT_ERROR: 'AGENT_ERROR',
  /** WordPress 沒設定或連不上。 */
  WORDPRESS_UNAVAILABLE: 'WORDPRESS_UNAVAILABLE',
  /** 遠端在我們載入之後被改過。 */
  REMOTE_CHANGED: 'REMOTE_CHANGED',
  INVALID_INPUT: 'INVALID_INPUT',
} as const;

export type CoreErrorCode = (typeof coreErrorCodes)[keyof typeof coreErrorCodes];

export class CoreError extends Error {
  override readonly name: string = 'CoreError';
  constructor(
    readonly code: CoreErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export class JobNotFoundError extends CoreError {
  override readonly name = 'JobNotFoundError';
  constructor(uuid: string) {
    super(coreErrorCodes.JOB_NOT_FOUND, `找不到工作項目 ${uuid}`);
  }
}

export class ApprovalForbiddenError extends CoreError {
  override readonly name = 'ApprovalForbiddenError';
  constructor(message: string) {
    super(coreErrorCodes.APPROVAL_FORBIDDEN, message);
  }
}

export class ContentChangedError extends CoreError {
  override readonly name = 'ContentChangedError';
  constructor(message: string, details?: unknown) {
    super(coreErrorCodes.CONTENT_CHANGED, message, details);
  }
}

export class ContentInvalidError extends CoreError {
  override readonly name = 'ContentInvalidError';
  constructor(message: string, readonly issues: string[] = []) {
    super(coreErrorCodes.CONTENT_INVALID, message, issues);
  }
}

export class PublishBlockedError extends CoreError {
  override readonly name = 'PublishBlockedError';
  constructor(message: string, details?: unknown) {
    super(coreErrorCodes.PUBLISH_BLOCKED, message, details);
  }
}

export class MediaError extends CoreError {
  override readonly name = 'MediaError';
  constructor(message: string) {
    super(coreErrorCodes.MEDIA_ERROR, message);
  }
}

export class AgentError extends CoreError {
  override readonly name = 'AgentError';
  constructor(message: string, details?: unknown) {
    super(coreErrorCodes.AGENT_ERROR, message, details);
  }
}

export class WordPressUnavailableError extends CoreError {
  override readonly name = 'WordPressUnavailableError';
  constructor(message = 'WordPress 尚未設定。到「設定」跑一次設定精靈（或在 .env 填好 WORDPRESS_URL、WORDPRESS_USERNAME 與 WORDPRESS_APP_PASSWORD 後重新啟動）') {
    super(coreErrorCodes.WORDPRESS_UNAVAILABLE, message);
  }
}

export class InvalidInputError extends CoreError {
  override readonly name = 'InvalidInputError';
  constructor(message: string, details?: unknown) {
    super(coreErrorCodes.INVALID_INPUT, message, details);
  }
}
