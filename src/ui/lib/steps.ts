import type { JobState } from '../service/types.js';

/** 狀態在畫面上的叫法（docs/specs/state-machine.md）。 */

export const STATE_LABEL: Record<JobState, string> = {
  SOURCE: '原稿',
  REVIEWED: '已校稿',
  MEDIA_READY: '已配圖',
  RENDERED: '已渲染',
  PREVIEWED: '已預覽',
  APPROVED: '已核准',
  PUBLISHING: '發布中',
  PUBLISHED: '已發布',
  FAILED: '失敗',
  CANCELLED: '已取消',
  SUPERSEDED: '已被取代',
};

export function isTerminal(state: JobState): boolean {
  return state === 'FAILED' || state === 'CANCELLED' || state === 'SUPERSEDED';
}

export function isFinished(state: JobState): boolean {
  return state === 'PUBLISHED' || isTerminal(state);
}
