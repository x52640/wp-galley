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
 * 連結網址收不收——**前後端、渲染與編輯都用這一個函式**（`templates/sanitize.ts` 也呼叫它，審查 F5）。
 *
 * - 絕對網址：scheme 要在允許清單裡（`javascript:`、`data:` 等一律不收）。
 * - `#錨點`：收。文章內跳段落，沒有離站的風險。
 * - `/` 開頭的站內路徑（`/about`）：收。文章就發在這個站上，指的是站內的頁面。
 * - 其他相對路徑（`../post`、`post.html`、`?q=1`）：不收。它的意思取決於文章最後的網址，發布後很可能是壞連結。
 * - `//host`（協定相對）：不收，那其實是外站。
 *
 * 判斷前先拿掉控制字元與空白——瀏覽器會忽略網址裡的 tab／換行，`java\tscript:`、`/\t/evil.com` 在它眼中
 * 就是 `javascript:`、`//evil.com`。回傳去掉前後空白的網址；不收就回 null。
 */
export function safeHref(raw: string, schemes: readonly string[]): string | null {
  const value = raw.trim();
  // eslint-disable-next-line no-control-regex
  const probe = value.replace(/[\u0000- \u007f-\u009f]/g, '');
  if (probe.length === 0) return null;
  if (probe.startsWith('#')) return value;
  if (probe.startsWith('/')) return /^\/[/\\]/.test(probe) ? null : value;
  const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(probe);
  if (!match) return null;
  const scheme = match[1]!.toLowerCase();
  if (!schemes.some((allowed) => allowed.toLowerCase() === scheme)) return null;
  // 還原成原字串之後 scheme 不一樣（中間夾了控制字元），就不收。
  if (!value.toLowerCase().startsWith(`${scheme}:`)) return null;
  // 瀏覽器解析網址前會拿掉的字元：頭尾的控制字元與空白、任何位置的 tab／LF／CR。語法檢查要看拿掉之後的樣子，
  // 不然 `https://<tab>/evil.test` 會用 tab 冒充主機、瀏覽器卻當成 `https:///evil.test`（第四輪審查 #5）。
  // eslint-disable-next-line no-control-regex
  const seen = value.replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/g, '').replace(/[\t\n\r]/g, '');
  const rest = seen.slice(scheme.length + 1);
  if (scheme === 'http' || scheme === 'https') {
    // 一定要是 `https://主機…`：`https:next` 沒有主機，瀏覽器會照目前頁面解析成站內路徑（第三輪審查 #5）。
    // `https:///x` 瀏覽器會自己補成 `https://x/`，寫法可疑，也不收。
    if (!/^\/\/[^/\\]/.test(rest)) return null;
    try {
      const parsed = new URL(seen);
      if (parsed.hostname.length === 0) return null;
    } catch {
      return null;
    }
    // 驗過之後回傳使用者寫的樣子（不換成 URL 物件的正規化寫法），沒碰過的網址不會被改寫。
    return value;
  }
  // mailto:、tel: 等：冒號後面要有東西，而且不是 `//`（那是在假裝成網址）。
  if (rest.length === 0 || rest.startsWith('//')) return null;
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

/**
 * 「這裡明講不粗／不斜」的暫時標記（`<span style="font-weight:normal">`）。整理的第一步裡，外層的
 * strong／em 遇到它要把自己拆開包，標記最後一律拆掉（審查 F4：`<strong>A<span normal>B</span></strong>`
 * 不能被整理回 `<strong>AB</strong>`）。
 */
const NO_BOLD = '#no-bold';
const NO_ITALIC = '#no-italic';

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

function addLabel(sink: string[], label: string): void {
  if (!sink.includes(label)) sink.push(label);
}

function reportDropped(ctx: Context, tag: string, children: readonly RichNode[]): void {
  if (ctx.options.mode !== 'edit' || ctx.allowed === null) return;
  const label = DROPPED_LABELS[tag];
  if (label === undefined) return;
  if (tag !== 'hr' && tag !== 'img' && !hasText(children)) return;
  addLabel(ctx.dropped, label);
}

/**
 * 解析 style 屬性成「屬性名 → 值」（第四輪審查 #1）。照 CSS 規則：逐條宣告、屬性名完全相符
 * （`mso-bidi-font-weight` 不是 `font-weight`）、後面的覆蓋前面的，但 `!important` 的只會被後面同樣
 * `!important` 的覆蓋。引號與括號裡的分號不算分隔（`font-family:"a;b"`、`url(a;b)`）。
 */
