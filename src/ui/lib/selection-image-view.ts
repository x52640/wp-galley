import type { ImageGenerationStatus } from '../service/types.js';
import {
  checkSelectionImage,
  excerptOf,
  selectionImageLength,
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
 * 「用此段配圖」面板開著時，位置選項還能不能用（P5-T038 審查）。選項是後端照 `spotsHash` 那一版算的：
 * - 畫面知道的目前版本（`currentHash`：打字中最後存的那一版，否則工作區的版本）已經不是那一版 → 過時。
 * - 校樣的版本換成**別處**改的（不是這次打字中自己存的那幾版）→ 過時。
 * 正在送出時不判斷（送出本身會照後端的 409 講）。
 */
export function selectionPickStale(state: {
  spotsHash: string | null;
  currentHash: string | undefined;
  openedKey: string;
  currentKey: string;
  own: readonly string[];
  sending: boolean;
}): boolean {
  if (state.sending) return false;
  if (state.spotsHash !== null && state.currentHash !== undefined && state.spotsHash !== state.currentHash) return true;
  return state.currentKey !== state.openedKey && !state.own.includes(state.currentKey);
}

/** 非同步回來時畫面還在不在發起的那一篇（Workspace 換篇會重用，跟 `startFactCheck` 同一套；Codex 審查 P2）。 */
export function stillOnJob(state: { alive: boolean; current: string; origin: string }): boolean {
  return state.alive && state.current === state.origin;
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

/**
 * 重讀的結果能不能寫進畫面（P5-T038 第二輪審查）：元件還在、是最新一次送出的重讀、**而且還是發起的那一篇**。
 * Workspace 換篇時沿用同一個元件，舊篇的 `refresh` 若是最後一個送出的，只看世代會把舊篇的資料寫進新篇的畫面。
 */
export function refreshStillCurrent(state: {
  alive: boolean;
  mine: number;
  latest: number;
  current: string;
  origin: string;
}): boolean {
  return state.mine === state.latest && stillOnJob({ alive: state.alive, current: state.current, origin: state.origin });
}

/**
 * 要不要開始一次重讀（P5-T038 第三輪審查）：呼叫的是**舊篇**的 `refresh`（換篇前抓住的）就不開始，
 * 而且**不推進世代**——推進了，新篇第一次載入的回應會被當成過期丟掉、舊篇的回應又被篇別擋掉，畫面卡在「載入稿件…」。
 * 回傳新的世代（開始）或 null（不開始，世代不動）。
 */
export function beginRefresh(state: { generation: number; current: string; origin: string }): number | null {
  if (state.current !== state.origin) return null;
  return state.generation + 1;
}
