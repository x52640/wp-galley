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
  pruneDrafts,
  readDraft,
  readDrafts,
  removeAncestors,
  removeDraftIfSame,
  restoreAllowed,
  restoredLineage,
  dismissOnDiscard,
  markDismissed,
  planDraftLoad,
  readDismissed,
  writeDraft,
  type DraftBackup,
  type DraftNotice,
  type DraftOrigin,
  type DraftStorage,
} from './draft-backup.js';
import { draftContentKey, draftDiffersFromShown } from './draft-backup-dom.js';

/**
 * 打字模式沒存的內容自動留底（D-047，P5-T048）：接 iframe 與 React。規則在 `draft-backup.ts`。
 * 原則：任何順序都不能讓使用者打的字不見。
 *
 * - **寫**：每一次進打字模式是一個 session、自己一個鍵，**使用者真的打了字才寫**（填回造成的變動不算）。恢復一份留底時
 *   不接手別人的鍵：打了字才寫進自己的新鍵，並記下來源鏈 `from`（Codex 第一、二輪）。聽正文與標題的任何變動
 *   （MutationObserver），節流寫進瀏覽器儲存區；分頁被藏起來（`visibilitychange`→hidden）、關掉（`pagehide`）、
 *   離開打字模式但沒作廢（換篇、回總覽、版本被換掉）時立刻寫。基準是這次打字開始時的版本，**只有本次編輯自己的存檔成功回呼**
 *   （`rebase`、`finishSave`）才換；輪詢讀到別處存的新版本不換（Codex 第一輪 1）。
 * - **刪**：只刪儲存區裡**還是自己最後寫的那份**（別的分頁可能寫過）。取消、捨棄（`discardSession`）只刪自己的鍵；
 *   恢復了來源但還沒打字就捨棄，不刪來源，記一個「已捨棄」標記（Codex 第二輪）。存檔成功（`beginSave`／`finishSave`）且
 *   送出之後沒再打字：刪自己的鍵，連來源鏈裡寫下時間沒變的一起刪（那份內容已經改好存進去了）。
 * - **恢復**：iframe 確定載入的是目前這一版、不在打字模式時才看（`draftCheckReady`）。整篇怎麼處理在 `planDraftLoad`：
 *   讀取時唯一自動刪別人的情況是內容完全相同（跟另一份、或跟目前存好的）；其餘隱藏不刪（已捨棄、被副本遮住的來源），
 *   新的先一次一份：基準相同→請工作區進打字模式、填回；基準不同→只問。打字中這次已經打了字，就不准再「恢復」另一份。
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
  /** 這次打字的來源鏈（送出那一刻的）。 */
  readonly from: readonly DraftOrigin[];
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
  /** 打字中先存了一版（留在打字模式）成功：基準換成存好的那一版。 */
  rebase: (token: DraftSaveToken, savedHash: string) => void;
}

