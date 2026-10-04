import { findIgnoringSpaces } from '../../contract/text-match.js';
import type { SuggestionKind } from './review-kinds.js';
import { markScopes, pickClickedMark } from './factcheck-view.js';
import { unwrapHighlightMarks } from './proof-edit-dom.js';

/**
 * 校樣上的字上標記（B1；P5-T043 從 ProofView 抽出）。
 *
 * 外層把待處理的那段字包進 `<mark>`，顏色用 CSSOM（`element.style`）設定：文件的
 * CSP 擋的是 `<style>` 與 style 屬性，不管外層透過 CSSOM 改樣式；也不注入任何 script。
 * 點標記的事件由外層掛在文件上（處理函式屬於外層，iframe 自己仍然不能跑 script），點到哪一張卡片由 `clickedMarkKey` 決定。
 */

/** 校樣上要標出來的一段字。 */
export interface ProofHighlight {
  /** 卡片的 key：校稿 `r<id>`、查證 `f<id>`（兩張表的 id 會撞號）。 */
  id: string;
  /** 校稿的四種分類，或查證（跟校稿不同的樣式，D-034）。 */
  kind: SuggestionKind | 'factcheck';
  text: string;
  /** 掛在第幾個頂層區塊；null＝定位不到，就在整篇裡找第一個。 */
  blockIndex: number | null;
  /**
   * 落在這段字（建議的 after）裡的不標（P5-T017）：「很多事→很多事情」在已經有「很多事情」的文章裡，
   * 要標的是另一個還沒改的「很多事」，跟按接受真的會改的位置一致。
   */
  skipInside?: string | null;
}

/**
 * 標記的顏色。跟 styles/01-tokens.css 的 --kind-* 同一套，這裡要能直接寫進 iframe。
 * 查證（`factcheck`，對應 --kind-check）用靛藍**虛線底線**、很淡的底，跟校稿的實線底線分得開；
 * 它用 text-decoration 畫線，校稿標記包在它裡面（同一句既有觀察卡片又有查證）時兩條線都看得到。
 */
export const HIGHLIGHT_COLORS: Record<SuggestionKind | 'factcheck', { bg: string; line: string; dashed?: boolean }> = {
  typo: { bg: '#FCE3D6', line: '#C2410C' },
  style: { bg: '#E4EDE8', line: '#3F5B4F' },
  fact: { bg: '#DDE8F5', line: '#1E4F8A' },
  source: { bg: '#F6EDCF', line: '#8A6A14' },
  factcheck: { bg: '#F0EFFB', line: '#3730A3', dashed: true },
};

/** 標記屬於哪一組：同一組的標記裡不再包，另一組的可以包在裡面。 */
export function highlightGroup(kind: ProofHighlight['kind']): 'factcheck' | 'review' {
  return kind === 'factcheck' ? 'factcheck' : 'review';
}

/**
 * 一個標記的樣式（CSSOM 屬性名 → 值），照設定的先後排好：外層用 `Object.assign(mark.style, …)` 依序寫進去。
 * 亮著的那一個多一圈外框。
 */
export function highlightStyle(kind: ProofHighlight['kind'], active: boolean): Record<string, string> {
  const color = HIGHLIGHT_COLORS[kind];
  const style: Record<string, string> = { background: color.bg, color: 'inherit' };
  if (color.dashed) {
    style.textDecoration = `underline dashed ${color.line}`;
    style.textDecorationThickness = '2px';
    style.textUnderlineOffset = '5px';
  } else {
    style.borderBottom = `2px solid ${color.line}`;
  }
  style.borderRadius = '2px';
  style.cursor = 'pointer';
  if (active) {
    style.outline = `2px solid ${color.line}`;
    style.outlineOffset = '2px';
  }
  return style;
}

/** 標記清單的身分：陣列每次都是新的，內容沒變就不重標。 */
export function highlightKey(highlights: readonly ProofHighlight[]): string {
  return highlights.map((h) => `${h.id}:${h.kind}:${h.blockIndex}:${h.text}`).join('|');
}

/** 點擊落點需要的最小介面（iframe 裡的節點屬於另一個視窗，不能用 instanceof Element）。 */
export interface MarkLike {
  closest?: (selector: string) => MarkLike | null;
  getAttribute: (name: string) => string | null;
  textContent: string | null;
  parentElement: MarkLike | null;
}

/**
 * 點了文章裡的哪一個標記（卡片的 key）；沒點到標記回 null。
 * 同一段字有兩種標記（查證包在校稿裡面）時，點擊只會落在內層：已經亮著再點一次就換外層（審查 A，`pickClickedMark`）。
 */
export function clickedMarkKey(target: MarkLike | null, activeKey: string | null): string | null {
  const mark = typeof target?.closest === 'function' ? target.closest('mark[data-hl]') : null;
  if (!mark) return null;
  const parent = mark.parentElement?.closest?.('mark[data-hl]') ?? null;
  return pickClickedMark(
    { key: mark.getAttribute('data-hl') ?? '', text: mark.textContent ?? '' },
    parent === null ? null : { key: parent.getAttribute('data-hl') ?? '', text: parent.textContent ?? '' },
    activeKey,
  );
}

/**
 * 在 scope 裡找第一段相同的文字（忽略空白，規則跟後端算「第 N 段」共用），包進 `<mark>`。
 *
 * 只在單一文字節點裡找：跨過標籤的（`今天<em>讀完`）不包，跟後端逐項套用的規則
 * 一致（docs/specs/review-proposals.md）——找不到就不標，右欄的卡片照樣在。
 */
export function wrapFirst(doc: Document, scope: Element, highlight: ProofHighlight, active: boolean): boolean {
  if (highlight.text.length === 0) return false;
  const group = highlightGroup(highlight.kind);
  const walker = doc.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node as Text;
    // 同一種（校稿／查證）的標記裡不再包；另一種的可以包在裡面（同一句既有觀察卡片又有查證）。
    if (text.parentElement?.closest(`mark[data-hl-group='${group}']`)) continue;
    const hit = findIgnoringSpaces(text.data, highlight.text, highlight.skipInside);
    if (hit === null) continue;
    const range = doc.createRange();
    range.setStart(text, hit.start);
    range.setEnd(text, hit.end);
    const mark = doc.createElement('mark');
    mark.setAttribute('data-hl', highlight.id);
    mark.setAttribute('data-hl-group', group);
    Object.assign(mark.style, highlightStyle(highlight.kind, active));
    range.surroundContents(mark);
    return true;
  }
  return false;
}

/**
 * 把標記整個重標：先拆掉正文與標題上舊的（標題裡也可能有查證的標記，只出現在標題的那句，Codex 審查 4），
 * `mode` 是 `edit` 才包新的。回傳 true＝包過了（版面可能變了，要重量）；讀不到正文或不是 `edit` 回 false。
 */
export function applyHighlights(
  doc: Document,
  highlights: readonly ProofHighlight[],
  activeHighlight: string | null,
  mode: 'edit' | 'final',
): boolean {
  const body = doc.querySelector('.preview-body');
  if (!body) return false;
  const title = doc.querySelector('.preview-title');
  unwrapHighlightMarks(body);
  if (title) unwrapHighlightMarks(title);
  if (mode !== 'edit') return false;
  for (const highlight of highlights) {
    const active = highlight.id === activeHighlight;
    for (const where of markScopes(highlight.kind, highlight.blockIndex)) {
      const scope = where === 'block' ? body.children[highlight.blockIndex ?? -1] : where === 'title' ? title : body;
      if (scope && wrapFirst(doc, scope, highlight, active)) break;
    }
  }
  return true;
}
