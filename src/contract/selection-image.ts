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
/** 位置選項是照某一版算的，送出時目前已經不是那一版：不猜，請使用者再選一次。 */
export const SELECTION_SPOTS_CHANGED_MESSAGE = '文章剛被改過，位置可能不對了，請重新選一次那段再按「用此段配圖」。';
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

/** 一個可以放圖的位置（`selectionSpots`）。`spot` 是送回後端的編號，只對算它的那一版有效。 */
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

/** 頂層區塊沒有字時是什麼（P5-T038 第二輪審查）：圖片、分隔線、嵌入內容都是真的區塊；什麼都沒有的空段落不算。 */
export type SpotMedia = 'image' | 'divider' | 'embed';

/** 位置選項要的區塊：字，以及沒字時它是什麼（null＝空的，不算一塊）。 */
export interface SpotBlock extends PositionBlock {
  readonly media?: SpotMedia | null;
}

const MEDIA_LABEL: Record<SpotMedia, string> = { image: '圖片', divider: '分隔線', embed: '嵌入內容' };

/**
 * 沒有字的頂層區塊是什麼。只看標籤名與 HTML 字串（共用契約不解析 HTML；後端、示範資料都給得出這兩個）。
 * 有字的區塊不用問（回 null）。
 */
export function blockMedia(block: { readonly text: string; readonly tag: string; readonly html: string }): SpotMedia | null {
  if (block.text.trim() !== '') return null;
  const tag = block.tag.toLowerCase();
  if (tag === 'hr' || /<hr[\s/>]/i.test(block.html) || /wp-block-separator/.test(block.html)) return 'divider';
  if (tag === 'img' || /<img[\s/>]/i.test(block.html)) return 'image';
  if (/<(iframe|video|audio|embed|object)[\s/>]/i.test(block.html)) return 'embed';
  return null;
}

/** 這塊算不算一塊：有字，或是圖片／分隔線／嵌入內容。 */
function isRealBlock(block: SpotBlock | undefined): boolean {
  if (block === undefined) return false;
  return block.text.trim() !== '' || (block.media ?? null) !== null;
}

/**
 * 圖可以放的位置。**由後端在存好的那一版上算**（`POST …/briefs/selection-spots`），畫面只顯示、送回 `spot`。
 * 選取範圍 [first, last]（都是有字的區塊）裡每一塊真的區塊（有字、圖片、分隔線、嵌入內容；空段落不算）之後都是一個位置：
 * `0`＝這段開頭（first 之前）、中間＝那塊之後（「第 N 段之後：『…』」、「第 N 段（圖片）之後」）、最後＝這段結尾（last 之後）。
 */
export function selectionSpots(blocks: readonly SpotBlock[], first: number, last: number): SelectionSpot[] {
  const real: number[] = [];
  for (let i = first; i <= last; i += 1) if (isRealBlock(blocks[i])) real.push(i);
  const spots: SelectionSpot[] = [{ spot: 0, kind: 'start', afterBlockIndex: first - 1, label: '這段開頭' }];
  real.slice(0, -1).forEach((index, k) => {
    const block = blocks[index]!;
    const media = block.text.trim() === '' ? (block.media ?? null) : null;
    spots.push({
      spot: k + 1,
      kind: 'between',
      afterBlockIndex: index,
      label: media === null ? `第 ${index + 1} 段之後：「${excerptOf(block.text)}」` : `第 ${index + 1} 段（${MEDIA_LABEL[media]}）之後`,
    });
  });
  spots.push({ spot: Math.max(real.length, 1), kind: 'end', afterBlockIndex: last, label: '這段結尾' });
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
