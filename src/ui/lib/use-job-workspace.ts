import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { api, describeError } from '../service/client.js';
import type { FactCheckListResponse, JobDetail } from '../service/types.js';
import { isWorkspaceBusy } from './factcheck-view.js';
import { editBlockedByRun, nextSaveBase, syncPending } from './check-while-writing.js';
import {
  beginRefresh,
  createJobBinder,
  refreshStillCurrent,
  selectionImageContentHash,
  stillOnJob,
} from './selection-image-view.js';
import { createRefreshScheduler, type ReadResult, type RefreshScheduler } from './refresh-scheduler.js';
import type { SyncOutcome } from './slug-save-store.js';
import { editBlockedNote } from './workspace-view.js';

/**
 * 工作區的「讀稿件與同步」（P5-T045 從 `components/Workspace.tsx` 原樣搬出，行為不變）：
 * 讀稿件與查證結果、世代與篇別守衛、重讀排程與輪詢、待同步重試、`onThisJob` 綁定、打字中存檔的基準。
 *
 * 只有一個資料來源：`GET /api/jobs/:uuid`。每個動作做完就重新抓一次，
 * 不在前端自己推算狀態——狀態機與核准失效都是後端的權責，前端猜錯會很危險。
 *
 * App 換篇時沿用同一個 Workspace（沒有 key）：這裡所有非同步的結果都綁住發起的那一篇，換篇後回來的一律不寫進畫面。
 *
 * effect 的順序跟搬出來之前一樣（呼叫端在這個 hook 之前只有 `useConfirm` 與 `forgetOtherSlugSuggests` 的 effect）：
 * 掛載旗標 → 換篇時丟掉排程 → 換篇時清畫面（世代先 +1）→ 第一次讀 → 查證中輪詢 → 待同步輪詢。
 * 「世代 +1」一定要在「第一次讀」之前，否則新篇第一次載入的回應會被當成過期丟掉。
 */
export interface JobWorkspace {
  job: JobDetail | null;
  error: string | null;
  setError: Dispatch<SetStateAction<string | null>>;
  /** 這篇的查證結果（`GET …/factchecks`，D-034）。讀不到（舊後端）就是 null，右欄照樣只有校稿。 */
  factChecks: FactCheckListResponse | null;
  /** 元件還在（沒卸載）。 */
  isAlive: () => boolean;
  /** 非同步回來時畫面還在不在發起的那一篇（元件還在、而且還是那一篇）。 */
  isOnJob: (origin: string) => boolean;
  /** 重讀這一篇，回傳有沒有真的把新資料寫進畫面（`applied`／`failed`／`gone`）。 */
  syncJob: () => Promise<SyncOutcome>;
  /** 大部分呼叫處不需要結果。所有 `refresh(` 呼叫處（含子元件）都經過排程。 */
  refresh: () => Promise<void>;
  /** 把會改工作區畫面的回呼綁住現在這一篇；同一篇、同一個回呼拿到的包裝身分不變。 */
  onThisJob: <A extends unknown[]>(fn: (...args: A) => void) => (...args: A) => void;
  /** 有東西在跑（發布中、Agent 在跑、查證剛送出）：輪詢中。 */
  working: boolean;
  /** 待同步（P5-T040 #1）：打字中存成功之後還沒有一次成功的重讀。 */
  pendingSync: boolean;
  /** 進打字模式要不要擋（AI 在跑或待同步），與擋住時講的那一句。 */
  editBlocked: boolean;
  editBlockedNote: string;
  /** 畫面知道的目前版本：打字中是最後存成功的那一版，否則工作區的版本。 */
  knownHash: string | undefined;
  /** 打字中存成功了：記下那一版，並記下當下已送出的最新重讀序號（待同步）。 */
  rememberSaved: (hash: string) => void;
  /** 離開打字模式：打字中存過的那一版不再當基準。 */
  forgetSaved: () => void;
  /** 存檔基準：打字中存過就用最後一次存成功的那一版，否則用呼叫端給的工作區版本。呼叫當下才讀。 */
  saveBase: (jobHash: string | undefined) => string | undefined;
}

