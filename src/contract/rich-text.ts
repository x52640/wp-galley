/**
 * 直接在文章上改時的格式整理（P5-T028）。
 *
 * 兩個地方要用**同一套**規則，所以放在共用契約裡：
 *   - 前端：貼上的外來 HTML（`mode: 'paste'`），以及存檔前整理編輯區的 DOM（`mode: 'edit'`）。
 *   - 後端：`normalizeEditedBody` 收到正文時再整理一次（不信任前端），之後照樣走 schema、sanitize、結構驗證。
 * 兩邊輸入不同（瀏覽器 DOM／parse5），所以先各自轉成下面這種最小的樹，再交給 `cleanRich`。
 *
 * **這不是安全關卡。** 安全的唯一關卡仍是後端的 `sanitize.ts`（allowlist）。這裡的工作是讓格式
 * 「不要默默消失」與「形狀是古騰堡存得下來的」：
 *   - `b`／`i` 換成 `strong`／`em`；`span style="font-weight:700"`（Google 文件）變 `strong`；
 *     `b style="font-weight:normal"`（Google 文件包在最外層的那個）不是粗體。
 *   - 瀏覽器的 `div`、`<p><ul>`、`ul` 直接包 `ul`、清單項目裡的段落與標題、引用裡的裸文字，整理成
 *     段落／清單項目／引用段落。
 *   - 模板沒允許的格式（底線、刪除線…）拿掉、字留著，並回報拿掉了什麼（`dropped`），讓畫面講出來。
 *
 * 規則的測試在 `tests/rich-text.test.ts`。本檔不得 import 任何東西（`tests/contract.test.ts`）。
 */

export interface RichText {
  readonly type: 'text';
  readonly text: string;
}

export interface RichAttr {
  readonly name: string;
  readonly value: string;
}

export interface RichElement {
  readonly type: 'element';
  /** 小寫標籤名。 */
  readonly tag: string;
  readonly attrs: readonly RichAttr[];
  readonly children: readonly RichNode[];
}

export type RichNode = RichText | RichElement;

export interface RichCleanOptions {
  /**
   * `paste`：外來的 HTML。屬性只留連結的 href，圖片不收（別人網站的圖不能直接掛進文章），
   * 原始碼裡的換行縮排摺成空白；只有行內內容時不包段落（插在游標處）。
   *
   * `edit`：編輯區本身。正文原有的 class、圖片、figure 原樣保留，只拿掉編輯器塞進來的屬性。
   */
  readonly mode: 'paste' | 'edit';
  /** 模板允許的標籤。沒給＝不在這裡擋（後端 sanitize 才是關卡），只整理形狀。 */
  readonly allowedTags?: readonly string[];
  /** 連結只收這些 scheme；不合的連結拆掉、字留著。沒給＝不檢查。 */
  readonly allowedSchemes?: readonly string[];
}

export interface RichCleanResult {
  readonly nodes: RichNode[];
  /** 因為模板不支援而拿掉的格式（中文名稱，去重、依出現順序）。只有 `edit` 且給了 allowedTags 時會有。 */
  readonly dropped: string[];
}

// ---------------------------------------------------------------------------
// 分類
// ---------------------------------------------------------------------------

/** 連內容一起丟掉：程式、樣式、表單、嵌入物、Word 的 `<o:p>`。 */
const DROP_WITH_CONTENT = new Set([
  'script', 'style', 'noscript', 'template', 'textarea', 'title', 'head', 'meta', 'link', 'base',
  'iframe', 'frame', 'object', 'embed', 'applet', 'svg', 'math', 'canvas', 'video', 'audio', 'picture',
  'source', 'track', 'button', 'select', 'option', 'input', 'o:p', 'xml',
]);

/**
 * 當作「一個段落」的容器：`div` 與各種排版外框。它只有行內內容時就是一段；裡面還有區塊時
 * 攤開，裡面的區塊各自成段。表格的格子也在這裡——一格一段，字不會黏在一起。
 */
const BLOCK_CONTAINERS = new Set([
  'div', 'section', 'article', 'header', 'footer', 'main', 'aside', 'nav', 'center', 'address',
  'details', 'summary', 'dl', 'dt', 'dd', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th',
  'caption', 'pre', 'body', 'html', 'form', 'fieldset', 'legend', 'hgroup',
]);

