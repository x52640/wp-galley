/**
 * 「請 AI 配一張」那句話（P5-T018）的整理與長度。前端的計數、輸入框、zod、CoreService 都用這一份，
 * 算法才會一樣：**先摺疊空白、去頭尾，再數 code point**（emoji 算一個字）。
 * 放在共用契約：前端不能 import core。
 */

/** 那句話的上限（整理後的 code point 數）。 */
export const USER_NOTE_MAX = 200;

/** 摺疊空白、去頭尾；空字串算沒寫（null）。 */
export function normalizeUserNote(note: string | undefined | null): string | null {
  const value = (note ?? '').replace(/\s+/g, ' ').trim();
  return value === '' ? null : value;
}

/** 整理之後有幾個字（code point）。 */
export function userNoteLength(note: string | undefined | null): number {
  return Array.from(normalizeUserNote(note) ?? '').length;
}

/**
 * 整理並檢查長度（P5-T033：CoreService 建需求、改需求與示範資料共用）。空的算沒寫（null），合格。
 * 不合格時 `message` 就是對使用者講的那句話。
 */
export function checkUserNote(
  note: string | undefined | null,
): { readonly ok: true; readonly note: string | null } | { readonly ok: false; readonly message: string } {
  const value = normalizeUserNote(note);
  if (userNoteLength(value) > USER_NOTE_MAX) return { ok: false, message: `想要什麼樣的圖，最多 ${USER_NOTE_MAX} 個字` };
  return { ok: true, note: value };
}
