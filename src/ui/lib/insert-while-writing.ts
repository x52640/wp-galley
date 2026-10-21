import { cleanRichEdit, type RichNode, type RichUnit } from '../../contract/rich-text.js';
import { domToRich, type RichAllow } from './rich-commands.js';

/**
 * 打字模式也能「在這裡插圖」（D-048，P5-T049）。規格見 docs/specs/design-system.md「在文章上改」。
 *
 * 流程（`placeWhileWriting` 在 `use-proof-editing.ts`；判斷與 DOM 小工具在這裡）：
 * 1. 按「放這裡」／「上傳並放在這裡」：先把上傳做完（上傳不改正文，期間照常打字），再**擋打字**。
 * 2. 有改動就照「儲存」存一版（同一套驗證、同一個存檔狀態），留在打字模式、校樣不重載（hold，D-036）。存失敗就不插、講原因。
 * 3. 編輯區的第幾塊換算成存好那一版的第幾塊（`savedAfterIndex`：整理會拿掉空段落等，兩邊不一定一樣）。
 * 4. 後端放圖、建新版本；把新版本裡那個 figure 原樣插進編輯區同一個位置，「有沒有改」的基準換成新版本。
 * 5. 放開打字。對不上（`placedFigure` 找不到那塊圖、或前一塊的字對不上）就結束打字模式、照後端的版本重載——
 *    這時沒有任何沒存的字（第 2 步存過、之後擋著打字），不會掉字。
 *
 * 擋打字只在存檔到圖放進編輯區之間（本機存檔＋放圖，通常不到一秒）；為什麼不邊打邊合併：存好之後又打的字
 * 跟新版本要逐塊對齊才合併得回去，對錯一次就會把字蓋掉（memory「掉資料都算 bug」），寧可擋幾百毫秒並講出來。
 */

/** 擋打字期間講的話。 */
export const INSERT_LOCK_NOTE = '正在把圖放進正文，這一下先不能打字…';

/** 打字模式插圖面板上的說明。 */
export const INSERT_WRITING_NOTE = '正在打字：放之前會先存一版你打的字，放好之後留在打字模式。';

function topLevel(nodes: readonly RichNode[]): RichNode[] {
  return nodes.filter((node) => node.type === 'element' || node.text.trim() !== '');
}

/** 整理後的頂層區塊數，跟後端 `splitTopLevelBlocks` 同一套算法：元素各算一塊、非空白的裸文字算一塊。 */
export function topLevelCount(nodes: readonly RichNode[]): number {
  return topLevel(nodes).length;
}

function richText(node: RichNode): string {
  return node.type === 'text' ? node.text : node.children.map(richText).join('');
}

/**
 * 編輯區第 `prefix` 之前（含）那些頂層節點，整理成存檔的樣子之後 → 插在存好那一版的第幾塊之後（-1＝最前面），
 * 以及那一塊的字（拿來核對新版本放對了沒；-1 是 null）。錨點一律是**往前第一個整理後還存在的區塊**：
 * 在自己剛按 Enter 開的空段落下面插圖，空段落存檔時被拿掉，錨點就是上一段（審查 2）。
 * `original`：存檔時比對「沒改過的區塊原樣保留」的基準（跟存檔同一個）。
 */
export function savedAnchor(
  prefix: readonly RichNode[],
  original: readonly RichUnit[] | null,
  allow: RichAllow,
): { afterIndex: number; text: string | null } {
  const result = cleanRichEdit(prefix, original, { allowedTags: allow.tags, allowedSchemes: allow.schemes });
  const blocks: RichNode[] = [];
  for (const piece of result.pieces) blocks.push(...topLevel(piece.kept ? piece.unit.nodes : piece.nodes));
  const last = blocks[blocks.length - 1];
  return { afterIndex: blocks.length - 1, text: last === undefined ? null : richText(last) };
}

/** 只要索引（`savedAnchor` 的 `afterIndex`）。 */
export function savedAfterIndex(prefix: readonly RichNode[], original: readonly RichUnit[] | null, allow: RichAllow): number {
  return savedAnchor(prefix, original, allow).afterIndex;
}