/** 只帶樣式、沒有語意的包裝：一律拆掉（沒給 allowedTags 時也拆）。`mark` 是校樣上的建議標記。 */
const STYLE_WRAPPERS = new Set(['span', 'font', 'mark', 'o:span', 'big', 'small', 'nobr', 'label', 'abbr', 'cite', 'time', 'bdi', 'bdo', 'data', 'var', 'dfn', 'q']);

/** 整理之後可能留下的區塊標籤（在行內位置出現就要拉出去或攤平）。 */
const BLOCKISH = new Set(['p', 'h2', 'h3', 'ul', 'ol', 'li', 'blockquote', 'hr', 'figure', 'div']);

/** 行內的格式標籤：沒有子內容就是殘骸。 */
const EMPTYABLE_INLINE = new Set(['strong', 'em', 'a']);

/** 模板不支援、拿掉時要講出來的格式。沒列的（span、font…）只是樣式包裝，拿掉不算格式消失。 */
const DROPPED_LABELS: Readonly<Record<string, string>> = {
  u: '底線',
  s: '刪除線',
  strike: '刪除線',
  del: '刪除線',
  ins: '底線',
  sub: '上下標',
  sup: '上下標',
  code: '程式碼',
  kbd: '程式碼',
  pre: '程式碼',
  table: '表格',
  strong: '粗體',
  em: '斜體',
  a: '連結',
  h2: '標題',
  h3: '標題',
  ul: '清單',
  ol: '清單',
  blockquote: '引用',
  hr: '分隔線',
  img: '圖片',
  figure: '圖片',
};

/** 編輯器塞進來的屬性（`edit` 模式）。class 不在這裡：正文的 `wp-block-*` class 要留著。 */
function isEditorAttribute(name: string): boolean {
  return name === 'style' || name === 'contenteditable' || name === 'spellcheck' || name.startsWith('data-');
}

// ---------------------------------------------------------------------------
// 連結
// ---------------------------------------------------------------------------

/**
 * 連結網址能不能收：一定要是絕對網址，scheme 在允許清單裡。相對網址不收（貼上來的相對網址
 * 指的是別人的網站）。判斷前先拿掉控制字元與空白——`java\tscript:` 在瀏覽器眼中就是 `javascript:`。
 * 回傳去掉前後空白的網址；不收就回 null。
 */
export function safeHref(raw: string, schemes: readonly string[]): string | null {
  const value = raw.trim();
  // eslint-disable-next-line no-control-regex
  const probe = value.replace(/[\u0000- \u007f-\u009f]/g, '');
  const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(probe);
  if (!match) return null;
  const scheme = match[1]!.toLowerCase();
  if (!schemes.some((allowed) => allowed.toLowerCase() === scheme)) return null;
  // 還原成原字串之後 scheme 不一樣（中間夾了控制字元），就不收。
  if (!value.toLowerCase().startsWith(`${scheme}:`)) return null;
  return value;
}

// ---------------------------------------------------------------------------
// 第一步：逐節點整理（改名、拆包裝、丟屬性、樣式轉語意）
// ---------------------------------------------------------------------------

interface Context {
  readonly options: RichCleanOptions;
  readonly allowed: ReadonlySet<string> | null;
  readonly dropped: string[];
}

function text(value: string): RichText {
  return { type: 'text', text: value };
}

function element(tag: string, attrs: readonly RichAttr[], children: readonly RichNode[]): RichElement {
  return { type: 'element', tag, attrs, children };
}

function isAllowed(ctx: Context, tag: string): boolean {
  return ctx.allowed === null || ctx.allowed.has(tag);
}

function hasText(nodes: readonly RichNode[]): boolean {
  return nodes.some((node) => (node.type === 'text' ? node.text.trim().length > 0 : hasText(node.children)));
}

function reportDropped(ctx: Context, tag: string, children: readonly RichNode[]): void {
  if (ctx.options.mode !== 'edit' || ctx.allowed === null) return;
  const label = DROPPED_LABELS[tag];
  if (label === undefined) return;
  if (tag !== 'hr' && tag !== 'img' && !hasText(children)) return;
  if (!ctx.dropped.includes(label)) ctx.dropped.push(label);
}

