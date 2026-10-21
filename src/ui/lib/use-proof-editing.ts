import { useCallback, useEffect, useRef, useState, type MutableRefObject, type RefObject } from 'react';
import { describeError } from '../service/client.js';
import type { LoadedJob } from '../service/types.js';
import {
  availableCommands,
  formatStateFrom,
  nextLinkEditor,
  type FormatCommand,
  type FormatState,
  type LinkEditorState,
} from './rich-format.js';
import {
  applyLink,
  cleanEditedBody,
  cleanRestoredBody,
  currentLink,
  removeLink,
  replaceBodyKeepingCaret,
  runCommand,
  saveSelection,
  selectionAncestors,
  selectionEmphasis,
  snapshotBody,
  snapshotHtml,
  type RichAllow,
} from './rich-commands.js';
import type { RichUnit } from '../../contract/rich-text.js';
import { isBlankBody } from '../../contract/empty-body.js';
import { isNewTabTarget } from '../../contract/link-target.js';
import { readString } from './format.js';
import {
  beginHold,
  planSelectionCheck,
  saveThenAct,
  settleHold,
  shownFrame,
  type ProofFrame,
  type ProofHold,
} from './check-while-writing.js';
import { stillOnJob } from './selection-image-view.js';
import { missingTargetNotice } from './edit-target.js';
import { disableWriting, editTarget, enableWriting, markBlank, showEditTarget, unwrapHighlightMarks } from './proof-edit-dom.js';
import { decideEditSave, replaceWithSavedBody } from './proof-editing.js';
import {
  htmlBlocks,
  insertFigureInEditor,
  InsertSaveError,
  lockWriting,
  placedFigure,
  prefixNodes,
  runInsertWhileWriting,
  savedAfterIndex,
  savedAnchor,
  withFigure,
  type InsertResult,
} from './insert-while-writing.js';

/**
 * 校樣的打字模式（P5-T042 從 ProofView 抽出；行為見 ProofView 檔頭「四」「六」「七」與「選字」兩節）：
 * 進出編輯、進入那一刻的原文快照（取消時還原、存檔時比對有沒有改）、存檔（含「照樣存」、整理後換回畫面）、
 * 打字中先存再做（`actWhileWriting`，查證這句與用此段配圖共用；存了留在打字模式、校樣不重載的 hold）、錯誤、
 * 格式工具列與連結編輯的狀態。
 *
 * ProofView 只組裝：iframe 文件、量測（`measure`）與捲動容器交給這裡。
 *
 * **effect 的順序跟抽出前一樣**（React 照呼叫順序跑 effect）：
 * - 這個 hook 裡只有一個 effect（離開打字模式就清掉 hold、自動存過、動作錯誤），ProofView 在原本那個位置呼叫這個 hook。
 * - 進入／離開編輯（`syncEditing`）與「版本被換掉」（`abandonOnNewVersion`）要排在其他 effect 之間，
 *   effect 本身不在這裡、只提供內容：進出編輯留在 ProofView 原位，換版本在 `lib/use-proof-frame.ts`（P5-T043）。
 */

/** 這裡用到的進入編輯要求（`ProofEditRequest` 的一部分：游標要停在哪）。 */
export interface ProofEditTarget {
  caret: string | null;
  caretSkipInside?: string | null;
  blockIndex: number | null;
}

