/**
 * 打字模式裡游標在圖片（`<figure>`）上時的按鍵（D-048，P5-T049）。
 *
 * **實際原因**（2026-10-21 用 `?fixtures=1` 重現）：圖片是最後一塊時，從上一段按 → 或 ↓，游標會停在 figure **裡面**
 * （圖片前或圖片後）。這時按 Enter，Chrome 把整個 figure **連同 class 複製一份**（`wp-block-image size-large aligncenter`），
 * 接著打的字落在那個新 figure 裡——不是段落。存檔整理在 `edit` 模式原樣保留 figure，所以那段字以「置中的圖片區塊」存進去。
 * 直接打字（不按 Enter）也一樣會打進 figure 裡、圖片旁邊。
 *
 * 規則（純函式，`node` 環境測得到；對 iframe 文件動手的是下面的 `escapeFigure`）：
 * - 游標在頂層 figure 裡（含圖說）按 Enter：在圖片**下方**開一個乾淨的 `<p>`（不帶 figure 的任何 class／style），游標移過去。
 * - 圖片是最後一塊：按 ↓（不在圖說裡，或在圖說的結尾）、或在結尾按 →：一樣在下方開新段落——游標才有地方接著寫。
 * - 游標在圖片旁邊（不在圖說裡）直接打字：字放進新段落；游標在圖片前面放上方、在後面放下方。輸入法組字也一樣處理。
 * - 游標在圖片旁邊貼上（⌘V）：先跳到新段落再貼（圖前放上方、圖後放下方）；圖說裡照常貼（審查 4）。
 * - 圖片**下一段段首**按 Backspace：不把段落併進圖片（Chrome 會把字併進 figure），游標移到圖片後面；那一段是空的就刪掉它再移。
 *   圖片**上一段段尾**按 Delete 同理（不把圖片併進段落），游標移到圖片前面。跟古騰堡一致：圖片旁的退格不會把字黏到圖上。
 * - 其他（圖說裡打字、⌘ 組合鍵、選取範圍不是一個點）交給瀏覽器。
 * - 插圖擋打字中（正文 `contenteditable` 不是 true）一律不動 DOM（審查 5）。
 */

export interface FigureCaret {
  /** 游標在圖說（figcaption）裡。 */
  readonly inCaption: boolean;
  /** 游標在 figure 的最前面（圖片前）。 */
  readonly atStart: boolean;
  /** 游標在 figure 的最後面（圖片後、或圖說結尾）。 */
  readonly atEnd: boolean;
  /** 這個 figure 是正文最後一塊。 */
  readonly isLast: boolean;
  /** 選取範圍是一個點（沒有選到字或圖）。 */
  readonly collapsed: boolean;
}

export interface FigureKey {
  readonly key: string;
  readonly isComposing: boolean;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  /** 輸入法處理中的按鍵，Chrome 給 229。 */
  readonly keyCode?: number;
}

export type FigureKeyAction =
  | { readonly kind: 'pass' }
  /** 擋掉預設，開新段落、游標移過去。 */
  | { readonly kind: 'escape'; readonly where: 'after' | 'before' }
  /** 不擋預設：先把游標移到新段落，讓這個鍵（或輸入法）打的字落在那裡。 */
  | { readonly kind: 'move'; readonly where: 'after' | 'before' };

/** 游標在頂層 figure 裡時按鍵要怎麼處理。游標不在 figure 裡由呼叫端判斷（不呼叫這裡）。 */
export function figureKeyAction(event: FigureKey, caret: FigureCaret): FigureKeyAction {
  if (event.isComposing) return { kind: 'pass' };
  if (event.metaKey || event.ctrlKey || event.altKey) return { kind: 'pass' };
  if (event.key === 'Enter') return { kind: 'escape', where: 'after' };
  if (caret.isLast && caret.collapsed) {
    if (event.key === 'ArrowDown' && (!caret.inCaption || caret.atEnd)) return { kind: 'escape', where: 'after' };
    if (event.key === 'ArrowRight' && caret.atEnd) return { kind: 'escape', where: 'after' };
  }
  if (caret.inCaption || !caret.collapsed) return { kind: 'pass' };
  const typing = event.key.length === 1 || event.key === 'Process' || event.keyCode === 229;
  if (!typing) return { kind: 'pass' };
  return { kind: 'move', where: caret.atStart ? 'before' : 'after' };
}

/** 在圖片旁貼上：先跳到新段落再讓貼上照常進行。 */
export function figurePasteAction(caret: FigureCaret): { readonly kind: 'pass' } | { readonly kind: 'move'; readonly where: 'after' | 'before' } {
  if (caret.inCaption || !caret.collapsed) return { kind: 'pass' };
  return { kind: 'move', where: caret.atStart ? 'before' : 'after' };
}

