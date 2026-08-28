import type {
  Block,
  HeadingBlock,
  HtmlBlock,
  ImageBlock,
  ListBlock,
  ListItem,
  ParagraphBlock,
  QuoteBlock,
  SeparatorBlock,
} from './block-types.js';

/**
 * IR → Gutenberg 區塊標記。
 *
 * 每個函式都是逐字對照 WordPress 核心 save() 的輸出寫的。改動這裡任何一個
 * 空白、斜線或屬性順序，都可能讓區塊編輯器判定內容無效，所以：
 *
 *   **修改前先跑 tests/blocks.test.ts，那裡放的是從正式站抓下來的真實標記。**
 *
 * 決定性：純函式，不碰時鐘、亂數或環境。同樣的 IR 永遠產生同樣的位元組。
 */

/**
 * 區塊註解裡的 JSON 要額外跳脫。
 *
 * `-->` 會把 HTML 註解提早關掉，`<` 與 `&` 則可能被 HTML 解析器誤讀。核心的
 * serializer 也做同樣的事，而且用的是 JSON 的 \u 逃脫——這樣 JSON.parse 回來
 * 還是原值，往返不會失真。
 */
function escapeCommentJson(json: string): string {
  // 順序與替換內容都照抄核心的 serializeAttributes，一個字元都不要改：
  // 只有連續兩個 `-` 才會關掉註解，單一個 `-` 不必動——不然 `is-style-wide`
  // 會被寫成 `is-style-wide`，跟正式站既有內容不一致。
  return json
    .replace(/--/g, '\\u002d\\u002d')
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\\"/g, '\\u0022');
}

/** 核心把屬性寫成 `<!-- wp:name {"a":1} -->`，沒有屬性時連空格都不留。 */
function openComment(name: string, attrs?: Record<string, unknown>): string {
  if (!attrs || Object.keys(attrs).length === 0) return `<!-- wp:${name} -->`;
  return `<!-- wp:${name} ${escapeCommentJson(JSON.stringify(attrs))} -->`;
}

function closeComment(name: string): string {
  return `<!-- /wp:${name} -->`;
}

/** `medium` → `has-medium-font-size`；null 則不加 class。 */
function fontSizeClass(fontSize: string | null): string | null {
  return fontSize === null ? null : `has-${fontSize}-font-size`;
}

function classAttr(...parts: (string | null)[]): string {
  const classes = parts.filter((part): part is string => part !== null && part.length > 0);
  return classes.length === 0 ? '' : ` class="${escapeAttribute(classes.join(' '))}"`;
}

/**
 * 把子區塊包進容器。核心的巢狀寫法很特別：第一個子區塊的註解**緊貼**開標籤，
 * 最後一個結束註解**緊貼**關標籤，中間用空行分隔，例如：
 *
 *   <ul class="wp-block-list"><!-- wp:list-item -->
 *   <li>A</li>
 *   <!-- /wp:list-item -->
 *
 *   <!-- wp:list-item -->
 *   <li>B</li>
 *   <!-- /wp:list-item --></ul>
 */
function wrapChildren(openTag: string, children: string[], closeTag: string): string {
  return `${openTag}${children.join('\n\n')}${closeTag}`;
}

function serializeParagraph(block: ParagraphBlock): string {
  const attrs = block.fontSize === null ? undefined : { fontSize: block.fontSize };
  return [
    openComment('paragraph', attrs),
    `<p${classAttr(fontSizeClass(block.fontSize))}>${block.html}</p>`,
    closeComment('paragraph'),
  ].join('\n');
}

function serializeHeading(block: HeadingBlock): string {
  // level 2 是核心預設值，預設值不會被寫進屬性。順序固定 level 在 fontSize 前面。
  const attrs: Record<string, unknown> = {};
  if (block.level !== 2) attrs.level = block.level;
  if (block.fontSize !== null) attrs.fontSize = block.fontSize;

  const tag = `h${block.level}`;
  return [
    openComment('heading', attrs),
    `<${tag}${classAttr('wp-block-heading', fontSizeClass(block.fontSize))}>${block.html}</${tag}>`,
    closeComment('heading'),
  ].join('\n');
}

