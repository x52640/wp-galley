import { useEffect, useRef, useState, type RefObject } from 'react';
import type { LoadedJob } from '../service/types.js';
import type { ProofHold } from './check-while-writing.js';
import { readString } from './format.js';
import type { RichAllow } from './rich-commands.js';
import { createThrottle, type Throttle } from './word-count.js';
import {
  afterSaveDraft,
  browserDraftStorage,
  DRAFT_SAME_NOTE,
  DRAFT_WRITE_WAIT_MS,
  draftCheckReady,
  newDraftId,
  pickDraftPlan,
  planDraftRestore,
  pruneDrafts,
  readDraft,
  readDrafts,
  removeDraftIfSame,
  restoreAllowed,
  writeDraft,
  type DraftBackup,
  type DraftNotice,
  type DraftStorage,
} from './draft-backup.js';
import { draftDiffersFromShown } from './draft-backup-dom.js';

/**
 * 打字模式沒存的內容自動留底（D-047，P5-T048）：接 iframe 與 React。規則在 `draft-backup.ts`。
 * 原則：任何順序都不能讓使用者打的字不見。
 *
 * - **寫**：每一次進打字模式是一個 session、自己一個鍵（恢復一份留底時接手它的鍵）。聽正文與標題的任何變動
 *   （MutationObserver），節流寫進瀏覽器儲存區；分頁被藏起來（`visibilitychange`→hidden）、關掉（`pagehide`）、
 *   離開打字模式但沒作廢（換篇、回總覽、版本被換掉）時立刻寫。基準是這次打字開始時的版本，打字中先存一版才換。
 * - **刪**：只刪儲存區裡**還是自己最後寫的那份**（別的分頁可能寫過）。取消、沒改就離開（`discardSession`）；
 *   存檔成功（`beginSave`／`finishSave`，工作區在重讀之前通知）——送出之後又打了字就不刪，改用存好的那一版當基準留著。
 * - **恢復**：iframe 確定載入的是目前這一版、不在打字模式時才看（`draftCheckReady`）。同一篇可能有好幾份，新的先處理
 *   （`pickDraftPlan`）：基準相同且內容不同→請工作區進打字模式、填回；基準不同→只問，不默默刪。
 *   打字中這次已經打了字，就不准再「恢復」另一份（`restoreAllowed`）。
 *
 * 排在 ProofView 所有既有 hook 之後：不動原本 effect 的順序。這裡的 effect 照下面的順序跑：
 * 寫（先接上觀察）→ 基準換了 → 讀 → 填回 → 離開打字模式收提示。
 */

/** 工作區給的：存檔基準、現在能不能進打字模式、怎麼進。 */
export interface ProofDraftInput {
  /** 存檔的基準 contentHash（`knownHash`：打字中先存過就是最後存成功的那一版）。 */
  baseHash: string | undefined;
  /** 現在能進打字模式（沒有 AI 在跑、沒在待同步、稿件沒結束）。 */
  canEdit: boolean;
  /** 不能進時講的話。 */
  blockedNote: string;
  /** 進打字模式（同「改原文」）。 */
  onStartEdit: () => void;
}

/** 按「儲存」那一刻記下的（`beginSave`）：存好之後拿來比有沒有又打字。 */
export interface DraftSaveToken {
  readonly uuid: string;
  readonly id: string;
  readonly sent: { readonly title: string | null; readonly body: string };
}

export interface DraftBackupState {
  /** 提示列要講的（已恢復／有沒存的內容）；null＝不講。 */
  notice: DraftNotice | null;
  /** 這個視窗沒辦法留底（只講一次）。 */
  unavailable: boolean;
  /** 「恢復」按得下去。 */
  canRestore: boolean;
  restoreBlockedNote: string | null;
  restore: () => void;
  /** 提示列的「捨棄」。已恢復的＝取消這次打字（回到存好的那一版）；問恢復的＝刪掉那份留底。 */
  discard: () => void;
  /** 這次打字的留底作廢（取消、沒改就離開）。 */
  discardSession: () => void;
  /** 按「儲存」（要離開打字模式的那種）送出的那一刻。 */
  beginSave: () => DraftSaveToken | null;
  /** 存檔成功（重讀之前）：沒再打字就刪，又打了字就以存好的那一版當基準留著。 */
  finishSave: (token: DraftSaveToken, savedHash: string) => void;
}

