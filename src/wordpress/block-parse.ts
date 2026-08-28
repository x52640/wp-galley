import { parseFragment, serializeOuter } from 'parse5';
import type { DefaultTreeAdapterMap } from 'parse5';
import {
  BlockConversionError,
  HARD_NESTING_LIMIT,
  isSafeCssLength,
  isSafeSlug,
  MAX_NESTING_DEPTH,
  type Block,
  type BlockDefaults,
  type ListBlock,
  type ListItem,
} from './block-types.js';

/**
 * sanitize 過的 HTML → 區塊 IR。
 *
 * 輸入一定是已經通過 manifest allowlist 的 HTML（見 templates/sanitize.ts），
 * 所以這裡不做安全性檢查，只做「結構辨識」。
 *
 * 貫穿整個檔案的一條規則：**辨識不出來就退到 wp:html，絕不靜默丟掉內容。**
 * 這包含兩種情況——
 *   1. 認不得的標籤（table、未預期的 figure 內容…）
 *   2. 認得標籤但**核心表達不了那個形狀**（巢狀清單後面還有文字）
 * 第 2 種特別危險：硬轉會產生「看起來成功、實際上內容被重排」的結果，
 * 比整份失敗還糟。
 *
 * 空白處理：文字節點的前後空白會被 trim。這是刻意的——HTML 的邊界空白沒有語意
 * （瀏覽器一律摺疊），而模板是 nunjucks 渲染的，不 trim 的話模板縮排會被當成
 * 內容發到 WordPress。元素內部與 &nbsp; 不受影響。
 */

type Node = DefaultTreeAdapterMap['node'];
type Element = DefaultTreeAdapterMap['element'];
type ParentNode = DefaultTreeAdapterMap['parentNode'];

function isElement(node: Node): node is Element {
  return 'tagName' in node;
}

function isTextNode(node: Node): node is DefaultTreeAdapterMap['textNode'] {
  return node.nodeName === '#text';
}

function childrenOf(node: Node): Node[] {
  return 'childNodes' in node ? ((node as ParentNode).childNodes as Node[]) : [];
}

function getAttribute(element: Element, name: string): string | null {
  return element.attrs.find((attr) => attr.name === name)?.value ?? null;
}

function classListOf(element: Element): string[] {
  return (getAttribute(element, 'class') ?? '').split(/\s+/).filter((c) => c.length > 0);
}

/**
 * 從 `has-medium-font-size` 這種 class 反推字級；沒有就回傳 undefined。
 *
 * 一定要驗證格式：這個值來自**內容**（不受信任），而且最後會被寫進區塊註解的
 * JSON。允許任意字串的話，`has---->x-font-size` 就能把註解提早關掉。
 */
function fontSizeFromClasses(element: Element): string | undefined {
  for (const cls of classListOf(element)) {
    const match = /^has-(.+)-font-size$/.exec(cls);
    if (match && isSafeSlug(match[1]!)) return match[1]!;
  }
  return undefined;
}

/** 把元素的子節點序列化回行內 HTML。內容已 sanitize 過，直接沿用。 */
function innerHtml(element: Element): string {
  return childrenOf(element)
    .map((child) => serializeOuter(child as never))
    .join('')
    .trim();
}

/** 含元素本身的 HTML。用在逃生門，要原樣保留。 */
function outerHtml(node: Node): string {
  return serializeOuter(node as never);
}

function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 逃生門。 */
function fallback(node: Node): Block {
  return { type: 'html', html: outerHtml(node) };
}

// ---------------------------------------------------------------------------
// 清單
// ---------------------------------------------------------------------------

/**
 * 拆解一個 li：行內文字歸行內，巢狀的 ul/ol 變成獨立的子清單區塊。
 *
 * 回傳 null 代表「核心表達不了這個形狀」，呼叫端要整份退到逃生門。目前只有一種：
 * 子清單**後面**還有內容。核心的 list-item 永遠先存 RichText 再存 InnerBlocks，
 * 硬轉的話那段文字會被搬到子清單前面，順序就被偷偷改掉了。
 */
function parseListItem(li: Element, defaults: BlockDefaults, depth: number): ListItem | null {
  const inline: string[] = [];
  const nested: ListBlock[] = [];

  for (const child of childrenOf(li)) {
    const isSublist = isElement(child) && (child.tagName === 'ul' || child.tagName === 'ol');

    if (isSublist) {
      const sublist = parseList(child, defaults, depth + 1);
      if (sublist === null) continue;            // 空的子清單，忽略
      if (sublist === 'fallback') return null;   // 子清單自己就轉不了
      nested.push(sublist);
      continue;
    }

    const piece = isTextNode(child)
      ? escapeText(child.value)
      : isElement(child)
        ? outerHtml(child)
        : '';
    if (piece.trim().length === 0) continue;

    // 已經看過子清單，後面又冒出內容 → 核心存不了這個順序。
    if (nested.length > 0) return null;
    inline.push(piece);
  }

  return {
    html: inline.join('').trim(),
    fontSize: fontSizeFromClasses(li) ?? defaults.listItemFontSize,
    nested,
  };
}

