import type { ProofSaveDecision } from './write-in-place.js';
import { factCheckBlockedReason } from './factcheck-view.js';

/**
 * 改字時也能「查證這句」、查證時可以繼續寫（D-036，P6-T006；規格 docs/specs/factcheck.md「觸發與畫面」）。
 * 畫面的判斷放這裡，才測得到。
 */

/** 打字模式按「查證這句」要做什麼。存的驗證與錯誤處理跟「儲存」同一套（`decideProofSave`）。 */
export type SelectionCheckPlan =
  | { readonly kind: 'check' }
  | { readonly kind: 'save-then-check'; readonly save: { readonly editedBody?: string; readonly editedTitle?: string } }
  | { readonly kind: 'confirm-drop'; readonly dropped: readonly string[] }
  | { readonly kind: 'invalid-title'; readonly message: string };

/** 沒改就直接查；有改先存一版（只存本機）再查；存不了的照存檔的方式講、不查。 */
export function planSelectionCheck(decision: ProofSaveDecision): SelectionCheckPlan {
  switch (decision.kind) {
    case 'unchanged':
      return { kind: 'check' };
    case 'save':
      return {
        kind: 'save-then-check',
        save: {
          ...(decision.editedBody === undefined ? {} : { editedBody: decision.editedBody }),
          ...(decision.editedTitle === undefined ? {} : { editedTitle: decision.editedTitle }),
        },
      };
    default:
      return decision;
  }
}

/** 校樣 iframe 載的是哪一版：內容 hash＋渲染世代（`ProofView` 的網址兩個都帶）。 */
export interface ProofFrame {
  readonly key: string;
  readonly epoch: number;
}

/**
 * 打字中存了一版、留在打字模式：校樣**不重載**（重載會把游標、捲動、存檔之後又打的字一起丟掉）。
 * `key`／`epoch` 是 iframe 目前載著的那一版；`own` 是這次打字中自己存出來的每一版；`pending`：還在存。
 */
export interface ProofHold extends ProofFrame {
  readonly own: readonly string[];
  readonly pending: boolean;
}

/**
 * iframe 該載哪一版。打字中、而且工作區的版本是 iframe 載著的那一版或自己存出來的任何一版（或還在存）：維持原本載著的那一版。
 * 工作區的快照可能比存檔舊（存好之後重讀失敗、或輪詢的舊回應），那不是外部改動，不換（Codex P1）。
 * 版本是別處改出來的（不在上面那些裡）、或沒在打字：照目前的版本——前者照既有規則重載並講「有了新版本」。
 */
export function shownFrame(input: {
  editing: boolean;
  hold: ProofHold | null;
  revisionKey: string;
  renderEpoch: number;
}): ProofFrame {
  const { hold } = input;
  if (
    input.editing &&
    hold !== null &&
    (hold.pending || hold.key === input.revisionKey || hold.own.includes(input.revisionKey))
  ) {
    return { key: hold.key, epoch: hold.epoch };
  }
  return { key: input.revisionKey, epoch: input.renderEpoch };
}

/** 要開始「存了留在打字模式」：還沒有 hold 就記下目前載著的那一版。 */
export function beginHold(current: ProofHold | null, shown: ProofFrame): ProofHold {
  return current === null ? { ...shown, own: [], pending: true } : { ...current, pending: true };
}

/**
 * 存完（`savedHash`；失敗是 null）。失敗：之前沒存過的不留 hold，存過的照舊。
 * 成功一律記下存出來的版本，就算它跟 iframe 載著的那一版同 hash（H0 → H1 → H0）：
 * 那時渲染世代已經變了，放掉 hold 會換成新的 `r=` 重載、把打字中的字與游標蓋掉（審查 2）。
 */
export function settleHold(hold: ProofHold, savedHash: string | null): ProofHold | null {
  if (savedHash === null) return hold.own.length === 0 ? null : { ...hold, pending: false };
  return { ...hold, own: hold.own.includes(savedHash) ? hold.own : [...hold.own, savedHash], pending: false };
}

/**
 * 打字中下一次存檔的基準（`expectedContentHash`）：這次打字中最後一次存成功的 hash 優先，
 * 工作區的快照可能還沒重讀到它（存好之後重讀失敗，Codex P1），拿舊的當基準會被 409 擋。
 */