function styleOf(attrs: readonly RichAttr[]): string {
  return attrs.find((attr) => attr.name === 'style')?.value.toLowerCase() ?? '';
}

/** 樣式裡的粗體：true＝粗、false＝明講不粗、null＝沒講。 */
function styleBold(style: string): boolean | null {
  const match = /font-weight\s*:\s*([^;]+)/.exec(style);
  if (!match) return null;
  const value = match[1]!.trim();
  if (/^(bold|bolder)\b/.test(value) || /^[6-9]00\b/.test(value)) return true;
  if (/^(normal|lighter)\b/.test(value) || /^[1-5]00\b/.test(value)) return false;
  return null;
}

function styleItalic(style: string): boolean | null {
  const match = /font-style\s*:\s*([^;]+)/.exec(style);
  if (!match) return null;
  return /^(italic|oblique)\b/.test(match[1]!.trim()) ? true : /^normal\b/.test(match[1]!.trim()) ? false : null;
}

/** 標題層級照模板允許的挑最近的一個：h1→h2、h4 以下→h3；都不允許就變段落（null）。 */
function headingTag(ctx: Context, level: number): string | null {
  const order = level <= 2 ? ['h2', 'h3'] : ['h3', 'h2'];
  return order.find((tag) => isAllowed(ctx, tag)) ?? null;
}

function keepAttrs(ctx: Context, attrs: readonly RichAttr[]): RichAttr[] {
  if (ctx.options.mode === 'paste') return [];
  return attrs.filter((attr) => !isEditorAttribute(attr.name));
}

/**
 * 用 strong／em 包起來（樣式說它是粗／斜體時）。模板不允許就不包。
 *
 * 裡面有區塊（`<ul style="font-weight:bold"><li>…`、`<b><p>…</p></b>`）時**不能包住整個區塊**：
 * 包住的話之後行內位置會把區塊攤平，清單邊界就被吃掉（`<li><strong>A<br>B</strong></li>`，審查 #2）。
 * 改成把粗／斜體往下套到每個區塊裡的行內內容；區塊之間的空白不包。
 */
function wrapStyled(ctx: Context, nodes: RichNode[], bold: boolean, italic: boolean): RichNode[] {
  if (nodes.length === 0 || (!bold && !italic)) return nodes;
  if (!nodes.some((node) => isBlockish(node))) return wrapInlineStyled(ctx, nodes, bold, italic);
  const out: RichNode[] = [];
  let run: RichNode[] = [];
  const flush = (): void => {
    if (run.some((node) => !isWhitespace(node))) out.push(...wrapInlineStyled(ctx, run, bold, italic));
    else out.push(...run);
    run = [];
  };
  for (const node of nodes) {
    if (node.type === 'element' && isBlockish(node)) {
      flush();
      out.push(
        node.tag === 'hr' || node.tag === 'figure'
          ? node
          : element(node.tag, node.attrs, wrapStyled(ctx, [...node.children], bold, italic)),
      );
      continue;
    }
    run.push(node);
  }
  flush();
  return out;
}

function wrapInlineStyled(ctx: Context, nodes: RichNode[], bold: boolean, italic: boolean): RichNode[] {
  let out = nodes;
  if (italic && isAllowed(ctx, 'em')) out = [element('em', [], out)];
  if (bold && isAllowed(ctx, 'strong')) out = [element('strong', [], out)];
  return out;
}

function cleanNodes(ctx: Context, nodes: readonly RichNode[]): RichNode[] {
  return nodes.flatMap((node) => cleanNode(ctx, node));
}

