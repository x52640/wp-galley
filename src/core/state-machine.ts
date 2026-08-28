import { CoreError, coreErrorCodes } from './errors.js';

/**
 * Job 狀態機（階段 5 契約第二節）。
 *
 * 用一張表定義，不要把「這時候能不能做那件事」散成一堆 if——散開之後，
 * 「使用者按下發布之前一定經過核准」這件事就沒有任何一個地方可以一眼看完，
 * 而那正是整個安全模型要保證的東西。
 *
 *   SOURCE → REVIEWED → MEDIA_READY → RENDERED → PREVIEWED → APPROVED
 *                                        ↑                      │
 *                                        └──────────────────────┘
 *                                        內容一改，核准失效，退回 RENDERED
 *
 * `SOURCE → RENDERED` 是刻意留的：使用者可以完全不用 Agent，貼完稿直接渲染發布。
 */

export const JOB_STATES = [
  'SOURCE',
  'REVIEWED',
  'MEDIA_READY',
  'RENDERED',
  'PREVIEWED',
  'APPROVED',
  'PUBLISHING',
  'PUBLISHED',
  'FAILED',
  'CANCELLED',
  'SUPERSEDED',
] as const;

export type JobState = (typeof JOB_STATES)[number];

/** 走到這些狀態就結束了，不再往下轉。 */
export const TERMINAL_STATES: readonly JobState[] = ['FAILED', 'CANCELLED', 'SUPERSEDED'];

/**
 * 允許的轉移。不在表格裡的一律拒絕。
 *
 * 沒有任何一個狀態能直接跳到 `PUBLISHING`，除了 `APPROVED`——這是「人工核准
 * 無法被程式繞過」在狀態機層的落實。
 */
export const TRANSITIONS: Readonly<Record<JobState, readonly JobState[]>> = {
  SOURCE: ['REVIEWED', 'RENDERED', 'CANCELLED', 'FAILED'],
  REVIEWED: ['MEDIA_READY', 'RENDERED', 'CANCELLED', 'FAILED'],
  MEDIA_READY: ['RENDERED', 'CANCELLED', 'FAILED'],
  RENDERED: ['PREVIEWED', 'REVIEWED', 'MEDIA_READY', 'CANCELLED', 'FAILED'],
  PREVIEWED: ['APPROVED', 'RENDERED', 'CANCELLED', 'FAILED'],
  APPROVED: ['PUBLISHING', 'RENDERED', 'CANCELLED'],
  PUBLISHING: ['PUBLISHED', 'FAILED'],
  PUBLISHED: ['SUPERSEDED'],
  FAILED: [],
  CANCELLED: [],
  SUPERSEDED: [],
};

export class InvalidTransitionError extends CoreError {
  override readonly name = 'InvalidTransitionError';
  constructor(
    readonly from: JobState,
    readonly to: JobState,
  ) {
    super(
      coreErrorCodes.INVALID_TRANSITION,
      TRANSITIONS[from].length === 0
        ? `工作項目已經是 ${from}，不能再變成 ${to}`
        : `不能從 ${from} 變成 ${to}；${from} 只能變成 ${TRANSITIONS[from].join('、')}`,
      { from, to, allowed: TRANSITIONS[from] },
    );
  }
}

export function isJobState(value: string): value is JobState {
  return (JOB_STATES as readonly string[]).includes(value);
}

export function isTerminal(state: JobState): boolean {
  return TERMINAL_STATES.includes(state);
}

export function canTransition(from: JobState, to: JobState): boolean {
  return TRANSITIONS[from].includes(to);
}

/** 轉移不合法就丟錯。呼叫端不需要自己判斷，也不該自己判斷。 */
export function assertTransition(from: JobState, to: JobState): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}