interface WriteSession {
  readonly uuid: string;
  id: string;
  base: string | null;
  suppressed: boolean;
  dirty: boolean;
  lastWritten: DraftBackup | null;
  throttle: Throttle | null;
  read: () => { title: string | null; body: string };
  write: () => void;
  /** 填回之後：丟掉填回造成的變動紀錄（那不是使用者打的），直接寫一次。 */
  afterFill: () => void;
}

/** 一個頁面只清一次過期的留底、只講一次「沒辦法留底」。 */
let pruned = false;
let warnedUnavailable = false;

export function useDraftBackup({
  job,
  isEditing,
  hold,
  frameRef,
  loadCount,
  loadedKey,
  revisionKey,
  hasRevision,
  allow,
  draft,
  restoreDraft,
  cancelEdit,
  onEndEdit,
}: {
  job: LoadedJob;
  isEditing: boolean;
  hold: ProofHold | null;
  frameRef: RefObject<HTMLIFrameElement | null>;
  loadCount: number;
  /** iframe 最後一次載入時載的是哪一版（`useProofFrame`）。 */
  loadedKey: string | null;
  revisionKey: string;
  hasRevision: boolean;
  allow: RichAllow;
  /** null＝不留底。 */
  draft: ProofDraftInput | null;
  restoreDraft: (draft: Pick<DraftBackup, 'title' | 'body'>) => 'restored' | 'same' | 'not-ready';
  cancelEdit: () => void;
  onEndEdit: ((notice?: string) => void) | undefined;
}): DraftBackupState {
  const enabled = draft !== null;
  const inputRef = useRef(draft);
  inputRef.current = draft;
  const baseHashRef = useRef(draft?.baseHash);
  baseHashRef.current = draft?.baseHash;
  const jobRef = useRef(job);
  jobRef.current = job;
  const allowRef = useRef(allow);
  allowRef.current = allow;
  const callbacks = useRef({ restoreDraft, cancelEdit, onEndEdit });
  callbacks.current = { restoreDraft, cancelEdit, onEndEdit };

  const storageRef = useRef<{ storage: DraftStorage | null; writable: boolean } | null>(null);
  const opened = (): { storage: DraftStorage | null; writable: boolean } => {
    storageRef.current ??= browserDraftStorage();
    return storageRef.current;
  };
  const store = (): DraftStorage | null => opened().storage;
  const sessionRef = useRef<WriteSession | null>(null);

  const [offer, setOffer] = useState<{ backup: DraftBackup; changedSince: boolean } | null>(null);
  const [restored, setRestored] = useState<{ savedAt: number } | null>(null);
  const [pending, setPending] = useState<{ backup: DraftBackup; entered: boolean; auto: boolean } | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  /** 這次打字使用者打過字（填回不算）。 */
  const [typed, setTyped] = useState(false);
  /** 「捨棄」問恢復的那份之後再看下一份。 */
  const [recheck, setRecheck] = useState(0);
  const warnUnavailable = (): void => {
    if (warnedUnavailable) return;
    warnedUnavailable = true;
    setUnavailable(true);
  };

  // 換篇：上一篇的提示與等著填回的不帶過來（留底本身照留）。
  const [shownUuid, setShownUuid] = useState(job.uuid);
  if (shownUuid !== job.uuid) {
    setShownUuid(job.uuid);
    setOffer(null);
    setRestored(null);
    setPending(null);
  }

  // --- 寫 ---
  useEffect(() => {
    if (!enabled || !isEditing) return;
    const doc = frameRef.current?.contentDocument;
    const body = doc?.querySelector<HTMLElement>('.preview-body');
    if (!doc || !body) return;
    const title = doc.querySelector<HTMLElement>('.preview-title');
    const { storage, writable } = opened();
    if (!writable) warnUnavailable();
    setTyped(false);
    const session: WriteSession = {
      uuid: job.uuid,
      id: newDraftId(Date.now()),
      base: baseHashRef.current ?? null,
      suppressed: false,
      dirty: false,
      lastWritten: null,
      throttle: null,
      read: () => ({ title: title?.textContent ?? null, body: body.innerHTML }),
      write: () => {
        if (session.suppressed) return;
        session.dirty = false;
        const next: DraftBackup = { v: 2, uuid: session.uuid, id: session.id, ...session.read(), savedAt: Date.now(), baseHash: session.base };
        if (writeDraft(storage, next)) session.lastWritten = next;
        else warnUnavailable();
      },
      afterFill: () => {
        observer.takeRecords();
        throttle.cancel();
        session.write();
      },
    };
    const throttle = createThrottle(() => session.write(), DRAFT_WRITE_WAIT_MS);
    session.throttle = throttle;
    sessionRef.current = session;
    const changed = (): void => {
      if (session.suppressed) return;
      session.dirty = true;
      setTyped(true);
      throttle.call();
    };
    const observer = new MutationObserver(changed);
    const watch = { subtree: true, childList: true, characterData: true };
    observer.observe(body, watch);
    if (title) observer.observe(title, watch);
    const flush = (): void => {
      if (observer.takeRecords().length > 0 && !session.suppressed) session.dirty = true;
      if (!session.dirty || session.suppressed) return;
      throttle.cancel();
      session.write();
    };
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flush);
      // 離開打字模式但沒作廢（換篇、回總覽、版本被換掉）：還沒寫的立刻寫（基準是這次打字自己的，不是之後的版本）。
      flush();
      observer.disconnect();
      throttle.cancel();
      if (sessionRef.current === session) sessionRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, isEditing, loadCount, job.uuid]);

  // --- 打字中先存了一版：基準換成新的再寫一次；「已恢復、還沒儲存」也不再成立 ---
  const lastBase = useRef(draft?.baseHash);
  useEffect(() => {
    if (lastBase.current === draft?.baseHash) return;
    lastBase.current = draft?.baseHash;
    const session = sessionRef.current;
    if (!isEditing || session === null || session.suppressed) return;
    session.base = draft?.baseHash ?? null;
    setRestored(null);
    if (session.lastWritten !== null) {
      session.throttle?.cancel();
      session.write();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.baseHash]);

  // --- 讀：iframe 載入的是目前這一版、不在打字模式 ---
  useEffect(() => {
    if (!pruned) {
      pruned = true;
      pruneDrafts(store(), Date.now());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const checked = useRef<string | null>(null);
  const ready = draftCheckReady({ enabled, isEditing, holding: hold !== null, hasRevision, loadedKey, revisionKey });
  useEffect(() => {
    if (!ready) return;
    const current = jobRef.current;
    const key = `${current.uuid}|${revisionKey}|${loadCount}|${recheck}`;
    if (checked.current === key) return;
    checked.current = key;
    const storage = store();
    const doc = frameRef.current?.contentDocument ?? null;
    const now = Date.now();
    const { drop, pick } = pickDraftPlan(readDrafts(storage, current.uuid), (backup) =>
      planDraftRestore({
        draft: backup,
        now,
        state: current.state,
        currentHash: current.currentRevision?.contentHash,
        canEdit: inputRef.current?.canEdit ?? false,
        differs: () =>
          doc === null
            ? true
            : draftDiffersFromShown({
                doc,
                draft: backup,
                allow: allowRef.current,
                savedTitle: readString(current.currentRevision?.templateData ?? null, 'title', current.title ?? ''),
                diary: current.target.contentType === 'diary',
                titleMaxLength: current.template.titleMaxLength,
              }),
      }),
    );
    for (const stale of drop) removeDraftIfSame(storage, stale);
    if (pick === null) {
      setOffer(null);
      return;
    }
    if (pick.plan.kind === 'auto') {
      setOffer(null);
      setPending({ backup: pick.draft, entered: true, auto: true });
      inputRef.current?.onStartEdit();
      return;
    }
    setOffer({ backup: pick.draft, changedSince: pick.plan.changedSince });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, loadCount, revisionKey, recheck, job.uuid]);

  // --- 填回：進了打字模式、原文記下之後 ---
  useEffect(() => {
    if (!isEditing || pending === null) return;
    const result = callbacks.current.restoreDraft(pending.backup);
    // 校樣還沒載好、原文還沒記下：等下一次載入。
    if (result === 'not-ready') return;
    setPending(null);
    setOffer(null);
    if (result === 'same') {
      removeDraftIfSame(store(), pending.backup);
      if (pending.entered) {
        discardSession();
        callbacks.current.onEndEdit?.(pending.auto ? undefined : DRAFT_SAME_NOTE);
      } else {
        setRecheck((n) => n + 1);
      }
      return;
    }
    // 這次打字接手那份留底的鍵：之後的變動寫回同一份，不另外多一份。
    const session = sessionRef.current;
    if (session !== null && session.uuid === pending.backup.uuid) {
      session.id = pending.backup.id;
      session.afterFill();
    }
    setRestored({ savedAt: pending.backup.savedAt });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditing, loadCount, pending]);

  // --- 離開打字模式：「已恢復」「沒辦法留底」收起來 ---
  useEffect(() => {
    if (isEditing) return;
    setRestored(null);
    setUnavailable(false);
    setTyped(false);
  }, [isEditing]);

  const discardSession = (): void => {
    const session = sessionRef.current;
    if (session === null) return;
    session.suppressed = true;
    session.throttle?.cancel();
    // 只刪自己最後寫的那份（別的分頁寫過就留著）。
    if (session.lastWritten !== null) removeDraftIfSame(store(), session.lastWritten);
  };

  const beginSave = (): DraftSaveToken | null => {
    const session = sessionRef.current;
    if (session === null) return null;
    return { uuid: session.uuid, id: session.id, sent: session.read() };
  };

  const finishSave = (token: DraftSaveToken, savedHash: string): void => {
    const storage = store();
    const session = sessionRef.current;
    if (session !== null && session.uuid === token.uuid && session.id === token.id && !session.suppressed) {
      if (afterSaveDraft({ sent: token.sent, now: session.read() }) === 'remove') {
        session.suppressed = true;
        session.throttle?.cancel();
        if (session.lastWritten !== null) removeDraftIfSame(storage, session.lastWritten);
      } else {
        // 送出之後又打了字：留著，基準換成存好的那一版（重載後照恢復規則找回來）。
        session.base = savedHash;
        session.throttle?.cancel();
        session.write();
      }
      return;
    }
    // 已經換篇（session 收掉時已經把最後的字寫進去了）：照儲存區那份比。
    const stored = readDraft(storage, token.uuid, token.id);
    if (stored === null) return;
    if (afterSaveDraft({ sent: token.sent, now: { title: stored.title, body: stored.body } }) === 'remove') removeDraftIfSame(storage, stored);
    else writeDraft(storage, { ...stored, baseHash: savedHash });
  };

  const allowed = restoreAllowed({
    isEditing,
    canEdit: draft?.canEdit === true,
    typedThisSession: typed,
    blockedNote: draft?.blockedNote ?? '',
  });

  const restore = (): void => {
    if (offer === null || !allowed.allowed) return;
    if (isEditing) {
      setPending({ backup: offer.backup, entered: false, auto: false });
      return;
    }
    setPending({ backup: offer.backup, entered: true, auto: false });
    inputRef.current?.onStartEdit();
  };

  const discard = (): void => {
    if (restored !== null && isEditing) {
      setRestored(null);
      callbacks.current.cancelEdit();
      return;
    }
    if (offer === null) return;
    // 儲存區裡還是問的那一份才刪（之後被寫過就留著）。
    removeDraftIfSame(store(), offer.backup);
    setOffer(null);
    setRecheck((n) => n + 1);
  };

  const notice: DraftNotice | null =
    restored !== null && isEditing
      ? { kind: 'restored', savedAt: restored.savedAt }
      : offer !== null && pending === null
        ? { kind: 'offer', changedSince: offer.changedSince, savedAt: offer.backup.savedAt }
        : null;

  return {
    notice,
    unavailable: unavailable && isEditing,
    canRestore: allowed.allowed,
    restoreBlockedNote: allowed.reason,
    restore,
    discard,
    discardSession,
    beginSave,
    finishSave,
  };
}
