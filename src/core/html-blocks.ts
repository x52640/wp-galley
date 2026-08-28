import { parseFragment, serializeOuter } from 'parse5';
import type { DefaultTreeAdapterMap } from 'parse5';

/**
 * 正文的「頂層區塊」拆解。
 *
 * 為什麼需要它：校對符號（ProofMark）與「把圖片插在第 n 段之後」都用同一套
 * 索引——UI 在頁邊畫的符號、使用者點的插入位置、後端算出的差異，三者必須指向
 * 同一件東西，否則符號會標錯段。所以拆解只實作一次，放在 core/。
 *
 * 用 parse5 而不是正規表示式：正文可能有巢狀清單、引用裡包段落，用字串比對
 * 遲早會把 `</p>` 算錯位置。parse5 已經是專案依賴（block-parse.ts 在用）。
 *
 * 這裡不做安全性檢查——輸入一定是 sanitize 過的 publishHtml。
 */

type Node = DefaultTreeAdapterMap['node'];
type ParentNode = DefaultTreeAdapterMap['parentNode'];

function childrenOf(node: Node): Node[] {
  return 'childNodes' in node ? ((node as ParentNode).childNodes as Node[]) : [];
}

function isElement(node: Node): boolean {
  return 'tagName' in node;
}

export interface TopLevelBlock {
  /** 這個區塊的完整 HTML（含自己的標籤）。 */
  readonly html: string;
  /** 去掉標籤後的純文字，用來比對兩個版本是不是同一段。 */
  readonly text: string;
  readonly tag: string;
}

function textOf(node: Node): string {
  if (node.nodeName === '#text') {
    return (node as DefaultTreeAdapterMap['textNode']).value;
  }
  return childrenOf(node)
    .map((child) => textOf(child))
    .join('');
}

/**
 * 拆成頂層區塊。裸文字節點（沒被段落包住）也算一個區塊，
 * 否則 flexible 模式下的內容會憑空少掉一段，索引就全錯了。
 */
export function splitTopLevelBlocks(html: string): TopLevelBlock[] {
  const fragment = parseFragment(html) as unknown as Node;
  const blocks: TopLevelBlock[] = [];

  for (const child of childrenOf(fragment)) {
    if (isElement(child)) {
      blocks.push({
        html: serializeOuter(child as DefaultTreeAdapterMap['element']),
        text: normalizeText(textOf(child)),
        tag: (child as DefaultTreeAdapterMap['element']).tagName,
      });
      continue;
    }
    if (child.nodeName === '#text') {
      const raw = (child as DefaultTreeAdapterMap['textNode']).value;
      if (raw.trim().length === 0) continue;
      blocks.push({ html: raw, text: normalizeText(raw), tag: '#text' });
    }
  }

  return blocks;
}

/** 比對用的正規化：摺疊空白。中文標點與英文字母都原樣保留。 */
export function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * 把一段 HTML 插在第 `afterBlockIndex` 個頂層區塊後面。
 * `afterBlockIndex` 為 -1 代表插在最前面；超過長度就接在最後。
 */
export function insertBlockAfter(html: string, afterBlockIndex: number, snippet: string): string {
  const blocks = splitTopLevelBlocks(html).map((block) => block.html);
  const at = Math.max(-1, Math.min(afterBlockIndex, blocks.length - 1));
  blocks.splice(at + 1, 0, snippet);
  return blocks.join('\n');
}

/** 移除符合條件的頂層區塊，回傳新的 HTML 與移除數量。 */
export function removeBlocksWhere(
  html: string,
  predicate: (block: TopLevelBlock, index: number) => boolean,
): { html: string; removed: number } {
  const blocks = splitTopLevelBlocks(html);
  const kept = blocks.filter((block, index) => !predicate(block, index));
  return { html: kept.map((block) => block.html).join('\n'), removed: blocks.length - kept.length };
}

/** 逐個頂層區塊做字串取代，只動被 predicate 選中的區塊。 */
export function replaceBlocksWhere(
  html: string,
  predicate: (block: TopLevelBlock, index: number) => boolean,
  replacer: (block: TopLevelBlock, index: number) => string,
): { html: string; replaced: number } {
  const blocks = splitTopLevelBlocks(html);
  let replaced = 0;
  const next = blocks.map((block, index) => {
    if (!predicate(block, index)) return block.html;
    replaced += 1;
    return replacer(block, index);
  });
  return { html: next.join('\n'), replaced };
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** 純文字 → HTML 文字節點／屬性值。 */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
}
