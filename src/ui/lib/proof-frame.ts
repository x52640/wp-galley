import type { ProofMark } from '../service/types.js';

/**
 * 校樣 iframe 的量測與版面計算（P5-T043 從 ProofView 抽出）。
 *
 * `contentHeight` 要讀文件；其餘是純函式：高度要不要沿用、區塊的摘要字、段落之間插圖的位置、頁邊符號怎麼分組。
 */

/** 量到的一個頂層區塊（`.preview-body` 的直接子元素），座標是文件座標。 */
export interface BlockBox {
  index: number;
  top: number;
  /**
   * 區塊的高度。標亮某一段時要畫一個蓋住整段的框，所以高度也得量。
   *
   * 框畫在 iframe **外面**：文件本身帶著 `default-src 'none'` 的 CSP，而且
   * 「不去碰校樣文件的內部」本來就是這個元件的原則——量得到位置就夠了。
   */
  height: number;
  text: string;
}

/**
 * 量好的底邊之後，iframe 該設多高（`contentHeight` 的最後一步）。
 *
 * 文件的內容比 iframe 目前的高度還高（scrollHeight 大於 clientHeight）就用 scrollHeight——iframe 不能捲，少算就是把內容裁掉；
 * 只在「超出」時才用：它至少等於 iframe 目前的高度，平常用它的話高度只會變大、不會縮回去。
 * 差不到幾 px 就維持目前的高度：量法跟 scrollHeight 差個一兩 px 時，不會在「超出→撐高→縮回→又超出」之間來回跳。
 */
export function settleHeight(measured: number, scrollHeight: number, clientHeight: number): number {
  if (scrollHeight > clientHeight) return Math.max(measured, scrollHeight);
  if (clientHeight > measured && clientHeight - measured < 4) return clientHeight;
  return measured;
}

/**
 * 文件內容的完整高度（P5-T029）。
 *
 * 不能用 documentElement.scrollHeight：它至少等於 iframe 目前的高度，高度只會被撐大、不會縮回去。
 * 量 body 的底邊，再加上 body 的下外距（瀏覽器預設 8px）與最後一個子元素可能穿出來的下外距、html 的下內距與框線
 * ——少算任何一點，文件就會多出幾 px 可以捲。
 *
 * 浮動（`alignleft`／`alignright` 的圖）不撐高父元素：載入時外層把 body 設成 `display: flow-root`（CSSOM），
 * body 的底邊才包得住最後一張浮動圖。再保險一層見 `settleHeight`（P5-T029 審查 #3）。
 */
export function contentHeight(doc: Document): number {
  const win = doc.defaultView;
  const body = doc.body;
  const scrollY = win?.scrollY ?? 0;
  const px = (value: string | undefined): number => {
    const n = Number.parseFloat(value ?? '');
    return Number.isFinite(n) ? n : 0;
  };
  const bodyStyle = win?.getComputedStyle(body);
  const htmlStyle = win?.getComputedStyle(doc.documentElement);
  const last = body.lastElementChild;
  const lastMargin = last ? px(win?.getComputedStyle(last).marginBottom) : 0;
  let bottom = body.getBoundingClientRect().bottom + scrollY;
  if (last) bottom = Math.max(bottom, last.getBoundingClientRect().bottom + scrollY + lastMargin);
  bottom += px(bodyStyle?.marginBottom) + px(htmlStyle?.paddingBottom) + px(htmlStyle?.borderBottomWidth);
  const root = doc.documentElement;
  return settleHeight(Math.ceil(bottom), root.scrollHeight, root.clientHeight);
}

/** 區塊的摘要字（回報給上層當「插入位置」的標籤）：空白攤平、最多 40 字。 */
export function blockSnippet(textContent: string | null): string {
  return (textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
}

/**
 * 段落之間可以插圖的位置：最前面（-1）、每一段之後。`y` 是兩段之間空白的中間
 * （最前面是第一段頂上一點，最後面是最後一段底下一點），座標跟頁邊符號同一套。
 */
export function insertSlots(blocks: readonly BlockBox[]): { after: number; y: number }[] {
  const sorted = [...blocks].sort((a, b) => a.index - b.index);
  const first = sorted[0];
  if (first === undefined) return [];
  const slots = [{ after: -1, y: first.top - 18 }];
  sorted.forEach((block, i) => {
    const bottom = block.top + block.height;
    const next = sorted[i + 1];
    slots.push({ after: block.index, y: next === undefined ? bottom + 18 : (bottom + next.top) / 2 });
  });
  return slots;
}

/** 頁邊符號依段落分組，段落由上到下；同一段的符號照原本的順序往下排。 */
export function groupMarks(marks: ProofMark[]): { blockIndex: number; marks: ProofMark[] }[] {
  const byBlock = new Map<number, ProofMark[]>();
  for (const mark of marks) {
    const bucket = byBlock.get(mark.blockIndex);
    if (bucket) bucket.push(mark);
    else byBlock.set(mark.blockIndex, [mark]);
  }
  return [...byBlock.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([blockIndex, list]) => ({ blockIndex, marks: list }));
}
