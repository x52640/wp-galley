/**
 * AI 建議的英文網址（slug）合不合格（D-026，P5-T026）。後端篩候選、示範資料共用這一份。
 *
 * 比模板 schema 的 slug 規則（允許底線、上限 80）嚴：只收小寫英數與單個連字號、不以連字號開頭結尾、
 * 上限 60——AI 給的是建議，要的是短、好讀、一定存得進去的網址。使用者自己打的字照模板 schema 驗，不受這裡限制。
 *
 * 這個檔不准 import 任何東西（見 api.ts 開頭的規則）。
 */

/** 候選網址的長度上限（字元數；只收 ASCII，所以字元數＝位元組數）。 */
export const SLUG_MAX_LENGTH = 60;

/** 最多給幾個候選。 */
export const SLUG_SUGGESTION_COUNT = 3;

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isSuggestedSlug(value: string): boolean {
  return value.length > 0 && value.length <= SLUG_MAX_LENGTH && SLUG_PATTERN.test(value);
}

/**
 * Agent 回來的候選：去頭尾空白、不合格的丟掉（不改寫、不猜）、重複的只留一個、最多留三個。
 * `dropped` 是格式不合格被丟掉的個數（重複與超過三個的不算）。
 */
export function pickSlugSuggestions(raw: readonly unknown[]): { slugs: string[]; dropped: number } {
  const slugs: string[] = [];
  let dropped = 0;
  for (const item of raw) {
    const value = typeof item === 'string' ? item.trim() : null;
    if (value === null || !isSuggestedSlug(value)) {
      dropped += 1;
      continue;
    }
    if (slugs.includes(value) || slugs.length >= SLUG_SUGGESTION_COUNT) continue;
    slugs.push(value);
  }
  return { slugs, dropped };
}
