import type { ImageGenerationStatus } from '../service/types.js';
import {
  checkSelectionImage,
  excerptOf,
  locateSelection,
  selectionImageLength,
  selectionSpots,
  type SelectionSpot,
} from '../../contract/selection-image.js';

/**
 * 選一段文字「用此段配圖」（D-037，P5-T038）畫面的判斷。規則本身在共用契約 `contract/selection-image.ts`；
 * 這裡只放畫面要的組合，才測得到。打字模式「先存再送」跟「查證這句」同一套（`check-while-writing.ts` 的 `planSelectionCheck`）。
 */

/**
 * 「用此段配圖」能不能按（不看選了什麼）：跟插圖面板「請 AI 配一張」同一套——Codex 不能用（沒裝／沒登入）、
 * 另一個 Agent 動作在跑、稿件已結束。打字模式不算（按下會先存）。還在確認 Codex 時也先反灰。
 */
export function selectionImageBlockedReason(state: {
  generation: ImageGenerationStatus | null;
  running: boolean;
  finished: boolean;
}): string | null {
  if (state.finished) return '這篇稿件已經結束，不能再配圖';
  if (state.running) return '另一個 Agent 動作還在跑，跑完才能請 AI 配圖（同一篇一次只跑一個）。';
  if (state.generation === null) return '正在確認 Codex 能不能用…';
  if (!state.generation.available) return state.generation.reason ?? '現在不能生圖';
  return null;
}

/** 選了這段之後「用此段配圖」為什麼不能按（null＝可以）：先講整體擋住的原因，再講字數。 */
export function selectionImageProblem(text: string, blockedReason: string | null): string | null {
  if (blockedReason !== null) return blockedReason;
  const checked = checkSelectionImage(text);
  return checked.ok ? null : checked.message;
}

/**
 * 膠囊底下的說明：兩顆按鈕各自的反灰原因（一樣的只講一次），都沒有就講查證那家的提醒。
 * 兩個原因不同時加上是哪一顆的，免得看不出在講誰。
 */
export function capsuleNotes(input: {
  checkProblem: string | null;
  imageProblem: string | null;
  /** 只選到標題：沒有「用此段配圖」這顆，它的原因不講。 */
  imageShown: boolean;
  checkNote: string | null;
}): { text: string; tone: 'warn' | 'info' }[] {
  const image = input.imageShown ? input.imageProblem : null;
  if (input.checkProblem !== null && image !== null) {
    if (input.checkProblem === image) return [{ text: image, tone: 'warn' }];
    return [
      { text: `查證：${input.checkProblem}`, tone: 'warn' },
      { text: `配圖：${image}`, tone: 'warn' },
    ];
  }
  if (input.checkProblem !== null) return [{ text: input.checkProblem, tone: 'warn' }];
  if (image !== null) return [{ text: image, tone: 'warn' }];
  return input.checkNote === null ? [] : [{ text: input.checkNote, tone: 'info' }];
}

/**
 * 送出前讓使用者選的位置（「這段開頭」預設、兩段之間、「這段結尾」）。用畫面上的正文區塊（完整文字）定位，
 * 規則跟後端同一份。找不到或不只一處時回 `message`：照樣讓人送（只有「這段開頭」），後端會再判斷並講原因。
 */
export function selectionImageSpots(
  blockTexts: readonly string[],
  text: string,
): { spots: SelectionSpot[]; message: string | null } {
  const blocks = blockTexts.map((value) => ({ text: value.replace(/\s+/g, ' ').trim() }));
  const located = locateSelection(blocks, text);
  if (!located.ok) {
    return { spots: [{ spot: 0, kind: 'start', afterBlockIndex: -1, label: '這段開頭' }], message: located.message };
  }
  return { spots: selectionSpots(blocks, located.first, located.last), message: null };
}

/**
 * 送出時帶的位置個數（`spotCount`）：後端用存好的那一版算出來不一樣就拒絕，不讓圖默默放錯（審查 2）。
 * 畫面上定位不到選取（只剩「這段開頭」）時不帶，交給後端自己定位。
 */
export function selectionImageSpotCount(result: { spots: readonly SelectionSpot[]; message: string | null }): number | undefined {
  return result.message === null ? result.spots.length : undefined;
}

/** 面板標題：「依選取段落：「開頭十幾個字…」（共 N 字）」——跟卡片上講的同一句。 */
export function selectionImageHeading(text: string): { excerpt: string; length: number } {
  return { excerpt: excerptOf(text), length: selectionImageLength(text) };
}

/**
 * 送出時帶的 `contentHash`（畫面那一版）：打字模式先存了一版的話，用最後一次存成功的那一版
 * （工作區的快照可能還沒重讀到它，跟打字中存檔的基準同一套）；沒在打字就是工作區目前這一版。
 */
export function selectionImageContentHash(state: {
  editing: boolean;
  lastSaved: string | null;
  jobHash: string | undefined;
}): string | undefined {
  return state.editing ? (state.lastSaved ?? state.jobHash) : state.jobHash;
}
