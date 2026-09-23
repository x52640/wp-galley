import type { JobState } from '../service/types.js';

/**
 * 狀態機在畫面上的樣子（契約 §二）。
 *
 * 左軌只有一條線性順序，因為使用者要的是「我走到哪裡了」。狀態機本身允許
 * 回頭（核准失效退回 RENDERED），那在左軌上表現為印章被撕掉，不是倒退的動畫。
 */

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

/** 線性進度上的位置。終止狀態不在這條線上，回 -1。 */
export const STATE_RANK: Record<JobState, number> = {
  SOURCE: 0,
  REVIEWED: 1,
  MEDIA_READY: 2,
  RENDERED: 3,
  PREVIEWED: 4,
  APPROVED: 5,
  PUBLISHING: 6,
  PUBLISHED: 7,
  FAILED: -1,
  CANCELLED: -1,
  SUPERSEDED: -1,
};

export type StepStatus = 'done' | 'current' | 'todo';

export interface RailStep {
  key: 'source' | 'review' | 'media' | 'render' | 'preview' | 'publish';
  /** 等寬數字，左軌的骨架。 */
  num: string;
  label: string;
  rank: number;
  /** 這一步不是必經的：貼完稿可以直接渲染發布（契約 §二）。 */
  optional?: boolean;
}

export const RAIL_STEPS: readonly RailStep[] = [
  { key: 'source', num: '01', label: '原稿', rank: 0 },
  { key: 'review', num: '02', label: '校稿', rank: 1, optional: true },
  { key: 'media', num: '03', label: '配圖', rank: 2, optional: true },
  { key: 'render', num: '04', label: '渲染', rank: 3 },
  { key: 'preview', num: '05', label: '預覽', rank: 4 },
  { key: 'publish', num: '06', label: '發布', rank: 6 },
];

export function isTerminal(state: JobState): boolean {
  return state === 'FAILED' || state === 'CANCELLED' || state === 'SUPERSEDED';
}

export function isFinished(state: JobState): boolean {
  return state === 'PUBLISHED' || isTerminal(state);
}

export function railStatus(step: RailStep, state: JobState): StepStatus {
  const rank = STATE_RANK[state];
  if (rank < 0) return 'todo';
  if (step.key === 'publish') {
    if (state === 'PUBLISHED') return 'done';
    if (state === 'PUBLISHING') return 'current';
    return 'todo';
  }
  if (rank > step.rank) return 'done';
  if (rank === step.rank) return 'current';
  return 'todo';
}

/** 右面板現在該把哪一張卡片攤開。 */
export type PanelKey =
  | 'source'
  | 'agent'
  | 'review'
  | 'media'
  | 'taxonomy'
  | 'approve'
  | 'publish'
  | 'result';

/**
 * 有待處理的項目時，那張卡片優先攤開。
 *
 * 狀態機不知道清單的存在（清單不改變狀態），所以這件事只能在畫面這一層決定：
 * 使用者的下一步是「把清單清完」，不是往下一格走。
 */
export function primaryPanel(state: JobState, hasPendingReview = false): PanelKey {
  if (hasPendingReview && state !== 'PUBLISHING' && state !== 'PUBLISHED' && !isTerminal(state)) {
    return 'review';
  }
  switch (state) {
    case 'SOURCE':
      return 'source';
    case 'REVIEWED':
      return 'media';
    case 'MEDIA_READY':
      return 'taxonomy';
    case 'RENDERED':
    case 'PREVIEWED':
      return 'approve';
    case 'APPROVED':
      return 'publish';
    default:
      return 'result';
  }
}