function cleanNode(ctx: Context, node: RichNode): RichNode[] {
  if (node.type === 'text') {
    if (ctx.options.mode === 'paste' && /\n/.test(node.text)) {
      // 原始碼的換行與縮排在網頁上本來就顯示成一個空白。
      return [text(node.text.replace(/[ \t\r\n\f]*\n[ \t\r\n\f]*/g, ' '))];
    }
    return [node];
  }

  const tag = node.tag.toLowerCase();
  if (DROP_WITH_CONTENT.has(tag)) return [];
  if (ctx.options.mode === 'paste' && tag === 'img') return [];

  const children = cleanNodes(ctx, node.children);
  const style = styleOf(node.attrs);
  const bold = styleBold(style);
  const italic = styleItalic(style) === true;

  // 粗體／斜體：瀏覽器的 b／i 換成模板認得的 strong／em。
  if (tag === 'b' || tag === 'strong') {
    if (bold === false) return wrapStyled(ctx, children, false, italic);
    if (!isAllowed(ctx, 'strong')) {
      reportDropped(ctx, 'strong', children);
      return children;
    }
    if (children.length === 0) return [];
    // 粗體包著區塊（`<b><p>…</p><p>…</p></b>`）：粗體套進每個區塊，不包住區塊。
    if (children.some((child) => isBlockish(child))) return wrapStyled(ctx, children, true, italic);
    return wrapStyled(ctx, [element('strong', keepAttrs(ctx, node.attrs), children)], false, italic);
  }
  if (tag === 'i' || tag === 'em') {
    if (!isAllowed(ctx, 'em')) {
      reportDropped(ctx, 'em', children);
      return children;
    }
    if (children.length === 0) return [];
    if (children.some((child) => isBlockish(child))) return wrapStyled(ctx, children, bold === true, true);
    return wrapStyled(ctx, [element('em', keepAttrs(ctx, node.attrs), children)], bold === true, false);
  }

  const headingMatch = /^h([1-6])$/.exec(tag);
  if (headingMatch) {
    const mapped = headingTag(ctx, Number(headingMatch[1]));
    if (mapped === null) {
      reportDropped(ctx, 'h2', children);
      return [element('div', [], children)];
    }
    // 標題本身就是粗的，樣式裡的粗體不另外包。
    return [element(mapped, keepAttrs(ctx, node.attrs), children)];
  }

  if (tag === 'a') {
    const href = node.attrs.find((attr) => attr.name === 'href')?.value;
    const schemes = ctx.options.allowedSchemes;
    const ok = href !== undefined && (schemes === undefined ? true : safeHref(href, schemes) !== null);
    if (!ok || !isAllowed(ctx, 'a')) {
      if (ok) reportDropped(ctx, 'a', children);
      return wrapStyled(ctx, children, bold === true, italic);
    }
    if (children.length === 0) return [];
    const attrs =
      ctx.options.mode === 'paste'
        ? [{ name: 'href', value: href.trim() }]
        : keepAttrs(ctx, node.attrs).map((attr) => (attr.name === 'href' ? { name: 'href', value: href.trim() } : attr));
    return wrapStyled(ctx, [element('a', attrs, children)], bold === true, italic);
  }

  if (tag === 'p' || tag === 'blockquote' || tag === 'ul' || tag === 'ol' || tag === 'li' || tag === 'figure' || tag === 'figcaption') {
    // 清單項目要連同 ul 或 ol 一起被允許才算數，否則一項變一段。
    const listOk = tag !== 'li' || isAllowed(ctx, 'ul') || isAllowed(ctx, 'ol');
    if (!isAllowed(ctx, tag) || !listOk || (ctx.options.mode === 'paste' && (tag === 'figure' || tag === 'figcaption'))) {
      if (tag !== 'li' && tag !== 'p' && tag !== 'figcaption') reportDropped(ctx, tag, children);
      return [element('div', [], children)];
    }
    return [element(tag, keepAttrs(ctx, node.attrs), wrapStyled(ctx, children, bold === true, italic))];
  }

  if (tag === 'br' || tag === 'hr' || tag === 'img') {
    if (!isAllowed(ctx, tag)) {
      reportDropped(ctx, tag, []);
      return tag === 'br' ? [text(' ')] : [];
    }
    return [element(tag, keepAttrs(ctx, node.attrs), [])];
  }

  if (BLOCK_CONTAINERS.has(tag)) {
    reportDropped(ctx, tag, children);
    // div 只有行內內容時會變成段落；它身上的 class 留給那個段落（編輯器只會給 div 加樣式，那已經拿掉了）。
    const attrs = tag === 'div' ? keepAttrs(ctx, node.attrs) : [];
    return [element('div', attrs, wrapStyled(ctx, children, bold === true, italic))];
  }

  // 沒給 allowedTags（後端）：認不得的標籤留給 sanitize 決定，這裡不擋。
  if (ctx.allowed === null && !STYLE_WRAPPERS.has(tag)) {
    return [element(tag, keepAttrs(ctx, node.attrs), wrapStyled(ctx, children, bold === true, italic))];
  }
  // 其他（span、font、mark、u…）：拆掉包裝，字留著。樣式裡的粗斜體轉成 strong／em。
  reportDropped(ctx, tag, children);
  return wrapStyled(ctx, children, bold === true, italic);
}