/** 比對用：摺疊空白（後端 `normalizeText`）。 */
export function sameBlockText(a: string, b: string): boolean {
  const norm = (value: string): string => value.replace(/\s+/g, ' ').trim();
  return norm(a) === norm(b);
}

/**
 * 新版本裡放進來的那塊圖：第 `afterIndex + 1` 塊要是 figure，而且它前一塊的字跟編輯區錨點那一塊一樣（插在最前面不比）。
 * 對不上回 null（呼叫端就結束打字模式、照後端版本重載）。
 */
export function placedFigure(
  blocks: readonly { tag: string; text: string; html: string }[],
  afterIndex: number,
  anchorText: string | null,
): string | null {
  const figure = blocks[afterIndex + 1];
  if (figure === undefined || figure.tag !== 'figure') return null;
  if (afterIndex >= 0) {
    const before = blocks[afterIndex];
    if (before === undefined || anchorText === null || !sameBlockText(before.text, anchorText)) return null;
  }
  return figure.html;
}

/**
 * `placed`＝圖放好、留在打字模式；`confirm`＝正在問「照樣存」，還沒存也沒放；`reloaded`＝放好了但合併不回編輯區，結束打字模式重載；
 * `abandoned`＝中途換了篇或離開打字模式：不放（或放好了不合併），也不動畫面（審查 7）。
 */
export type InsertResult = 'placed' | 'confirm' | 'reloaded' | 'abandoned';

/** 存檔這一步出的錯（存失敗、標題清空）：講成「沒存成功」，不是「已存，但接著的動作沒做成」（審查 3）。 */
export class InsertSaveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InsertSaveError';
  }
}

/** 插圖前的判斷（跟「儲存」同一套）：要不要先存、存什麼、插在存好那一版的第幾塊之後。 */
export type InsertPrepare<S> =
  | { readonly kind: 'confirm' }
  | { readonly kind: 'invalid'; readonly message: string }
  | { readonly kind: 'go'; readonly save: S | null; readonly afterIndex: number };

/**
 * 打字模式插圖的順序（純流程，測得到）：先擋打字 → 判斷 → 有改先存 → 放圖 → 合併回編輯區（不行就重載）→ 放開打字。
 * 擋打字從判斷之前開始：判斷、存檔、換算索引看的是同一份畫面，存好之後到圖放進來之間也沒有新打的字可掉。
 * 任何一步出錯（存檔失敗、放圖失敗）都丟出去給面板講，而且一定放開打字；存檔失敗就不放圖。存檔這一步的錯是 `InsertSaveError`。
 * `done`（關面板、重讀）只在放好（含重載）之後、放開打字之後呼叫；換篇了不呼叫，免得動到新的那篇。
 */
export async function runInsertWhileWriting<S, P>(steps: {
  lock: () => () => void;
  prepare: () => InsertPrepare<S>;
  save: (save: S) => Promise<void>;
  put: (afterIndex: number) => Promise<P>;
  merge: (placed: P, afterIndex: number) => boolean;
  reload: () => void;
  /** 還在發起的那一篇、還在打字模式。 */
  still: () => boolean;
  done: () => void | Promise<void>;
}): Promise<InsertResult> {
  const result = await runLocked(steps);
  if (result === 'placed' || result === 'reloaded') await steps.done();
  return result;
}

async function runLocked<S, P>(steps: {
  lock: () => () => void;
  prepare: () => InsertPrepare<S>;
  save: (save: S) => Promise<void>;
  put: (afterIndex: number) => Promise<P>;
  merge: (placed: P, afterIndex: number) => boolean;
  reload: () => void;
  still: () => boolean;
}): Promise<InsertResult> {
  const unlock = steps.lock();
  try {
    const prepared = steps.prepare();
    if (prepared.kind === 'confirm') return 'confirm';
    if (prepared.kind === 'invalid') throw new InsertSaveError(prepared.message);
    if (prepared.save !== null) {
      try {
        await steps.save(prepared.save);
      } catch (cause) {
        throw new InsertSaveError(`沒存成功，圖沒有放：${cause instanceof Error ? cause.message : String(cause)}`);
      }
    }
    if (!steps.still()) return 'abandoned';
    const placed = await steps.put(prepared.afterIndex);
    if (!steps.still()) return 'abandoned';
    if (steps.merge(placed, prepared.afterIndex)) return 'placed';
    steps.reload();
    return 'reloaded';
  } finally {
    unlock();
  }
}