/**
 * 三種結果要分開，不能都當成失敗：
 * - `ListBlock`：正常轉換
 * - `'fallback'`：有內容但核心表達不了，整份退到 wp:html 保住內容
 * - `null`：完全沒有內容（`<ul></ul>`），直接丟掉。包進 wp:html 只會留下垃圾
 *
 * 會走 `'fallback'` 的情況包含「清單裡有不是 li 的內容」——sanitize 會把
 * `<ul><div>字</div>` 的 div 拆掉但留下文字，直接跳過那些節點就等於把字吃掉了。
 */
function parseList(list: Element, defaults: BlockDefaults, depth: number): ListBlock | 'fallback' | null {
  // 清單的遞迴走 parseList ↔ parseListItem，不經過 parseElement，
  // 所以深度上限一定要在這裡也擋一次，否則極深的巢狀會爆堆疊。
  if (depth > MAX_NESTING_DEPTH) return 'fallback';

  const items: ListItem[] = [];
  let sawContent = false;

  for (const child of childrenOf(list)) {
    if (isElement(child) && child.tagName === 'li') {
      sawContent = true;
      const item = parseListItem(child, defaults, depth);
      if (!item) return 'fallback';
      items.push(item);
      continue;
    }
    // 不是 li 的內容：空白可以忽略，有實體內容就不能硬吞。
    if (isTextNode(child) && child.value.trim().length === 0) continue;
    return 'fallback';
  }

  if (items.length === 0) return sawContent ? 'fallback' : null;
  return { type: 'list', ordered: list.tagName === 'ol', items };
}

// ---------------------------------------------------------------------------
// 圖片
// ---------------------------------------------------------------------------

/** 從 `style="width:800px"` 或 width 屬性取出 CSS 長度，格式不合就當作沒有。 */
function dimensionOf(img: Element, axis: 'width' | 'height'): string | null {
  const style = getAttribute(img, 'style');
  if (style) {
    const match = new RegExp(`${axis}\\s*:\\s*([^;]+)`).exec(style);
    if (match) {
      const value = match[1]!.trim();
      if (isSafeCssLength(value)) return value;
    }
  }
  const attr = getAttribute(img, axis);
  if (attr && /^\d+$/.test(attr)) return `${attr}px`;
  return null;
}

function mediaIdOf(img: Element): number | null {
  const cls = classListOf(img).find((c) => /^wp-image-\d+$/.test(c));
  return cls ? Number(cls.slice('wp-image-'.length)) : null;
}

function imageFromElement(img: Element, figure: Element | null, defaults: BlockDefaults, caption: string | null): Block {
  const classes = figure ? classListOf(figure) : [];
  const alignClass = classes.find((c) => /^align(left|center|right|wide|full)$/.test(c));
  const sizeClass = classes.find((c) => /^size-/.test(c));
  const align = alignClass ? alignClass.slice('align'.length) : defaults.imageAlign;
  const sizeSlug = sizeClass ? sizeClass.slice('size-'.length) : defaults.imageSizeSlug;

  return {
    type: 'image',
    src: getAttribute(img, 'src') ?? '',
    alt: getAttribute(img, 'alt') ?? '',
    mediaId: mediaIdOf(img),
    sizeSlug: isSafeSlug(sizeSlug) ? sizeSlug : defaults.imageSizeSlug,
    align: align !== null && isSafeSlug(align) ? align : null,
    // 空圖說要存成 null；核心的 save() 會略過空圖說，多輸出就判定內容無效。
    caption: caption !== null && caption.length > 0 ? caption : null,
    width: dimensionOf(img, 'width'),
    height: dimensionOf(img, 'height'),
  };
}

/**
 * figure 只有在「剛好一張圖，最多再加一個圖說」時才轉成 image 區塊。
 *
 * 其他形狀（表格、多張圖、圖旁邊還有段落）一律原樣保留——之前的版本只要找得到
 * img 就吃掉整個 figure，多的圖與文字會直接消失。
 */
function parseFigure(figure: Element, defaults: BlockDefaults): Block {
  let img: Element | null = null;
  let caption: string | null = null;

  for (const child of childrenOf(figure)) {
    if (isTextNode(child)) {
      if (child.value.trim().length > 0) return fallback(figure);
      continue;
    }
    if (!isElement(child)) continue;

    if (child.tagName === 'img') {
      if (img) return fallback(figure); // 不只一張圖
      img = child;
      continue;
    }
    if (child.tagName === 'figcaption') {
      if (caption !== null) return fallback(figure);
      caption = innerHtml(child);
      continue;
    }
    return fallback(figure); // 圖片與圖說以外的東西
  }

  if (!img) return fallback(figure);
  return imageFromElement(img, figure, defaults, caption);
}

