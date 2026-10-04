/**
 * 選一段文字「用此段配圖」（D-037，P5-T038）前後端共用的規則：字數、在文章裡找到選取、圖可以放哪些位置、
 * 卡片上講「依據哪一段」。後端（`service/images.ts`）、示範資料、畫面都用這一份，三邊才會一樣。
 * 放在共用契約：前端不能 import core。輸入是頂層區塊的純文字，怎麼拆區塊由呼叫端決定。
 */

import { positionAnchor, type PositionAnchor, type PositionBlock } from './position-anchor.js';

/** 選取字數範圍（空白摺疊、去頭尾後數 code point）。超過不截斷，講太長。 */
export const SELECTION_IMAGE_MIN = 10;
export const SELECTION_IMAGE_MAX = 3000;

/** 選取的字數：空白摺疊、去頭尾後數 code point（跟查證選字同一套算法）。 */
export function selectionImageLength(text: string): number {
  return Array.from(text.replace(/\s+/gu, ' ').trim()).length;
}

/** 能不能拿這段配圖。不合格時 `message` 就是對使用者講的那句話。 */
export function checkSelectionImage(text: string): { readonly ok: true } | { readonly ok: false; readonly message: string } {
  const length = selectionImageLength(text);
  if (length < SELECTION_IMAGE_MIN) {
    return { ok: false, message: `選的字太短，至少要 ${SELECTION_IMAGE_MIN} 個字才能用此段配圖` };
  }
  if (length > SELECTION_IMAGE_MAX) {
    return { ok: false, message: `選的字太長（${length} 字），用此段配圖一次最多 ${SELECTION_IMAGE_MAX} 字；選短一點` };
  }
  return { ok: true };
}

/**
 * 送進 prompt 的選取文字：照選取原樣保留段落換行；每行去頭尾、行內連續空白摺成一個、連續空行只留一個。
 */
export function normalizeSelectionText(text: string): string {
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[^\S\n]+/gu, ' ').trim());
  const out: string[] = [];
  for (const line of lines) {
    if (line === '' && (out.length === 0 || out[out.length - 1] === '')) continue;
    out.push(line);
  }
  while (out.length > 0 && out[out.length - 1] === '') out.pop();
  return out.join('\n');
}

export type SelectionLocation =
  | { readonly ok: true; readonly first: number; readonly last: number }
  | { readonly ok: false; readonly reason: 'missing' | 'ambiguous'; readonly message: string };

export const SELECTION_MISSING_MESSAGE = '選的字在目前的文章裡找不到（可能改過了）。重新選一次再按。';
/** 畫面上看到的位置個數跟後端用存好的那一版算的不一樣（打字模式存檔整理改了段落）：不猜，請使用者再選一次。 */
export const SELECTION_SPOTS_CHANGED_MESSAGE = '段落整理後位置變了，請再選一次（重新選那段、再按「用此段配圖」）。';
export const SELECTION_AMBIGUOUS_MESSAGE = '選的字在文章裡出現不只一次，不確定是哪一段。多選幾個字讓位置確定。';

/**
 * 選取在文章裡從第幾塊到第幾塊（頂層區塊索引）。比對忽略所有空白（跟 `text-match` 同一套），所以可以跨段：
 * 把每塊的字（去空白）接起來找。找不到、或出現不只一次（不知道圖該放哪）都不猜。
 */
export function locateSelection(blocks: readonly PositionBlock[], text: string): SelectionLocation {
  const target = text.replace(/\s+/gu, '');
  if (target === '') return { ok: false, reason: 'missing', message: SELECTION_MISSING_MESSAGE };
  let compact = '';
  const owner: number[] = [];
  blocks.forEach((block, index) => {
    for (const ch of block.text.replace(/\s+/gu, '')) {
      compact += ch;
      for (let k = 0; k < ch.length; k += 1) owner.push(index);
    }
  });
  const at = compact.indexOf(target);
  if (at < 0) return { ok: false, reason: 'missing', message: SELECTION_MISSING_MESSAGE };
  if (compact.indexOf(target, at + 1) >= 0) return { ok: false, reason: 'ambiguous', message: SELECTION_AMBIGUOUS_MESSAGE };
  return { ok: true, first: owner[at]!, last: owner[at + target.length - 1]! };
}

