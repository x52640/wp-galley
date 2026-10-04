/**
 * 主區現在顯示什麼（D-018）。
 *
 * 使用者能選的只有兩種：**文章**（預設，建議標在字上）與**對照**（校樣工具列上的切換按鈕）。
 * 乾淨的成品不是一個可以選的檢視——只在發布面板打開時出現，關掉面板就回到原本那一種。
 *
 * 規則只有一條，但不能弄錯：**發布面板打開時一定顯示成品**，就算使用者剛才在對照。
 * 核准前畫面上一定是真正會送出去的樣子（docs/specs/design-system.md）；
 * 讓對照蓋在成品上面，等於讓人沒看過就核准。
 */

/** 使用者自己選的檢視。 */
export type StageView = 'article' | 'compare';

export interface StageDisplay {
  /** 校樣的樣子：`edit`＝標出建議與校對符號；`final`＝跟網站上一樣，什麼都不標。 */
  proof: 'edit' | 'final';
  /** 對照要不要蓋在校樣上面。校樣本身永遠掛在樹上，只是被蓋住。 */
  compare: boolean;
}

export function stageDisplay(view: StageView, publishing: boolean): StageDisplay {
  if (publishing) return { proof: 'final', compare: false };
  return { proof: 'edit', compare: view === 'compare' };
}

/**
 * 文章段落之間要不要出現「在這裡插圖」（P5-T016）。
 *
 * 只在**看文章**的時候：對照蓋在上面時看不到文章、發布面板的成品是給人核准前看的（不該再動它）、
 * 直接在文章上改的時候位置會隨打字跑掉。AI 還在跑（跑完會產生新版本、位置作廢）或稿件已經結束
 * （不能再改內容）也不給。
 */
export function canInsertImages(
  display: StageDisplay,
  state: { editing: boolean; finished: boolean; working: boolean },
): boolean {
  return display.proof === 'edit' && !display.compare && !state.editing && !state.finished && !state.working;
}

/**
 * 文章上選字時要不要浮出「查證這句」的膠囊（P6-T005）。
 *
 * 跟「在這裡插圖」一樣只在**看文章**的時候：對照、發布面板的成品上不出現，稿件結束也不出現。
 * **打字模式照樣出現**（D-036）：按下先存一版（只存本機）、留在打字模式再查。
 * AI 在跑的時候**照樣出現**，但反灰並講原因（`factCheckBlockedReason`）——選了字卻什麼都沒有，會以為功能壞了。
 */
export function canSelectToFactCheck(display: StageDisplay, state: { finished: boolean }): boolean {
  return display.proof === 'edit' && !display.compare && !state.finished;
}
