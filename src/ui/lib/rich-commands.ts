import {
  cleanRich,
  cleanRichEdit,
  richUnits,
  serializeRich,
  serializeRichEdit,
  type RichNode,
  type RichUnit,
} from '../../contract/rich-text.js';
import { countNonSpace, locateTextOffset } from './check-while-writing.js';
import { emphasisFromComputed, type ComputedEmphasis, type FormatCommand, type FormatState } from './rich-format.js';

/**
 * 直接在文章上改的格式指令：對校樣 iframe 的文件下指令（P5-T028）。
 *
 * iframe 維持 `sandbox="allow-same-origin"`、不給 scripts：這裡的程式都跑在外層，
 * 對同源的 iframe 文件呼叫 `execCommand`（瀏覽器內建的編輯指令，會進 ⌘Z 的復原堆疊）。
 * 產出一律在存檔前經過 `cleanEditedBody` 整理，後端再用同一套規則整理一次。
 *
 * Chrome 實測過的坑（寫在各函式裡）：清單會長在段落裡（`<p><ul>`）、清單裡按標題會產生
 * `<h2><ul>`、多段一起按引用會併成一段用 `<br>` 隔開、分隔線預設插在游標處把段落切兩半。
 * 前兩個靠存檔整理與停用按鈕處理，後兩個在這裡處理。
 */

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

interface DomLike {
  readonly nodeType: number;
  readonly nodeName: string;
  readonly nodeValue: string | null;
  readonly childNodes: ArrayLike<DomLike>;
  readonly attributes?: ArrayLike<{ readonly name: string; readonly value: string }>;
}

/** DOM → 共用契約的格式樹。註解等其他節點略過。不用 instanceof：iframe 的節點屬於另一個視窗。 */
export function domToRich(nodes: ArrayLike<DomLike>): RichNode[] {
  const out: RichNode[] = [];
  for (const node of Array.from(nodes)) {
    if (node.nodeType === TEXT_NODE) {
      out.push({ type: 'text', text: node.nodeValue ?? '' });
    } else if (node.nodeType === ELEMENT_NODE) {
      out.push({
        type: 'element',
        tag: node.nodeName.toLowerCase(),
        attrs: Array.from(node.attributes ?? []).map((attr) => ({ name: attr.name, value: attr.value })),
        children: domToRich(node.childNodes),
      });
    }
  }
  return out;
}

export interface RichAllow {
  readonly tags: readonly string[];
  readonly schemes: readonly string[];
}

/** 進入編輯那一刻的正文，切成頂層區塊。存檔時拿來比對哪些區塊沒動過。 */
export function snapshotBody(body: Element): RichUnit[] {
  return richUnits(domToRich(body.childNodes as unknown as ArrayLike<DomLike>));
}

/**
 * 存好的那份正文 HTML 切成頂層區塊（D-036）：打字中存了一版、留在打字模式時，之後「哪些區塊沒動過」改跟這一版比。
 * 外層視窗的 DOMParser：解析出來的文件是惰性的，script 不會跑、圖片不會載入。
 */
export function snapshotHtml(html: string): RichUnit[] {
  return snapshotBody(new DOMParser().parseFromString(`<!doctype html><body>${html}</body>`, 'text/html').body);
}

/**
 * 把正文換成存進去的那份整理後 HTML，游標照「前面有幾個非空白字」放回去（審查 3：照樣存之後畫面跟存進去的一致，
 * 不再留著存不進去的格式）。整理只拿掉格式、不動字（空白與區塊間的換行會變，所以不算），字數對得上；
 * 對不上（超出）就放在最後一段結尾。
 */
export function replaceBodyKeepingCaret(doc: Document, body: Element, html: string): void {
  const selection = doc.getSelection();
  let offset: number | null = null;
  if (selection && selection.rangeCount > 0 && selection.anchorNode !== null && body.contains(selection.anchorNode)) {
    const before = doc.createRange();
    before.selectNodeContents(body);
    before.setEnd(selection.anchorNode, selection.anchorOffset);
    offset = countNonSpace(before.toString());
  }
  body.innerHTML = html;
  if (offset === null || !selection) return;
  const nodes: Text[] = [];
  const walker = doc.createTreeWalker(body, 4 /* NodeFilter.SHOW_TEXT */);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) nodes.push(node as Text);
  const at = locateTextOffset(nodes.map((node) => node.data), offset);
  const range = doc.createRange();
  if (at === null) {
    range.selectNodeContents(body);
    range.collapse(false);
  } else {
    range.setStart(nodes[at.index]!, at.offset);
    range.collapse(true);
  }
  selection.removeAllRanges();
  selection.addRange(range);
}

/**
 * 存檔前整理編輯區。**只整理改過或新增的頂層區塊**，沒動過的（跟 `original` 對得上的）原樣保留
 * （`cleanRichEdit`，後端同一套）。`dropped`：改過的區塊裡因為模板不支援或結構存不了而會被拿掉的格式。
 */
