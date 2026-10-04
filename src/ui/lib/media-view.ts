import type {
  AutoPlaceResult,
  ImageBrief,
  ImageGenerationStatus,
  LoadedJob,
  MediaAsset,
} from '../service/types.js';
import { agentStatusText } from './agent-tasks.js';
import { USER_NOTE_MAX, userNoteLength } from '../../contract/user-note.js';
import { BRIEF_PROMPT_MAX, briefPromptLength } from '../../contract/brief-prompt.js';

/**
 * 配圖面板（`panels/MediaPanel`、`BriefCard`、`MediaRow`）畫面的判斷（P5-T044 從 MediaPanel 抽出來）。
 * 不碰 React 狀態，才測得到。前後端都要的規則照舊在 `src/contract`（字數算法、能不能鎖內容）。
 */

type AgentRun = LoadedJob['agentRun'];

/** 選檔時收哪些格式。SVG 收進來之後在前端轉成 PNG（`svg-to-png.ts`）。 */
export const IMAGE_FILE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml,.svg';

/** 媒體列與插圖面板上給人看的名字。 */
export function assetLabel(asset: MediaAsset): string {
  // 使用者在文章上請 AI 配的（key `user-…`，P5-T018）：key 是亂數，給人看的是替代文字。
  const mine = asset.briefKey?.startsWith('user-') === true;
  if (asset.briefKey && !mine) return asset.briefKey;
  if (asset.altText) return asset.altText;
  if (mine) return `AI 配的圖 #${asset.id}`;
  return `圖片 #${asset.id}`;
}

/**
 * 這張圖有沒有放在某一段之後（`-1`＝最前面不算）。校樣還沒量完時，下拉靠它補一個「第 N 段之後」選項，
 * 免得目前的位置看起來被清掉。
 */
export function isPlacedInBody(asset: Pick<MediaAsset, 'placedAfterBlockIndex'>): boolean {
  return asset.placedAfterBlockIndex !== null && asset.placedAfterBlockIndex >= 0;
}

/** 這次自動放位置有沒有動到正文（放進去或換掉舊圖）。 */
export function changedBody(result: AutoPlaceResult): boolean {
  return result.outcome === 'placed' || result.outcome === 'replaced';
}

/** 這條配圖需求要放在哪裡（「『…』那段之後」）；沒有錨點是 null。 */
export function briefWhere(brief: Pick<ImageBrief, 'anchor' | 'anchorPosition'>): string | null {
  return brief.anchor === null ? null : `「${brief.anchor}」那段${brief.anchorPosition === 'before' ? '之前' : '之後'}`;
}

/** 使用者那條（`origin: 'user'`）沒在改的時候，「想要：…」那一行。 */
export function minePurposeText(brief: Pick<ImageBrief, 'note' | 'fromSelection'>): string {
  if (brief.note !== null) return `想要：${brief.note}`;
  return brief.fromSelection
    ? '沒有特別要求：Codex 讀你選的這段自己決定畫面'
    : '沒有特別要求：Codex 讀前後段落自己決定畫面';
}

/**
 * 這張卡片跟目前這一趟 Agent 的關係。`generateBusy` 是卡片自己按下去、還在等回應的那一趟。
 * `runStartedAt`：正在畫這張時，那一趟從什麼時候開始（給計時器）。
 */
export function briefRunState(
  run: AgentRun,
  briefId: number,
  generateBusy: boolean,
): { runningHere: boolean; runningElsewhere: boolean; generating: boolean; runStartedAt: string | undefined } {
  const runningHere = run?.status === 'running' && run.task === 'generate-image' && run.briefId === briefId;
  const runningElsewhere = run?.status === 'running' && !runningHere;
  return {
    runningHere,
    runningElsewhere,
    generating: generateBusy || runningHere,
    runStartedAt: runningHere ? run.startedAt : undefined,
  };
}

/** 重新整理之後 generate.error 就沒了；上一趟這張卡片生圖失敗的話，照樣講出來。 */
export function briefLastFailure(run: AgentRun, briefId: number): string | null {
  return run !== null &&
    run.task === 'generate-image' &&
    run.briefId === briefId &&
    (run.status === 'failed' || run.status === 'timeout')
    ? `上次生圖${agentStatusText(run.status)}${run.errorMessage ? `：${run.errorMessage}` : ''}`
    : null;
}

/** 不能生圖的原因（還沒問到是 null，不講）。 */
export function generationUnavailableReason(generation: ImageGenerationStatus | null): string | null {
  if (generation === null) return null;
  return !generation.available ? (generation.reason ?? '現在不能生圖') : null;
}

/** 「用 Codex 生圖」「再生一張」能不能按。改到一半不給：生的會是還沒存的那一版以外的東西。 */
export function canGenerateBrief(state: {
  generation: ImageGenerationStatus | null;
  generating: boolean;
  runningElsewhere: boolean;
  busy: boolean;
  editing: boolean;
}): boolean {
  return (
    state.generation?.available === true && !state.generating && !state.runningElsewhere && !state.busy && !state.editing
  );
}