/**
 * 圖可以放的位置（使用者在送出前選）。`spot` 是送給後端的編號：
 * - `0`＝「這段開頭」（預設）：選取第一個字所在那塊**之前**。
 * - `1..n-1`＝選取範圍內第 k 段有字的段落**之後**（兩段之間）。
 * - `n`＝「這段結尾」：選取最後一個字所在那塊**之後**。
 * n 是選取範圍內有字的段落數；只選到一段時只有開頭、結尾。
 * 編號照「選取範圍內第幾段有字的段落」算，不照文章的區塊索引：打字模式先存一版時沒字的空段落可能被整理掉，
 * 照段落數就不會指錯。
 */
export interface SelectionSpot {
  readonly spot: number;
  readonly kind: 'start' | 'between' | 'end';
  /** 插在第幾個頂層區塊之後（-1＝最前面），跟 `placeMedia` 同一套索引。 */
  readonly afterBlockIndex: number;
  readonly label: string;
}

const EXCERPT_CHARS = 15;

/** 開頭十幾個字，太長加「…」。 */
export function excerptOf(text: string, chars = EXCERPT_CHARS): string {
  const all = Array.from(text.replace(/\s+/gu, ' ').trim());
  return all.length <= chars ? all.join('') : `${all.slice(0, chars).join('')}…`;
}

export function selectionSpots(blocks: readonly PositionBlock[], first: number, last: number): SelectionSpot[] {
  const texted: number[] = [];
  for (let i = first; i <= last; i += 1) if ((blocks[i]?.text.trim() ?? '') !== '') texted.push(i);
  const spots: SelectionSpot[] = [{ spot: 0, kind: 'start', afterBlockIndex: first - 1, label: '這段開頭' }];
  texted.slice(0, -1).forEach((index, k) => {
    spots.push({
      spot: k + 1,
      kind: 'between',
      afterBlockIndex: index,
      label: `第 ${index + 1} 段之後：「${excerptOf(blocks[index]!.text)}」`,
    });
  });
  spots.push({ spot: Math.max(texted.length, 1), kind: 'end', afterBlockIndex: last, label: '這段結尾' });
  return spots;
}

/**
 * 那個位置的錨點：跟「在這裡插圖」同一套（`positionAnchor`）。「這段開頭」先引用選取開頭那段、放在它**之前**；
 * 其他位置照原規則（引用前面那段、放在它之後；不行就換另一邊或 null）。
 */
export function selectionSpotAnchor(blocks: readonly PositionBlock[], spot: SelectionSpot): PositionAnchor {
  return positionAnchor(blocks, spot.afterBlockIndex, spot.kind === 'start' ? 'before' : 'after');
}

/** 卡片上的依據：「依選取段落：「開頭十幾個字…」（共 N 字）」。存在配圖需求的 purpose。 */
export function selectionBasisLabel(text: string): string {
  return `依選取段落：「${excerptOf(text)}」（共 ${selectionImageLength(text)} 字）`;
}

/** 位置指紋每一側取幾個字（忽略空白後）。 */
export const SPOT_EDGE_CHARS = 20;

/**
 * 位置的「兩側指紋」（P5-T038 Codex 審查）：邊界**前面那塊的結尾**與**後面那塊的開頭**各取忽略空白後的 20 字
 * （文章最前面／最後面那一側是空字串）。取貼著邊界的那一截：段落被拆開或合併時，邊界兩側的字一定變，
 * 光比位置個數抓不到（例如 `<div><p>A</p><p>B</p></div>` 存檔後拆成兩段，個數一樣、邊界卻挪了）。
 */
export function spotEdges(blocks: readonly PositionBlock[], afterBlockIndex: number): { before: string; after: string } {
  const compact = (index: number): string[] => Array.from((blocks[index]?.text ?? '').replace(/\s+/gu, ''));
  const before = afterBlockIndex >= 0 ? compact(afterBlockIndex) : [];
  const after = compact(afterBlockIndex + 1);
  return {
    before: before.slice(Math.max(before.length - SPOT_EDGE_CHARS, 0)).join(''),
    after: after.slice(0, SPOT_EDGE_CHARS).join(''),
  };
}

/** 畫面送來的兩側指紋跟用目前這一版算的一不一樣（忽略空白）。 */
export function spotEdgesMatch(seen: { before: string; after: string }, current: { before: string; after: string }): boolean {
  const strip = (value: string): string => value.replace(/\s+/gu, '');
  return strip(seen.before) === strip(current.before) && strip(seen.after) === strip(current.after);
}
