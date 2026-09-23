import { parseFragment, serializeOuter } from 'parse5';
import type { DefaultTreeAdapterMap } from 'parse5';
import { findIgnoringSpaces } from '../contract/text-match.js';

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
 * 出現在頂層時要併進同一個段落，而不是各自成為一個區塊。
 *
 * 這份清單是**唯一**的一份：`wordpress/block-parse.ts` 直接 import 它。
 * 兩邊各自維護一份的話，預覽數出來的區塊數就會跟發布出去的區塊數不一樣，
 * 校對符號與「插在第幾塊後面」又會標錯段。
 */
export const INLINE_TAGS: ReadonlySet<string> = new Set([
  'a', 'strong', 'em', 'b', 'i', 'u', 's', 'code', 'span', 'br',
  'sub', 'sup', 'small', 'mark', 'abbr', 'cite', 'q', 'time', 'del', 'ins',
]);

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
 * 把頂層的裸文字與行內標籤包進 `<p>`，讓正文的頂層節點**全部都是元素**。
 *
 * 為什麼一定要做：同一份正文有三套人在數「第幾個區塊」——
 *   1. `splitTopLevelBlocks()`：文字節點也算一塊
 *   2. 前端量的 `body.children`：文字節點不算
 *   3. `toBlockMarkup()`：連續的裸文字與行內標籤會被併成**一個**段落區塊
 * 三套數出來不一樣，校對符號就會標到隔壁段，圖片也會插錯位置。
 *
 * 修法選在渲染這一端而不是改任何一套數法：包起來之後三套自然一致，
 * 而且預覽會更誠實——使用者看到的段落就是實際會發布出去的段落。
 * 分組規則刻意跟 `block-parse.ts` 的 `parseNodes` 一模一樣。
 *
 * 沒有東西需要包時**原樣回傳**，不重新序列化——否則既有內容的 content hash
 * 會因為空白與屬性引號的正規化而平白改變，核准就全部失效了。
 */
/**
 * 哪一個頂層區塊裝著這段文字。找不到就回 null。
 *
 * 用途只有一個：讓待處理清單上的一項可以「跳到那一段並標亮」。所以定位失敗
 * 不是錯誤，只是那一項沒有跳轉按鈕——猜一個段落跳過去比不能跳更糟。
 *
 * 比對時忽略所有空白，規則跟前端字上標記共用（見 `findIgnoringSpaces`）。
 */
export function findBlockContaining(blocks: readonly TopLevelBlock[], needle: string): number | null {
  const index = blocks.findIndex((block) => findIgnoringSpaces(block.text, needle) !== null);
  return index < 0 ? null : index;
}

export function wrapBareTopLevelText(html: string): string {
  const fragment = parseFragment(html) as unknown as Node;
  const children = childrenOf(fragment);

  const needsWrapping = children.some((child) => {
    if (child.nodeName === '#text') {
      return (child as DefaultTreeAdapterMap['textNode']).value.trim().length > 0;
    }
    return isElement(child) && INLINE_TAGS.has((child as DefaultTreeAdapterMap['element']).tagName);
  });
  if (!needsWrapping) return html;

  const out: string[] = [];
  let inline: string[] = [];

  const flush = (): void => {
    const joined = inline.join('').trim();
    inline = [];
    if (joined.length > 0) out.push(`<p class="wp-block-paragraph">${joined}</p>`);
  };

  for (const child of children) {
    if (child.nodeName === '#text') {
      const value = (child as DefaultTreeAdapterMap['textNode']).value;
      // 區塊之間的空白是排版；一段行內內容中間的空白有意義，要留著。
      if (value.trim().length === 0) {
        if (inline.length > 0) inline.push(value);
        continue;
      }
      inline.push(escapeTextNode(value));
      continue;
    }

    if (isElement(child) && INLINE_TAGS.has((child as DefaultTreeAdapterMap['element']).tagName)) {
      inline.push(serializeOuter(child as DefaultTreeAdapterMap['element']));
      continue;
    }

    flush();
    out.push(serializeOuter(child as DefaultTreeAdapterMap['element']));
  }

  flush();
  return out.join('\n');
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

/**
 * 文字節點 → HTML。只動 `& < >`，引號原樣保留。
 *
 * 跟 `escapeHtml` 分開是刻意的：引號在文字節點裡沒有語意，包成 `&quot;` 會讓
 * `wrapBareTopLevelText()` 包過的段落跟 `toBlockMarkup()` 自己併出來的段落
 * 產生位元組差異，區塊標記就不再是同一份東西了。
 * `wordpress/block-parse.ts` 直接 import 這一個，兩邊只有一份實作。
 */
export function escapeTextNode(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
