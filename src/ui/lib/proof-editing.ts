import { editBarSavedNote } from './check-while-writing.js';
import { decideProofSave, type ProofSaveDecision } from './write-in-place.js';

/**
 * 打字模式（`useProofEditing`，P5-T042 從 ProofView 抽出）裡不需要 React 狀態、也不碰文件的判斷。
 * 存檔規則本身在 `write-in-place.ts`（`decideProofSave`）與 `check-while-writing.ts`（hold、先存再做），這裡只是把
 * 「儲存」與「先存再做」共用的那幾步收在一起，才測得到。
 */

/** 打字模式提示列平常講的話；打字中自動存過一版時改講 `editBarSavedNote`。 */
export const EDIT_BAR_NOTE = '直接在文章上打字，標題也可以點進去改；貼上時保留粗體、連結、標題與清單，其他樣式會拿掉。';

/** 提示列這一刻要講的話。 */
export function editBarNote(autoSaved: boolean): string {
  return editBarSavedNote(autoSaved) ?? EDIT_BAR_NOTE;
}

/**
 * 「儲存」與「先存再做」共用的存檔判斷：整理過的正文跟進入編輯（或上次自動存）時的基準比，標題跟原本的標題比。
 * 基準沒有整理過的版本時用原始正文去掉前後空白；沒有記下的標題時用存著的標題。
 */
export function decideEditSave(input: {
  /** 現在畫面上的正文整理後（`cleanEditedBody`）。 */
  readonly html: string;
  readonly dropped: readonly string[];
  readonly force: boolean;
  /** 進入編輯（或上次自動存）時整理過的正文。 */
  readonly originalClean: string | null;
  /** 進入編輯（或上次自動存）時的原始正文。 */
  readonly originalBody: string | null;
  /** 標題元素的字；null＝沒有標題元素。 */
  readonly titleText: string | null;
  /** 進入編輯（或上次自動存）時的標題。 */
  readonly originalTitle: string | null;
  /** 稿件存著的標題（沒記下進入編輯時的標題就用它）。 */
  readonly savedTitle: string;
  readonly diary: boolean;
  readonly titleMaxLength: number | null;
}): ProofSaveDecision {
  return decideProofSave({
    bodyCleaned: input.html,
    bodyOriginal: input.originalClean ?? (input.originalBody ?? '').trim(),
    dropped: input.dropped,
    force: input.force,
    titleText: input.titleText,
    titleOriginal: input.originalTitle ?? input.savedTitle,
    diary: input.diary,
    titleMaxLength: input.titleMaxLength,
  });
}

/**
 * 「照樣存」之後留在打字模式（先存再做）：畫面要不要換成存進去的那份整理後正文（審查 3）。
 * 只有照樣存、這次真的存了正文、而且等回應的期間沒有再打字（畫面還是存的那一刻的樣子）才換；換了會丟字的不換。
 */
export function replaceWithSavedBody(input: {
  readonly force: boolean;
  readonly savedBody: string | undefined;
  readonly rawNow: string;
  readonly rawAtSave: string;
}): boolean {
  return input.force && input.savedBody !== undefined && input.rawNow === input.rawAtSave;
}
