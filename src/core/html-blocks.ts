import { parseFragment, serializeOuter } from 'parse5';
import type { DefaultTreeAdapterMap } from 'parse5';
import { findIgnoringSpaces } from '../contract/text-match.js';
import {
  cleanRichEdit,
  richUnits,
  serializeRichEdit,
  type RichNode,
} from '../contract/rich-text.js';

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
export function findBlockContaining(
  blocks: readonly TopLevelBlock[],
  needle: string,
  skipInside?: string | null,
): number | null {
  const index = blocks.findIndex((block) => findIgnoringSpaces(block.text, needle, skipInside) !== null);
  return index < 0 ? null : index;
}

/**
 * 所有裝著這段文字的頂層區塊（比對規則同 `findBlockContaining`）。
 *
 * 要「確定是哪一段」才動手的地方用這個（例如 AI 配圖照錨點自動放進正文，P5-T016）：
 * 只有一段對得上才算數，兩段以上就是有歧義，不猜。
 */
export function findBlocksContaining(blocks: readonly TopLevelBlock[], needle: string): number[] {
  return blocks.flatMap((block, index) => (findIgnoringSpaces(block.text, needle) === null ? [] : [index]));
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

/** 這個元素是不是那張圖：`<img>` 的 class 裡有 `wp-image-N` 這個 token。 */
function isImageOf(element: DefaultTreeAdapterMap['element'], mediaId: number): boolean {
  if (element.tagName !== 'img') return false;
  const cls = element.attrs.find((attr) => attr.name === 'class')?.value ?? '';
  return cls.split(/\s+/).includes(`wp-image-${mediaId}`);
}

/**
 * 拿掉圖片之後，只剩這些就算「空了」、包它的也一起拿掉：換行、空白、沒有內容的行內包裝
 * （例如包著圖的 `<a>`）與段落、群組、figure、引用、清單與清單項目、標題等容器。
 * 其他元素（hr、影片、嵌入、表格…）都算內容——表格的空格子拿掉會把表格弄壞，不碰。
 */
const EMPTYABLE_TAGS: ReadonlySet<string> = new Set([
  ...INLINE_TAGS,
  'p', 'div', 'figure', 'figcaption', 'blockquote', 'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'section', 'article', 'aside', 'header', 'footer', 'main', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre',
]);

function countImages(node: Node): number {
  if (isElement(node) && (node as DefaultTreeAdapterMap['element']).tagName === 'img') return 1;
  return childrenOf(node).reduce((sum, child) => sum + countImages(child), 0);
}

/**
 * 圖庫：class 有 `wp-block-gallery`，或裡面不只一張圖。圖庫不是「包這張圖的 figure」，
 * 拿掉一張時只拿那張（它自己的 figure，沒有就 img 本身），其他張留著。
 */
function isGalleryFigure(element: DefaultTreeAdapterMap['element']): boolean {
  const cls = element.attrs.find((attr) => attr.name === 'class')?.value ?? '';
  return cls.split(/\s+/).includes('wp-block-gallery') || countImages(element) > 1;
}

function hasContent(node: Node): boolean {
  if (node.nodeName === '#text') {
    return !/^[ \t\r\n]*$/.test((node as DefaultTreeAdapterMap['textNode']).value);
  }
  if (!isElement(node)) return false;
  const element = node as DefaultTreeAdapterMap['element'];
  if (element.tagName === 'br') return false;
  if (!EMPTYABLE_TAGS.has(element.tagName)) return true;
  return childrenOf(element).some((child) => hasContent(child));
}

function detach(node: Node): void {
  const parent = (node as { parentNode?: ParentNode | null }).parentNode;
  if (!parent) return;
  const siblings = parent.childNodes as Node[];
  const at = siblings.indexOf(node);
  if (at >= 0) siblings.splice(at, 1);
}

function collectImages(node: Node, mediaId: number, out: DefaultTreeAdapterMap['element'][]): void {
  if (isElement(node) && isImageOf(node as DefaultTreeAdapterMap['element'], mediaId)) {
    out.push(node as DefaultTreeAdapterMap['element']);
    return;
  }
  for (const child of childrenOf(node)) collectImages(child, mediaId, out);
}

/** 每個頂層區塊拿掉那張圖之後的樣子：`html` 為 null 代表整塊都是那張圖、整塊拿掉。 */
interface ImageStrippedBlock {
  readonly html: string | null;
  readonly touched: boolean;
}

/**
 * 從正文拿掉 `wp-image-N` 那張圖，**只拿掉圖片節點**（審查 #9，P5-T019）。
 *
 * 規則：
 * - 圖在 `<figure>` 裡就連同最近的那個 figure（圖說跟著走）；否則只拿 `<img>`。
 * - 拿掉之後，往上一層一層看：包它的東西空了（只剩空白、`<br>`、空的行內包裝）就一起拿掉。
 * - 頂層區塊整個空了才整塊拿掉；還有字或別的節點就留著剩下的。
 *
 * 以前是整個頂層區塊刪掉——`<p>前文<img>後文</p>` 移動或移除圖片時，前文與後文一起消失。
 * 沒碰到的區塊原樣序列化（跟 `splitTopLevelBlocks` 同一種輸出），區塊索引跟它一致。
 */
function stripImageFromBlocks(html: string, mediaId: number): ImageStrippedBlock[] {
  const fragment = parseFragment(html) as unknown as Node;
  const out: ImageStrippedBlock[] = [];

  for (const child of childrenOf(fragment)) {
    if (child.nodeName === '#text') {
      const raw = (child as DefaultTreeAdapterMap['textNode']).value;
      if (raw.trim().length > 0) out.push({ html: raw, touched: false });
      continue;
    }
    if (!isElement(child)) continue;
    const block = child as DefaultTreeAdapterMap['element'];

    const images: DefaultTreeAdapterMap['element'][] = [];
    collectImages(block, mediaId, images);
    if (images.length === 0) {
      out.push({ html: serializeOuter(block), touched: false });
      continue;
    }

    let blockGone = false;
    for (const image of images) {
      // 最近的 figure（到頂層區塊為止）；沒有、或最近的是圖庫，就是圖本身。
      let target: Node = image;
      for (let at: Node | null = image; at && at !== fragment; at = parentOf(at)) {
        if (isElement(at) && (at as DefaultTreeAdapterMap['element']).tagName === 'figure') {
          if (!isGalleryFigure(at as DefaultTreeAdapterMap['element'])) target = at;
          break;
        }
      }
      if (target === block) {
        blockGone = true;
        break;
      }
      let parent = parentOf(target);
      detach(target);
      while (parent && parent !== block && !hasContent(parent)) {
        const next = parentOf(parent);
        detach(parent);
        parent = next;
      }
    }

    if (blockGone || !hasContent(block)) {
      out.push({ html: null, touched: true });
      continue;
    }
    out.push({ html: serializeOuter(block), touched: true });
  }

  return out;
}

/** 正文裡有沒有這張圖：`<img>` 的 class 有 `wp-image-N` 這個 token。文字裡寫著「wp-image-N」不算。 */
export function containsImage(html: string, mediaId: number): boolean {
  const images: DefaultTreeAdapterMap['element'][] = [];
  collectImages(parseFragment(html) as unknown as Node, mediaId, images);
  return images.length > 0;
}

/**
 * 這張圖在第幾個頂層區塊（第一個出現的；索引同 `splitTopLevelBlocks`）。不在正文裡回 -1。
 * 判斷規則同 `containsImage`，跟移動、移除、換圖認的是同一件事。
 */
export function findImageBlockIndex(html: string, mediaId: number): number {
  const fragment = parseFragment(html) as unknown as Node;
  let index = 0;
  for (const child of childrenOf(fragment)) {
    if (child.nodeName === '#text') {
      if ((child as DefaultTreeAdapterMap['textNode']).value.trim().length > 0) index += 1;
      continue;
    }
    if (!isElement(child)) continue;
    const images: DefaultTreeAdapterMap['element'][] = [];
    collectImages(child, mediaId, images);
    if (images.length > 0) return index;
    index += 1;
  }
  return -1;
}

function parentOf(node: Node): Node | null {
  return ((node as { parentNode?: ParentNode | null }).parentNode as Node | null | undefined) ?? null;
}

/**
 * 從正文拿掉那張圖（規則見 `stripImageFromBlocks`）。
 * `touched`：動到幾個頂層區塊；`droppedIndexes`：整塊拿掉的是原本的第幾塊（插圖位置要往前挪）。
 * 沒碰到任何區塊時原樣回傳，不重新序列化。
 */
export function removeImageFromBody(
  html: string,
  mediaId: number,
): { html: string; touched: number; droppedIndexes: number[] } {
  const blocks = stripImageFromBlocks(html, mediaId);
  const touched = blocks.filter((block) => block.touched).length;
  if (touched === 0) return { html, touched: 0, droppedIndexes: [] };
  const droppedIndexes = blocks.flatMap((block, index) => (block.html === null ? [index] : []));
  return {
    html: blocks.flatMap((block) => (block.html === null ? [] : [block.html])).join('\n'),
    touched,
    droppedIndexes,
  };
}

/**
 * 把正文裡那張圖換成 `snippet`（新圖的 figure）。
 * 整塊都是那張圖就原地換；那塊還有別的內容（同段文字）就留著，新圖接在那塊後面。
 */
export function replaceImageInBody(html: string, mediaId: number, snippet: string): { html: string; replaced: number } {
  const blocks = stripImageFromBlocks(html, mediaId);
  const replaced = blocks.filter((block) => block.touched).length;
  if (replaced === 0) return { html, replaced: 0 };
  const next = blocks.flatMap((block) => {
    if (!block.touched) return [block.html!];
    return block.html === null ? [snippet] : [block.html, snippet];
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

/**
 * HTML 字串 → 共用契約的格式樹（`contract/rich-text.ts`）。註解與其他非元素節點略過。
 * 前端從 DOM 轉出同一種樹，兩邊整理的是同一種東西。
 */
export function htmlToRich(html: string): RichNode[] {
  return childrenOf(parseFragment(html) as unknown as Node).flatMap((child) => toRich(child));
}

function toRich(node: Node): RichNode[] {
  if (node.nodeName === '#text') return [{ type: 'text', text: (node as DefaultTreeAdapterMap['textNode']).value }];
  if (!isElement(node)) return [];
  const element = node as DefaultTreeAdapterMap['element'];
  return [
    {
      type: 'element',
      tag: element.tagName.toLowerCase(),
      attrs: element.attrs.map((attr) => ({ name: attr.name, value: attr.value })),
      children: childrenOf(element).flatMap((child) => toRich(child)),
    },
  ];
}

/**
 * 整理「直接在文章上改」送回來的正文（P5-T010、P5-T028）。
 *
 * contenteditable 產出的 HTML 會帶著模板不認得的東西：`<b>`／`<i>`、帶樣式的 `<span>`、
 * 按 Enter 生出的 `<div>` 與 `<p><br></p>`、全選刪光重打之後頂層的裸文字與 `<br>`，
 * 以及格式工具列（P5-T028）操作後 Chrome 留下的 `<p><ul>`、`ul` 直接包 `ul`、清單項目裡的 div、
 * 引用裡的裸文字。不整理的話 sanitize 會照規則把 `<b>` 拆掉（粗體靜靜消失），hybrid 模板的結構驗證
 * 會因為頂層裸文字整份退回，古騰堡轉換會把清單退成 wp:html。
 *
 * **只整理使用者改過的頂層區塊**（`contract/rich-text.ts` 的 `cleanRichEdit`，前端存檔前也是同一套）：
 * 給了 `baseline`（上一版**實際會發布的正文**，也就是 sanitize 之後的 publishHtml——前端校樣顯示的就是它）時
 * 逐塊比對，對得上的區塊輸出基準裡那份（解析器修補過、已 sanitize）的 HTML，不重新整理——整理規則再怎麼小心，
 * 也不該改寫使用者沒碰過的內容。沒給就整份整理。
 * 頂層的裸文字與行內標籤在這裡就包成段落（`<br>` 當作分段），不留給 render 的 `wrapBareTopLevelText`：
 * 結構驗證跑在它之前，驗的是這裡的輸出。
 *
 * **這不是安全關卡**：整理完（含原樣保留的區塊）照樣走 schema、sanitize、結構驗證。這裡不擋標籤
 * （sanitize 擋）；給了 `allowedSchemes` 時，不收的連結（`safeHref`）拆成純文字。
 */
export function normalizeEditedBody(
  html: string,
  options: { allowedSchemes?: readonly string[]; baseline?: string | null } = {},
): string {
  const previous = typeof options.baseline === 'string' ? richUnits(htmlToRich(options.baseline)) : null;
  const result = cleanRichEdit(
    htmlToRich(html),
    previous,
    options.allowedSchemes === undefined ? {} : { allowedSchemes: options.allowedSchemes },
  );
  return serializeRichEdit(result);
}
