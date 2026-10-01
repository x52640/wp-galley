/**
 * 配圖需求上 Agent 寫的那段畫面描述（`ImageBrief.prompt`），使用者在卡片上改的時候（D-025，P5-T025）的
 * 整理與長度。前端的計數、zod、CoreService 都用這一份，算法才會一樣：**去頭尾、保留中間的換行，數 code point**。
 * 放在共用契約：前端不能 import core。
 *
 * 上限 2000 跟 Agent 輸出契約（`src/agents/output-contract.ts` 的 `imageBriefs[].prompt.maxLength`）同一個數字：
 * Agent 寫得出來的長度，使用者也改得出來；再長對生圖沒有幫助。
 */

/** 畫面描述的上限（整理後的 code point 數）。 */
export const BRIEF_PROMPT_MAX = 2000;

/** 去頭尾；中間的換行、空白照留（描述可能分行寫）。 */
export function normalizeBriefPrompt(prompt: string | undefined | null): string {
  return (prompt ?? '').trim();
}

/** 整理之後有幾個字（code point）。 */
export function briefPromptLength(prompt: string | undefined | null): number {
  return Array.from(normalizeBriefPrompt(prompt)).length;
}

/**
 * 整理並檢查卡片上改的畫面描述（P5-T033：CoreService 與示範資料共用）。不能是空的、不能超過上限。
 * 不合格時 `message` 就是對使用者講的那句話。
 */
export function checkBriefPrompt(
  prompt: string | undefined | null,
): { readonly ok: true; readonly prompt: string } | { readonly ok: false; readonly message: string } {
  const value = normalizeBriefPrompt(prompt);
  if (value === '') return { ok: false, message: '畫面描述不能是空的' };
  if (briefPromptLength(value) > BRIEF_PROMPT_MAX) return { ok: false, message: `畫面描述最多 ${BRIEF_PROMPT_MAX} 個字` };
  return { ok: true, prompt: value };
}

/**
 * 卡片上改配圖需求時，這條能改哪一欄（P5-T025）。Agent 建議的只能改 `prompt`；使用者在文章上請 AI 配的
 * 只能改 `note`（整份生圖指令由系統組）。送錯欄位回那句話，對的回 null。
 */
export function briefEditFieldError(
  origin: 'agent' | 'user',
  input: { readonly prompt?: string | undefined; readonly note?: string | null | undefined },
): string | null {
  if (origin === 'user') {
    return input.prompt !== undefined || input.note === undefined
      ? '這條是你在文章上請 AI 配的：能改的是「想要什麼樣的圖」那句（note），整份生圖指令由系統組'
      : null;
  }
  return input.note !== undefined || input.prompt === undefined ? '這條是 AI 建議的：能改的是畫面描述（prompt）' : null;
}