export function parseStyle(style: string): Map<string, string> {
  const result = new Map<string, { value: string; important: boolean }>();
  const declarations: string[] = [];
  let current = '';
  let quote: string | null = null;
  let depth = 0;
  for (let i = 0; i < style.length; i++) {
    const ch = style[i]!;
    // 跳脫：下一個字元照字面（`\"`、`\'`、`\;` 都不會結束引號或宣告）。
    if (ch === '\\') {
      current += ch + (style[i + 1] ?? '');
      i += 1;
      continue;
    }
    if (quote !== null) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    // CSS 註解（引號外）：整段拿掉，裡面的 `;`、`:` 不算數（第五輪審查 #1）。
    if (ch === '/' && style[i + 1] === '*') {
      const close = style.indexOf('*/', i + 2);
      i = close < 0 ? style.length : close + 1;
      current += ' ';
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') depth += 1;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (ch === ';' && depth === 0) {
      declarations.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  declarations.push(current);
  for (const declaration of declarations) {
    const colon = declaration.indexOf(':');
    if (colon < 0) continue;
    const name = declaration.slice(0, colon).trim().toLowerCase();
    let value = declaration.slice(colon + 1).trim();
    if (name.length === 0 || value.length === 0) continue;
    const important = /!\s*important\s*$/i.test(value);
    if (important) value = value.replace(/!\s*important\s*$/i, '').trim();
    value = value.toLowerCase();
    // 無效的宣告整條忽略，不覆蓋前面有效的（CSS 規則；第五輪審查 #2）。只判斷我們會讀的兩個屬性。
    if (!isValidDeclaration(name, value)) continue;
    const previous = result.get(name);
    if (previous !== undefined && previous.important && !important) continue;
    result.set(name, { value, important });
  }
  return new Map([...result].map(([name, entry]) => [name, entry.value]));
}

const CSS_WIDE = /^(inherit|initial|unset|revert|revert-layer)$/;

function isValidDeclaration(name: string, value: string): boolean {
  if (value.length === 0) return false;
  if (name === 'font-weight') {
    if (CSS_WIDE.test(value) || /^(normal|bold|bolder|lighter)$/.test(value)) return true;
    const weight = /^\d+(\.\d+)?$/.test(value) ? Number(value) : NaN;
    return weight >= 1 && weight <= 1000;
  }
  if (name === 'font-style') {
    return CSS_WIDE.test(value) || /^(normal|italic|oblique)$/.test(value) || /^oblique\s+-?\d+(\.\d+)?(deg|grad|rad|turn)$/.test(value);
  }
  return true;
}

function styleOf(attrs: readonly RichAttr[]): Map<string, string> {
  return parseStyle(attrs.find((attr) => attr.name === 'style')?.value ?? '');
}

/** 樣式裡的粗體：true＝粗、false＝明講不粗、null＝沒講。 */
function styleBold(style: ReadonlyMap<string, string>): boolean | null {
  const value = style.get('font-weight');
  if (value === undefined) return null;
  if (value === 'bold' || value === 'bolder') return true;
  if (value === 'normal' || value === 'lighter') return false;
  const weight = Number(value);
  if (!Number.isFinite(weight)) return null; // inherit 之類：沒明講
  return weight >= 600;
}

function styleItalic(style: ReadonlyMap<string, string>): boolean | null {
  const value = style.get('font-style');
  if (value === undefined) return null;
  if (/^(italic|oblique)\b/.test(value)) return true;
  return value === 'normal' ? false : null;
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

function containsTag(nodes: readonly RichNode[], tag: string): boolean {
  return nodes.some((node) => node.type === 'element' && (node.tag === tag || containsTag(node.children, tag)));
}

/**
 * 用一個行內標籤（strong／em）包住一串行內節點，但裡面「明講不是這個格式」的部分（標記 `marker`）要留在外面：
 * `<strong>A<#no-bold>B</#no-bold>C</strong>` → `<strong>A</strong>B<strong>C</strong>`。標記藏在更深的
 * 元素裡（`<strong><a>A<#no-bold>B</#no-bold></a></strong>`）時，那個元素跟著切開。
 */
function wrapExcept(nodes: readonly RichNode[], marker: string, wrap: (inner: RichNode[]) => RichNode[]): RichNode[] {
  if (!containsTag(nodes, marker)) return wrap([...nodes]);
  const out: RichNode[] = [];
  for (const piece of liftMarker(nodes, marker)) {
    // 拿到外面的部分**仍帶著標記**：外層如果還有同樣的 strong／em，也要在這裡斷開（第四輪審查 #2）。
    // 標記在整份整理完才拿掉（stripMarkers）。
    if (piece.outside) out.push(element(marker, [], piece.nodes));
    else if (piece.nodes.some((node) => !isWhitespace(node))) out.push(...wrap(piece.nodes));
    else out.push(...piece.nodes);
  }
  return out;
}

interface Piece {
  readonly outside: boolean;
  readonly nodes: RichNode[];
}

function liftMarker(nodes: readonly RichNode[], marker: string): Piece[] {
  const pieces: Piece[] = [];
  const push = (outside: boolean, node: RichNode): void => {
    const last = pieces[pieces.length - 1];
    if (last !== undefined && last.outside === outside) last.nodes.push(node);
    else pieces.push({ outside, nodes: [node] });
  };
  for (const node of nodes) {
    if (node.type === 'element' && node.tag === marker) {
      for (const child of node.children) push(true, child);
    } else if (node.type === 'element' && containsTag(node.children, marker)) {
      for (const piece of liftMarker(node.children, marker)) push(piece.outside, element(node.tag, node.attrs, piece.nodes));
    } else {
      push(false, node);
    }
  }
  return pieces;
}

/**
 * 整理第一步做完之後拆掉所有暫時標記（沒被外層粗／斜體用到的，本來就只是「不粗」的普通字），
 * 順便把巢狀的同名 strong／em 合併成一層（`<strong><strong>A</strong></strong>` → `<strong>A</strong>`）。
 */
function stripMarkers(nodes: readonly RichNode[], inStrong = false, inEm = false): RichNode[] {
  return nodes.flatMap((node) => {
    if (node.type === 'text') return [node];
    const strong = node.tag === 'strong';
    const em = node.tag === 'em';
    const children = stripMarkers(node.children, inStrong || strong, inEm || em);
    if (node.tag === NO_BOLD || node.tag === NO_ITALIC) return children;
    if ((strong && inStrong) || (em && inEm)) return children;
    return [element(node.tag, node.attrs, children)];
  });
}

/**
 * 把「包住一串行內內容」的動作套到節點上。裡面有區塊時**不能包住整個區塊**——包住的話之後行內位置
 * 會把區塊攤平、清單邊界被吃掉（審查 #2）——改成往下套到每個區塊裡的行內內容；區塊之間的空白不包。
 * 粗體、斜體、連結（`<a>` 包住區塊，審查 F2）都走這裡。
 */
function distribute(
  nodes: readonly RichNode[],
  wrapRun: (run: RichNode[]) => RichNode[],
  wrapFigure?: (figure: RichElement) => RichElement,
): RichNode[] {
  if (nodes.length === 0) return [];
  if (!nodes.some((node) => isBlockish(node))) return wrapRun([...nodes]);
  const out: RichNode[] = [];
  let run: RichNode[] = [];
  const flush = (): void => {
    if (run.some((node) => !isWhitespace(node))) out.push(...wrapRun(run));
    else out.push(...run);
    run = [];
  };
  for (const node of nodes) {
    if (node.type === 'element' && isBlockish(node)) {
      flush();
      if (node.tag === 'figure') out.push(wrapFigure === undefined ? node : wrapFigure(node));
      else if (node.tag === 'hr') out.push(node);
      else out.push(element(node.tag, node.attrs, distribute(node.children, wrapRun, wrapFigure)));
      continue;
    }
    run.push(node);
  }
  flush();
  return out;
}

/** 用 strong／em 包起來（樣式說它是粗／斜體時）。模板不允許就不包。 */
function wrapStyled(ctx: Context, nodes: RichNode[], bold: boolean, italic: boolean): RichNode[] {
  if (nodes.length === 0 || (!bold && !italic)) return nodes;
  return distribute(nodes, (run) => wrapInlineStyled(ctx, run, bold, italic));
}

function wrapInlineStyled(ctx: Context, nodes: RichNode[], bold: boolean, italic: boolean): RichNode[] {
  let out = nodes;
  if (italic && isAllowed(ctx, 'em')) out = wrapExcept(out, NO_ITALIC, (inner) => [element('em', [], inner)]);
  if (bold && isAllowed(ctx, 'strong')) out = wrapExcept(out, NO_BOLD, (inner) => [element('strong', [], inner)]);
  return out;
}

/** 在一串行內內容外面留「不粗／不斜」的標記，讓外層的 strong／em 知道要在這裡斷開。 */
function markNormal(nodes: RichNode[], normalWeight: boolean, normalStyle: boolean): RichNode[] {
  if (nodes.length === 0 || nodes.some((node) => isBlockish(node))) return nodes;
  let out = nodes;
  if (normalStyle) out = [element(NO_ITALIC, [], out)];
  if (normalWeight) out = [element(NO_BOLD, [], out)];
  return out;
}

function cleanNodes(ctx: Context, nodes: readonly RichNode[]): RichNode[] {
  return nodes.flatMap((node) => cleanNode(ctx, node));
}

/**
 * 樣式明講「不粗／不斜」（`font-weight:normal`、`font-style:normal`）對**任何元素**都有效——span、a、li、p、
 * 清單都一樣（第三輪審查 #3）：在它的行內內容上留標記，外層的 strong／em 遇到標記就從那裡切開；
 * 裡面有區塊時標記放進每個區塊的行內內容。沒有外層粗／斜體時標記最後拿掉，等於沒事。
 * Google 文件貼上最外層那個 `<b style="font-weight:normal" id="docs-internal-guid-…">` 也是走這條。
 */
function cleanNode(ctx: Context, node: RichNode): RichNode[] {
  const out = cleanNodeInner(ctx, node);
  if (node.type === 'text') return out;
  const style = styleOf(node.attrs);
  const normalWeight = styleBold(style) === false;
  const normalStyle = styleItalic(style) === false;
  if (!normalWeight && !normalStyle) return out;
  return distribute(out, (run) => markNormal(run, normalWeight, normalStyle));
}

function cleanNodeInner(ctx: Context, node: RichNode): RichNode[] {
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
  const italicStyle = styleItalic(style);
  const italic = italicStyle === true;

  // 粗體／斜體：瀏覽器的 b／i 換成模板認得的 strong／em。
  if (tag === 'b' || tag === 'strong') {
    // 明講不粗（Google 文件最外層那個 b）：不是粗體；標記由 cleanNode 統一加。
    if (bold === false) return wrapStyled(ctx, children, false, italic);
    if (!isAllowed(ctx, 'strong')) {
      reportDropped(ctx, 'strong', children);
      return children;
    }
    if (children.length === 0) return [];
    // 粗體包著區塊（`<b><p>…</p><p>…</p></b>`）：粗體套進每個區塊，不包住區塊。
    if (children.some((child) => isBlockish(child))) return wrapStyled(ctx, children, true, italic);
    const attrs = keepAttrs(ctx, node.attrs);
    return wrapStyled(ctx, wrapExcept(children, NO_BOLD, (inner) => [element('strong', attrs, inner)]), false, italic);
  }
  if (tag === 'i' || tag === 'em') {
    if (italicStyle === false) return wrapStyled(ctx, children, bold === true, false);
    if (!isAllowed(ctx, 'em')) {
      reportDropped(ctx, 'em', children);
      return children;
    }
    if (children.length === 0) return [];
    if (children.some((child) => isBlockish(child))) return wrapStyled(ctx, children, bold === true, true);
    const attrs = keepAttrs(ctx, node.attrs);
    return wrapStyled(ctx, wrapExcept(children, NO_ITALIC, (inner) => [element('em', attrs, inner)]), bold === true, false);
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
    const accepted = href === undefined ? null : schemes === undefined ? href.trim() : safeHref(href, schemes);
    if (accepted === null || !isAllowed(ctx, 'a')) {
      // 有網址卻不收（不允許的 scheme、`../` 相對路徑）或模板不允許連結：字留著，講出來。
      if (href !== undefined) reportDropped(ctx, 'a', children);
      return wrapStyled(ctx, children, bold === true, italic);
    }
    if (children.length === 0) return [];
    const attrs =
      ctx.options.mode === 'paste'
        ? [{ name: 'href', value: accepted }]
        : keepAttrs(ctx, node.attrs).map((attr) => (attr.name === 'href' ? { name: 'href', value: accepted } : attr));
    // 連結包著區塊（`<a>A<ul>…</ul></a>`、`<a><div>…</div>字</a>`）：連結拆到各段的字上，區塊邊界留著（審查 F2）。
    // 連結包著圖片區塊（`<a><figure><img></figure></a>`）：照古騰堡圖片連結的寫法把連結放進 figure 包住 img
    // （`<figure><a href><img></a></figure>`），連結不消失（第三輪審查 #4）。
    // 圖說與被包住的圖片（`<figure><p><img></p></figure>`）也要帶到連結（第四輪審查 #4）；
    // 裡面已經有自己的連結的部分沒辦法再包一層（連結不能包連結），那部分的外層連結會消失，要提醒。
    const linkInside = (nodes: readonly RichNode[]): RichNode[] =>
      nodes.map((child) => {
        if (child.type === 'text') return isWhitespace(child) ? child : element('a', attrs, [child]);
        if (child.tag === 'a' || containsTag(child.children, 'a')) {
          if (hasText(child.children) || containsTag(child.children, 'img')) reportDropped(ctx, 'a', [text('x')]);
          return child;
        }
        if (child.tag === 'img') return element('a', attrs, [child]);
        if (child.tag === 'figcaption' || isBlockish(child)) {
          return element(child.tag, child.attrs, isBlockish(child) ? linkInside(child.children) : wrapRunInLink(child.children));
        }
        return element('a', attrs, [child]);
      });
    const wrapRunInLink = (nodes: readonly RichNode[]): RichNode[] =>
      nodes.some((node) => !isWhitespace(node)) ? [element('a', attrs, [...nodes])] : [...nodes];
    const linkFigure = (figure: RichElement): RichElement => element('figure', figure.attrs, linkInside(figure.children));
    return wrapStyled(ctx, distribute(children, (run) => [element('a', attrs, run)], linkFigure), bold === true, italic);
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

  // 沒給 allowedTags（後端）：認不得的標籤留給 sanitize 決定，這裡不擋；包著區塊的話拆到各段上。
  if (ctx.allowed === null && !STYLE_WRAPPERS.has(tag)) {
    const attrs = keepAttrs(ctx, node.attrs);
    return wrapStyled(ctx, distribute(children, (run) => [element(tag, attrs, run)]), bold === true, italic);
  }
  // 其他（span、font、mark、u…）：拆掉包裝，字留著。樣式裡的粗斜體轉成 strong／em（明講「不粗／不斜」的由 cleanNode 留標記）。
  reportDropped(ctx, tag, children);
  return wrapStyled(ctx, children, bold === true, italic);
}

// ---------------------------------------------------------------------------
// 第二步：結構（段落、清單、引用要是古騰堡存得下來的形狀）
// ---------------------------------------------------------------------------

type Flow = 'root' | 'quote';

/** 結構整理時不得不丟的格式（清單項目裡的標題、引用、分隔線…）記在這裡，跟第一步的 dropped 合併（審查 F3）。 */
type Sink = string[];

/** 區塊被攤平成字時，哪些算「格式消失」（段落、div 只是分段，不算）。 */
const FLATTEN_LABELS: Readonly<Record<string, string>> = {
  h2: '標題',
  h3: '標題',
  blockquote: '引用',
  ul: '清單',
  ol: '清單',
  hr: '分隔線',
  figure: '圖片',
};

function reportFlatten(sink: Sink, tag: string): void {
  const label = FLATTEN_LABELS[tag];
  if (label !== undefined) addLabel(sink, label);
}

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

/** 去掉一串行內節點**開頭**的空白（不動 &nbsp;）。只看整串的邊界，不動中間的字（審查 F1）。 */
function trimStart(nodes: readonly RichNode[]): RichNode[] {
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
  return out;
}

function trimEnd(nodes: readonly RichNode[]): RichNode[] {
  const out = [...nodes];
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

function trimInline(nodes: readonly RichNode[]): RichNode[] {
  return trimEnd(trimStart(nodes));
}

/**
 * 行內位置（段落、標題、清單項目的字、粗體裡…）：裡面冒出區塊就攤平成字，前後用 `<br>` 隔開；
 * 分隔線當作分段。標題、引用、清單、分隔線在這裡消失要記下來（審查 F3）。
 */
function inlineFlow(nodes: readonly RichNode[], sink: Sink): RichNode[] {
  const out: RichNode[] = [];
  let pendingBreak = false;
  const pushContent = (pieces: RichNode[]): void => {
    if (pieces.length === 0) return;
    if (pendingBreak && hasContentBefore(out)) out.push(element('br', [], []));
    pendingBreak = false;
    out.push(...pieces);
  };
  for (const node of nodes) {
    if (node.type === 'text') {
      if (pendingBreak && isWhitespace(node)) continue;
      pushContent([node]);
      continue;
    }
    if (node.tag === 'hr') {
      reportFlatten(sink, 'hr');
      pendingBreak = true;
      continue;
    }
    if (isBlockish(node)) {
      reportFlatten(sink, node.tag);
      const inner = trimInline(inlineFlow(node.children, sink));
      if (inner.length === 0) continue;
      pendingBreak = true;
      pushContent(inner);
      pendingBreak = true;
      continue;
    }
    if (node.children.length === 0 && node.tag !== 'br' && node.tag !== 'img') {
      if (EMPTYABLE_INLINE.has(node.tag)) continue;
    }
    pushContent([node.children.length === 0 ? node : element(node.tag, node.attrs, inlineFlow(node.children, sink))]);
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
function textBlock(node: RichElement, flow: Flow, rootClass: boolean, sink: Sink): RichNode[] {
  const tag = node.tag === 'div' ? 'p' : node.tag;
  const out: RichNode[] = [];
  let run: RichNode[] = [];
  const flush = (): void => {
    const inline = inlineFlow(run, sink);
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
      out.push(...blockFlow([child], flow, rootClass, sink));
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
function blockFlow(nodes: readonly RichNode[], flow: Flow, rootClass: boolean, sink: Sink): RichNode[] {
  const out: RichNode[] = [];
  let run: RichNode[] = [];
  const flush = (): void => {
    const inline = trimInline(inlineFlow(run, sink));
    run = [];
    if (inline.length === 0 || isEmptyInline(inline)) return;
    const attrs = flow === 'root' && rootClass ? [{ name: 'class', value: 'wp-block-paragraph' }] : [];
    out.push(element('p', attrs, inline));
  };

  for (const node of nodes) {
    if (node.type === 'text') {
      // 區塊之間的空白：最外層是排版（丟掉，輸出時另外換行）；引用裡原樣留著。
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
        out.push(...textBlock(node.tag === 'li' ? element('div', [], node.children) : node, flow, rootClass, sink));
        break;
      case 'ul':
      case 'ol': {
        const list = listBlock(node, sink);
        if (list !== null) out.push(list);
        break;
      }
      case 'blockquote': {
        const children = blockFlow(node.children, 'quote', rootClass, sink);
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
function listBlock(list: RichElement, sink: Sink): RichElement | null {
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
      items.push(...listItems(child, sink));
      continue;
    }
    if (child.type === 'element' && (child.tag === 'ul' || child.tag === 'ol')) {
      const nested = listBlock(child, sink);
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
    items.push(...listItems(element('li', [], [child]), sink));
  }

  if (!items.some((item) => item.type === 'element')) return null;
  return element(list.tag, list.attrs, items);
}

type ItemToken = { readonly kind: 'inline'; readonly node: RichNode } | { readonly kind: 'break' } | { readonly kind: 'list'; readonly node: RichElement };

/**
 * 把清單項目的內容攤成一串：行內節點、分段、子清單。項目裡的段落、div、標題、引用是「包裝」：
 * 穿過它往下找，裡面的字前後要分段（審查 #3），裡面的子清單照樣是子清單（審查 #4）。
 * 標題、引用、分隔線在清單項目裡存不了，攤平時記下來（審查 F3）；分隔線當作分段。
 */
function itemTokens(nodes: readonly RichNode[], sink: Sink): ItemToken[] {
  const out: ItemToken[] = [];
  for (const node of nodes) {
    if (node.type === 'element' && (node.tag === 'ul' || node.tag === 'ol')) {
      out.push({ kind: 'list', node });
    } else if (node.type === 'element' && isBlockish(node)) {
      reportFlatten(sink, node.tag);
      if (node.tag === 'hr') {
        out.push({ kind: 'break' });
        continue;
      }
      out.push({ kind: 'break' }, ...itemTokens(node.children, sink), { kind: 'break' });
    } else {
      out.push({ kind: 'inline', node });
    }
  }
  return out;
}

/**
 * 一個清單項目。內容**照原本的順序**留著，不拆成新項目：子清單後面還有字（`<li>A<ul>…</ul>結論</li>`）
 * 是合法的 HTML，古騰堡的清單項目存不了這個順序，發布時整個清單走 wp:html 保底（block-parse 的規則；審查 #5）。
 * 分段之間用 `<br>`；只在分段的邊界修掉空白，字與字之間的空白不動（審查 F1）。
 * 沒有字也沒有子清單的項目（`<li><br></li>`）拿掉。
 */
function listItems(li: RichElement, sink: Sink): RichElement[] {
  const children: RichNode[] = [];
  let segment: RichNode[] = [];
  let breakBefore = false;
  let hasList = false;

  const flushSegment = (breakAfter: boolean): void => {
    let pieces = inlineFlow(segment, sink);
    segment = [];
    if (breakBefore) pieces = trimStart(pieces);
    if (breakAfter) pieces = trimEnd(pieces);
    if (pieces.length === 0 || (breakBefore && pieces.every((node) => isWhitespace(node)))) return;
    if (breakBefore && hasContentBefore(children) && !endsWithList(children)) children.push(element('br', [], []));
    children.push(...pieces);
    breakBefore = false;
  };

  for (const token of itemTokens(li.children, sink)) {
    if (token.kind === 'break') {
      flushSegment(true);
      breakBefore = true;
      continue;
    }
    if (token.kind === 'list') {
      flushSegment(false);
      const sub = listBlock(token.node, sink);
      if (sub !== null) {
        children.push(sub);
        hasList = true;
      }
      breakBefore = false;
      continue;
    }
    segment.push(token.node);
  }
  flushSegment(false);
  const words = children.filter((node) => !(node.type === 'element' && (node.tag === 'ul' || node.tag === 'ol')));
  if (!hasList && isEmptyInline(words)) return [];
  return [element('li', li.attrs, children)];
}

function endsWithList(nodes: readonly RichNode[]): boolean {
  const last = [...nodes].reverse().find((node) => !isWhitespace(node));
  return last !== undefined && last.type === 'element' && (last.tag === 'ul' || last.tag === 'ol');
}

// ---------------------------------------------------------------------------
// 對外：整份整理
// ---------------------------------------------------------------------------

function makeContext(options: RichCleanOptions): Context {
  return {
    options,
    allowed: options.allowedTags === undefined ? null : new Set(options.allowedTags.map((tag) => tag.toLowerCase())),
    dropped: [],
  };
}

/**
 * 整份整理。貼上用這個；編輯存檔用 `cleanRichEdit`（沒改的頂層區塊原樣保留）。
 */
export function cleanRich(nodes: readonly RichNode[], options: RichCleanOptions): RichCleanResult {
  const ctx = makeContext(options);
  const cleaned = stripMarkers(cleanNodes(ctx, nodes));
  // 貼上時不提醒（貼上來的東西本來就要整理）；編輯時結構整理丟掉的格式也要講。
  const sink: Sink = options.mode === 'edit' ? ctx.dropped : [];

  // 貼上的只有行內內容（例如複製網頁上的一句話）：插在游標處，不包成段落。
  // 前後的空白要留著（`<span> brave </span>` 貼進 `Hello|world` 要是 `Hello brave world`，第四輪審查 #3）；
  // 只拿掉原始碼排版造成的頭尾換行（`\n<span>x</span>\n`）。
  if (options.mode === 'paste' && !cleaned.some((node) => isBlockish(node))) {
    const edges = trimSourceNewlines(nodes);
    const inline = inlineFlow(stripMarkers(cleanNodes(ctx, edges)), sink);
    return { nodes: inline, dropped: ctx.dropped };
  }
  const blocks = blockFlow(cleaned, 'root', options.mode === 'edit', sink);
  // 貼上的段落：頭尾空白是來源的排版，修掉；段內的空白留著。編輯時不動（使用者自己打的）。
  return { nodes: options.mode === 'paste' ? trimTextBlocks(blocks) : blocks, dropped: ctx.dropped };
}

function trimTextBlocks(nodes: readonly RichNode[]): RichNode[] {
  return nodes.map((node) => {
    if (node.type === 'text') return node;
    if (node.tag === 'p' || node.tag === 'h2' || node.tag === 'h3' || node.tag === 'figcaption') {
      return element(node.tag, node.attrs, trimInline(node.children));
    }
    return element(node.tag, node.attrs, trimTextBlocks(node.children));
  });
}

/** 最外層頭尾「含換行的純空白」文字節點是原始碼排版，不是內容；只有空白（沒換行）的留著。 */
function trimSourceNewlines(nodes: readonly RichNode[]): RichNode[] {
  const out = [...nodes];
  const isLayout = (node: RichNode | undefined): boolean =>
    node !== undefined && node.type === 'text' && isWhitespace(node) && /\n/.test(node.text);
  while (isLayout(out[0])) out.shift();
  while (isLayout(out[out.length - 1])) out.pop();
  const first = out[0];
  if (first?.type === 'text') out[0] = text(first.text.replace(/^[ \t\r\f]*\n[ \t\r\n\f]*/, ''));
  const last = out[out.length - 1];
  if (last?.type === 'text') out[out.length - 1] = text(last.text.replace(/[ \t\r\n\f]*\n[ \t\r\f]*$/, ''));
  return out;
}

// ---------------------------------------------------------------------------
// 對外：編輯存檔（沒改的頂層區塊原樣保留）
// ---------------------------------------------------------------------------

/** 出現在最外層時跟前後的字併成同一段的行內標籤（跟 core/html-blocks 的 INLINE_TAGS 同一份清單，外加 font）。 */
const ROOT_INLINE = new Set([
  'a', 'strong', 'em', 'b', 'i', 'u', 's', 'code', 'span', 'br', 'sub', 'sup', 'small', 'mark', 'abbr',
  'cite', 'q', 'time', 'del', 'ins', 'font',
]);

/**
 * 一個頂層區塊：一個最外層元素，或一串連在一起的最外層行內內容。`key` 是它的正規化 HTML，用來比對有沒有改；
 * 保留時輸出的也是這份正規化 HTML（HTML 解析器修補過、不是原始字串片段——原始片段可能有沒關的註解或標籤，
 * 逐字拼回去會吞掉後面新加的區塊，第三輪審查 #1）。
 */
export interface RichUnit {
  readonly key: string;
  readonly nodes: readonly RichNode[];
}

/** 切成頂層區塊。最外層的空白（區塊之間的排版）不屬於任何區塊。 */
export function richUnits(nodes: readonly RichNode[]): RichUnit[] {
  const units: RichUnit[] = [];
  let run: RichNode[] = [];
  const make = (unitNodes: RichNode[]): RichUnit => ({ key: serializeRich(unitNodes), nodes: unitNodes });
  const flush = (): void => {
    while (run.length > 0 && isWhitespace(run[run.length - 1]!)) run.pop();
    if (run.length > 0) units.push(make(run));
    run = [];
  };
  for (const node of nodes) {
    if (node.type === 'text') {
      if (isWhitespace(node) && run.length === 0) continue;
      run.push(node);
      continue;
    }
    if (ROOT_INLINE.has(node.tag)) {
      run.push(node);
      continue;
    }
    flush();
    units.push(make([node]));
  }
  flush();
  return units;
}

/** 最長共同子序列：回傳每個 edited 區塊對上的 original 索引（對不上是 -1）。插入、刪除段落不會讓後面全部對不上。 */
function matchUnits(original: readonly string[], edited: readonly string[]): number[] {
  const n = original.length;
  const m = edited.length;
  const table: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i]![j] = original[i] === edited[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  const match = new Array<number>(m).fill(-1);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (original[i] === edited[j]) {
      match[j] = i;
      i += 1;
      j += 1;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return match;
}

export type RichEditPiece =
  | { readonly kept: true; readonly unit: RichUnit }
  | { readonly kept: false; readonly nodes: readonly RichNode[] };

export interface RichEditResult {
  readonly pieces: readonly RichEditPiece[];
  /** 有改動的區塊裡因為模板不支援或結構存不了而拿掉的格式。沒改的區塊不算。 */
  readonly dropped: string[];
}

/**
 * 編輯存檔的整理（前後端共用，審查 F3／F5／#5 的根本修法）：
 * 編輯後的正文跟**基準**逐個**頂層區塊**比對（最長共同子序列，不是位置對齊）。基準一律是上一版
 * **實際會發布的正文**（sanitize 之後的 publishHtml）：前端看到的校樣就是它，後端也自己算出同一份，
 * 兩邊的區塊鍵才對得上（第三輪審查 #2）。
 * 對得上的＝使用者沒碰過，**原樣保留**；只有改過或新增的區塊跑整理規則。連在一起的改動區塊一起整理。
 * `original` 為 null（拿不到上一版）就整份整理。
 *
 * 保留不等於免檢：後端仍會對整份正文跑 sanitize 與結構驗證。
 */
export function cleanRichEdit(
  edited: readonly RichNode[],
  original: readonly RichUnit[] | null,
  options: Omit<RichCleanOptions, 'mode'>,
): RichEditResult {
  const editOptions: RichCleanOptions = { ...options, mode: 'edit' };
  if (original === null) {
    const whole = cleanRich(edited, editOptions);
    return { pieces: [{ kept: false, nodes: whole.nodes }], dropped: whole.dropped };
  }
  const units = richUnits(edited);
  const match = matchUnits(
    original.map((unit) => unit.key),
    units.map((unit) => unit.key),
  );
  const pieces: RichEditPiece[] = [];
  const dropped: string[] = [];
  let pending: RichNode[] = [];
  const flush = (): void => {
    if (pending.length === 0) return;
    const cleaned = cleanRich(pending, editOptions);
    pending = [];
    for (const label of cleaned.dropped) addLabel(dropped, label);
    if (cleaned.nodes.length > 0) pieces.push({ kept: false, nodes: cleaned.nodes });
  };
  units.forEach((unit, index) => {
    const at = match[index]!;
    if (at < 0) {
      // 區塊之間補一個換行：最外層的行內內容才不會跟上一塊黏在一起。
      if (pending.length > 0) pending.push(text('\n'));
      pending.push(...unit.nodes);
      return;
    }
    flush();
    pieces.push({ kept: true, unit: original[at]! });
  });
  flush();
  return { pieces, dropped };
}

/** 把 `cleanRichEdit` 的結果接回 HTML：保留的區塊輸出基準裡那份正規化 HTML，頂層區塊之間用換行（後端的正文慣例）。 */
export function serializeRichEdit(result: RichEditResult): string {
  return result.pieces
    .map((piece) => (piece.kept ? serializeRich(piece.unit.nodes) : serializeRich(piece.nodes, '\n')))
    .filter((part) => part.length > 0)
    .join('\n');
}

// ---------------------------------------------------------------------------
// 序列化
// ---------------------------------------------------------------------------

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
 * 所以同一份 HTML 從瀏覽器 DOM 或 parse5 轉出來的區塊 key 相同，比得出「沒改過」。
 * `separator`：最外層節點之間放什麼（後端的正文慣例是換行）。
 */
export function serializeRich(nodes: readonly RichNode[], separator = ''): string {
  return nodes.map(serializeNode).join(separator);
}
