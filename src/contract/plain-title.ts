/**
 * 在文章上直接改的標題（D-030，P5-T029）。前端存檔前、後端收到時都走這一條。
 *
 * 標題只能是純文字：不接受換行（WordPress 的標題是一行）、控制字元；格式與 HTML 在前端就拿不到
 * （讀的是 textContent），字面上的角括號是字，渲染時照樣逃脫。前後的空白修掉；修完是空的不准存。
 */

/**
 * 標題長度上限照**該篇模板 schema** 的 `title.maxLength`（ajv 數的是 code point）：日記、長文 120，通用文章 200。
 * 不寫死——寫死會讓 schema 本來收的標題存不進去（P5-T029 審查 #2）。schema 沒寫就不限。
 */
export function titleMaxLengthFromSchema(schema: unknown): number | null {
  const properties = (schema as { properties?: Record<string, unknown> } | null)?.properties;
  const title = properties?.['title'] as { maxLength?: unknown } | undefined;
  return typeof title?.maxLength === 'number' && Number.isFinite(title.maxLength) ? title.maxLength : null;
}

export type PlainTitleCheck = { readonly ok: true; readonly title: string } | { readonly ok: false; readonly message: string };

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f\u2028\u2029]/;

export function checkPlainTitle(
  raw: string,
  options: { diary?: boolean; maxLength?: number | null } = {},
): PlainTitleCheck {
  if (/[\r\n]/.test(raw)) return { ok: false, message: '標題只能是一行，不能換行' };
  if (CONTROL.test(raw)) return { ok: false, message: '標題裡有看不見的控制字元，請重打一次' };
  // 只修前後空白；中間的空白（連續空格、全形空格、tab）是使用者的，原樣保留。
  const title = raw.trim();
  if (title.length === 0) {
    return {
      ok: false,
      message: options.diary ? '標題不能是空的。日記的慣例是 YYYYMMDD，例如 20260928' : '標題不能是空的',
    };
  }
  const max = options.maxLength ?? null;
  if (max !== null && [...title].length > max) {
    return { ok: false, message: `標題最多 ${max} 個字` };
  }
  return { ok: true, title };
}

/**
 * 從編輯中的標題元素讀出來的字：瀏覽器在 contenteditable 裡按 Enter 或貼上多行時會留下換行，
 * 這裡只把換行換成空格（前端的防線；真正送出前仍要過 checkPlainTitle）。NBSP 也換成一般空格：那是瀏覽器編輯器
 * 為了保住連續空格自己塞的，不是使用者打的。其他空白不動、不合併：存的標題原樣保留。
 */
export function flattenTitleText(text: string): string {
  return text.replace(/\r\n?|\n/g, ' ').replace(/\u00a0/g, ' ');
}

/**
 * 兩個標題算不算同一個：比較時才把連續空白（含 tab、NBSP、全形空格、換行）當成一個、前後空白不算。
 * 進入編輯時的標題與存檔時讀到的標題都經過瀏覽器，空白可能被改寫；只為空白不同就建新版本、讓核准失效是錯的（審查 #1）。
 */
export function sameTitle(a: string, b: string): boolean {
  const norm = (text: string): string => text.replace(/[\s\u00a0\u3000]+/g, ' ').trim();
  return norm(a) === norm(b);
}