function serializeListItem(item: ListItem): string {
  // 巢狀清單緊貼在文字後面，關閉的 </li> 又緊貼在子清單的結束註解後面：
  //   <li>文字<!-- wp:list -->\n<ul …>…</ul>\n<!-- /wp:list --></li>
  //
  // 核心的 list-item 一定「先文字、後子區塊」，所以子清單後面不可能還有文字。
  // parseListItem 遇到那種形狀會整份退到 wp:html，這裡因此不必處理。
  const nested = item.nested.map((child) => serializeList(child)).join('\n\n');
  const attrs = item.fontSize === null ? undefined : { fontSize: item.fontSize };
  return [
    openComment('list-item', attrs),
    `<li${classAttr(fontSizeClass(item.fontSize))}>${item.html}${nested}</li>`,
    closeComment('list-item'),
  ].join('\n');
}

function serializeList(block: ListBlock): string {
  const tag = block.ordered ? 'ol' : 'ul';
  const attrs = block.ordered ? { ordered: true } : undefined;
  const items = block.items.map((item) => serializeListItem(item));
  return [
    openComment('list', attrs),
    wrapChildren(`<${tag} class="wp-block-list">`, items, `</${tag}>`),
    closeComment('list'),
  ].join('\n');
}

function serializeQuote(block: QuoteBlock): string {
  const children = block.children.map((child) => serializeBlock(child));
  return [
    openComment('quote'),
    wrapChildren('<blockquote class="wp-block-quote">', children, '</blockquote>'),
    closeComment('quote'),
  ].join('\n');
}

function serializeImage(block: ImageBlock): string {
  // 屬性順序照核心 block.json：id → width → height → sizeSlug → linkDestination → align。
  const attrs: Record<string, unknown> = {};
  if (block.mediaId !== null) attrs.id = block.mediaId;
  if (block.width !== null) attrs.width = block.width;
  if (block.height !== null) attrs.height = block.height;
  attrs.sizeSlug = block.sizeSlug;
  attrs.linkDestination = 'none';
  if (block.align !== null) attrs.align = block.align;

  // 指定尺寸時核心會補 is-resized，位置在 size-* 後面。
  const resized = block.width !== null || block.height !== null;
  const figureClass = classAttr(
    'wp-block-image',
    block.align === null ? null : `align${block.align}`,
    `size-${block.sizeSlug}`,
    resized ? 'is-resized' : null,
  );

  const style = [
    block.width === null ? null : `width:${block.width}`,
    block.height === null ? null : `height:${block.height}`,
  ]
    .filter((part): part is string => part !== null)
    .join(';');

  // 核心的 img 是自閉合寫法，斜線不能省。
  const img =
    `<img src="${escapeAttribute(block.src)}" alt="${escapeAttribute(block.alt)}"` +
    (block.mediaId === null ? '' : ` class="wp-image-${block.mediaId}"`) +
    (style.length === 0 ? '' : ` style="${escapeAttribute(style)}"`) +
    '/>';

  // 空圖說核心會整個略過，多輸出一個空的 figcaption 就會判定內容無效。
  const caption =
    block.caption === null || block.caption.length === 0
      ? ''
      : `<figcaption class="wp-element-caption">${block.caption}</figcaption>`;

  return [
    openComment('image', attrs),
    `<figure${figureClass}>${img}${caption}</figure>`,
    closeComment('image'),
  ].join('\n');
}

function serializeHtml(block: HtmlBlock): string {
  return [openComment('html'), block.html, closeComment('html')].join('\n');
}

function serializeSeparator(block: SeparatorBlock): string {
  const attrs = block.className === null ? undefined : { className: block.className };
  return [
    openComment('separator', attrs),
    `<hr${classAttr('wp-block-separator', 'has-alpha-channel-opacity', block.className)}/>`,
    closeComment('separator'),
  ].join('\n');
}

/** 屬性值跳脫。src/alt 來自 sanitize 後的內容，但仍不能讓引號跳出屬性。 */
function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function serializeBlock(block: Block): string {
  switch (block.type) {
    case 'paragraph':
      return serializeParagraph(block);
    case 'heading':
      return serializeHeading(block);
    case 'list':
      return serializeList(block);
    case 'quote':
      return serializeQuote(block);
    case 'image':
      return serializeImage(block);
    case 'separator':
      return serializeSeparator(block);
    case 'html':
      return serializeHtml(block);
  }
}

/** 頂層區塊之間一律空一行，跟核心存檔一致。 */
export function serializeBlocks(blocks: readonly Block[]): string {
  return blocks.map(serializeBlock).join('\n\n');
}