// ---------------------------------------------------------------------------
// 第二步：結構（段落、清單、引用要是古騰堡存得下來的形狀）
// ---------------------------------------------------------------------------

type Flow = 'root' | 'quote';

function isBlockish(node: RichNode): boolean {
  return node.type === 'element' && BLOCKISH.has(node.tag);
}

function isWhitespace(node: RichNode): boolean {
  return node.type === 'text' && /^[ \t\r\n\f]*$/.test(node.text);
}

/** 只有空白與 br（瀏覽器刪光一段後留下的 `<p><br></p>`）。`&nbsp;` 不算空：那常是作者刻意的間隔段。 */
function isEmptyInline(nodes: readonly RichNode[]): boolean {
  return nodes.every((node) => isWhitespace(node) || (node.type === 'element' && node.tag === 'br'));
}

/** 去掉一串行內節點頭尾的空白（不動 &nbsp;）。 */
function trimInline(nodes: readonly RichNode[]): RichNode[] {
  const out = [...nodes];
  while (out.length > 0) {
    const first = out[0]!;
    if (first.type !== 'text') break;
    const trimmed = first.text.replace(/^[ \t\r\n\f]+/, '');
    if (trimmed.length > 0) {
      out[0] = text(trimmed);
      break;
    }
    out.shift();
  }
  while (out.length > 0) {
    const last = out[out.length - 1]!;
    if (last.type !== 'text') break;
    const trimmed = last.text.replace(/[ \t\r\n\f]+$/, '');
    if (trimmed.length > 0) {
      out[out.length - 1] = text(trimmed);
      break;
    }
    out.pop();
  }
  return out;
}

/**
 * 行內位置（段落、標題、清單項目的字、粗體裡…）：裡面冒出區塊就攤平成字，前後用 `<br>` 隔開。
 * 分隔線在行內沒有意義，丟掉。
 */
function inlineFlow(nodes: readonly RichNode[]): RichNode[] {
  const out: RichNode[] = [];
  for (const node of nodes) {
    if (node.type === 'text') {
      out.push(node);
      continue;
    }
    if (node.tag === 'hr') continue;
    if (isBlockish(node)) {
      const inner = trimInline(inlineFlow(node.children));
      if (inner.length === 0) continue;
      if (hasContentBefore(out)) out.push(element('br', [], []));
      out.push(...inner);
      continue;
    }
    if (node.children.length === 0 && node.tag !== 'br' && node.tag !== 'img') {
      if (EMPTYABLE_INLINE.has(node.tag)) continue;
    }
    out.push(node.children.length === 0 ? node : element(node.tag, node.attrs, inlineFlow(node.children)));
  }
  return out;
}

function hasContentBefore(nodes: readonly RichNode[]): boolean {
  const last = [...nodes].reverse().find((node) => !isWhitespace(node));
  return last !== undefined && !(last.type === 'element' && last.tag === 'br');
}

/**
 * 段落／標題（以及當段落用的 div）：裡面有區塊（Chrome 的 `<p><ul>`、`<h2><ul>`）就拆開，
 * 行內的部分用同一個標籤包，區塊拉出來。空的段落與標題拿掉。
 */
function textBlock(node: RichElement, flow: Flow, rootClass: boolean): RichNode[] {
  const tag = node.tag === 'div' ? 'p' : node.tag;
  const out: RichNode[] = [];
  let run: RichNode[] = [];
  const flush = (): void => {
    const inline = inlineFlow(run);
    run = [];
    if (isEmptyInline(inline)) return;
    out.push(element(tag, node.attrs, inline));
  };
  const hoist = node.children.some((child) => child.type === 'element' && isBlockish(child) && child.tag !== 'li');
  if (!hoist) {
    run = [...node.children];
    flush();
    return out;
  }
  for (const child of node.children) {
    if (child.type === 'element' && isBlockish(child) && child.tag !== 'li') {
      flush();
      out.push(...blockFlow([child], flow, rootClass));
      continue;
    }
    run.push(child);
  }
  flush();
  return out;
}

