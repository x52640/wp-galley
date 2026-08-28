import { parseFragment, serialize } from 'parse5';
import type { DefaultTreeAdapterMap } from 'parse5';
import type { Block, BlockDefaults, ListBlock, ListItem } from './block-types.js';

/**
 * sanitize 過的 HTML → 區塊 IR。
 *
 * 輸入一定是已經通過 manifest allowlist 的 HTML（見 templates/sanitize.ts），
 * 所以這裡不做安全性檢查，只做「結構辨識」。遇到不認得的頂層元素會落到
 * `html` 區塊當逃生門，不會整份失敗——日記是 flexible 模式，使用者本來就可能
 * 寫出我們沒預期的標記，那時應該照樣發得出去，而不是卡住。
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

/** 從 `has-medium-font-size` 這種 class 反推字級；沒有就回傳 undefined 表示「未指定」。 */
function fontSizeFromClasses(element: Element): string | undefined {
  for (const cls of classListOf(element)) {
    const match = /^has-(.+)-font-size$/.exec(cls);
    if (match) return match[1]!;
  }
  return undefined;
}

/** 把元素的子節點序列化回行內 HTML。內容已 sanitize 過，直接沿用。 */
function innerHtml(element: Element): string {
  return serialize(element).trim();
}

/**
 * 拆解一個 li：行內文字歸行內，巢狀的 ul/ol 變成獨立的子清單區塊。
 *
 * 不能整個 li 的 innerHTML 直接當文字用——那樣子清單會變成 li 富文字內容的一部分，
 * Gutenberg 就認不出它是可編輯的清單區塊了。
 */
function parseListItem(li: Element, defaults: BlockDefaults): ListItem {
  const inline: string[] = [];
  const nested: ListBlock[] = [];

  for (const child of childrenOf(li)) {
    if (isElement(child) && (child.tagName === 'ul' || child.tagName === 'ol')) {
      const sublist = parseElement(child, defaults);
      if (sublist && sublist.type === 'list') nested.push(sublist);
      continue;
    }
    if (isTextNode(child)) {
      inline.push(escapeText(child.value));
      continue;
    }
    if (isElement(child)) inline.push(outerHtml(child));
  }

  return { html: inline.join('').trim(), nested };
}

function parseListItems(
  list: Element,
  defaults: BlockDefaults,
): { items: ListItem[]; itemFontSize: string | undefined } {
  const items: ListItem[] = [];
  let itemFontSize: string | undefined;
  for (const child of childrenOf(list)) {
    if (!isElement(child) || child.tagName !== 'li') continue;
    items.push(parseListItem(child, defaults));
    itemFontSize ??= fontSizeFromClasses(child);
  }
  return { items, itemFontSize };
}

function parseImageFigure(figure: Element, defaults: BlockDefaults): Block {
  let img: Element | null = null;
  let caption: string | null = null;
  for (const child of childrenOf(figure)) {
    if (!isElement(child)) continue;
    if (child.tagName === 'img') img = child;
    if (child.tagName === 'figcaption') caption = innerHtml(child);
  }
  // figure 不一定是圖片——正式站就有 <figure class="wp-block-table"> 包表格。
  // 沒有 img 就走逃生門原樣保留，絕不因為「認得 figure 這個標籤」就把內容丟掉。
  if (!img) return { type: 'html', html: outerHtml(figure) };

  const classes = classListOf(figure);
  const alignClass = classes.find((c) => /^align(left|center|right|wide|full)$/.test(c));
  const sizeClass = classes.find((c) => /^size-/.test(c));
  // 已上傳的圖片會帶 wp-image-<id>，還沒上傳的就沒有。
  const idClass = classListOf(img).find((c) => /^wp-image-\d+$/.test(c));

  return {
    type: 'image',
    src: getAttribute(img, 'src') ?? '',
    alt: getAttribute(img, 'alt') ?? '',
    mediaId: idClass ? Number(idClass.replace('wp-image-', '')) : null,
    sizeSlug: sizeClass ? sizeClass.replace('size-', '') : defaults.imageSizeSlug,
    align: alignClass ? alignClass.replace('align', '') : defaults.imageAlign,
    caption,
  };
}

function parseElement(element: Element, defaults: BlockDefaults): Block | null {
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
      const { items, itemFontSize } = parseListItems(element, defaults);
      if (items.length === 0) return null;
      return {
        type: 'list',
        ordered: element.tagName === 'ol',
        items,
        itemFontSize: itemFontSize ?? defaults.listItemFontSize,
      };
    }
    case 'blockquote': {
      const children = parseNodes(childrenOf(element), defaults);
      if (children.length === 0) return null;
      return { type: 'quote', children };
    }
    case 'figure':
      return parseImageFigure(element, defaults);
    case 'img':
      // 沒有 figure 包住的裸 img，補一層 figure 的語意。
      return {
        type: 'image',
        src: getAttribute(element, 'src') ?? '',
        alt: getAttribute(element, 'alt') ?? '',
        mediaId: null,
        sizeSlug: defaults.imageSizeSlug,
        align: defaults.imageAlign,
        caption: null,
      };
    case 'hr':
      return { type: 'separator' };
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

/** 含元素本身的 HTML。parse5 的 serialize 只給 innerHTML，包一層才拿得到 outer。 */
function outerHtml(node: Node): string {
  return serialize({ childNodes: [node] } as unknown as ParentNode);
}

function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function parseNodes(nodes: readonly Node[], defaults: BlockDefaults): Block[] {
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

    const block = parseElement(node, defaults);
    if (block) {
      blocks.push(block);
    } else if (!RECOGNIZED_TAGS.has(node.tagName)) {
      // 認不得的區塊級元素：原樣包進 wp:html，絕不靜默丟掉。
      blocks.push({ type: 'html', html: outerHtml(node) });
    }
  }

  flushInline();
  return blocks;
}

export function parseBlocks(html: string, defaults: BlockDefaults): Block[] {
  const fragment = parseFragment(html);
  return parseNodes(childrenOf(fragment as unknown as Node), defaults);
}
