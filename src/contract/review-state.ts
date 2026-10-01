/**
 * 待處理清單「還有幾項沒處理」的判斷（階段 5.5、P5-T017）。後端 `service/review.ts`、`service/jobs.ts`
 * 與示範資料用同一份（P5-T033）：清單、blockers、總覽的數字才不會各說各話。
 */

import type { ReviewItemState } from './api.js';

/**
 * 這個狀態算不算還沒處理完：`pending` 加上 `unappliable`。
 *
 * `unappliable` 也算：那一項是「想套用但定位不到」，使用者還沒決定要自己改還是不要了。
 * 當成完成的話，清單會連同「這一項要自己改」的提示一起消失。
 */
export function isOpenReviewState(state: ReviewItemState): boolean {
  return state === 'pending' || state === 'unappliable';
}

/** 還沒處理完的有幾項（只看 `state`；「已經改好了」的在讀取時已經是 skipped）。 */
export function countOpenReviewItems(items: readonly { readonly state: ReviewItemState }[]): number {
  return items.filter((item) => isOpenReviewState(item.state)).length;
}

/** 發布面板「還不能發布」裡那一行。是提醒不是禁令：發布的硬性前置檢查不看它。 */
export function pendingReviewBlocker(count: number): string {
  return `還有 ${count} 項校稿建議沒處理`;
}