/** 游標在圖片隔壁那一塊（段落、小標）裡的位置。 */
export interface BesideFigure {
  readonly atBlockStart: boolean;
  readonly atBlockEnd: boolean;
  /** 那一塊沒有字也沒有圖。 */
  readonly blockEmpty: boolean;
  /** 上一塊是頂層 figure。 */
  readonly prevIsFigure: boolean;
  /** 下一塊是頂層 figure。 */
  readonly nextIsFigure: boolean;
  readonly collapsed: boolean;
}

export type BesideFigureAction =
  | { readonly kind: 'pass' }
  /** 擋掉預設：游標移到圖片的後面（end）或前面（start）；`removeBlock`＝先刪掉這一塊空的。 */
  | { readonly kind: 'to-figure'; readonly where: 'end' | 'start'; readonly removeBlock: boolean };

/** 圖片隔壁那一塊按 Backspace／Delete：不准把字跟圖片併在同一個 figure 裡。 */
export function besideFigureKeyAction(event: FigureKey, at: BesideFigure): BesideFigureAction {
  if (event.isComposing || event.metaKey || event.ctrlKey || !at.collapsed) return { kind: 'pass' };
  if (event.key === 'Backspace' && at.atBlockStart && at.prevIsFigure) {
    return { kind: 'to-figure', where: 'end', removeBlock: at.blockEmpty };
  }
  if (event.key === 'Delete' && at.atBlockEnd && at.nextIsFigure) {
    return { kind: 'to-figure', where: 'start', removeBlock: at.blockEmpty };
  }
  return { kind: 'pass' };
}

/** 新段落的 HTML：乾淨的 `<p>`，不帶任何 class 或 style（不繼承圖片的置中）。 */
export const CLEAN_PARAGRAPH = '<p><br></p>';

/** 隔壁那塊已經是空的乾淨段落：直接把游標移過去，不再多開一個。 */
export function isCleanEmptyParagraph(node: { tagName: string; attributes: { length: number }; textContent: string | null; querySelector: (selector: string) => unknown } | null): boolean {
  if (node === null || node.tagName !== 'P' || node.attributes.length > 0) return false;
  return (node.textContent ?? '').trim() === '' && node.querySelector('img, figure, hr') === null;
}

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

/** 游標所在的頂層 figure（`.preview-body` 的直接子元素）；不在就是 null。 */
export function caretFigure(body: Element, node: Node | null): HTMLElement | null {
  let current: Node | null = node;
  while (current !== null && current !== body) {
    if (current.parentNode === body) {
      return current.nodeType === ELEMENT_NODE && (current as Element).tagName === 'FIGURE' ? (current as HTMLElement) : null;
    }
    current = current.parentNode;
  }
  return null;
}

/** 量出游標在 figure 裡的位置（iframe 文件裡的 Range；不用 instanceof，節點屬於另一個視窗）。 */
export function readFigureCaret(doc: Document, body: Element, figure: HTMLElement): FigureCaret | null {
  const selection = doc.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  const caption = figure.querySelector('figcaption');
  const inCaption = caption !== null && caption.contains(range.startContainer);
  const before = doc.createRange();
  before.selectNodeContents(figure);
  before.setEnd(range.startContainer, range.startOffset);
  const after = doc.createRange();
  after.selectNodeContents(figure);
  after.setStart(range.endContainer, range.endOffset);
  return {
    inCaption,
    atStart: !hasContent(before.cloneContents()),
    atEnd: !hasContent(after.cloneContents()),
    isLast: lastBlock(body) === figure,
    collapsed: range.collapsed,
  };
}

function hasContent(fragment: DocumentFragment): boolean {
  if ((fragment.textContent ?? '').trim() !== '') return true;
  return fragment.querySelector('img') !== null;
}

/** 正文最後一塊（略過區塊之間的空白文字）。 */
function lastBlock(body: Element): Node | null {
  for (let node = body.lastChild; node !== null; node = node.previousSibling) {
    if (node.nodeType === TEXT_NODE && (node.nodeValue ?? '').trim() === '') continue;
    return node;
  }
  return null;
}

/**
 * 在 figure 上方或下方開一個乾淨的段落（隔壁已經是空的乾淨段落就沿用），游標放進去。回傳那個段落。
 * 直接改 DOM（不經 execCommand），所以不會觸發 `input`：呼叫端自己重量高度。
 */
export function escapeFigure(doc: Document, figure: HTMLElement, where: 'after' | 'before'): HTMLElement {
  const neighbor = (where === 'after' ? figure.nextElementSibling : figure.previousElementSibling) as HTMLElement | null;
  let paragraph: HTMLElement;
  if (neighbor !== null && isCleanEmptyParagraph(neighbor)) {
    paragraph = neighbor;
  } else {
    paragraph = doc.createElement('p');
    paragraph.appendChild(doc.createElement('br'));
    figure.insertAdjacentElement(where === 'after' ? 'afterend' : 'beforebegin', paragraph);
  }
  const range = doc.createRange();
  range.setStart(paragraph, 0);
  range.collapse(true);
  const selection = doc.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  return paragraph;
}

