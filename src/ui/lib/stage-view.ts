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
