/**
 * 內文圖上傳後照錨點自動放進正文（D-020，P5-T016）、封面自動設精選（D-017）的判斷與講給使用者聽的話。
 * 後端 `service/media.ts` 與示範資料用同一份（P5-T033）：放不放、放哪裡、講什麼都只寫在這裡。
 *
 * 只做決定，不碰正文：錨點在哪幾段（`findHits`）由呼叫端照目前這一版算——後端用 parse5 拆區塊，
 * 示範資料用 DOMParser，比對都是 `findIgnoringSpaces`。真的放進去（建新版本、撤銷核准）也是呼叫端的事。
 */

import type { AutoFeatureResult, AutoPlaceResult } from './api.js';

/** 校稿或一鍵配圖正在跑：先不放，放了那一趟的結果會作廢。 */
export const AUTO_PLACE_AGENT_RUNNING: AutoPlaceResult = {
  outcome: 'agent-running',
  message:
    'AI 還在跑，等它跑完再放（圖已經上傳了）：跑完之後在文章段落之間按「在這裡插圖」，或用圖片的「插入位置」選。',
  afterBlockIndex: null,
};

/** 校稿或一鍵配圖正在跑：先不設精選（設精選會建新版本）。 */
export const AUTO_FEATURE_AGENT_RUNNING: AutoFeatureResult = {
  outcome: 'agent-running',
  message: 'AI 還在跑，等它跑完再設成精選（圖已經上傳了）：跑完之後按圖片上的「設為精選」。',
};

/** 已經有使用者選的別張封面：不覆蓋。 */
export const AUTO_FEATURE_KEPT_EXISTING: AutoFeatureResult = {
  outcome: 'kept-existing',
  message: '已經有封面了，沒有換掉。要換成這張，按圖片上的「設為精選」。',
};

export const AUTO_FEATURE_SET: AutoFeatureResult = { outcome: 'set', message: '已設成精選圖片。' };

/** 「換一張」：新圖接替舊圖在正文裡的位置。`afterBlockIndex` 是新圖那塊的前一段（-1＝文章最前面）。 */
export function replacedResult(afterBlockIndex: number): AutoPlaceResult {
  return {
    outcome: 'replaced',
    message: `已換掉正文裡原本那張（${afterBlockIndex < 0 ? '文章最前面' : `第 ${afterBlockIndex + 1} 段之後`}）。舊圖拿出正文了，還留在媒體庫。`,
    afterBlockIndex,
  };
}

/** 照錨點放需要的配圖需求欄位。 */
export interface AnchorBrief {
  /** 使用者自己選的位置（P5-T018）講「你選的位置」，Agent 建議的講「建議的位置」。 */
  readonly origin: 'agent' | 'user';
  /** 圖放在錨點那段之後，或之前（「文章最前面」那種）。 */
  readonly anchorPosition: 'after' | 'before';
  readonly anchor: string | null;
}

/** 照錨點的決定：`place` 時呼叫端把圖放在 `afterBlockIndex` 之後，成功就回 `result`；否則直接回 `result`。 */
export type AnchorPlacement =
  | { readonly place: true; readonly afterBlockIndex: number; readonly result: AutoPlaceResult }
  | { readonly place: false; readonly result: AutoPlaceResult };

/**
 * 對著**目前這一版**找錨點，剛好一段對得上才放（錨點那段之後；`before` 是那段之前）。
 * 找不到、不只一段、沒有錨點，都不放，結果講給使用者聽。不用 Agent 當時看到的段落編號。
 *
 * @param findHits 錨點（已去頭尾、不是空字串）出現在哪幾個頂層區塊；只在有錨點時呼叫。
 */
export function placeByAnchor(brief: AnchorBrief, findHits: (anchor: string) => readonly number[]): AnchorPlacement {
  const mine = brief.origin === 'user';
  const side = brief.anchorPosition === 'before' ? '後面' : '前面';
  const notPlaced = (outcome: 'not-found' | 'ambiguous', why: string): AnchorPlacement => ({
    place: false,
    result: {
      outcome,
      message:
        `找不到${mine ? '你選的' : '建議的'}位置，請自己放：` +
        `${why}在文章段落之間按「在這裡插圖」，或用圖片的「插入位置」選。`,
      afterBlockIndex: null,
    },
  });

  const anchor = brief.anchor?.trim() ?? '';
  if (anchor === '') {
    return notPlaced('not-found', mine ? '你選的位置前後都沒有文字可以對照。' : 'AI 沒有指定要放在哪一段。');
  }
  const quoted = mine ? `你選的位置${side}那段「${anchor}」` : `AI 引用的「${anchor}」`;
  const hits = findHits(anchor);
  if (hits.length === 0) return notPlaced('not-found', `${quoted}在目前的文章裡找不到（可能改過了）。`);
  if (hits.length > 1) {
    return notPlaced('ambiguous', `${quoted}在文章裡出現在 ${hits.length} 段，不確定是哪一段。`);
  }

  const afterBlockIndex = brief.anchorPosition === 'before' ? hits[0]! - 1 : hits[0]!;
  return {
    place: true,
    afterBlockIndex,
    result: {
      outcome: 'placed',
      message: afterBlockIndex < 0 ? '已放進正文最前面。' : `已放進正文第 ${afterBlockIndex + 1} 段之後。`,
      afterBlockIndex,
    },
  };
}