// ---------------------------------------------------------------------------
// 一般元素
// ---------------------------------------------------------------------------

function parseElement(element: Element, defaults: BlockDefaults, depth: number): Block | null {
  if (depth > MAX_NESTING_DEPTH) return fallback(element);

  switch (element.tagName) {
    case 'p': {
      const html = innerHtml(element);
      if (html.length === 0) return null; // 空段落是排版殘骸，不要發出去
      return {
        type: 'paragraph',
        html,
        fontSize: fontSizeFromClasses(element) ?? defaults.paragraphFontSize,
      };
    }
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6': {
      // h1 留給文章標題，正文的 h1 一律降成 h2。
      const raw = Number(element.tagName.slice(1));
      const level = (raw === 1 ? 2 : raw) as 2 | 3 | 4 | 5 | 6;
      return {
        type: 'heading',
        level,
        html: innerHtml(element),
        fontSize: fontSizeFromClasses(element) ?? defaults.headingFontSize,
      };
    }
    case 'ul':
    case 'ol': {
      const list = parseList(element, defaults, depth);
      return list === 'fallback' ? fallback(element) : list;
    }
    case 'blockquote': {
      const children = parseNodes(childrenOf(element), defaults, depth + 1);
      if (children.length === 0) return null;
      return { type: 'quote', children };
    }
    case 'figure':
      return parseFigure(element, defaults);
    case 'img':
      // 沒有 figure 包住的裸 img，補一層 figure 的語意。
      return imageFromElement(element, null, defaults, null);
    case 'hr': {
      const style = classListOf(element).find((c) => c.startsWith('is-style-') && isSafeSlug(c));
      return { type: 'separator', className: style ?? null };
    }
    default:
      return null;
  }
}

/** parseElement 認得的標籤。認得但回傳 null＝刻意略過（例如空段落），不是無法辨識。 */
const RECOGNIZED_TAGS = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'blockquote', 'figure', 'img', 'hr',
]);

/** 出現在頂層時要併進段落，而不是各自成為一個區塊。 */
const INLINE_TAGS = new Set([
  'a', 'strong', 'em', 'b', 'i', 'u', 's', 'code', 'span', 'br',
  'sub', 'sup', 'small', 'mark', 'abbr', 'cite', 'q', 'time', 'del', 'ins',
]);

function parseNodes(nodes: readonly Node[], defaults: BlockDefaults, depth: number): Block[] {
  const blocks: Block[] = [];
  // 頂層的裸文字與行內標籤會先累積在這裡，遇到區塊邊界時整段收成一個段落。
  let inline: string[] = [];

  const flushInline = (): void => {
    const html = inline.join('').trim();
    inline = [];
    if (html.length > 0) {
      blocks.push({ type: 'paragraph', html, fontSize: defaults.paragraphFontSize });
    }
  };

  for (const node of nodes) {
    if (isTextNode(node)) {
      if (node.value.trim().length === 0) {
        // 區塊之間的空白是排版；但一段行內內容中間的空白有意義，要留著。
        if (inline.length > 0) inline.push(node.value);
        continue;
      }
      inline.push(escapeText(node.value));
      continue;
    }

    if (!isElement(node)) continue;

    if (INLINE_TAGS.has(node.tagName)) {
      inline.push(outerHtml(node));
      continue;
    }

    flushInline();

    const block = parseElement(node, defaults, depth);
    if (block) {
      blocks.push(block);
    } else if (!RECOGNIZED_TAGS.has(node.tagName)) {
      blocks.push(fallback(node));
    }
  }

  flushInline();
  return blocks;
}

/**
 * 用**非遞迴**的方式量出樹的最大深度。
 *
 * 一定要非遞迴：這道檢查存在的目的就是擋住會讓遞迴爆掉的輸入，用遞迴去量
 * 等於在檢查之前先當掉。
 */
function maxDepthOf(root: Node): number {
  let max = 0;
  const stack: { node: Node; depth: number }[] = [{ node: root, depth: 0 }];
  while (stack.length > 0) {
    const { node, depth } = stack.pop()!;
    if (depth > max) max = depth;
    if (depth > HARD_NESTING_LIMIT) return depth; // 已經超標，不必量完
    for (const child of childrenOf(node)) stack.push({ node: child, depth: depth + 1 });
  }
  return max;
}

export function parseBlocks(html: string, defaults: BlockDefaults): Block[] {
  const fragment = parseFragment(html) as unknown as Node;

  const depth = maxDepthOf(fragment);
  if (depth > HARD_NESTING_LIMIT) {
    throw new BlockConversionError(
      `正文的巢狀深度 ${depth} 超過上限 ${HARD_NESTING_LIMIT}，無法轉換成區塊格式`,
    );
  }

  return parseNodes(childrenOf(fragment), defaults, 0);
}
