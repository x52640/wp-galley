import type { ImageGenerationStatus, SelectionSpotsResponse } from '../service/types.js';
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
 * （工作區的快照可能還沒重讀到它，跟打字中存檔的基準同一套）；還沒存過但有「存在前面」的那一版（P5-T040 `SavedAhead`）
 * 就用它——進打字模式那一刻就要對，不能等 effect 把它寫進 ref（PR #28 Codex P2）；沒在打字就是工作區目前這一版。
 * Workspace 在 render 時算，傳給子元件的值與送出的請求用同一個。
 */
export function selectionImageContentHash(state: {
  editing: boolean;
  lastSaved: string | null;
  aheadHash?: string | null;
  jobHash: string | undefined;
}): string | undefined {
  if (!state.editing) return state.jobHash;
  return state.lastSaved ?? state.aheadHash ?? state.jobHash;
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

/**
 * 把回呼綁住某一篇，**同一篇、同一個回呼拿到的包裝身分不變**（P5-T038 第四輪審查）。
 * 子元件常把回呼放進 effect 依賴（AgentButton 的 `onError`）：每次 render 給新的包裝，effect 就每次重跑、
 * 把子元件的 null 寫回去，清掉工作區剛設好的錯誤。`isCurrent(origin)` 呼叫當下才判斷還在不在那一篇。
 */
export interface JobBinder {
  <A extends unknown[]>(origin: string, fn: (...args: A) => void): (...args: A) => void;
  /** 快取裡留的是哪一篇（只留目前這一篇；第五輪審查）。 */
  cachedJob(): string | null;
}

export function createJobBinder(isCurrent: (origin: string) => boolean): JobBinder {
  // 只留目前這一篇的包裝：Workspace 換篇不卸載，跨篇一直累積就是漏（第五輪審查）。換篇時整個換掉。
  let cached: { origin: string; wrapped: WeakMap<object, unknown> } | null = null;
  const bind = <A extends unknown[]>(origin: string, fn: (...args: A) => void): ((...args: A) => void) => {
    if (cached === null || cached.origin !== origin) cached = { origin, wrapped: new WeakMap() };
    const existing = cached.wrapped.get(fn) as ((...args: A) => void) | undefined;
    if (existing !== undefined) return existing;
    const bound = (...args: A): void => {
      if (isCurrent(origin)) fn(...args);
    };
    cached.wrapped.set(fn, bound);
    return bound;
  };
  return Object.assign(bind, { cachedJob: () => cached?.origin ?? null });
}

/** 「用此段配圖」面板的位置選項狀態（問後端的那一段）。 */
export interface SpotsPickState {
  /** 這次開面板的請求編號：關掉又重開會換一個，舊請求回來對不上就丟掉（第五輪審查）。 */
  readonly token: number;
  readonly spots: SelectionSpotsResponse['spots'] | null;
  readonly spotsHash: string | null;
  readonly loadError: string | null;
}

/**
 * 問位置選項的結果寫回面板：只收**同一個 token** 的（成功、失敗都是）；成功時清掉錯誤。
 * 面板已經關掉（null）或是另一次打開的，原樣不動。
 */
export function settleSpots<T extends SpotsPickState>(
  current: T | null,
  token: number,
  outcome: { readonly ok: true; readonly result: SelectionSpotsResponse } | { readonly ok: false; readonly error: string },
): T | null {
  if (current === null || current.token !== token) return current;
  return outcome.ok
    ? { ...current, spots: outcome.result.spots, spotsHash: outcome.result.contentHash, loadError: null }
    : { ...current, spots: null, spotsHash: null, loadError: outcome.error };
}

/**
 * 「用此段配圖」面板的送出鈕能不能按（第六輪審查）：沒有擋住的原因、不在送出中、那句話沒超過、
 * 位置選項已經回來且沒有錯誤，**而且所選的位置在目前這組選項裡**（沒有任何一個被勾就不給送）。
 */
export function canSendSelectionImage(state: {
  blockedReason: string | null;
  busy: boolean;
  noteTooLong: boolean;
  spots: readonly { readonly spot: number }[] | null;
  loadError: string | null;
  spot: number;
}): boolean {
  if (state.blockedReason !== null || state.busy || state.noteTooLong) return false;
  if (state.spots === null || state.loadError !== null) return false;
  return state.spots.some((option) => option.spot === state.spot);
}