export function cleanEditedBody(body: Element, allow: RichAllow, original: readonly RichUnit[] | null): { html: string; dropped: string[] } {
  const result = cleanRichEdit(domToRich(body.childNodes as unknown as ArrayLike<DomLike>), original, {
    allowedTags: allow.tags,
    allowedSchemes: allow.schemes,
  });
  return { html: serializeRichEdit(result), dropped: result.dropped };
}

/** 貼上的外來 HTML → 要插進去的 HTML（`paste` 模式）。空字串＝整理完什麼都不剩。 */
export function cleanPastedHtml(html: string, allow: RichAllow): string {
  // 外層視窗的 DOMParser：解析出來的文件是惰性的，script 不會跑、圖片不會載入。
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const result = cleanRich(domToRich(parsed.body.childNodes as unknown as ArrayLike<DomLike>), {
    mode: 'paste',
    allowedTags: allow.tags,
    allowedSchemes: allow.schemes,
  });
  return serializeRich(result.nodes);
}

function anchorElement(doc: Document, body: Element): Element | null {
  const node = doc.getSelection()?.anchorNode ?? null;
  if (node === null || !body.contains(node)) return null;
  return node.nodeType === ELEMENT_NODE ? (node as Element) : node.parentElement;
}

/** 游標往外到正文容器為止的祖先標籤（最裡面的在前）。游標不在正文裡回 null。 */
export function selectionAncestors(doc: Document, body: Element): string[] | null {
  let element = anchorElement(doc, body);
  if (element === null) return null;
  const tags: string[] = [];
  while (element !== null && element !== body) {
    tags.push(element.tagName.toLowerCase());
    element = element.parentElement;
  }
  return tags;
}

/** 游標處實際的粗／斜（iframe 自己的 getComputedStyle；樣式由外層讀，iframe 不跑 script）。 */
export function selectionEmphasis(doc: Document, body: Element): ComputedEmphasis | null {
  const element = anchorElement(doc, body);
  const view = doc.defaultView;
  if (element === null || view === null) return null;
  const style = view.getComputedStyle(element);
  return emphasisFromComputed(style.fontWeight, style.fontStyle);
}

function closestIn(doc: Document, body: Element, selector: string): Element | null {
  const found = anchorElement(doc, body)?.closest(selector) ?? null;
  return found !== null && body.contains(found) && found !== body ? found : null;
}

/** 游標所在的連結。 */
export function currentLink(doc: Document, body: Element): Element | null {
  return closestIn(doc, body, 'a');
}

/** 目前的選取範圍（在正文裡才算）。打開連結輸入框前先存起來：焦點離開 iframe 之後還要用。 */
export function saveSelection(doc: Document, body: Element): Range | null {
  const selection = doc.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  return body.contains(range.commonAncestorContainer) ? range.cloneRange() : null;
}

