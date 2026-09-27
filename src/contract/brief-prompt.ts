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
