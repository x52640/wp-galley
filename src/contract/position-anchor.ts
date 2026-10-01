/**
 * 「在這裡插圖」那個位置的錨點（D-022，P5-T018）。後端建配圖需求、示範資料都用這一份（P5-T033）：
 * 兩邊各寫一份就會出現「示範資料放得進去、真的後端卻說找不到位置」。
 * 放在共用契約：前端不能 import core。輸入是頂層區塊的純文字，怎麼拆區塊由呼叫端決定（後端 parse5、示範資料 DOMParser）。
 */

import { findIgnoringSpaces } from './text-match.js';

export interface PositionBlock {
  /** 頂層區塊的純文字（`splitTopLevelBlocks` 的 `text`，空白已摺疊）。 */
  readonly text: string;
}

export interface PositionAnchor {
  /** 錨點原文；前後都沒有字可以引用時是 null（用這張時就不自動放，請使用者自己放）。 */
  readonly anchor: string | null;
  /** 圖放在錨點那段之後，或之前（只有前面沒有可引用的段落時才用 before）。 */
  readonly position: 'after' | 'before';
}

/** 錨點從段落開頭取，至少這麼長；不夠獨特就每次加 10 字。 */
export const ANCHOR_MIN_CHARS = 20;

/**
 * 錨點要在整篇**只對得上這一段**（`autoPlace` 用同一套比對：忽略空白、子字串），否則用這張時是
 * 「不只一段對得上」，不猜、不放。所以：
 * - 插入點前面那段有字、而且找得到唯一的引用：引用它，圖放在它**之後**。
 * - 不行的話（文章最前面、前一塊是圖、前一段太短又被別段包住——日記常見的「晚安。」）：
 *   引用後面那段，圖放在它**之前**。同一個位置，只是換一邊對。
 * - 兩邊都不行：null（用這張時講找不到、請使用者自己放）。
 *
 * 引用的是段落**開頭**一小段：從 20 字起，在整篇只出現在這一段為止（每次加 10 字），最後是整段。短一點
 * 比較不怕使用者之後改了那段的後半。不跨段接字：比對是一段一段做的，跨段的引用永遠對不上。
 */
export function positionAnchor(blocks: readonly PositionBlock[], afterBlockIndex: number): PositionAnchor {
  const before = afterBlockIndex >= 0 ? uniquePrefix(blocks, afterBlockIndex) : null;
  if (before !== null) return { anchor: before, position: 'after' };
  const after = uniquePrefix(blocks, afterBlockIndex + 1);
  if (after !== null) return { anchor: after, position: 'before' };
  return { anchor: null, position: 'after' };
}

/** 第 index 段開頭、在整篇只對得上這一段的最短引用；沒字、或整段都不唯一就是 null。 */
function uniquePrefix(blocks: readonly PositionBlock[], index: number): string | null {
  const text = blocks[index]?.text.trim() ?? '';
  if (text === '') return null;
  const chars = Array.from(text);
  const lengths: number[] = [];
  for (let length = ANCHOR_MIN_CHARS; length < chars.length; length += 10) lengths.push(length);
  lengths.push(chars.length);
  for (const length of lengths) {
    const candidate = chars.slice(0, length).join('').trim();
    const hits = blocks.filter((block) => findIgnoringSpaces(block.text, candidate) !== null).length;
    if (hits === 1) return candidate;
  }
  return null;
}