function restoreSelection(frame: HTMLIFrameElement, body: HTMLElement, range: Range | null): void {
  frame.contentWindow?.focus();
  body.focus();
  if (range === null) return;
  const selection = frame.contentDocument?.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * 加上或改連結。`href` 已經驗過（`parseLinkInput`）。
 * - 游標在既有連結裡：整個連結換網址（字不動）。
 * - 有選字：選到的字變連結。
 * - 什麼都沒選：插入一段以網址本身為字的連結。
 */
export function applyLink(frame: HTMLIFrameElement, body: HTMLElement, range: Range | null, href: string, existing: Element | null): void {
  const doc = frame.contentDocument;
  if (!doc) return;
  restoreSelection(frame, body, range);
  if (existing !== null && body.contains(existing)) {
    const whole = doc.createRange();
    whole.selectNodeContents(existing);
    restoreSelection(frame, body, whole);
    doc.execCommand('createLink', false, href);
    return;
  }
  if (range === null || range.collapsed) {
    doc.execCommand('insertHTML', false, `<a href="${escapeHtml(href)}">${escapeHtml(href)}</a>`);
    return;
  }
  doc.execCommand('createLink', false, href);
}

/** 拿掉連結，字留著。 */
export function removeLink(frame: HTMLIFrameElement, body: HTMLElement, existing: Element): void {
  const doc = frame.contentDocument;
  if (!doc || !body.contains(existing)) return;
  const whole = doc.createRange();
  whole.selectNode(existing);
  restoreSelection(frame, body, whole);
  doc.execCommand('unlink');
}

/**
 * 區塊類的指令（標題、段落、清單、引用、分隔線）與粗斜體。連結另外走 `applyLink`。
 * 回傳 true＝有動到正文（上層要重量高度）。
 */
export function runCommand(frame: HTMLIFrameElement, body: HTMLElement, command: Exclude<FormatCommand, 'link'>, state: FormatState): boolean {
  const doc = frame.contentDocument;
  if (!doc) return false;
  frame.contentWindow?.focus();
  switch (command) {
    case 'bold':
      return doc.execCommand('bold');
    case 'italic':
      return doc.execCommand('italic');
    case 'h2':
    case 'h3':
      // 再按一次同一個＝回到段落。
      return doc.execCommand('formatBlock', false, state.block === command ? 'p' : command);
    case 'paragraph':
      if (state.block === 'list') return toggleList(doc, state.list ?? 'ul');
      if (state.block === 'h2' || state.block === 'h3') return doc.execCommand('formatBlock', false, 'p');
      return false;
    case 'ul':
    case 'ol':
      // 標題裡直接轉清單，Chrome 會產生 `<h2><ul>`；先變回段落再轉。
      if (state.block === 'h2' || state.block === 'h3') doc.execCommand('formatBlock', false, 'p');
      return toggleList(doc, command);
    case 'quote':
      return state.quote ? unquote(doc, body) : doc.execCommand('formatBlock', false, 'blockquote');
    case 'hr':
      return insertSeparator(doc, body);
  }
}

function toggleList(doc: Document, list: 'ul' | 'ol'): boolean {
  return doc.execCommand(list === 'ul' ? 'insertUnorderedList' : 'insertOrderedList');
}

const INLINE_ONLY = /^(a|strong|em|b|i|span|br|font|mark|u|s|sub|sup|code)$/;

/**
 * 拿掉引用。
 *
 * 引用裡只有字（用工具列加的，Chrome 的 formatBlock 產生 `<blockquote>字</blockquote>`）：
 * 用 formatBlock 換回段落，可以 ⌘Z。
 * 引用裡是一段一段的（AI 或模板產生的 `<blockquote><p>…</p></blockquote>`）：Chrome 沒有指令能乾淨地
 * 拿掉（outdent 會把第一段變成裸文字），只好直接改 DOM——這一步**不進 ⌘Z 的復原堆疊**，取消編輯仍可整個還原。
 */
function unquote(doc: Document, body: HTMLElement): boolean {
  const quote = closestIn(doc, body, 'blockquote');
  if (quote === null) return false;
  const blockChildren = Array.from(quote.children).some((child) => !INLINE_ONLY.test(child.tagName.toLowerCase()));
  if (!blockChildren) return doc.execCommand('formatBlock', false, 'p');

  const parent = quote.parentNode;
  if (!parent) return false;
  let run: HTMLParagraphElement | null = null;
  const first = quote.firstChild;
  for (const child of Array.from(quote.childNodes)) {
    const isInline =
      child.nodeType === TEXT_NODE || (child.nodeType === ELEMENT_NODE && INLINE_ONLY.test((child as Element).tagName.toLowerCase()));
    if (isInline) {
      if (child.nodeType === TEXT_NODE && (child.nodeValue ?? '').trim().length === 0 && run === null) {
        quote.removeChild(child);
        continue;
      }
      if (run === null) {
        run = doc.createElement('p');
        parent.insertBefore(run, quote);
      }
      run.appendChild(child);
      continue;
    }
    run = null;
    parent.insertBefore(child, quote);
  }
  parent.removeChild(quote);
  if (first !== null && body.contains(first)) {
    const range = doc.createRange();
    range.selectNodeContents(first);
    range.collapse(true);
    const selection = doc.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }
  return true;
}

/**
 * 分隔線插在游標所在那一整塊（段落、清單、引用…）的**後面**，不切斷段落。
 *
 * Chrome 實測：insertHorizontalRule 放在游標處會把「三|四」切成兩段；在段落**尾端**下它就乾淨地插在
 * 段落後面。清單、引用裡的尾端會插進清單項目／引用裡面，所以那兩種改成在整塊後面用 insertHTML；
 * 但後面緊接著是引用或清單時，Chrome 會把它塞進那一塊的開頭，只好直接改 DOM（這一步不進 ⌘Z）。
 */
function insertSeparator(doc: Document, body: HTMLElement): boolean {
  const anchor = anchorElement(doc, body);
  let top = anchor;
  while (top !== null && top.parentElement !== body) top = top.parentElement;
  const selection = doc.getSelection();
  const select = (range: Range): void => {
    selection?.removeAllRanges();
    selection?.addRange(range);
  };
  const range = doc.createRange();
  if (top === null) {
    range.selectNodeContents(body);
    range.collapse(false);
    select(range);
    return doc.execCommand('insertHTML', false, '<hr>');
  }
  if (TEXT_BLOCK.test(top.tagName.toLowerCase())) {
    range.selectNodeContents(top);
    range.collapse(false);
    select(range);
    return doc.execCommand('insertHorizontalRule');
  }
  const next = top.nextElementSibling;
  if (next === null || TEXT_BLOCK.test(next.tagName.toLowerCase())) {
    range.setStartAfter(top);
    range.collapse(true);
    select(range);
    return doc.execCommand('insertHTML', false, '<hr>');
  }
  top.insertAdjacentElement('afterend', doc.createElement('hr'));
  return true;
}

const TEXT_BLOCK = /^(p|h[1-6]|div)$/;
