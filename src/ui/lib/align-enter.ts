import { textAlignOf } from '../../contract/text-align.js';

/**
 * 對齊過的段落／小標按 Enter（D-049，P5-T050 跟進）。
 *
 * **問題**：Chrome 在段尾按 Enter 時把整個段落連同 class 複製一份，置中的段落按 Enter，新的一段也置中——使用者以為「按 Enter 字變置中」。
 *
 * **照古騰堡做**（WordPress 7.1.3 對應的 Gutenberg dd294ab8，`block-editor/src/store/actions.js` 的 `__unstableSplitSelection`，
 * 由 `writing-flow/use-input.js` 在支援 `splitting` 的區塊——段落、標題——按 Enter 時呼叫）：
 * - 游標是一個點、在段尾（含空段）：後面插 `createBlock(預設區塊)`——**沒有任何屬性**的段落，游標移過去。小標也一樣開一般段落。
 * - 在段首（段落有字）：前面插一個沒有屬性的空段落，游標留在原段（原段的對齊不動）。
 * - 在段中：拆成兩半，兩半都帶原本的屬性（對齊保留；小標的後半變段落、對齊照帶）。這裡交給瀏覽器（Chrome 拆開時兩半都帶 class）。
 * 只處理**有對齊**的段落／小標；其他情況照舊交給瀏覽器。輸入法組字中的 Enter、Shift+Enter（換行）、⌘ 組合鍵、選了字都不攔。
 *
 * 規則是純函式（node 環境測得到）；對 iframe 文件動手的是 `attachAlignEnter`。圖片上的按鍵（`figure-caret.ts`）先處理，
 * 它擋掉的 Enter 這裡不再管。直接改 DOM（不經 execCommand），跟圖片那邊一樣不進 ⌘Z。
 */

export interface AlignEnterKey {
  readonly key: string;
  readonly isComposing: boolean;
  readonly shiftKey: boolean;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  /** 輸入法處理中的按鍵，Chrome 給 229。 */
  readonly keyCode?: number;
}

export interface AlignEnterCaret {
  /** 游標所在的頂層段落／小標有對齊 class。 */
  readonly aligned: boolean;
  /** 選取範圍是一個點。 */
  readonly collapsed: boolean;
  /** 游標前面沒有字。 */
  readonly atStart: boolean;
  /** 游標後面沒有字（空段落兩個都是 true）。 */
  readonly atEnd: boolean;
}

export type AlignEnterAction = { readonly kind: 'pass' } | { readonly kind: 'new-after' } | { readonly kind: 'new-before' };

export function alignEnterAction(event: AlignEnterKey, caret: AlignEnterCaret): AlignEnterAction {
  if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229) return { kind: 'pass' };
  if (event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return { kind: 'pass' };
  if (!caret.aligned || !caret.collapsed) return { kind: 'pass' };
  if (caret.atEnd) return { kind: 'new-after' };
  if (caret.atStart) return { kind: 'new-before' };
  return { kind: 'pass' };
}

const TEXT_BLOCK = /^(P|H[1-6])$/;

/** 游標所在的頂層段落／小標（`.preview-body` 的直接子元素）；不在就是 null。 */
function caretTextBlock(body: Element, node: Node | null): HTMLElement | null {
  let current: Node | null = node;
  while (current !== null && current !== body) {
    if (current.parentNode === body) {
      return current.nodeType === 1 && TEXT_BLOCK.test((current as Element).tagName) ? (current as HTMLElement) : null;
    }
    current = current.parentNode;
  }
  return null;
}

/** 段落裡的一個內容單位（字、換行、圖），在游標前或後。 */
export interface CaretToken {
  readonly kind: 'text' | 'br' | 'img';
  readonly side: 'before' | 'after';
}

/**
 * 游標是不是在段首／段尾（PR #38 Codex P2）。字與圖算內容；`<br>` 也算（Shift+Enter 的軟換行），
 * **只有段落的最後一個 `<br>`（後面沒有字或圖）不算**——那是瀏覽器放的佔位（空段落的 `<p><br></p>`、段尾的 `A<br>`），看不見。
 * 看不見的空白不算（`isVisibleText`，`tokens` 由呼叫端先濾掉）。
 */
