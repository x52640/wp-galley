import { createHash } from 'node:crypto';

/**
 * Revision 的內容 hash。
 *
 * 這是**核准機制的地基**（計畫 §5）：使用者按下「確認發布」時，核准的是一個
 * 特定的 hash；之後只要內容有任何改動，重算出來的 hash 就對不上，核准立即失效。
 *
 * 因此它必須：
 * - 只涵蓋會影響「發布結果」的東西。預覽外框、顯示用日期都不算數，
 *   否則使用者只是換個預覽日期就會莫名其妙掉核准。
 * - 完全決定性。不碰時鐘、亂數或環境變數。
 * - 對物件鍵值排序，JSON 欄位順序不同不該產生不同的 hash。
 *
 * 放在 core/ 而不是 templates/：階段 5 的核准與階段 6 的 MCP 都要算同一個 hash，
 * 而且不一定會經過渲染流程。
 */

export interface RevisionHashInput {
  readonly templateId: string;
  readonly templateHash: string;
  /** 要送去 WordPress 的 HTML。 */
  readonly publishHtml: string;
  /** 標題、slug、標籤等會一併寫進 WordPress 的欄位。 */
  readonly fields: Record<string, unknown>;
}

/** 遞迴排序物件鍵值，確保序列化結果與輸入的鍵值順序無關。 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, canonicalize((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

/** 產生穩定的序列化字串。除錯時可以直接比對兩個 revision 差在哪。 */
export function canonicalizeRevision(input: RevisionHashInput): string {
  return JSON.stringify({
    templateId: input.templateId,
    templateHash: input.templateHash,
    publishHtml: input.publishHtml,
    fields: canonicalize(input.fields),
  });
}

export function computeRevisionHash(input: RevisionHashInput): string {
  return createHash('sha256').update(canonicalizeRevision(input)).digest('hex');
}