/** 正文現在可以打字（插圖擋打字中是 false）。 */
function writable(body: HTMLElement): boolean {
  return body.getAttribute('contenteditable') === 'true';
}

const BESIDE_TAGS = new Set(['P', 'H2', 'H3']);

/** 游標所在的頂層段落／小標（`.preview-body` 的直接子元素）。 */
function caretBlock(body: Element, node: Node | null): HTMLElement | null {
  let current: Node | null = node;
  while (current !== null && current !== body) {
    if (current.parentNode === body) {
      return current.nodeType === ELEMENT_NODE && BESIDE_TAGS.has((current as Element).tagName) ? (current as HTMLElement) : null;
    }
    current = current.parentNode;
  }
  return null;
}

function isTopFigure(node: Element | null): node is HTMLElement {
  return node !== null && node.tagName === 'FIGURE';
}

function readBeside(doc: Document, block: HTMLElement): BesideFigure | null {
  const selection = doc.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  const before = doc.createRange();
  before.selectNodeContents(block);
  before.setEnd(range.startContainer, range.startOffset);
  const after = doc.createRange();
  after.selectNodeContents(block);
  after.setStart(range.endContainer, range.endOffset);
  const whole = doc.createRange();
  whole.selectNodeContents(block);
  return {
    atBlockStart: !hasContent(before.cloneContents()),
    atBlockEnd: !hasContent(after.cloneContents()),
    blockEmpty: !hasContent(whole.cloneContents()),
    prevIsFigure: isTopFigure(block.previousElementSibling),
    nextIsFigure: isTopFigure(block.nextElementSibling),
    collapsed: range.collapsed,
  };
}

/** 游標放到 figure 的最後（圖片後）或最前（圖片前）。 */
function caretToFigure(doc: Document, figure: HTMLElement, where: 'end' | 'start'): void {
  const range = doc.createRange();
  range.selectNodeContents(figure);
  range.collapse(where === 'start');
  const selection = doc.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

/** 游標在頂層 figure 裡：figure 與游標位置；不在就是 null。 */
function figureAtCaret(doc: Document, body: HTMLElement): { figure: HTMLElement; caret: FigureCaret } | null {
  const anchor = doc.getSelection()?.anchorNode ?? null;
  if (anchor === null) return null;
  const figure = caretFigure(body, anchor);
  if (figure === null) return null;
  const caret = readFigureCaret(doc, body, figure);
  return caret === null ? null : { figure, caret };
}

/**
 * 掛上「游標在圖片上」的按鍵與貼上處理（每份文件載入時掛一次）。`isEditing()` 不是 true、正文正在擋打字，或游標不在相關位置就不管。
 * 貼上掛在捕獲階段：比 `attachEditInterceptors` 的貼上早跑，先把游標移到新段落，貼上照常插在那裡。
 * `changed`：改了 DOM 之後（重量高度、空正文提示）。
 */
export function attachFigureKeys(doc: Document, deps: { isEditing: () => boolean; changed: () => void }): void {
  doc.addEventListener('keydown', (event) => {
    if (!deps.isEditing()) return;
    const body = doc.querySelector<HTMLElement>('.preview-body');
    if (!body) return;
    if (!writable(body)) return;
    const inFigure = figureAtCaret(doc, body);
    if (inFigure !== null) {
      const action = figureKeyAction(event, inFigure.caret);
      if (action.kind === 'pass') return;
      if (action.kind === 'escape') event.preventDefault();
      escapeFigure(doc, inFigure.figure, action.where);
      deps.changed();
      return;
    }
    if (event.key !== 'Backspace' && event.key !== 'Delete') return;
    const block = caretBlock(body, doc.getSelection()?.anchorNode ?? null);
    if (block === null) return;
    const beside = readBeside(doc, block);
    if (beside === null) return;
    const action = besideFigureKeyAction(event, beside);
    if (action.kind === 'pass') return;
    event.preventDefault();
    const figure = (action.where === 'end' ? block.previousElementSibling : block.nextElementSibling) as HTMLElement;
    if (action.removeBlock) block.remove();
    caretToFigure(doc, figure, action.where);
    deps.changed();
  });
  doc.addEventListener(
    'paste',
    () => {
      if (!deps.isEditing()) return;
      const body = doc.querySelector<HTMLElement>('.preview-body');
      if (!body) return;
      if (!writable(body)) return;
      const inFigure = figureAtCaret(doc, body);
      if (inFigure === null) return;
      const action = figurePasteAction(inFigure.caret);
      if (action.kind === 'pass') return;
      escapeFigure(doc, inFigure.figure, action.where);
      deps.changed();
    },
    true,
  );
}
