import { isBlankBody } from '../../contract/empty-body.js';
import { locateEditCaret } from './edit-target.js';
import { cleanPastedHtml, type RichAllow } from './rich-commands.js';
import type { FormatState } from './rich-format.js';
import { editKeyAction, pasteAction, shouldBlockDrop } from './proof-edit.js';

/**
 * 「直接在文章上改」對 iframe 文件做的事（P5-T010、P5-T011、P5-T028、P5-T029、P5-T031；P5-T035 從 `ProofView` 抽出）。
 * 都不需要 React 狀態：`ProofView` 只管什麼時候叫、把結果放進 state。iframe 仍然不跑 script——
 * 這裡的東西都由外層對 iframe 文件做（CSSOM、Range、外層掛的事件處理函式）。
 */

/**
 * 直接在文章上改時，標出「要改的是哪裡」（P5-T011）。
 *
 * 用 CSS Custom Highlight（`CSS.highlights` ＋ `::highlight()`），不用 `<mark>`：它只在畫面上
 * 上色，不改 DOM，所以不會混進要存檔的正文，也不會在打字時被 contenteditable 拆成碎片。
 * 顏色是螢光筆黃，刻意跟四種建議標記都不同——這個標記的意思是「游標在這裡」，不是「這裡有建議」。
 */
const EDIT_TARGET = 'publisher-edit-target';
const EDIT_TARGET_RULE = `::highlight(${EDIT_TARGET}) { background-color: #FFE066; text-decoration: underline 2px #1C1B19; }`;

export function showEditTarget(frame: HTMLIFrameElement, target: Range | null): void {
  // 要用 iframe 自己視窗的 CSS 與 Highlight：Range 屬於那份文件。
  const win = frame.contentWindow as (Window & typeof globalThis) | null;
  const doc = frame.contentDocument;
  const registry = win?.CSS?.highlights;
  if (!win || !doc || !registry || typeof win.Highlight !== 'function') return; // 舊瀏覽器：只有游標，沒有標色
  registry.delete(EDIT_TARGET);
  if (target === null) return;
  const sheet = doc.styleSheets[0];
  if (sheet && !doc.documentElement.hasAttribute('data-edit-target-rule')) {
    // CSSOM 插規則，不動文件的 <style>；每份文件只插一次。
    sheet.insertRule(EDIT_TARGET_RULE, sheet.cssRules.length);
    doc.documentElement.setAttribute('data-edit-target-rule', '');
  }
  registry.set(EDIT_TARGET, new win.Highlight(target));
}

/**
 * 打字模式裡標題看得出「可以點進去改」、空正文有提示（P5-T029）。用 CSSOM 插進文件，不動文件的 <style>。
 *
 * 正文的焦點框跟標題一樣往外推（P5-T037）：瀏覽器預設的框緊貼文字左緣，游標在段首時疊在框線上看不到。
 * 推 6px＋框 2px 落在模板左右 1.25rem 的留白裡，不會被 iframe 邊緣切掉。
 */
export const WRITE_RULES: readonly string[] = [
  '.preview-title[contenteditable] { outline: 1px dashed #B8B2A6; outline-offset: 6px; border-radius: 2px; cursor: text; }',
  '.preview-title[contenteditable]:focus { outline: 2px solid #1E4F8A; }',
  '.preview-body[contenteditable]:focus { outline: 2px solid #1E4F8A; outline-offset: 6px; border-radius: 2px; }',
  '.preview-body[data-blank="yes"] > p:first-child::before { content: "從這裡開始寫…"; color: #9A958C; float: left; height: 0; pointer-events: none; }',
];

function ensureWriteRules(doc: Document): void {
  const sheet = doc.styleSheets[0];
  if (!sheet || doc.documentElement.hasAttribute('data-write-rules')) return;
  for (const rule of WRITE_RULES) sheet.insertRule(rule, sheet.cssRules.length);
  doc.documentElement.setAttribute('data-write-rules', '');
}

/** 正文空不空決定要不要顯示「從這裡開始寫…」。 */
export function markBlank(body: HTMLElement): void {
  body.setAttribute('data-blank', isBlankBody(body.innerHTML) ? 'yes' : 'no');
}

/** 拆掉字上的建議標記（`<mark data-hl>`），字留著。 */
export function unwrapHighlightMarks(body: Element): void {
  for (const mark of Array.from(body.querySelectorAll('mark[data-hl]'))) {
    mark.replaceWith(...Array.from(mark.childNodes));
  }
  body.normalize();
}

/** 正文與標題變成可打字（P5-T010、P5-T029）。 */
export function enableWriting(doc: Document, body: HTMLElement, title: HTMLElement | null): void {
  ensureWriteRules(doc);
  markBlank(body);
  body.setAttribute('contenteditable', 'true');
  if (title) {
    title.setAttribute('contenteditable', 'plaintext-only');
    title.setAttribute('spellcheck', 'false');
  }
  // 按 Enter 開新段落用 <p>，不要 Chrome 預設的 <div>。
  doc.execCommand('defaultParagraphSeparator', false, 'p');
}