interface WriteSession {
  readonly uuid: string;
  readonly id: string;
  base: string | null;
  /** 這次打字是從哪幾份留底恢復來的（沒恢復是空的）。 */
  from: DraftOrigin[];
  /** 使用者這次真的打過字（填回不算）。 */
  typed: boolean;
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
      // 基準：進打字模式那一刻的版本。之後只有本次編輯自己的存檔成功才換（rebase／finishSave）。
      base: baseHashRef.current ?? null,
      from: [],
      typed: false,
      suppressed: false,
      dirty: false,
      lastWritten: null,
      throttle: null,
      read: () => ({ title: title?.textContent ?? null, body: body.innerHTML }),
      write: () => {
        if (session.suppressed) return;
        session.dirty = false;
        const next: DraftBackup = {
          v: 2,
          uuid: session.uuid,
          id: session.id,
          ...session.read(),
          savedAt: Date.now(),
          baseHash: session.base,
          from: session.from,
        };
        if (writeDraft(storage, next)) session.lastWritten = next;
        else warnUnavailable();
      },
      afterFill: () => {
        // 填回不算打字、也不寫：使用者打了字才寫進自己的新鍵（連續重新整理不累積副本，Codex 第二輪）。
        observer.takeRecords();
      },
    };
    const throttle = createThrottle(() => session.write(), DRAFT_WRITE_WAIT_MS);
    session.throttle = throttle;
    sessionRef.current = session;
    const changed = (): void => {
      if (session.suppressed) return;
      session.dirty = true;
      session.typed = true;
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
    const savedTitle = readString(current.currentRevision?.templateData ?? null, 'title', current.title ?? '');
    const { remove, pick } = planDraftLoad({
      drafts: readDrafts(storage, current.uuid),
      dismissed: readDismissed(storage, current.uuid),
      now: Date.now(),
      state: current.state,
      currentHash: current.currentRevision?.contentHash,
      canEdit: inputRef.current?.canEdit ?? false,
      differs: (backup) =>
        doc === null
          ? true
          : draftDiffersFromShown({
              doc,
              draft: backup,
              allow: allowRef.current,
              savedTitle,
              diary: current.target.contentType === 'diary',
              titleMaxLength: current.template.titleMaxLength,
            }),
      // 讀不到校樣就每份都當成不同（不刪）。
      contentKey: (backup) => (doc === null ? `${backup.id}` : draftContentKey({ doc, draft: backup, allow: allowRef.current })),
    });
    // 只刪內容完全相同（或過期、稿件已發布／被取代）的；還是要確認儲存區那份沒被改寫過。
    for (const stale of remove) removeDraftIfSame(storage, stale);
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
      // 跟目前存好的完全相同：只刪這一份（不少任何字）；它的來源不一定相同，不動。
      removeDraftIfSame(store(), pending.backup);
      if (pending.entered) {
        discardSession();
        callbacks.current.onEndEdit?.(pending.auto ? undefined : DRAFT_SAME_NOTE);
      } else {
        setRecheck((n) => n + 1);
      }
      return;
    }
    // 不接手那份的鍵（別的分頁可能還在寫它）：記下來源鏈，使用者打了字才寫進這次打字自己的鍵。
    // 原來那份只在這次存檔成功、送出之後沒再打字時刪（寫下時間要沒變）；捨棄不刪。
    const session = sessionRef.current;
    if (session !== null && session.uuid === pending.backup.uuid) {
      session.from = restoredLineage(pending.backup);
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
    // 只刪自己最後寫的那份（別的分頁寫過就留著）；不刪來源（Codex 第二輪）。
    if (session.lastWritten !== null) removeDraftIfSame(store(), session.lastWritten);
    // 恢復了來源但還沒打字就捨棄：記「已捨棄」標記，那份（這個寫下時間的）之後不再提示。
    const dismissed = dismissOnDiscard({ wrote: session.typed, from: session.from });
    if (dismissed !== null) markDismissed(store(), session.uuid, dismissed, Date.now());
  };

  const beginSave = (): DraftSaveToken | null => {
    const session = sessionRef.current;
    if (session === null) return null;
    return { uuid: session.uuid, id: session.id, sent: session.read(), from: [...session.from] };
  };

  const finishSave = (token: DraftSaveToken, savedHash: string): void => {
    const storage = store();
    const session = sessionRef.current;
    if (session !== null && session.uuid === token.uuid && session.id === token.id && !session.suppressed) {
      if (afterSaveDraft({ sent: token.sent, now: session.read() }) === 'remove') {
        session.suppressed = true;
        session.throttle?.cancel();
        if (session.lastWritten !== null) removeDraftIfSame(storage, session.lastWritten);
        removeAncestors(storage, session.uuid, session.from);
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
    if (stored === null) {
      // 這次沒寫過（恢復了沒打字就存）：存進去的就是來源的內容，來源鏈照規則刪。
      removeAncestors(storage, token.uuid, token.from);
      return;
    }
    if (afterSaveDraft({ sent: token.sent, now: { title: stored.title, body: stored.body } }) === 'remove') {
      removeDraftIfSame(storage, stored);
      removeAncestors(storage, stored.uuid, stored.from);
    } else writeDraft(storage, { ...stored, baseHash: savedHash });
  };

  const rebase = (token: DraftSaveToken, savedHash: string): void => {
    const session = sessionRef.current;
    if (session !== null && session.uuid === token.uuid && session.id === token.id && !session.suppressed) {
      session.base = savedHash;
      setRestored(null);
      if (session.lastWritten !== null) {
        session.throttle?.cancel();
        session.write();
      }
      return;
    }
    const storage = store();
    const stored = readDraft(storage, token.uuid, token.id);
    if (stored !== null) writeDraft(storage, { ...stored, baseHash: savedHash });
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
    // 不刪（可能是別的分頁正在寫的）：記「已捨棄」標記，這個寫下時間的那份不再提示；之後被再寫過照常提示。
    markDismissed(store(), offer.backup.uuid, { id: offer.backup.id, savedAt: offer.backup.savedAt }, Date.now());
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
    rebase,
  };
}