export function nextSaveBase(lastSaved: string | null, jobHash: string | undefined): string | undefined {
  return lastSaved ?? jobHash;
}

/**
 * 選字「查證這句」的反灰原因。打字模式照樣能按（「正在改字」不算）；正文空不空也不看**存過的**——
 * 空白新稿在打字模式打了第一句、還沒存，存過的正文是空的（Codex P2）。按下會先存，空的話存檔與後端查證會講。
 */
export function selectionCheckBlockedReason(state: {
  running: boolean;
  editing: boolean;
  comparing: boolean;
  bodyEmpty: boolean;
  finished: boolean;
}): string | null {
  return factCheckBlockedReason({ ...state, editing: false, bodyEmpty: state.editing ? false : state.bodyEmpty });
}

/**
 * 打字中存了一版之後：從卡片進來的那張（校稿 `itemId`、查證 `factCheckId`）已經跟著這次存檔結案，
 * 之後再存不要再送一次。
 */
export function afterStaySave<T extends { itemId: number | null; factCheckId?: number | null }>(editing: T | null): T | null {
  return editing === null ? null : { ...editing, itemId: null, factCheckId: null };
}

/**
 * 工作區重讀查證結果之後：從查證卡片「去原文改」進來的那條已經不是 open（打字中查證跑完被新結果取代、
 * 或清單裡已經沒有它——清單不列 superseded）就不再送 `resolveFactCheckId`（審查 1）。
 * 讀不到清單（`null`）不動。沒變就回原本那個物件（React 不重繪）。
 */
export function dropStaleFactCheck<T extends { factCheckId?: number | null }>(
  editing: T | null,
  findings: readonly { readonly id: number; readonly status: string }[] | null,
): T | null {
  if (editing === null || editing.factCheckId == null || findings === null) return editing;
  const id = editing.factCheckId;
  return findings.some((finding) => finding.id === id && finding.status === 'open') ? editing : { ...editing, factCheckId: null };
}

/**
 * 進打字模式（改原文、卡片的自己改／去原文改）要不要擋：發布中、或有**查證以外**的 Agent 動作在跑。
 * 查證不改文章（D-036），跑的時候照樣可以改；其他 Agent 動作照舊（跑完會產生新版本或對著某一版套用）。
 */
export function editBlockedByRun(state: {
  publishing: boolean;
  agentRun: { readonly status: string; readonly task: string } | null | undefined;
}): boolean {
  if (state.publishing) return true;
  return state.agentRun?.status === 'running' && state.agentRun.task !== 'factcheck';
}

/** 非空白字數（游標定位用：整理前後空白與換行節點會變，字不會）。 */
export function countNonSpace(text: string): number {
  return text.replace(/\s+/gu, '').length;
}

/**
 * 「前面有幾個非空白字」→ 落在第幾個文字節點的第幾個字元（審查 3：照樣存之後換掉畫面時把游標放回去）。
 * 只算有字的節點（區塊之間的換行節點跳過）；剛好在交界放在前一個的結尾；超出就停在最後一個有字節點的結尾；沒有字回 null。
 */
export function locateTextOffset(texts: readonly string[], count: number): { index: number; offset: number } | null {
  let seen = 0;
  let lastWithText: number | null = null;
  for (let index = 0; index < texts.length; index += 1) {
    const text = texts[index]!;
    const length = countNonSpace(text);
    if (length === 0) continue;
    lastWithText = index;
    if (count <= seen + length) {
      let need = count - seen;
      if (need <= 0) return { index, offset: 0 };
      for (let offset = 0; offset < text.length; offset += 1) {
        if (!/\s/u.test(text[offset]!)) need -= 1;
        if (need === 0) return { index, offset: offset + 1 };
      }
    }
    seen += length;
  }
  return lastWithText === null ? null : { index: lastWithText, offset: texts[lastWithText]!.length };
}

/** 打字中自動存過一版（按「查證這句」先存的）：提示列講一句，免得按取消以為會回到進打字模式前（審查 4）。 */
export function editBarSavedNote(autoSaved: boolean): string | null {
  return autoSaved ? '已自動存一版；按取消會回到這一版' : null;
}