/** 離開打字模式：拿掉可編輯與空正文提示、清掉螢光筆標色。 */
export function disableWriting(frame: HTMLIFrameElement, body: HTMLElement, title: HTMLElement | null): void {
  showEditTarget(frame, null);
  body.removeAttribute('contenteditable');
  body.removeAttribute('data-blank');
  title?.removeAttribute('contenteditable');
}

/**
 * 游標要放哪裡、要標出哪一段。
 *
 * - 游標：那一項引用的字前面（忽略空白，跟定位同一套規則）；沒有段落、正文找不到的，到標題裡找
 *   （講標題的建議，P5-T031，規則見 `edit-target.ts`）；都找不到就放那一段的開頭，再不行就放文章開頭。
 * - 標色：找得到字就標那段字；找不到但知道是第幾段，就標整段（至少是「大概在這裡」）；
 *   從上方「改原文」進來的沒有目標，不標。
 * - `inTitle`：游標在標題裡，焦點要給標題（不然 `body.focus()` 會把游標拉回正文）。
 */
export function editTarget(
  doc: Document,
  body: Element,
  title: Element | null,
  request: { caret: string | null; caretSkipInside?: string | null; blockIndex: number | null },
): { caret: Range; target: Range | null; inTitle: boolean } {
  const caret = doc.createRange();
  const block = request.blockIndex === null ? null : (body.children[request.blockIndex] ?? null);
  const scopeNodes = textNodes(doc, block ?? body);
  const titleNodes = title === null ? [] : textNodes(doc, title);
  const spot = locateEditCaret(
    request,
    scopeNodes.map((node) => node.data),
    titleNodes.map((node) => node.data),
  );
  if (spot.in !== 'fallback') {
    const node = (spot.in === 'title' ? titleNodes : scopeNodes)[spot.node]!;
    caret.setStart(node, spot.start);
    caret.collapse(true);
    const target = doc.createRange();
    target.setStart(node, spot.start);
    target.setEnd(node, spot.end);
    return { caret, target, inTitle: spot.in === 'title' };
  }
  // 沒有指定段落：游標放第一段裡面（第一段是文字段落時），不要停在段落外面——
  // 停在外面打的字會變成頂層裸文字（新稿件剛建好的空段落就是這種情況，P5-T029）。
  const first = body.firstElementChild;
  caret.selectNodeContents(block ?? (first !== null && first.tagName === 'P' ? first : body));
  caret.collapse(true);
  if (block === null) return { caret, target: null, inTitle: false };
  const target = doc.createRange();
  target.selectNodeContents(block);
  return { caret, target, inTitle: false };
}

function textNodes(doc: Document, scope: Element): Text[] {
  const nodes: Text[] = [];
  const walker = doc.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) nodes.push(node as Text);
  return nodes;
}

function isInTitle(target: EventTarget | null): boolean {
  // 不能用 instanceof Element：iframe 裡的節點屬於另一個視窗，外層的 Element 認不得它。
  const element = target as Element | null;
  return typeof element?.closest === 'function' && element.closest('.preview-title') !== null;
}

/** 游標放到正文開頭（標題裡按 Enter）。 */
function caretToBodyStart(doc: Document): void {
  const body = doc.querySelector<HTMLElement>('.preview-body');
  if (!body) return;
  body.focus();
  const range = doc.createRange();
  range.selectNodeContents(body.firstElementChild ?? body);
  range.collapse(true);
  const selection = doc.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

/**
 * 掛上編輯中的貼上、拖放、按鍵攔截（每份文件載入時掛一次）。全部先問 `isEditing()`，沒在編輯就不管。
 *
 * - 貼上（P5-T028、P5-T029）：有格式的剪貼簿只保留模板 allowlist 內的標籤；標題只收純文字、一行。
 * - 拖放：拖檔案進來或拖進標題一律擋；插圖走「在這裡插圖」。
 * - 按鍵：⌘B／⌘I／⌘K 交給 `runCommand`，⌘U 擋掉；標題裡 Enter 跳到正文開頭、格式快捷鍵不做事。
 */
export function attachEditInterceptors(
  doc: Document,
  deps: {
    isEditing: () => boolean;
    allow: () => RichAllow;
    formatState: () => FormatState | null;
    runCommand: (command: 'bold' | 'italic' | 'link') => void;
  },
): void {
  doc.addEventListener('paste', (event) => {
    if (!deps.isEditing()) return;
    event.preventDefault();
    const clip = {
      html: event.clipboardData?.getData('text/html') ?? '',
      plain: event.clipboardData?.getData('text/plain') ?? '',
    };
    const action = pasteAction(clip, isInTitle(event.target), (html) => cleanPastedHtml(html, deps.allow()));
    doc.execCommand(action.command, false, action.value);
  });
  doc.addEventListener('drop', (event) => {
    if (!deps.isEditing()) return;
    if (shouldBlockDrop(Array.from(event.dataTransfer?.types ?? []), isInTitle(event.target))) event.preventDefault();
  });
  doc.addEventListener('keydown', (event) => {
    if (!deps.isEditing()) return;
    const action = editKeyAction(event, isInTitle(event.target), deps.formatState());
    if (action.kind === 'pass') return;
    event.preventDefault();
    if (action.kind === 'to-body') caretToBodyStart(doc);
    else if (action.kind === 'run') deps.runCommand(action.command);
  });
}