/**
 * 區塊位置（正文最外層、引用裡）。行內內容包成段落；最外層的 `<br>` 當作分段（全選刪光重打之後常見）。
 * 最外層的段落 class 用 `wp-block-paragraph`，跟渲染端補段落的做法一致。
 */
function blockFlow(nodes: readonly RichNode[], flow: Flow, rootClass: boolean): RichNode[] {
  const out: RichNode[] = [];
  let run: RichNode[] = [];
  const flush = (): void => {
    const inline = trimInline(inlineFlow(run));
    run = [];
    if (inline.length === 0 || isEmptyInline(inline)) return;
    const attrs = flow === 'root' && rootClass ? [{ name: 'class', value: 'wp-block-paragraph' }] : [];
    out.push(element('p', attrs, inline));
  };

  for (const node of nodes) {
    if (node.type === 'text') {
      // 區塊之間的空白：最外層是排版（丟掉，輸出時另外換行）；引用裡原樣留著，沒改的引用才會逐字不變。
      if (isWhitespace(node) && run.length === 0) {
        if (flow === 'quote') out.push(node);
        continue;
      }
      run.push(node);
      continue;
    }
    if (node.tag === 'br') {
      flush();
      continue;
    }
    if (!isBlockish(node) && node.tag !== 'img') {
      run.push(node);
      continue;
    }
    flush();
    switch (node.tag) {
      case 'p':
      case 'h2':
      case 'h3':
      case 'div':
      case 'li':
        out.push(...textBlock(node.tag === 'li' ? element('div', [], node.children) : node, flow, rootClass));
        break;
      case 'ul':
      case 'ol': {
        const list = listBlock(node);
        if (list !== null) out.push(list);
        break;
      }
      case 'blockquote': {
        const children = blockFlow(node.children, 'quote', rootClass);
        if (children.some((child) => !isWhitespace(child))) out.push(element('blockquote', node.attrs, children));
        break;
      }
      default:
        // hr、figure、img：原樣。
        out.push(node);
    }
  }
  flush();
  return out;
}

/**
 * 清單：
 * - `ul` 直接包 `ul`（Chrome 縮排、Google 文件的巢狀清單）→ 收進上一個項目；
 * - 清單裡不是項目的內容 → 自成一個項目；
 * - 項目的內容見 `listItems`（子清單後面的字留在原項目，不拆）；
 * - 沒有字也沒有子清單的項目（`<li><br></li>`）拿掉；一個項目都沒有的清單整個拿掉。
 */
function listBlock(list: RichElement): RichElement | null {
  const items: RichNode[] = [];
  const lastItem = (): number => {
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i]!;
      if (item.type === 'element') return i;
    }
    return -1;
  };

  for (const child of list.children) {
    if (isWhitespace(child)) {
      items.push(child);
      continue;
    }
    if (child.type === 'element' && child.tag === 'li') {
      items.push(...listItems(child));
      continue;
    }
    if (child.type === 'element' && (child.tag === 'ul' || child.tag === 'ol')) {
      const nested = listBlock(child);
      if (nested === null) continue;
      const at = lastItem();
      if (at < 0) {
        items.push(element('li', [], [nested]));
      } else {
        const item = items[at] as RichElement;
        items[at] = element('li', item.attrs, [...item.children, nested]);
      }
      continue;
    }
    items.push(...listItems(element('li', [], [child])));
  }

  if (!items.some((item) => item.type === 'element')) return null;
  return element(list.tag, list.attrs, items);
}

type ItemToken = { readonly kind: 'inline'; readonly node: RichNode } | { readonly kind: 'break' } | { readonly kind: 'list'; readonly node: RichElement };

/**
 * 把清單項目的內容攤成一串：行內節點、分段、子清單。項目裡的段落、div、標題、引用是「包裝」：
 * 穿過它往下找，裡面的字前後要分段（`<div>First</div>Second` 不能黏成 `FirstSecond`，審查 #3），
 * 裡面的子清單照樣是子清單（`<div>A<ul>…</ul></div>` 不能被攤成字，審查 #4）。
 */