/**
 * 卡片上改描述的字數狀態。跟後端同一套算法（`contract/brief-prompt.ts`、`contract/user-note.ts`）。
 * 使用者那條可以留空（＝沒有特別要求）；Agent 那條不行。
 */
export function briefDraftStatus(
  draft: string | null,
  mine: boolean,
): { length: number; max: number; tooLong: boolean; empty: boolean } {
  const length = draft === null ? 0 : mine ? userNoteLength(draft) : briefPromptLength(draft);
  const max = mine ? USER_NOTE_MAX : BRIEF_PROMPT_MAX;
  return { length, max, tooLong: length > max, empty: !mine && length === 0 };
}

/** 改描述的「存」能不能按。 */
export function canSaveBriefDraft(state: {
  editing: boolean;
  tooLong: boolean;
  empty: boolean;
  generating: boolean;
  saving: boolean;
}): boolean {
  return state.editing && !state.tooLong && !state.empty && !state.generating && !state.saving;
}

/** 「改」按鈕的提示。 */
export function briefEditTitle(generating: boolean, mine: boolean): string {
  if (generating) return 'Codex 正在畫這張，等它跑完再改';
  return mine ? '改你想要的那句' : '改這段描述；之後生圖照改過的畫';
}

/** 改描述時，字數後面那句說明。 */
export function briefDraftHint(state: { generating: boolean; mine: boolean; hasCandidate: boolean }): string {
  const main = state.generating
    ? 'Codex 正在畫這張，等它跑完再改。'
    : state.mine
      ? '存的時候，會用文章裡這個位置目前前後的段落，重新組給 Codex 的指令。'
      : '存了之後，「用 Codex 生圖」就照這段畫；之後 AI 再給建議也不會蓋掉。';
  return main + (state.hasCandidate && !state.generating ? ' 已經生好的那張留著，想要新的就再生一張。' : '');
}

/** 候選圖底下：按「用這張」會發生什麼事（含會不會讓核准失效）。 */
export function candidateHint(
  brief: Pick<ImageBrief, 'isFeatured' | 'fulfilled' | 'anchor' | 'anchorPosition' | 'origin'>,
  approvalValid: boolean,
): string {
  const where = briefWhere(brief);
  const mine = brief.origin === 'user';
  const main = brief.isFeatured
    ? '按「用這張」會上傳到 WordPress 媒體庫；還沒有別的封面時會自動設成精選圖片。'
    : brief.fulfilled
      ? '按「用這張」會上傳到 WordPress 媒體庫；原本那張在正文裡的話，新圖放到它的位置。'
      : where !== null
        ? mine
          ? `按「用這張」會上傳到 WordPress 媒體庫，並放回你選的位置（${where}；找不到那段就不放）。不滿意就再生一張，不用它也沒關係。`
          : '按「用這張」會上傳到 WordPress 媒體庫，並自動放進正文上面那段之後（找不到那段就不放）。'
        : '按「用這張」會上傳到 WordPress 媒體庫，位置要自己選。不滿意就再生一張，不用它也沒關係。';
  const cover = brief.isFeatured && approvalValid ? ' 換封面會讓目前的核准失效。' : '';
  const body = !brief.isFeatured && (brief.anchor !== null || brief.fulfilled) && approvalValid ? ' 放進正文會讓目前的核准失效。' : '';
  return main + cover + body;
}

/**
 * 沒有候選圖、也沒在生圖時，卡片上那行「之後會怎樣」的說明（封面／會自動放／換一張，三選一或沒有）。
 */
export function briefIdleHint(
  brief: Pick<ImageBrief, 'isFeatured' | 'fulfilled' | 'anchor' | 'origin'>,
  approvalValid: boolean,
): string | null {
  if (brief.isFeatured) {
    return (
      '這是封面：上傳（或生圖後「用這張」）的圖，在還沒有別的封面時會自動設成精選。' +
      (approvalValid ? ' 換封面會讓目前的核准失效。' : '')
    );
  }
  if (brief.anchor !== null && !brief.fulfilled) {
    return (
      (brief.origin === 'user'
        ? '上傳（或生圖後「用這張」）的圖會放回你選的位置。'
        : '上傳（或生圖後「用這張」）的圖會自動放進正文上面那段之後。') +
      (approvalValid ? ' 放進正文會讓目前的核准失效。' : '')
    );
  }
  if (brief.fulfilled) {
    return (
      '「換一張」：原本那張在正文裡的話，新圖會放到它的位置，舊圖拿出正文（留在媒體庫）。' +
      (approvalValid ? ' 換進正文會讓目前的核准失效。' : '')
    );
  }
  return null;
}
