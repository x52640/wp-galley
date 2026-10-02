import { findIgnoringSpaces } from '../../contract/text-match.js';

/**
 * 卡片的「去原文改／自己改」游標停哪裡（P5-T010、P5-T017、P5-T031）。只看文字節點的字，才測得到；
 * 把結果換成 DOM Range 是 `ProofView` 的事。
 *
 * - 先在正文（有段落就只在那一段）找引用的字，找到就停那裡。
 * - 沒有段落、正文找不到：到打字模式可編輯的標題裡找（P5-T031）——講標題的建議（「標題是『hello』，
 *   看起來像暫定標題」）本來就沒有段落，字在標題裡。有段落的不去標題找：那一項講的是正文某段。
 * - 都找不到：`fallback`，照舊放那一段或文章開頭。
 */
export type EditCaret =
  | { readonly in: 'body' | 'title'; readonly node: number; readonly start: number; readonly end: number }
  | { readonly in: 'fallback' };

export function locateEditCaret(
  request: { caret: string | null; caretSkipInside?: string | null; blockIndex: number | null },
  scopeTexts: readonly string[],
  titleTexts: readonly string[],
): EditCaret {
  if (request.caret === null) return { in: 'fallback' };
  const inBody = findInTexts(scopeTexts, request.caret, request.caretSkipInside);
  if (inBody !== null) return { in: 'body', ...inBody };
  if (request.blockIndex !== null) return { in: 'fallback' };
  const inTitle = findInTexts(titleTexts, request.caret, request.caretSkipInside);
  return inTitle === null ? { in: 'fallback' } : { in: 'title', ...inTitle };
}

/** 第一個含那段字的文字節點（只在單一節點裡找，跟標記同一條規則）。 */
function findInTexts(
  texts: readonly string[],
  needle: string,
  skipInside: string | null | undefined,
): { node: number; start: number; end: number } | null {
  for (let node = 0; node < texts.length; node++) {
    const hit = findIgnoringSpaces(texts[node]!, needle, skipInside);
    if (hit !== null) return { node, ...hit };
  }
  return null;
}

/**
 * 「去原文改／自己改」最後沒有東西可標時，頂端要講的話（P5-T037）。
 *
 * 只在「有要找的字」而且「字與段落都標不出來」（`editTarget` 回 `target: null`）時講：游標掉在文章開頭，
 * 不講的話使用者會以為游標停的地方就是要改的地方。段落找得到、字找不到的照舊標整段，不另提示；
 * 從上方「改原文」進來的（沒有要找的字）也不講。
 */
export function missingTargetNotice(caret: string | null, hasTarget: boolean): string | null {
  if (caret === null || caret.trim().length === 0 || hasTarget) return null;
  return `文章裡找不到「${caret}」，游標放在文章開頭。`;
}