export interface ProofEditing {
  isEditing: boolean;
  /** 打字中與否（給 iframe 上的事件處理用，處理函式只掛一次）。 */
  editingRef: MutableRefObject<boolean>;
  /** 打字中先存的那幾版（D-036）：iframe 維持原本載著的那一版。 */
  hold: ProofHold | null;
  /** iframe 該載哪一版。 */
  shown: ProofFrame;
  saving: boolean;
  saveError: string | null;
  actError: string | null;
  autoSaved: boolean;
  /** 存檔時發現有模板不支援、會被拿掉的格式：先講出來，使用者按「照樣存」才存。 */
  dropWarning: string[] | null;
  /** 填回留底時整理拿掉的格式（P5-T048 審查 6）：講一聲，按「知道了」收起。 */
  restoreDropped: string[] | null;
  dismissRestoreDropped: () => void;
  // --- 格式（P5-T028） ---
  allow: RichAllow;
  allowRef: MutableRefObject<RichAllow>;
  commands: FormatCommand[];
  formatState: FormatState | null;
  formatStateRef: MutableRefObject<FormatState | null>;
  linkEditor: LinkEditorState | null;
  /** 重讀游標所在的格式（按鈕亮起與停用）。身分不變。 */
  refreshFormat: () => void;
  doCommand: (command: FormatCommand) => void;
  doCommandRef: MutableRefObject<(command: FormatCommand) => void>;
  applyLinkHref: (href: string, newTab: boolean) => void;
  removeCurrentLink: () => void;
  closeLinkEditor: (refocus?: boolean) => void;
  // --- 流程 ---
  /** 進入／離開編輯（ProofView 的 effect 呼叫，依賴 `editing?.nonce`、`isEditing`、`loadCount`）。 */
  syncEditing: () => void;
  /** 校樣換了版本：打字到一半就結束編輯並講出來（`useProofFrame`「換版本」的 effect 呼叫）。 */
  abandonOnNewVersion: () => void;
  cancelEdit: () => void;
  saveEdit: (force?: boolean) => Promise<void>;
  /**
   * 打字模式先存再做（查證這句、用此段配圖、在這裡插圖的「請 AI 配一張」）。`act` 收到這次存好的 hash；沒改、沒存是 null。
   */
  actWhileWriting: (act: (savedHash: string | null) => void | Promise<void>, force?: boolean) => Promise<void>;
  /**
   * 打字模式「在這裡插圖」把圖放進正文（P5-T049，D-048；流程見 `lib/insert-while-writing.ts`）：擋打字 → 有改先存 →
   * `put` 收到換算成存好那一版的索引、放圖並回傳新版本 → 圖插進編輯區、基準換成新版本 → 放開打字。
   * 存失敗、放圖失敗丟出去；`confirm`＝正在問照樣存（按了之後接著放，`done` 那時才呼叫，錯誤講在頂端）。
   */
  placeWhileWriting: (request: InsertPlaceRequest) => Promise<InsertResult>;
  /** 擋打字中（插圖存檔到放進編輯區之間）。 */
  placing: boolean;
  /** 編輯區第 `afterDomIndex` 塊換算成存好那一版（存之前的整理規則）的第幾塊。 */
  savedIndexOf: (afterDomIndex: number) => number;
  /** 丟格式警告的「回去改」。 */
  dismissDrop: () => void;
  /** 丟格式警告的「照樣存」。 */
  confirmDrop: () => void;
  /**
   * 把留底（D-047，P5-T048）填回編輯區：照存檔同一套規則整理後換掉正文與標題，游標放在最後。
   * 跟進入編輯時的原文比，按儲存也不會建新版本的（一樣）回 `same`、不動畫面；還沒進編輯或校樣還沒好回 `not-ready`。
   * 原文快照不動：「取消」照舊回到存好的那一版。
   */
  restoreDraft: (draft: { title: string | null; body: string }) => 'restored' | 'same' | 'not-ready';
}

/** 打字模式插圖（`placeWhileWriting`）的請求。 */
export interface InsertPlaceRequest {
  /** 插在編輯區第幾塊之後（量到的區塊索引；-1＝最前面）。 */
  afterDomIndex: number;
  /** 放圖：收到存好那一版的索引，回傳放好之後的版本（hash 與會發布的正文）。 */
  put: (afterBlockIndex: number) => Promise<PlacedRevision>;
  /** 放好之後（關面板、重讀）。 */
  done: () => void | Promise<void>;
}

export interface PlacedRevision {
  contentHash: string;
  /** 放好之後會發布的正文（後端的 rendered_html）：從這裡拿那塊圖、當下一次存檔的基準。 */
  publishHtml: string;
}