export function caretEdges(tokens: readonly CaretToken[]): { atStart: boolean; atEnd: boolean } {
  const last = tokens.length - 1;
  const placeholder = last >= 0 && tokens[last]!.kind === 'br' ? last : -1;
  const counted = tokens.filter((_, index) => index !== placeholder);
  return {
    atStart: !counted.some((token) => token.side === 'before'),
    atEnd: !counted.some((token) => token.side === 'after'),
  };
}

/**
 * 這段字看不看得到（PR #38 Codex 第三輪）。正文的 white-space 是 normal：瀏覽器只摺疊一般空白（ASCII 空格、tab、換行、CR、FF），
 * `&nbsp;`、全形空白等照樣顯示，算內容。一般空格只有前後都有字時才顯示，那時旁邊的字已經算了；只有一般空格的那一邊
 * 一定在行頭或行尾、被摺掉——不算（Chrome 打出來、要顯示的行頭行尾空格本來就存成 `&nbsp;`）。
 */
export function isVisibleText(value: string): boolean {
  return /[^ \t\n\r\f]/.test(value);
}

/** 游標所在的那段字，從游標處拆成前後兩段，看得到的才算一個單位。 */
export function textTokensAtCaret(value: string, offset: number): CaretToken[] {
  const out: CaretToken[] = [];
  if (isVisibleText(value.slice(0, offset))) out.push({ kind: 'text', side: 'before' });
  if (isVisibleText(value.slice(offset))) out.push({ kind: 'text', side: 'after' });
  return out;
}

const ELEMENT = 1;
const TEXT = 3;

/** 段落裡的字、換行、圖，照文件順序，標上在游標前或後（游標所在的文字節點拆成兩段）。 */
export function caretTokens(block: Element, container: Node, offset: number): CaretToken[] {
  const out: CaretToken[] = [];
  const point = block.ownerDocument.createRange();
  point.setStart(container, offset);
  point.collapse(true);
  const sideOf = (node: Node): 'before' | 'after' => (point.comparePoint(node, 0) < 0 ? 'before' : 'after');
  const walk = (node: Node): void => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === TEXT) {
        const value = child.nodeValue ?? '';
        if (child === container) {
          out.push(...textTokensAtCaret(value, offset));
        } else if (isVisibleText(value)) {
          out.push({ kind: 'text', side: sideOf(child) });
        }
      } else if (child.nodeType === ELEMENT) {
        const tag = (child as Element).tagName;
        if (tag === 'BR') out.push({ kind: 'br', side: sideOf(child) });
        else if (tag === 'IMG') out.push({ kind: 'img', side: sideOf(child) });
        else walk(child);
      }
    }
  };
  walk(block);
  return out;
}

function readCaret(doc: Document, block: HTMLElement): AlignEnterCaret | null {
  const selection = doc.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  // 選了字的情況 alignEnterAction 本來就不攔，所以用起點量就夠。
  const { atStart, atEnd } = caretEdges(caretTokens(block, range.startContainer, range.startOffset));
  return {
    aligned: textAlignOf(block.getAttribute('class')) !== null,
    collapsed: range.collapsed,
    atStart,
    atEnd,
  };
}

/**
 * 掛上對齊段落的 Enter 處理（每份文件載入時掛一次，掛在 `attachFigureKeys` 後面）。
 * `changed`：改了 DOM 之後（重量高度、空正文提示）。
 */
export function attachAlignEnter(doc: Document, deps: { isEditing: () => boolean; changed: () => void }): void {
  doc.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || !deps.isEditing()) return;
    if (event.key !== 'Enter') return;
    const body = doc.querySelector<HTMLElement>('.preview-body');
    if (!body || body.getAttribute('contenteditable') !== 'true') return;
    const block = caretTextBlock(body, doc.getSelection()?.anchorNode ?? null);
    if (block === null) return;
    const caret = readCaret(doc, block);
    if (caret === null) return;
    const action = alignEnterAction(event, caret);
    if (action.kind === 'pass') return;
    event.preventDefault();
    // 古騰堡的 createBlock(預設區塊)：乾淨的段落，不帶對齊、字級或任何 class（字級發布時照模板預設補）。
    const paragraph = doc.createElement('p');
    paragraph.appendChild(doc.createElement('br'));
    block.insertAdjacentElement(action.kind === 'new-after' ? 'afterend' : 'beforebegin', paragraph);
    if (action.kind === 'new-after') {
      const range = doc.createRange();
      range.setStart(paragraph, 0);
      range.collapse(true);
      const selection = doc.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
    deps.changed();
  });
}