export function useJobWorkspace({
  uuid,
  editing,
  factCheckSending,
  onSwitchJob,
}: {
  uuid: string;
  /** 正在打字模式（Workspace 的 `editing !== null`）。 */
  editing: boolean;
  /** 按了查證、請求剛送出但 agentRun 還沒出現在稿件上（這一篇）。 */
  factCheckSending: boolean;
  /** 換一篇稿件時，呼叫端把自己的畫面狀態清掉（跟這裡的清除在同一個 effect 裡做）。 */
  onSwitchJob: () => void;
}): JobWorkspace {
  const [job, setJob] = useState<JobDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 這篇的查證結果（`GET …/factchecks`，D-034）。讀不到（舊後端）就是 null，右欄照樣只有校稿。 */
  const [factChecks, setFactChecks] = useState<FactCheckListResponse | null>(null);
  /** 目前是哪一篇。查證完成的後續（重讀、報錯、亮卡片）只在還是發起那一篇時才做。 */
  const uuidRef = useRef(uuid);
  uuidRef.current = uuid;
  const onSwitchJobRef = useRef(onSwitchJob);
  onSwitchJobRef.current = onSwitchJob;
  const alive = useRef(true);
  /**
   * 重新讀取的世代編號。
   *
   * 校樣載入、輪詢、手動重讀、每個動作做完的重讀會同時在路上，回應的順序不保證
   * 跟送出的順序一樣。只有最新一次送出的回應可以寫進畫面，否則最後才回來的舊快照
   * 會把畫面倒退回去。
   */
  const generation = useRef(0);
  /** 最近一次成功的重讀是第幾個（`generation` 的序號）；待同步用（P5-T040 #1）。 */
  const [okSeq, setOkSeq] = useState(0);
  /** 打字中最後一次存成功時，已經送出的最新重讀序號；null＝這篇還沒在打字中存過（P5-T040 #1）。 */
  const [savedAt, setSavedAt] = useState<number | null>(null);
  /**
   * 這次打字中最後一次存成功的 hash（D-036）；離開打字模式或換篇就清掉。
   * ref 給非同步的回呼讀，state 給 render 算「畫面知道的目前版本」（PR #28 Codex P2：只寫 ref 不會重新 render）。
   */
  const lastSavedHash = useRef<string | null>(null);
  const [lastSaved, setLastSaved] = useState<string | null>(null);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /**
   * 讀一次某一篇、寫進畫面（只在還是那一篇、而且是最新一次送出的時候寫）。只由重讀排程呼叫，一次只有一個在飛。
   * 發請求之前先確認元件還在、還在那一篇（PR #28 第四輪 Codex P2：卸載後不再發請求）。
   */
  const readJob = useCallback(async (origin: string): Promise<ReadResult> => {
    if (!stillOnJob({ alive: alive.current, current: uuidRef.current, origin })) return 'failed';
    // 結果綁住發起的那一篇（第二輪審查）：換篇後舊篇的重讀剛好是最後送出的那一個時，只看世代會把舊篇寫進新篇的畫面。
    // 舊篇的重讀在**推進世代之前**就返回（第三輪審查）：推進了，新篇第一次載入的回應會被當成過期丟掉。
    const mine = beginRefresh({ generation: generation.current, current: uuidRef.current, origin });
    if (mine === null) return 'failed';
    generation.current = mine;
    const isCurrent = (): boolean =>
      refreshStillCurrent({ alive: alive.current, mine, latest: generation.current, current: uuidRef.current, origin });
    try {
      // 查證結果另一條路讀（GET …/factchecks）；讀不到不擋整個工作區，留著上一次的。
      const [next, checks] = await Promise.all([api.getJob(origin), api.listFactChecks(origin).catch(() => undefined)]);
      if (isCurrent()) {
        setJob(next);
        // 待同步（P5-T040 #1）看的是「哪一個序號的重讀成功了」，不比 hash。
        setOkSeq(mine);
        if (checks !== undefined) setFactChecks(checks);
        setError(null);
        return 'applied';
      }
    } catch (cause) {
      if (isCurrent()) setError(describeError(cause));
    }
    return 'failed';
  }, []);

  /**
   * 這一篇的重讀排程（`lib/refresh-scheduler.ts`，PR #28 第四輪 Codex P2）：手動重讀、動作做完的重讀、查證中的輪詢、
   * 待同步的重試、存網址後的重讀全部走它，同時最多一個在飛、上一個結束才排下一個。
   * 用到才建（StrictMode 的 effect 會先清再建）；換篇或卸載時 dispose：在飛與等著的立刻以 gone 收尾。
   */
  const schedulerRef = useRef<{ uuid: string; scheduler: RefreshScheduler } | null>(null);
  const schedulerFor = useCallback(
    (origin: string): RefreshScheduler | null => {
      if (!stillOnJob({ alive: alive.current, current: uuidRef.current, origin })) return null;
      const held = schedulerRef.current;
      if (held !== null && held.uuid === origin) return held.scheduler;
      held?.scheduler.dispose();
      const scheduler = createRefreshScheduler(() => readJob(origin));
      schedulerRef.current = { uuid: origin, scheduler };
      return scheduler;
    },
    [readJob],
  );
  useEffect(
    () => () => {
      schedulerRef.current?.scheduler.dispose();
      schedulerRef.current = null;
    },
    [uuid],
  );

  /**
   * 重讀這一篇，回傳有沒有真的把新資料寫進畫面（PR #28 第三輪 Codex P2）：存網址要等 `applied` 才算存好；
   * `failed`＝讀失敗；`gone`＝已經不在這一篇（換篇、元件卸載），不會再套用。綁住呼叫時的那一篇。
   */
  const syncJob = useCallback(async (): Promise<SyncOutcome> => {
    const scheduler = schedulerFor(uuid);
    return scheduler === null ? 'gone' : scheduler.request();
  }, [uuid, schedulerFor]);
  /** 大部分呼叫處不需要結果。所有 `refresh(` 呼叫處（含子元件）都經過排程。 */
  const refresh = useCallback(async (): Promise<void> => {
    await syncJob();
  }, [syncJob]);

  /**
   * 把會改工作區畫面的回呼綁住現在這一篇（第三輪審查）：子元件的非同步動作（AgentButton 的錯誤、恢復這篇的錯誤…）
   * 回來時已經換到別篇，就不動畫面。同一篇內身分不變（第四輪審查）：子元件把它放進 effect 依賴時，
   * 每次 render 換新的會讓 effect 每次重跑、把錯誤清掉（AgentButton 的 `onError`）。
   */
  const binder = useRef(createJobBinder((origin) => stillOnJob({ alive: alive.current, current: uuidRef.current, origin })));
  const onThisJob = <A extends unknown[]>(fn: (...args: A) => void): ((...args: A) => void) => binder.current(uuid, fn);

  // 換一篇稿件就把上一篇的畫面丟掉，不要讓舊資料留在畫面上。
  useEffect(() => {
    generation.current += 1;
    setJob(null);
    setError(null);
    setFactChecks(null);
    // 呼叫端的畫面狀態（段落、校樣 hash、亮著的卡片、抽屜、打字模式、對照…）。
    onSwitchJobRef.current();
    // 打字中存過的那一版、待同步是上一篇的：不帶到這一篇（P5-T040 #1）。
    lastSavedHash.current = null;
    setLastSaved(null);
    setSavedAt(null);
  }, [uuid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 有東西在跑的時候才輪詢。閒著的時候不打擾後端。
  // 查證剛送出、還沒讀到 running 的 agentRun 也算（第一次重讀失敗時輪詢照樣在跑，進度與停止才會出來）。
  const working = isWorkspaceBusy({
    working: job?.state === 'PUBLISHING' || job?.agentRun?.status === 'running',
    factCheckSending,
  });
  /**
   * 進打字模式要不要擋：發布中、或查證以外的 Agent 動作在跑（D-036：查證不改文章，跑的時候照樣可以寫、可以存）。
   * 「改原文」、卡片的自己改／去原文改共用這一個條件。
   */
  const runBlocked = editBlockedByRun({ publishing: job?.state === 'PUBLISHING', agentRun: job?.agentRun });
  /**
   * 待同步（P5-T040 #1）：打字中存成功之後還沒有一次成功的重讀，工作區快照可能比伺服器舊，
   * 這時再進打字模式存檔基準會是舊的 → 409。所有進打字模式的入口先擋，同時一直重讀到成功為止。
   */
  const pendingSync = syncPending({ editing, savedAt, okSeq });
  const editBlocked = runBlocked || pendingSync;
  const blockedNote = editBlockedNote({ runBlocked, pendingSync });
  // 輪詢交給同一個重讀排程（PR #28 第四輪 Codex P2）：查證在跑（1.5 秒）、待同步（3 秒）各登記一個需求，
  // 一次只跑一個、上一次結束才排下一次；`working`／`pendingSync` 都是照最新一次套用成功的資料算的，
  // 查證跑完、同步好了，需求拿掉就停。
  useEffect(() => {
    schedulerFor(uuid)?.setNeed('working', working ? 1500 : null);
  }, [working, uuid, schedulerFor]);
  useEffect(() => {
    schedulerFor(uuid)?.setNeed('pendingSync', pendingSync ? 3000 : null);
  }, [pendingSync, uuid, schedulerFor]);

  const rememberSaved = useCallback((hash: string) => {
    lastSavedHash.current = hash;
    setLastSaved(hash);
    // 存好那一刻已經送出的最新重讀序號：之後要有序號比它大的重讀成功，才算讀到存好的那一版（待同步，P5-T040 #1）。
    setSavedAt(generation.current);
  }, []);
  const forgetSaved = useCallback(() => {
    lastSavedHash.current = null;
    setLastSaved(null);
  }, []);
  const saveBase = useCallback(
    // 打字中自動存過的：基準用最後一次存成功的 hash（存好之後的重讀可能失敗，工作區快照還是舊的，Codex P1）。
    (jobHash: string | undefined): string | undefined => nextSaveBase(lastSavedHash.current, jobHash),
    [],
  );
  const jobHash = job?.currentRevision?.contentHash;
  /** 畫面知道的目前版本：打字中是最後存成功的那一版，否則工作區的版本。render 時算，傳給子元件的值與送出的請求用同一個。 */
  const knownHash = selectionImageContentHash({ editing, lastSaved, jobHash });

  const isAlive = useCallback(() => alive.current, []);
  const isOnJob = useCallback(
    (origin: string): boolean => stillOnJob({ alive: alive.current, current: uuidRef.current, origin }),
    [],
  );

  return {
    job,
    error,
    setError,
    factChecks,
    isAlive,
    isOnJob,
    syncJob,
    refresh,
    onThisJob,
    working,
    pendingSync,
    editBlocked,
    editBlockedNote: blockedNote,
    knownHash,
    rememberSaved,
    forgetSaved,
    saveBase,
  };
}
