/**
 * 前後端都要的稿件狀態規則（P5-T033）：恢復已取消的稿件回到哪裡、哪些稿件算「進行中」。
 * 後端 `service/jobs.ts`、`service/setup.ts`、`state-machine.ts` 與示範資料用同一份。
 */

import { JOB_STATES, type JobState } from './api-enums.js';

/**
 * 已取消的稿件能恢復成哪些狀態（D-031，P5-T030）；也是狀態機 `CANCELLED` 那一列。
 * 沒有 `APPROVED`：取消時核准已經撤銷，恢復不讓它復活。
 */
export const RESTORABLE_STATES: readonly JobState[] = ['SOURCE', 'REVIEWED', 'MEDIA_READY', 'RENDERED', 'PREVIEWED'];

/**
 * 恢復要回到的狀態（state-machine.md「恢復已取消的稿件」）。`fromState` 是取消前的狀態（記在 `job_cancelled` 事件）。
 * 取消前是 `APPROVED` 的回 `RENDERED`；記不到、認不得、或不在 `RESTORABLE_STATES` 的一律回 `SOURCE`。
 */
export function restoreStateFor(fromState: unknown): JobState {
  if (typeof fromState !== 'string' || !(JOB_STATES as readonly string[]).includes(fromState)) return 'SOURCE';
  const target: JobState = fromState === 'APPROVED' ? 'RENDERED' : (fromState as JobState);
  return RESTORABLE_STATES.includes(target) ? target : 'SOURCE';
}

/** 沒發布、沒取消、沒被取代的稿件（FAILED 還能重試，算）。設定精靈停用類型時數「還有幾篇」用（D-032）。 */
export function isOpenJobState(state: JobState): boolean {
  return state !== 'PUBLISHED' && state !== 'CANCELLED' && state !== 'SUPERSEDED';
}

/**
 * 能取消的狀態：狀態機（`core/state-machine.ts` 的 `TRANSITIONS`）裡有 `→ CANCELLED` 的那幾列。
 * 示範資料不能 import core，所以抄在這裡；`tests/state-machine.test.ts` 對著轉移表逐一比對，抄錯就紅（P5-T033）。
 */
export const CANCELLABLE_STATES: readonly JobState[] = ['SOURCE', 'REVIEWED', 'MEDIA_READY', 'RENDERED', 'PREVIEWED', 'APPROVED'];

export function canCancel(state: JobState): boolean {
  return CANCELLABLE_STATES.includes(state);
}

/**
 * 不能取消時講的話，跟後端 `InvalidTransitionError(state, 'CANCELLED')` 一字不差（同一個測試守著）。
 * 還有下一步的狀態要列出能變成什麼，所以這兩列也抄了轉移表。
 */
export function cancelRejectedMessage(state: JobState): string {
  const next: Partial<Record<JobState, readonly JobState[]>> = {
    PUBLISHING: ['PUBLISHED', 'FAILED'],
    PUBLISHED: ['SUPERSEDED'],
    CANCELLED: RESTORABLE_STATES,
  };
  const allowed = next[state];
  return allowed === undefined
    ? `工作項目已經是 ${state}，不能再變成 CANCELLED`
    : `不能從 ${state} 變成 CANCELLED；${state} 只能變成 ${allowed.join('、')}`;
}
