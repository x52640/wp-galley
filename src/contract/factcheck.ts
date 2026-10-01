/**
 * AI 查證前後端都要的規則（D-033：示範資料不重寫規則；規格 docs/specs/factcheck.md）。
 * 後端（`src/core/service/factcheck.ts`）與示範資料用同一份。
 */

import type { FactCheckFinding, FactCheckScope } from './api-factcheck.js';
import { findIgnoringSpaces } from './text-match.js';

/** 選字查證的字數範圍（空白摺疊後、以 code point 數）。 */
export const FACTCHECK_SELECTION_MIN = 4;
export const FACTCHECK_SELECTION_MAX = 300;

export const FACTCHECK_SCOPES: readonly FactCheckScope[] = ['selection', 'observation', 'article'];

/** 只有這三種校稿觀察卡片有「查證」按鈕（「這句沒出處」「沒標出處」「前後矛盾」）。 */
export const FACTCHECK_OBSERVATION_KINDS = ['unsupported-claim', 'missing-source', 'contradiction'] as const;

export function canFactCheckObservation(kind: string): boolean {
  return (FACTCHECK_OBSERVATION_KINDS as readonly string[]).includes(kind);
}

/** 選字的長度：空白摺疊、去頭尾後數 code point。 */
export function selectionLength(text: string): number {
  return Array.from(text.replace(/\s+/gu, ' ').trim()).length;
}

/** 選字能不能查：太短、太長都講原因。「在文章裡找不找得到」要有內容，另外判斷（`isExcerptGone`）。 */
export function checkFactCheckSelection(text: string): { ok: true } | { ok: false; message: string } {
  const length = selectionLength(text);
  if (length < FACTCHECK_SELECTION_MIN) {
    return { ok: false, message: `選的字太短，至少要 ${FACTCHECK_SELECTION_MIN} 個字才能查證` };
  }
  if (length > FACTCHECK_SELECTION_MAX) {
    return { ok: false, message: `選的字太長，一次最多查 ${FACTCHECK_SELECTION_MAX} 個字；選短一點，或用「一鍵查證」查整篇` };
  }
  return { ok: true };
}

/**
 * 原句已經改了：excerpt 在目前的任何一段文字（標題、正文、各段）裡都找不到（忽略空白，`text-match`）。
 * 空的 excerpt 也算找不到。
 */
export function isExcerptGone(excerpt: string, texts: readonly string[]): boolean {
  if (excerpt.replace(/\s+/gu, '').length === 0) return true;
  return !texts.some((text) => findIgnoringSpaces(text, excerpt) !== null);
}

/** 發布面板提醒：「說法不同」、還沒結案、原句還在的條數（不是 blocker）。 */
export function countOpenContradictions(
  findings: readonly Pick<FactCheckFinding, 'verdict' | 'status' | 'excerptGone'>[],
): number {
  return findings.filter((f) => f.verdict === 'contradicted' && f.status === 'open' && !f.excerptGone).length;
}

/** 發布面板那一行提醒；0 條是 null。 */
export function openContradictionNotice(count: number): string | null {
  return count > 0 ? `有 ${count} 條查證說法不同` : null;
}