export function useProofEditing({
  job,
  editing,
  revisionKey,
  renderEpoch,
  frameRef,
  scrollRef,
  measure,
  measureToken,
  onSaveEdit,
  onEndEdit,
  onEditTargetMissing,
  onDiscardDraft,
  onPlaced,
}: {
  job: LoadedJob;
  editing: ProofEditTarget | null;
  revisionKey: string;
  renderEpoch: number;
  frameRef: RefObject<HTMLIFrameElement | null>;
  scrollRef: RefObject<HTMLDivElement | null>;
  /** 重量區塊與高度（身分不變）。 */
  measure: (token: number) => void;
  measureToken: MutableRefObject<number>;
  onSaveEdit: ((save: { editedBody?: string; editedTitle?: string; stay?: boolean }) => Promise<string>) | undefined;
  onEndEdit: ((notice?: string) => void) | undefined;
  onEditTargetMissing: ((notice: string) => void) | undefined;
  /** 這次打字的留底作廢（取消、沒改就離開；D-047）。 */
  onDiscardDraft?: () => void;
  /** 打字中插圖放好、合併回編輯區之後：留底的基準換成放好的那一版（P5-T049）。 */
  onPlaced?: (savedHash: string) => void;
}): ProofEditing {
  /** 目前是哪一篇：存檔後的接續動作回來時不是發起那一篇就什麼都不做（Workspace 換篇沿用這個元件，第二輪審查）。 */
  const jobUuidRef = useRef(job.uuid);
  jobUuidRef.current = job.uuid;
  const isEditing = editing !== null;
  const editingRef = useRef(isEditing);
  editingRef.current = isEditing;
  const onEndEditRef = useRef(onEndEdit);
  onEndEditRef.current = onEndEdit;
  const onEditTargetMissingRef = useRef(onEditTargetMissing);
  onEditTargetMissingRef.current = onEditTargetMissing;
  /** 進入編輯那一刻的正文，用來判斷「有沒有改」與取消時還原。 */
  const originalBody = useRef<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  /** 打字模式存好之後的動作（查證、用此段配圖）自己出錯：只講它的錯，不當成存檔失敗（P5-T038 審查 3）。 */
  const [actError, setActError] = useState<string | null>(null);
  /** 進入編輯那一刻、整理過的正文：存檔時比對「有沒有改」要用同一套整理規則，不然沒改也會算改。 */
  const originalClean = useRef<string | null>(null);
  /** 進入編輯那一刻的頂層區塊：存檔時沒動過的區塊原樣保留，只整理改過的（P5-T028 審查）。 */
  const originalUnits = useRef<RichUnit[] | null>(null);
  /** 進入編輯那一刻的標題（P5-T029）：取消時還原、存檔時比對有沒有改。 */
  const originalTitle = useRef<string | null>(null);
  const savedTitle = readString(job.currentRevision?.templateData ?? null, 'title', job.title ?? '');
  const isDiary = job.target.contentType === 'diary';

  // --- 格式（P5-T028） ---
  const allow: RichAllow = { tags: job.template.allowedTags, schemes: job.template.allowedSchemes };
  const allowRef = useRef(allow);
  allowRef.current = allow;
  const commands = availableCommands(allow.tags);
  const commandsRef = useRef(commands);
  commandsRef.current = commands;
  /** 游標所在的格式；null＝游標不在正文裡（或不在編輯中）。 */
  const [formatState, setFormatState] = useState<FormatState | null>(null);
  const formatStateRef = useRef(formatState);
  formatStateRef.current = formatState;
  const [linkEditor, setLinkEditor] = useState<LinkEditorState | null>(null);
  /** 打開連結輸入框時存下的選取範圍與既有連結：焦點離開 iframe 後還要套在同一段字上。 */
  const linkTarget = useRef<{ range: Range | null; existing: Element | null } | null>(null);
  const linkSessions = useRef(0);
  /** 存檔時發現有模板不支援、會被拿掉的格式：先講出來，使用者按「照樣存」才存。 */
  const [dropWarning, setDropWarning] = useState<string[] | null>(null);
  const [restoreDropped, setRestoreDropped] = useState<string[] | null>(null);

  /** 打字中按「查證這句」先存的那幾版（D-036）：iframe 維持原本載著的那一版，不重載（見 ProofView 檔頭「六」）。 */
  const [hold, setHold] = useState<ProofHold | null>(null);
  /** 這次打字中自動存過一版（審查 4）：提示列講「按取消會回到這一版」。 */
  const [autoSaved, setAutoSaved] = useState(false);
  const holdRef = useRef(hold);
  holdRef.current = hold;
  // 這個 hook 唯一的 effect：ProofView 在抽出前這個 effect 所在的位置呼叫本 hook，順序不變。
  useEffect(() => {
    if (!isEditing) {
      setHold(null);
      setAutoSaved(false);
      setActError(null);
      setRestoreDropped(null);
    }
  }, [isEditing]);
  const shown = shownFrame({ editing: isEditing, hold, revisionKey, renderEpoch });

  const editBody = (): HTMLElement | null =>
    frameRef.current?.contentDocument?.querySelector<HTMLElement>('.preview-body') ?? null;

  /** 重讀游標所在的格式（按鈕亮起與停用）。 */
  const refreshFormat = useCallback(() => {
    const doc = frameRef.current?.contentDocument;
    const body = doc?.querySelector('.preview-body');
    if (!doc || !body || !editingRef.current) {
      setFormatState(null);
      return;
    }
    const ancestors = selectionAncestors(doc, body);
    setFormatState(ancestors === null ? null : formatStateFrom(ancestors, selectionEmphasis(doc, body)));
  }, []);

  const openLinkEditor = useCallback(() => {
    const doc = frameRef.current?.contentDocument;
    const body = doc?.querySelector('.preview-body');
    if (!doc || !body || !commandsRef.current.includes('link')) return;
    const existing = currentLink(doc, body);
    linkTarget.current = { range: saveSelection(doc, body), existing };
    linkSessions.current += 1;
    const counter = linkSessions.current;
    setLinkEditor((previous) =>
      nextLinkEditor(previous, existing?.getAttribute('href') ?? null, counter, isNewTabTarget(existing?.getAttribute('target'))),
    );
  }, []);

  const closeLinkEditor = useCallback((refocus = true) => {
    setLinkEditor(null);
    const target = linkTarget.current;
    linkTarget.current = null;
    const frame = frameRef.current;
    const body = frame?.contentDocument?.querySelector<HTMLElement>('.preview-body');
    if (!refocus || !frame || !body) return;
    frame.contentWindow?.focus();
    body.focus();
    if (target?.range) {
      const selection = frame.contentDocument?.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(target.range);
    }
  }, []);

  const doCommand = useCallback(
    (command: FormatCommand) => {
      if (placingRef.current) return;
      const frame = frameRef.current;
      const body = frame?.contentDocument?.querySelector<HTMLElement>('.preview-body');
      const state = formatStateRef.current;
      if (!frame || !body || !editingRef.current || !commandsRef.current.includes(command)) return;
      if (command === 'link') {
        openLinkEditor();
        return;
      }
      if (state === null) return;
      runCommand(frame, body, command, state);
      refreshFormat();
      measure(measureToken.current);
    },
    [measure, openLinkEditor, refreshFormat],
  );
  const doCommandRef = useRef(doCommand);
  doCommandRef.current = doCommand;

  const applyLinkHref = (href: string, newTab: boolean): void => {
    // 插圖擋打字中不改正文（審查 1）：連結框留著，放好之後再按。
    if (placingRef.current) return;
    const frame = frameRef.current;
    const body = editBody();
    const target = linkTarget.current;
    setLinkEditor(null);
    linkTarget.current = null;
    if (!frame || !body) return;
    applyLink(frame, body, target?.range ?? null, href, target?.existing ?? null, newTab);
    refreshFormat();
  };

  const removeCurrentLink = (): void => {
    if (placingRef.current) return;
    const frame = frameRef.current;
    const body = editBody();
    const existing = linkTarget.current?.existing ?? null;
    setLinkEditor(null);
    linkTarget.current = null;
    if (!frame || !body || existing === null) return;
    removeLink(frame, body, existing);
    refreshFormat();
  };

  // 進入／離開編輯。標記的拆除由 `useProofFrame` 標記的 effect 負責（isEditing 變了它會重跑）。
  const syncEditing = (): void => {
    const frame = frameRef.current;
    const doc = frame?.contentDocument;
    const body = doc?.querySelector<HTMLElement>('.preview-body');
    if (!frame || !doc || !body) return;
    const title = doc.querySelector<HTMLElement>('.preview-title');
    if (editing === null) {
      disableWriting(frame, body, title);
      originalTitle.current = null;
      originalBody.current = null;
      originalClean.current = null;
      originalUnits.current = null;
      setFormatState(null);
      setLinkEditor(null);
      setDropWarning(null);
      pendingCheck.current = null;
      linkTarget.current = null;
      return;
    }
    unwrapHighlightMarks(body);
    // 標題要變成可打字（plaintext-only）之前，查證留在標題上的標記先拆掉。
    if (title) unwrapHighlightMarks(title);
    if (originalBody.current === null) {
      originalBody.current = body.innerHTML;
      originalUnits.current = snapshotBody(body);
      originalClean.current = cleanEditedBody(body, allowRef.current, originalUnits.current).html;
      originalTitle.current = title?.textContent ?? null;
      // 空文章（新稿件剛建好）：放一個有高度的空段落，游標才有地方停（存檔時照樣整理掉）。
      if (isBlankBody(body.innerHTML)) body.innerHTML = '<p><br></p>';
    }
    enableWriting(doc, body, title);
    setSaveError(null);

    const { caret: range, target, inTitle } = editTarget(doc, body, title, editing);
    showEditTarget(frame, target);
    const missing = missingTargetNotice(editing.caret, target !== null);
    if (missing !== null) onEditTargetMissingRef.current?.(missing);
    frame.contentWindow?.focus();
    // 講標題的建議（P5-T031）：焦點給標題，不然游標會被拉回正文。
    (inTitle && title ? title : body).focus();
    const selection = doc.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    refreshFormat();

    const scroller = scrollRef.current;
    const anchor = range.startContainer.nodeType === 1 ? (range.startContainer as Element) : range.startContainer.parentElement;
    if (scroller && anchor) {
      const offset = frame.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
      const top = anchor.getBoundingClientRect().top + (frame.contentWindow?.scrollY ?? 0);
      scroller.scrollTo({
        top: Math.max(offset + top - 160, 0),
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      });
    }
  };

  // 編輯到一半版本被換掉（理論上編輯中動作都鎖住了，這是最後一道防線）：
  // 校樣要重載，打的字留不住，至少要講出來，不能靜靜消失。
  const abandonOnNewVersion = (): void => {
    if (editingRef.current) {
      originalBody.current = null;
      onEndEditRef.current?.('這篇稿件在你編輯的時候有了新版本，剛才打的字沒有存到。請再改一次。');
    }
  };

  const cancelEdit = (): void => {
    // 留底先作廢（同步做）：下面還原正文的那一下不能再被寫成留底。
    onDiscardDraft?.();
    const body = editBody();
    if (body && originalBody.current !== null) body.innerHTML = originalBody.current;
    restoreTitle();
    measure(measureToken.current);
    onEndEdit?.();
  };

  const titleElement = (): HTMLElement | null =>
    frameRef.current?.contentDocument?.querySelector<HTMLElement>('.preview-title') ?? null;
  /** 標題改回進入編輯時的字（取消、沒改、後端說沒變）。 */
  const restoreTitle = (): void => {
    const title = titleElement();
    if (title && originalTitle.current !== null) title.textContent = originalTitle.current;
  };

  /**
   * 打字模式按「查證這句」或「用此段配圖」時內容有會被拿掉的格式、正在問「照樣存」：存好之後要做的事。
   */
  const pendingCheck = useRef<((force: true) => Promise<void>) | null>(null);
  /** 插圖擋打字中（P5-T049）。ref 給事件處理用：擋打字期間恢復留底、連結、格式指令都不做（審查 1）。 */
  const [placing, setPlacing] = useState(false);
  const placingRef = useRef(false);

  const saveEdit = async (force = false): Promise<void> => {
    // 按的是「儲存」：之前「查證這句」留下、等著「照樣存」的那段字作廢。
    pendingCheck.current = null;
    const body = editBody();
    if (!body) return;
    // 存檔前整理一次（P5-T028）：b／i 轉 strong／em、瀏覽器的 div／<p><ul> 整理好、模板不支援的格式拿掉。
    // 後端照同一套規則再整理一次，再走 sanitize。
    const { html, dropped } = cleanEditedBody(body, allow, originalUnits.current);
    // 先拿到手：存檔成功時上層會結束編輯，編輯 effect 會把 originalBody 清掉。
    const original = originalBody.current;
    const title = titleElement();
    // 標題與正文一起決定（P5-T029）：有改的才送；標題清空不准存。
    const decision = decideEditSave({
      html,
      dropped,
      force,
      originalClean: originalClean.current,
      originalBody: original,
      titleText: title === null ? null : (title.textContent ?? ''),
      originalTitle: originalTitle.current,
      savedTitle,
      diary: isDiary,
      titleMaxLength: job.template.titleMaxLength,
    });
    if (decision.kind === 'unchanged') {
      // 沒改就離開：留底也不用了（還原畫面之前先作廢）。
      onDiscardDraft?.();
      // 沒有實質改動（例如只多按了 Enter）：不送出，但畫面要還原成進入編輯時的正文再重量，
      // 不然校樣多一個空區塊，「在這裡插圖」的索引會跟後端差一格（審查 #1）。
      if (original !== null) body.innerHTML = original;
      restoreTitle();
      measure(measureToken.current);
      onEndEdit?.();
      return;
    }
    if (decision.kind === 'invalid-title') {
      setDropWarning(null);
      setSaveError(decision.message);
      title?.focus();
      return;
    }
    // 格式不能默默消失：有會被拿掉的，先講出來。
    if (decision.kind === 'confirm-drop') {
      setDropWarning([...decision.dropped]);
      return;
    }
    setDropWarning(null);
    setSaving(true);
    setSaveError(null);
    try {
      const savedHash = await onSaveEdit?.({
        ...(decision.editedBody === undefined ? {} : { editedBody: decision.editedBody }),
        ...(decision.editedTitle === undefined ? {} : { editedTitle: decision.editedTitle }),
      });
      // 整理之後跟原本一樣（例如只多按了一個 Enter），後端不建新版本，校樣也不會重載；
      // 把畫面還原成那一版，不要留著沒整理過的樣子。
      if (savedHash === revisionKey && original !== null) {
        body.innerHTML = original;
        restoreTitle();
        measure(measureToken.current);
      }
    } catch (cause) {
      setSaveError(describeError(cause));
    } finally {
      setSaving(false);
    }
  };

  /**
   * 打字模式按「查證這句」（D-036）或「用此段配圖」（P5-T038）：沒改直接做；有改先照「儲存」存一版（同樣的驗證與錯誤處理），
   * 存完留在打字模式、校樣不重載，再用存好的那一版做。存失敗就不做，照存檔失敗的方式講。
   */
  const actWhileWriting = async (act: (savedHash: string | null) => void | Promise<void>, force = false): Promise<void> => {
    setActError(null);
    // 存檔之後的每一步都先確認還在發起的那一篇（第二輪審查）。
    const origin = job.uuid;
    const stillHere = (): boolean => stillOnJob({ alive: true, current: jobUuidRef.current, origin });
    const body = editBody();
    if (!body) return;
    const { html, dropped } = cleanEditedBody(body, allow, originalUnits.current);
    const title = titleElement();
    const plan = planSelectionCheck(
      decideEditSave({
        html,
        dropped,
        force,
        originalClean: originalClean.current,
        originalBody: originalBody.current,
        titleText: title === null ? null : (title.textContent ?? ''),
        originalTitle: originalTitle.current,
        savedTitle,
        diary: isDiary,
        titleMaxLength: job.template.titleMaxLength,
      }),
    );
    if (plan.kind === 'check') {
      pendingCheck.current = null;
      setDropWarning(null);
      try {
        await act(null);
      } catch (cause) {
        setActError(describeError(cause));
      }
      return;
    }
    if (plan.kind === 'invalid-title') {
      pendingCheck.current = null;
      setDropWarning(null);
      setSaveError(plan.message);
      return;
    }
    if (plan.kind === 'confirm-drop') {
      pendingCheck.current = (again) => actWhileWriting(act, again);
      setDropWarning([...plan.dropped]);
      return;
    }
    pendingCheck.current = null;
    setDropWarning(null);
    setSaving(true);
    setSaveError(null);
    // 存的那一刻的樣子：存好之後「有沒有改」改跟這一版比。等回應的期間使用者可能還在打，不能拿那時的畫面當基準。
    const rawAtSave = body.innerHTML;
    const started = beginHold(holdRef.current, shown);
    holdRef.current = started;
    setHold(started);
    let saved: string | null = null;
    await saveThenAct({
      save: async () => (await onSaveEdit?.({ ...plan.save, stay: true })) ?? null,
      onSaved: (savedHash) => {
        saved = savedHash;
        setSaving(false);
        if (!stillHere()) return;
        const settled = settleHold(started, savedHash);
        holdRef.current = settled;
        setHold(settled);
        // 照樣存（有會被拿掉的格式）：畫面換成存進去的樣子，不然那些格式留在畫面上、之後每次存都再問一次（審查 3）。
        // 等回應的期間又打了字就不換（換了會丟字），下次存再照常問。
        let rawNow = rawAtSave;
        const doc = frameRef.current?.contentDocument;
        const savedBody = plan.save.editedBody;
        if (doc && savedBody !== undefined && replaceWithSavedBody({ force, savedBody, rawNow: body.innerHTML, rawAtSave })) {
          replaceBodyKeepingCaret(doc, body, savedBody);
          rawNow = body.innerHTML;
          measure(measureToken.current);
        }
        if (plan.save.editedBody !== undefined) originalUnits.current = snapshotHtml(plan.save.editedBody);
        originalClean.current = html;
        originalBody.current = rawNow;
        setAutoSaved(true);
        if (plan.save.editedTitle !== undefined) originalTitle.current = plan.save.editedTitle;
      },
      onSaveFailed: (cause) => {
        setSaving(false);
        if (!stillHere()) return;
        const settled = settleHold(started, null);
        holdRef.current = settled;
        setHold(settled);
        setSaveError(describeError(cause));
      },
      // 存好之後的動作自己出錯（P5-T038 審查 3）：只講那個動作的錯，不動 hold（放掉會重載、蓋掉正在打的字）。
      act: () => (stillHere() ? act(saved) : undefined),
      onActFailed: (cause) => {
        if (stillHere()) setActError(describeError(cause));
      },
    });
  };

  /** 編輯區第 `afterDomIndex` 塊 → 存好那一版的第幾塊（用存檔前的基準整理；P5-T049）。 */
  const savedIndexOf = (afterDomIndex: number): number => {
    const body = editBody();
    if (!body) return afterDomIndex;
    return savedAfterIndex(prefixNodes(body, afterDomIndex), originalUnits.current, allowRef.current);
  };

  /** 打字模式插圖（P5-T049，D-048）：流程與為什麼擋打字見 `lib/insert-while-writing.ts`。 */
  const placeWhileWriting = async (request: InsertPlaceRequest, force = false): Promise<InsertResult> => {
    setActError(null);
    const origin = job.uuid;
    const stillHere = (): boolean => editingRef.current && stillOnJob({ alive: true, current: jobUuidRef.current, origin });
    const doc = frameRef.current?.contentDocument;
    const body = editBody();
    if (!doc || !body) throw new Error('校樣還沒準備好，等一下再試');
    const title = titleElement();
    // 校樣不重載（hold）：存檔到新版本合併回來之間一直「還在存」，輪詢讀到新版本也不換 iframe。
    const holdBegin = (): void => {
      const next = beginHold(holdRef.current, shown);
      holdRef.current = next;
      setHold(next);
    };
    const holdSettle = (hash: string | null): void => {
      const current = holdRef.current;
      if (current === null) return;
      const next = settleHold(current, hash);
      holdRef.current = next;
      setHold(next);
    };
    const domIndex = request.afterDomIndex;
    let anchorText: string | null = null;
    /** 照樣存把編輯區換成存進去的樣子了：之後編輯區的區塊就是存好那一版的區塊。 */
    let replaced = false;
    /** 存檔那一刻（沒改就是判斷那一刻）的編輯區：合併的基準從這裡算，不拿當下畫面（審查 1）。 */
    let snapshot = '';
    return runInsertWhileWriting<{ save: { editedBody?: string; editedTitle?: string }; html: string }, PlacedRevision>({
      lock: () => {
        placingRef.current = true;
        setPlacing(true);
        setSaving(true);
        const unlock = lockWriting(doc, body, title);
        return () => {
          placingRef.current = false;
          setPlacing(false);
          setSaving(false);
          if (editingRef.current && stillOnJob({ alive: true, current: jobUuidRef.current, origin })) unlock();
        };
      },
      prepare: () => {
        const { html, dropped } = cleanEditedBody(body, allow, originalUnits.current);
        const plan = planSelectionCheck(
          decideEditSave({
            html,
            dropped,
            force,
            originalClean: originalClean.current,
            originalBody: originalBody.current,
            titleText: title === null ? null : (title.textContent ?? ''),
            originalTitle: originalTitle.current,
            savedTitle,
            diary: isDiary,
            titleMaxLength: job.template.titleMaxLength,
          }),
        );
        if (plan.kind === 'invalid-title') {
          pendingCheck.current = null;
          setDropWarning(null);
          return { kind: 'invalid', message: plan.message };
        }
        if (plan.kind === 'confirm-drop') {
          // 按「照樣存」才接著放；那時面板那一趟已經結束：存檔的錯講成「沒存成功」，其他講成動作沒做成（審查 3）。
          pendingCheck.current = async (again) => {
            try {
              await placeWhileWriting(request, again);
            } catch (cause) {
              if (cause instanceof InsertSaveError) setSaveError(cause.message);
              else setActError(describeError(cause));
            }
          };
          setDropWarning([...plan.dropped]);
          return { kind: 'confirm' };
        }
        pendingCheck.current = null;
        setDropWarning(null);
        setSaveError(null);
        // 錨點：往前第一個整理後還存在的區塊（空段落下面插圖，審查 2）。
        const anchor = savedAnchor(prefixNodes(body, domIndex), originalUnits.current, allow);
        anchorText = anchor.text;
        snapshot = body.innerHTML;
        holdBegin();
        return { kind: 'go', save: plan.kind === 'save-then-check' ? { save: plan.save, html } : null, afterIndex: anchor.afterIndex };
      },
      save: async ({ save, html }) => {
        let savedHash: string | undefined;
        try {
          savedHash = await onSaveEdit?.({ ...save, stay: true });
        } catch (cause) {
          holdSettle(null);
          throw new Error(describeError(cause));
        }
        if (savedHash === undefined) {
          holdSettle(null);
          throw new Error('存檔沒有回應');
        }
        holdSettle(savedHash);
        holdBegin();
        if (!stillHere()) return;
        // 照樣存：畫面換成存進去的樣子（擋著打字，沒有存檔之後打的字）；換完編輯區的區塊就是存好那一版的區塊。
        const savedBody = save.editedBody;
        if (force && savedBody !== undefined) {
          replaceBodyKeepingCaret(doc, body, savedBody);
          replaced = true;
          snapshot = body.innerHTML;
        }
        if (savedBody !== undefined) originalUnits.current = snapshotHtml(savedBody);
        originalClean.current = html;
        originalBody.current = snapshot;
        setAutoSaved(true);
        if (save.editedTitle !== undefined) originalTitle.current = save.editedTitle;
      },
      put: async (afterIndex) => {
        try {
          return await request.put(afterIndex);
        } catch (cause) {
          holdSettle(null);
          throw cause;
        }
      },
      merge: (placed, afterIndex) => {
        holdSettle(placed.contentHash);
        // 照樣存換過畫面：編輯區的區塊就是存好那一版的區塊，位置用換算後的。
        const at = replaced ? afterIndex : domIndex;
        const figure = placedFigure(htmlBlocks(placed.publishHtml), afterIndex, anchorText);
        // 基準：存檔那一刻的內容＋插入的圖（不拿當下畫面）。
        const baseline = figure === null ? null : withFigure(doc, snapshot, at, figure);
        if (figure === null || baseline === null) return false;
        if (!insertFigureInEditor(body, at, figure)) return false;
        // 「有沒有改」的基準換成放好的那一版（跟「先存再做」一樣，不然下次存會把圖當成新加的區塊整理掉）。
        originalUnits.current = snapshotHtml(placed.publishHtml);
        originalClean.current = cleanEditedBody(baseline, allowRef.current, originalUnits.current).html;
        originalBody.current = baseline.innerHTML;
        setAutoSaved(true);
        markBlank(body);
        measure(measureToken.current);
        onPlaced?.(placed.contentHash);
        return true;
      },
      reload: () => {
        // 畫面跟存檔那一刻不一樣（有還沒存的字）：不能重載，留在打字模式講清楚（審查 1）。
        if (body.innerHTML !== snapshot) {
          setActError('圖已經放進正文，但編輯區對不上、沒顯示出來；你剛打的字還沒存。按「儲存」會照編輯區存（圖會被拿掉，可以再插一次）。');
          return;
        }
        // 對不上就不硬合併：之前都存過、期間擋著打字，結束打字模式照後端的版本重載不會掉字。
        onDiscardDraft?.();
        originalBody.current = null;
        onEndEditRef.current?.('圖已經放進正文；打的字都存好了，校樣照存好的版本重新載入，要再改請按「改原文」。');
      },
      still: stillHere,
      done: request.done,
    });
  };
  const dismissDrop = (): void => {
    pendingCheck.current = null;
    setDropWarning(null);
  };

  const confirmDrop = (): void => {
    // 從「查證這句」／「用此段配圖」來的：照樣存之後留在打字模式、接著做（D-036、P5-T038）；從「儲存」來的照舊存完離開。
    const resume = pendingCheck.current;
    if (resume !== null) void resume(true);
    else void saveEdit(true);
  };

  const restoreDraft = (draft: { title: string | null; body: string }): 'restored' | 'same' | 'not-ready' => {
    // 插圖擋打字中不換正文（審查 1）：等放好再填回。
    if (placingRef.current) return 'not-ready';
    const frame = frameRef.current;
    const doc = frame?.contentDocument;
    const body = editBody();
    if (!frame || !doc || !body || !editingRef.current || originalBody.current === null) return 'not-ready';
    const { html, dropped } = cleanRestoredBody(draft.body, allowRef.current, originalUnits.current);
    const title = titleElement();
    const decision = decideEditSave({
      html,
      dropped,
      force: false,
      originalClean: originalClean.current,
      originalBody: originalBody.current,
      titleText: title === null ? null : (draft.title ?? title.textContent ?? ''),
      originalTitle: originalTitle.current,
      savedTitle,
      diary: isDiary,
      titleMaxLength: job.template.titleMaxLength,
    });
    if (decision.kind === 'unchanged') return 'same';
    body.innerHTML = isBlankBody(html) ? '<p><br></p>' : html;
    if (title && draft.title !== null) title.textContent = draft.title;
    markBlank(body);
    setSaveError(null);
    setDropWarning(null);
    // 整理時拿掉了格式：不准默默拿掉，講一聲（審查 6）。
    setRestoreDropped(dropped.length > 0 ? [...dropped] : null);
    // 游標放在最後一段的結尾：接著寫。
    frame.contentWindow?.focus();
    body.focus();
    const last = body.lastElementChild ?? body;
    const range = doc.createRange();
    range.selectNodeContents(last);
    range.collapse(false);
    const selection = doc.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    refreshFormat();
    measure(measureToken.current);
    return 'restored';
  };

  return {
    isEditing,
    editingRef,
    hold,
    shown,
    saving,
    saveError,
    actError,
    autoSaved,
    dropWarning,
    restoreDropped,
    dismissRestoreDropped: () => setRestoreDropped(null),
    allow,
    allowRef,
    commands,
    formatState,
    formatStateRef,
    linkEditor,
    refreshFormat,
    doCommand,
    doCommandRef,
    applyLinkHref,
    removeCurrentLink,
    closeLinkEditor,
    syncEditing,
    abandonOnNewVersion,
    cancelEdit,
    saveEdit,
    actWhileWriting,
    placeWhileWriting: (request) => placeWhileWriting(request),
    placing,
    savedIndexOf,
    dismissDrop,
    confirmDrop,
    restoreDraft,
  };
}