function itemTokens(nodes: readonly RichNode[]): ItemToken[] {
  const out: ItemToken[] = [];
  for (const node of nodes) {
    if (node.type === 'element' && (node.tag === 'ul' || node.tag === 'ol')) {
      out.push({ kind: 'list', node });
    } else if (node.type === 'element' && isBlockish(node)) {
      if (node.tag === 'hr') continue;
      out.push({ kind: 'break' }, ...itemTokens(node.children), { kind: 'break' });
    } else {
      out.push({ kind: 'inline', node });
    }
  }
  return out;
}

/**
 * 一個清單項目。內容**照原本的順序**留著，不拆成新項目：子清單後面還有字（`<li>A<ul>…</ul>結論</li>`）
 * 是合法的 HTML，古騰堡的清單項目存不了這個順序，發布時整個清單走 wp:html 保底（block-parse 的規則）；
 * 這裡自己拆成新項目會把後面的項目編號往後推，沒改過的正文也會變（審查 #5）。
 * 沒有字也沒有子清單的項目（`<li><br></li>`）拿掉。
 */
function listItems(li: RichElement): RichElement[] {
  const children: RichNode[] = [];
  let pendingBreak = false;
  let hasList = false;
  for (const token of itemTokens(li.children)) {
    if (token.kind === 'break') {
      pendingBreak = true;
      continue;
    }
    if (token.kind === 'list') {
      const sub = listBlock(token.node);
      if (sub !== null) {
        children.push(sub);
        hasList = true;
      }
      pendingBreak = false;
      continue;
    }
    const pieces = inlineFlow([token.node]);
    if (pieces.length === 0) continue;
    if (pendingBreak) {
      // 包裝裡的字頭尾的空白是排版，不是內容。
      const trimmed = trimInline(pieces);
      if (trimmed.length === 0) continue;
      if (hasContentBefore(children) && !endsWithList(children)) children.push(element('br', [], []));
      children.push(...trimmed);
      pendingBreak = false;
      continue;
    }
    children.push(...pieces);
  }
  const text = children.filter((node) => !(node.type === 'element' && (node.tag === 'ul' || node.tag === 'ol')));
  if (!hasList && isEmptyInline(text)) return [];
  return [element('li', li.attrs, children)];
}

function endsWithList(nodes: readonly RichNode[]): boolean {
  const last = [...nodes].reverse().find((node) => !isWhitespace(node));
  return last !== undefined && last.type === 'element' && (last.tag === 'ul' || last.tag === 'ol');
}

// ---------------------------------------------------------------------------
// 對外
// ---------------------------------------------------------------------------

export function cleanRich(nodes: readonly RichNode[], options: RichCleanOptions): RichCleanResult {
  const ctx: Context = {
    options,
    allowed: options.allowedTags === undefined ? null : new Set(options.allowedTags.map((tag) => tag.toLowerCase())),
    dropped: [],
  };
  const cleaned = cleanNodes(ctx, nodes);

  // 貼上的只有行內內容（例如複製網頁上的一句話）：插在游標處，不包成段落。
  if (options.mode === 'paste' && !cleaned.some((node) => isBlockish(node))) {
    return { nodes: trimInline(inlineFlow(cleaned)), dropped: ctx.dropped };
  }
  return { nodes: blockFlow(cleaned, 'root', options.mode === 'edit'), dropped: ctx.dropped };
}

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/ /g, '&nbsp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/ /g, '&nbsp;').replace(/"/g, '&quot;');
}

function serializeNode(node: RichNode): string {
  if (node.type === 'text') return escapeText(node.text);
  const attrs = node.attrs.map((attr) => ` ${attr.name}="${escapeAttr(attr.value)}"`).join('');
  if (VOID_TAGS.has(node.tag)) return `<${node.tag}${attrs}>`;
  return `<${node.tag}${attrs}>${node.children.map(serializeNode).join('')}</${node.tag}>`;
}

/**
 * 樹 → HTML。跳脫規則跟 parse5 的序列化一致（文字：& nbsp < >；屬性：& nbsp "），
 * 所以沒改過的正文整理完逐字不變，後端不會為了空白或引號寫法建新版本。
 * `separator`：最外層節點之間放什麼（後端的正文慣例是換行）。
 */
export function serializeRich(nodes: readonly RichNode[], separator = ''): string {
  return nodes.map(serializeNode).join(separator);
}
