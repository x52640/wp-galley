import type { Observation, ReviewChange, ReviewItem } from '../service/types.js';

/**
 * 建議的四種顏色（B1 右欄的篩選、校樣上的標記用同一套）。
 *
 * Agent 給的分類比較細（typo／grammar／clarity／style、四種觀察），使用者要的是
 * 「這一項要我動腦多少」：錯字按了就好，寫法要看一下，事實與出處要自己查。
 */

export type SuggestionKind = 'typo' | 'style' | 'fact' | 'source';

export const KIND_LABEL: Record<SuggestionKind, string> = {
  typo: '錯字',
  style: '寫法',
  fact: '事實',
  source: '出處',
};

export const KIND_ORDER: readonly SuggestionKind[] = ['typo', 'style', 'fact', 'source'];

const CHANGE_KIND: Record<ReviewChange['type'], SuggestionKind> = {
  typo: 'typo',
  grammar: 'style',
  clarity: 'style',
  style: 'style',
};

const OBSERVATION_KIND: Record<Observation['kind'], SuggestionKind> = {
  contradiction: 'fact',
  'unsupported-claim': 'fact',
  gap: 'fact',
  'missing-source': 'source',
};

export const DETAIL_LABEL: Record<ReviewChange['type'] | Observation['kind'], string> = {
  typo: '錯字',
  grammar: '語法',
  clarity: '不夠清楚',
  style: '用字',
  contradiction: '前後矛盾',
  'unsupported-claim': '沒有依據',
  'missing-source': '沒標出處',
  gap: '交代不足',
};

export function kindOf(item: ReviewItem): SuggestionKind {
  if (item.change) return CHANGE_KIND[item.change.type];
  if (item.observation) return OBSERVATION_KIND[item.observation.kind];
  return 'style';
}

export function detailOf(item: ReviewItem): string {
  if (item.change) return DETAIL_LABEL[item.change.type];
  if (item.observation) return DETAIL_LABEL[item.observation.kind];
  return '';
}

/** 還沒有下場的：pending 加上 unappliable（定位不到、等使用者決定）。 */
export function isOpen(item: ReviewItem): boolean {
  return item.state === 'pending' || item.state === 'unappliable';
}

/**
 * 「按了就好」的那一群：Agent 自己說不改變原意的錯字。
 *
 * 這一群可以一次全部接受（決策 D-010 的一鍵；Q-3 目前的預設）。`meaningChanged`
 * 為真的永遠不進來，要一項一項看。
 */
export function isSafeTypo(item: ReviewItem): boolean {
  return item.state === 'pending' && item.change?.type === 'typo' && item.change.meaningChanged === false;
}

/** 校樣上要標出來的那段文字。改動標 before，觀察標它引用的片段。 */
export function highlightText(item: ReviewItem): string | null {
  if (!isOpen(item)) return null;
  if (item.change) return item.change.before;
  if (item.observation) return item.observation.excerpt;
  return null;
}