// --- 對 iframe 文件做的事（DOM；node 測試不跑） ---

/** 編輯區第 `afterDomIndex` 塊（含）之前的頂層節點 → 格式樹。-1＝空。 */
export function prefixNodes(body: Element, afterDomIndex: number): RichNode[] {
  if (afterDomIndex < 0) return [];
  const anchor = body.children[afterDomIndex];
  if (anchor === undefined) return domToRich(body.childNodes as unknown as Parameters<typeof domToRich>[0]);
  const nodes: ChildNode[] = [];
  for (const node of Array.from(body.childNodes)) {
    nodes.push(node);
    if (node === anchor) break;
  }
  return domToRich(nodes as unknown as Parameters<typeof domToRich>[0]);
}

/** 正文 HTML 切成頂層區塊（外層視窗的 DOMParser：惰性文件，script 不跑、圖片不載入）。 */
export function htmlBlocks(html: string): { tag: string; text: string; html: string }[] {
  const parsed = new DOMParser().parseFromString(`<!doctype html><body>${html}</body>`, 'text/html');
  const blocks: { tag: string; text: string; html: string }[] = [];
  for (const node of Array.from(parsed.body.childNodes)) {
    if (node.nodeType === 1) {
      const element = node as Element;
      blocks.push({ tag: element.tagName.toLowerCase(), text: element.textContent ?? '', html: element.outerHTML });
    } else if (node.nodeType === 3 && (node.nodeValue ?? '').trim() !== '') {
      blocks.push({ tag: '#text', text: node.nodeValue ?? '', html: node.nodeValue ?? '' });
    }
  }
  return blocks;
}

/**
 * 合併的基準（審查 1）：**存檔那一刻**的編輯區 HTML 插進那塊圖之後的樣子——不拿當下畫面（擋打字期間要是有別的路改了畫面，
 * 那些字還沒存，拿當下畫面當基準會被當成已存）。在 iframe 文件裡用一個不掛上去的容器做（不跑 script）。
 */
export function withFigure(doc: Document, snapshot: string, afterDomIndex: number, figureHtml: string): HTMLElement | null {
  const container = doc.createElement('div');
  container.innerHTML = snapshot;
  return insertFigureInEditor(container, afterDomIndex, figureHtml) ? container : null;
}

/** 把圖插進編輯區第 `afterDomIndex` 塊後面（-1＝最前面）。找不到那一塊回 false。 */
export function insertFigureInEditor(body: Element, afterDomIndex: number, figureHtml: string): boolean {
  if (afterDomIndex < 0) {
    body.insertAdjacentHTML('afterbegin', figureHtml);
    return true;
  }
  const anchor = body.children[afterDomIndex];
  if (anchor === undefined) return false;
  anchor.insertAdjacentHTML('afterend', figureHtml);
  return true;
}

/**
 * 擋打字：正文與標題暫時不可編輯（游標位置記下來，放開時放回去）。回傳放開的函式。
 * 只改 `contenteditable`，不動內容：留底的 MutationObserver 不看屬性，不會當成打字。
 */
export function lockWriting(doc: Document, body: HTMLElement, title: HTMLElement | null): () => void {
  const selection = doc.getSelection();
  const saved = selection && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;
  const titleMode = title?.getAttribute('contenteditable') ?? null;
  body.setAttribute('contenteditable', 'false');
  title?.setAttribute('contenteditable', 'false');
  return () => {
    body.setAttribute('contenteditable', 'true');
    if (title && titleMode !== null) title.setAttribute('contenteditable', titleMode);
    if (saved !== null && doc.contains(saved.startContainer)) {
      const current = doc.getSelection();
      current?.removeAllRanges();
      current?.addRange(saved);
    }
  };
}
