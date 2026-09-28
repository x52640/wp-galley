/**
 * 在文章上直接改的標題（D-030，P5-T029）。前端存檔前、後端收到時都走這一條。
 *
 * 標題只能是純文字：不接受換行（WordPress 的標題是一行）、控制字元；格式與 HTML 在前端就拿不到
 * （讀的是 textContent），字面上的角括號是字，渲染時照樣逃脫。前後的空白修掉；修完是空的不准存。
 */

/** 跟三個模板 schema 的 title.maxLength 一致（ajv 數的是 code point）。 */
export const TITLE_MAX_LENGTH = 120;

export type PlainTitleCheck = { readonly ok: true; readonly title: string } | { readonly ok: false; readonly message: string };

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f\u2028\u2029]/;

export function checkPlainTitle(raw: string, options: { diary?: boolean } = {}): PlainTitleCheck {
  if (/[\r\n]/.test(raw)) return { ok: false, message: '標題只能是一行，不能換行' };
  if (CONTROL.test(raw)) return { ok: false, message: '標題裡有看不見的控制字元，請重打一次' };
  const title = raw.replace(/\t/g, ' ').trim();
  if (title.length === 0) {
    return {
      ok: false,
      message: options.diary ? '標題不能是空的。日記的慣例是 YYYYMMDD，例如 20260928' : '標題不能是空的',
    };
  }
  if ([...title].length > TITLE_MAX_LENGTH) {
    return { ok: false, message: `標題最多 ${TITLE_MAX_LENGTH} 個字` };
  }
  return { ok: true, title };
}

/**
 * 從編輯中的標題元素讀出來的字：瀏覽器在 contenteditable 裡按 Enter 或貼上多行時會留下換行，
 * 這裡一律換成空格（前端的防線；真正送出前仍要過 checkPlainTitle）。
 */
export function flattenTitleText(text: string): string {
  return text.replace(/\r\n?|\n/g, ' ').replace(/[ \t ]{2,}/g, ' ');
}
