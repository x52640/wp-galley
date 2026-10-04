import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { api, describeError } from '../service/client.js';
import {
  isLoaded,
  type AgentProvider,
  type FactCheckFinding,
  type FactCheckListResponse,
  type FactCheckRequest,
  type JobDetail,
  type ReviewItem,
} from '../service/types.js';
import { Icon } from '../icons.js';
import { STATE_LABEL, isFinished, isTerminal } from '../lib/steps.js';
import { highlightText, kindOf } from '../lib/review-kinds.js';
import { canInsertImages, canSelectToFactCheck, stageDisplay, type StageView } from '../lib/stage-view.js';
import { factCheckBlockedReason, hostedSearchNote, isNewCancelledRun, isOpenFinding, isWorkspaceBusy } from '../lib/factcheck-view.js';
import {
  afterStaySave,
  dropStaleFactCheck,
  editBlockedByRun,
  nextSaveBase,
  selectionCheckBlockedReason,
} from '../lib/check-while-writing.js';
import { loadProvider, saveProvider } from '../lib/agent-tasks.js';
import { AgentBanner } from './AgentProgress.js';
import { AgentButton } from './AgentButton.js';
import { useConfirm } from './ConfirmDialog.js';
import { CompareView } from './CompareView.js';
import { typeLabel } from './JobList.js';
import { InsertImagePanel } from './InsertImagePanel.js';
import { ProofView, type ProofEditRequest, type ProofHighlight } from './ProofView.js';
import { Sheet } from './Sheet.js';
import { SuggestionColumn, findingKey, reviewKey } from './SuggestionColumn.js';
import { MediaPanel, useImageGenerationStatus } from './panels/MediaPanel.js';
import { selectionImageBlockedReason, selectionImageContentHash } from '../lib/selection-image-view.js';
import { PublishSheet } from './PublishSheet.js';
import { SourcePanel } from './panels/SourcePanel.js';
import { forgetOtherSlugSuggests } from '../lib/slug-suggest-store.js';

/**
 * 工作區（B1，決策 D-013）：文章在中間，建議標在字上，右邊的卡片一對一對應。
 *
 * 上方只有兩件事：請 AI 看一遍、發布。其他動作都跟著內容走——
 * 要改字就在卡片上按、要自己改就直接在文章上打字（P5-T010），要比對就按校樣工具列上的
 * 「對照上一版」，不必去找「現在是第幾步」。
 *
 * 沒有「成品」這個檢視可以選（D-018）：乾淨的成品只在發布面板打開時出現，見 lib/stage-view.ts。
 *
 * 只有一個資料來源：`GET /api/jobs/:uuid`。每個動作做完就重新抓一次，
 * 不在前端自己推算狀態——狀態機與核准失效都是後端的權責，前端猜錯會很危險。
 *
 * 介面上一律叫「稿件」；程式裡叫 job（型別、API、網址都是），兩者刻意不同名。
 */

type SheetKey = 'source' | 'publish' | null;

export function Workspace({
  uuid,
  onBack,
  startEditing = false,
  onStartedEditing,
}: {
  uuid: string;
  onBack: () => void;
  /** 剛從新稿件畫面建好（D-030，P5-T029）：一打開就進打字模式，游標在內文開頭。 */
  startEditing?: boolean;
  /** 已經進了打字模式：上層把旗標清掉，之後重新讀取不會再進一次。 */
  onStartedEditing?: () => void;
}): JSX.Element {
  const [job, setJob] = useState<JobDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [blocks, setBlocks] = useState<{ index: number; text: string }[]>([]);
  // 校樣回應的 ETag：使用者眼前那一份的 hash。null = 還沒問到或問不到。
  const [previewHash, setPreviewHash] = useState<string | null>(null);
  /** 文章或對照。成品不在這裡：它跟著發布面板走。 */
  const [view, setView] = useState<StageView>('article');
  /** 亮起來的那一張卡片（校樣上的標記與右欄卡片同步）：校稿 `r<id>`、查證 `f<id>`。 */
  const [activeKey, setActiveKey] = useState<string | null>(null);
  /** 這篇的查證結果（`GET …/factchecks`，D-034）。讀不到（舊後端）就是 null，右欄照樣只有校稿。 */
  const [factChecks, setFactChecks] = useState<FactCheckListResponse | null>(null);
  /** 按了查證、請求剛送出但 agentRun 還沒出現在稿件上：這段時間也不給再按。 */
  const [sendingUuid, setSendingUuid] = useState<string | null>(null);
  /**
   * 記的是「哪一篇」在送：App 換篇時沿用同一個 Workspace（沒有 key），A 的查證還在等的時候切到 B，
   * B 不能看起來也在送（Codex 審查 1）。
   */
  const factCheckSending = sendingUuid === uuid;
  /** 目前是哪一篇。查證完成的後續（重讀、報錯、亮卡片）只在還是發起那一篇時才做。 */
  const uuidRef = useRef(uuid);
  uuidRef.current = uuid;
  /**
   * 交給哪一家（記在 localStorage）。放在工作區而不是 AgentButton 裡：三個查證入口與它們旁邊的
   * Antigravity 說明都要跟著選單上換的那一家走。
   */
  const [provider, setProviderState] = useState<AgentProvider>(loadProvider);
  const setProvider = useCallback((next: AgentProvider) => {
    setProviderState(next);
    saveProvider(next);
  }, []);
  /** 最近一次查證的 id（送出前記下來，分得出「這次被停止」與「這次在開紀錄之前就失敗」）。 */
  const latestRunId = useRef<number | null>(null);
  latestRunId.current = factChecks?.latestRun?.id ?? null;
  /** 要框起來的段落。建議定位不到字（例如要自己改的那種）時，至少框出那一段。 */
  const [focusBlock, setFocusBlock] = useState<number | null>(null);
  /** 每點一次卡片加一：同一張卡片再點一次，對照也要再展開、再捲過去（D-019）。 */
  const [focusSeq, setFocusSeq] = useState(0);
  const [sheet, setSheet] = useState<SheetKey>(null);
  /**
   * 直接在文章上改。編輯中右欄與上方動作都鎖住：那些動作會產生新版本、讓校樣重載，
   * 打到一半的字就沒了。
   */
  const [editing, setEditing] = useState<ProofEditRequest | null>(null);
  const [editNotice, setEditNotice] = useState<string | null>(null);
  const [imagesOpen, setImagesOpen] = useState<boolean | null>(null);
  /** 剛在文章上「請 AI 配一張」建出來的配圖需求（P5-T018）：右欄捲到那張卡片。 */
  const [focusBriefId, setFocusBriefId] = useState<number | null>(null);
  /** 頂端長條上的「停止」按下之後，避免連按。 */
  const [cancelling, setCancelling] = useState(false);
  const confirm = useConfirm();
  const alive = useRef(true);
  /**
   * 重新讀取的世代編號。
   *
   * 校樣載入、輪詢、手動重讀、每個動作做完的重讀會同時在路上，回應的順序不保證
   * 跟送出的順序一樣。只有最新一次送出的回應可以寫進畫面，否則最後才回來的舊快照
   * 會把畫面倒退回去。
   */
  const generation = useRef(0);

  // 換到這一篇：別篇已經結束的「建議網址」結果丟掉（還在跑的留著，D-026）。
  useEffect(() => forgetOtherSlugSuggests(uuid), [uuid]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    const mine = ++generation.current;
    const isCurrent = (): boolean => alive.current && mine === generation.current;
    try {
      // 查證結果另一條路讀（GET …/factchecks）；讀不到不擋整個工作區，留著上一次的。
      const [next, checks] = await Promise.all([api.getJob(uuid), api.listFactChecks(uuid).catch(() => undefined)]);
      if (isCurrent()) {
        setJob(next);
        if (checks !== undefined) setFactChecks(checks);
        setError(null);
      }
    } catch (cause) {
      if (isCurrent()) setError(describeError(cause));
    }
  }, [uuid]);

  // 換一篇稿件就把上一篇的畫面丟掉，不要讓舊資料留在畫面上。
  useEffect(() => {
    generation.current += 1;
    setJob(null);
    setError(null);
    setBlocks([]);
    setPreviewHash(null);
    setActiveKey(null);
    setFactChecks(null);
    setFocusBlock(null);
    setSheet(null);
    setEditing(null);
    setEditNotice(null);
    setFocusBriefId(null);
    setView('article');
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
  const editBlocked = editBlockedByRun({ publishing: job?.state === 'PUBLISHING', agentRun: job?.agentRun });
  const editBlockedRef = useRef(editBlocked);
  editBlockedRef.current = editBlocked;
  useEffect(() => {
    if (!working) return;
    const timer = window.setInterval(() => void refresh(), 1500);
    return () => window.clearInterval(timer);
  }, [working, refresh]);

  // 後端在 GET /preview 時把 RENDERED 推進 PREVIEWED，所以看完校樣要重讀一次。
  const stateRef = useRef(job?.state);
  stateRef.current = job?.state;
  const onPreviewed = useCallback(() => {
    if (stateRef.current === 'RENDERED') void refresh();
  }, [refresh]);

  const onBlocks = useCallback((next: { index: number; text: string }[]) => {
    setBlocks((current) =>
      current.length === next.length && current.every((b, i) => b.text === next[i]?.text)
        ? current
        : next,
    );
  }, []);

  const onPreviewHash = useCallback((hash: string | null) => setPreviewHash(hash), []);
  const closeSheet = useCallback(() => setSheet(null), []);

  const items = useMemo(() => job?.review?.items ?? [], [job?.review]);
  const openFindings = useMemo(() => (factChecks?.findings ?? []).filter(isOpenFinding), [factChecks]);
  const highlights = useMemo<ProofHighlight[]>(
    () => [
      // 校稿先包（維持原本標得出來的樣子）；查證後包。查證跟校稿部分重疊、包不進去的就不標字，
      // 點卡片時照樣框出那一段（ProofView 的 wrapFirst 只在單一文字節點裡找）。完全同一段字時查證包在校稿裡面。
      ...items.flatMap((item) => {
        const text = highlightText(item);
        return text === null
          ? []
          : [{ id: reviewKey(item), kind: kindOf(item), text, blockIndex: item.blockIndex, skipInside: item.change?.after ?? null }];
      }),
      ...openFindings.map((finding) => ({
        id: findingKey(finding),
        kind: 'factcheck' as const,
        text: finding.excerpt,
        blockIndex: finding.blockIndex,
      })),
    ],
    [items, openFindings],
  );

  const activate = useCallback((entry: { key: string; blockIndex: number | null } | null) => {
    setActiveKey(entry?.key ?? null);
    setFocusBlock(entry?.blockIndex ?? null);
    setFocusSeq((seq) => seq + 1);
  }, []);

  const onHighlight = useCallback(
    (key: string) => {
      const item = items.find((candidate) => reviewKey(candidate) === key);
      if (item) {
        activate({ key, blockIndex: item.blockIndex });
        return;
      }
      const finding = openFindings.find((candidate) => findingKey(candidate) === key);
      if (finding) activate({ key, blockIndex: finding.blockIndex });
    },
    [items, openFindings, activate],
  );

  /**
   * 發起查證（D-034）。三個入口共用：觀察卡片、選字、一鍵查證。請求要等整次查證跑完才回（1～3 分鐘）；
   * 先重讀一次讓頂端長條與分段進度出現、開始輪詢。按了停止的不當錯誤講（右欄會中性地說「已停止」）。
   */
  const startFactCheck = useCallback(
    (request: Omit<FactCheckRequest, 'provider'>) => {
      const previousRunId = latestRunId.current;
      const origin = uuid;
      // 跑完的時候畫面可能已經換到別篇（App 沿用同一個 Workspace）：那時這篇的結果一個字都不寫進畫面。
      const stillHere = (): boolean => alive.current && uuidRef.current === origin;
      setAgentError(null);
      setSendingUuid(origin);
      void (async () => {
        let created: FactCheckFinding[] = [];
        try {
          const pending = api.runFactCheck(origin, { provider, ...request });
          window.setTimeout(() => {
            if (stillHere()) void refresh();
          }, 500);
          created = (await pending).findings;
        } catch (cause) {
          const latest = await api.listFactChecks(origin).catch(() => null);
          // 只有「這次新開的那一筆被停止」才不當錯誤講；在開紀錄之前就失敗的（選字找不到、含密碼、另一個動作在跑…）照講。
          if (stillHere() && !isNewCancelledRun(latest?.latestRun ?? null, previousRunId)) setAgentError(describeError(cause));
        } finally {
          if (alive.current) setSendingUuid((current) => (current === origin ? null : current));
          if (stillHere()) await refresh();
        }
        // 查一句（選字、觀察卡片）的結果只有一張：直接亮起來、右欄捲到它，不用自己找。
        const only = created.length === 1 ? created[0] : undefined;
        if (only !== undefined && stillHere()) activate({ key: findingKey(only), blockIndex: only.blockIndex });
      })();
    },
    [uuid, refresh, activate, provider],
  );

  const startEdit = useCallback((item: ReviewItem | null) => {
    // AI 跑完會產生新版本、校樣會重載，編到一半的字就沒了。等它跑完再改（查證不在此列，D-036）。
    if (editBlockedRef.current) {
      setEditNotice('AI 還在處理這篇，等它跑完再改。');
      return;
    }
    // 按過接受、後端在每個欄位（標題、正文…）都找不到原句的（unappliable，P5-T017）：字上標不出來，
    // 游標只能放文章開頭——明講找不到，不然使用者會以為游標停的地方就是要改的地方。
    // 不用 blockIndex === null 判斷：改標題的建議也沒有段落，但它找得到，只是不在正文裡。
    // 其他卡片（觀察、查證）字與段落都標不出來的，由 ProofView 定位完回報（onEditTargetMissing，P5-T037）。
    const quoted = item === null ? null : (item.change?.before ?? item.observation?.excerpt ?? null);
    const lost = item !== null && item.state === 'unappliable';
    // 空白不同之類逐字對不上、但定位（忽略空白）找得到段落的，游標放那一段開頭。
    const where = item?.blockIndex == null ? '文章開頭' : `第 ${item.blockIndex + 1} 段開頭`;
    setEditNotice(lost && quoted ? `文章裡找不到「${quoted}」，游標放在${where}。找到那句直接改，改完按儲存。` : null);
    // 對照蓋在校樣上面，看不到正在改的文章；先回到文章再進編輯。
    setView('article');
    setSheet(null);
    setEditing({
      itemId: item?.id ?? null,
      factCheckId: null,
      caret: item === null || lost ? null : (highlightText(item) ?? quoted),
      caretSkipInside: item?.change?.after ?? null,
      blockIndex: item?.blockIndex ?? null,
      nonce: Date.now(),
    });
  }, []);
  /** 查證卡片的「去原文改」：游標停在那句前面（找不到就停在那一段開頭），存檔後那條結案（resolved-by-edit）。 */
  const startFactCheckEdit = useCallback((finding: FactCheckFinding) => {
    if (editBlockedRef.current) {
      setEditNotice('AI 還在處理這篇，等它跑完再改。');
      return;
    }
    setEditNotice(null);
    setView('article');
    setSheet(null);
    setEditing({
      itemId: null,
      factCheckId: finding.id,
      caret: finding.excerpt,
      blockIndex: finding.blockIndex,
      nonce: Date.now(),
    });
  }, []);

  // 新稿件建好直接進打字模式。等稿件讀到了才進（startEdit 要看有沒有 AI 在跑）；
  // 校樣還沒載入也沒關係，ProofView 會等 iframe 載入完再把游標放進去。
  const loadedUuid = job !== null && isLoaded(job) ? job.uuid : null;
  useEffect(() => {
    if (!startEditing || loadedUuid !== uuid) return;
    startEdit(null);
    onStartedEditing?.();
  }, [startEditing, loadedUuid, uuid, startEdit, onStartedEditing]);
  // 剛建好的那一篇載入失敗（或發布目標已經不在）：這次不進打字模式，旗標也清掉，
  // 不然之後重新讀取成功、或再打開同一篇時會莫名進打字模式（審查 #4）。
  const loadFailed = (error !== null && job === null) || (job !== null && !isLoaded(job));
  useEffect(() => {
    if (startEditing && loadFailed) onStartedEditing?.();
  }, [startEditing, loadFailed, onStartedEditing]);

  // 去原文改的那條在打字中被新的查證結果取代或已處理（D-036）：之後存檔不再送它（後端遇到也照存不結案，這裡讓前端跟著，審查 1）。
  useEffect(() => {
    setEditing((current) => dropStaleFactCheck(current, factChecks?.findings ?? null));
  }, [factChecks]);

  /** 這次打字中最後一次自動存成功的 hash（D-036）；離開打字模式或換篇就清掉。 */
  const lastSavedHash = useRef<string | null>(null);
  useEffect(() => {
    if (editing === null) lastSavedHash.current = null;
  }, [editing, uuid]);

  /** 選字「用此段配圖」（P5-T038）能不能生圖：跟插圖面板同一個來源（後端有 30 秒快取）。 */
  const imageGeneration = useImageGenerationStatus(true);

  const endEdit = useCallback((notice?: string) => {
    setEditing(null);
    setEditNotice(notice ?? null);
  }, []);

  // 發布前要看的是成品：跟網站上一模一樣、什麼都不標的那一份。面板打開，主區就自動是成品
  // （stageDisplay）；關掉面板，view 沒被動過，自然回到原本的文章或對照。
  const openPublish = useCallback(() => setSheet('publish'), []);

  if (error && !job) {
    return (
      <div className="screen-error">
        <p role="alert">
          <Icon name="alert" size={16} /> {error}
        </p>
        <button type="button" className="btn btn-quiet" onClick={onBack}>
          <Icon name="arrow-left" size={14} />
          回到稿件總覽
        </button>
      </div>
    );
  }

  if (!job) {
    return <p className="screen-loading">載入稿件…</p>;
  }

  // 設定檔把發布目標拿掉時，這篇稿件沒有模板也沒有目標，做不了任何事。
  if (!isLoaded(job)) {
    return (
      <div className="screen-error">
        <p role="alert">
          <Icon name="alert" size={16} />
          這篇稿件的發布目標已經不在 config/publish-targets.json 裡了，所以無法編輯或發布。
          把目標加回設定檔並重啟後端，或直接取消這篇稿件。
        </p>
        <div className="row">
          <button type="button" className="btn btn-quiet" onClick={onBack}>
            <Icon name="arrow-left" size={14} />
            回到稿件總覽
          </button>
          <CancelButton job={job} refresh={refresh} confirm={confirm} />
        </div>
      </div>
    );
  }

  const pending = job.review?.pendingCount ?? 0;
  const imagesAttention =
    job.imageBriefs.some((brief) => !brief.fulfilled) ||
    (job.target.requireFeaturedImage && job.featuredMediaId === null);
  const showImages = imagesOpen ?? imagesAttention;
  const display = stageDisplay(view, sheet === 'publish');
  // 查證入口共用的反灰條件（跟其他 Agent 動作同一套）。查證跑的期間不鎖內容（D-036）。
  const blockedInput = {
    running: working,
    editing: editing !== null,
    comparing: display.compare,
    bodyEmpty: job.bodyEmpty,
    finished: isFinished(job.state),
  };
  const factCheckBlocked = factCheckBlockedReason(blockedInput);
  // 選字「查證這句」在打字模式也能按（D-036）：按下先存一版、留在打字模式再查；
  // 打字模式下正文空不空不看存過的（空白新稿打了第一句還沒存，Codex P2），交給存檔與查證流程驗。
  const selectionCheckBlocked = selectionCheckBlockedReason(blockedInput);
  // 選字「用此段配圖」（P5-T038）：跟「請 AI 配一張」同一套反灰條件；打字模式照樣給（按下先存）。
  const selectionImageBlocked = selectionImageBlockedReason({
    generation: imageGeneration,
    running: working === true,
    finished: isFinished(job.state),
  });
  // 段落之間的「在這裡插圖」（P5-T016）：只在看文章、沒在改字、沒有 AI 在跑的時候出現。
  const insertable = canInsertImages(display, {
    editing: editing !== null,
    finished: isFinished(job.state),
    working: working === true,
  });
  // 編輯中工具列整條換成「取消／儲存」，這顆按鈕本來就看不到；這裡再擋一次，不讓編輯中進對照。
  // 字跟著畫面上實際顯示的走：從對照打開發布面板時，成品上方不能還寫著「回到文章」。
  const compareToggle = (
    <button
      type="button"
      className="btn btn-quiet btn-tiny"
      // 發布面板開著時畫面一定是成品；鍵盤還是 Tab 得到這顆，按了會在關面板後突然跳進對照。
      disabled={editing !== null || sheet === 'publish'}
      onClick={() => setView(display.compare ? 'article' : 'compare')}
    >
      <Icon name={display.compare ? 'arrow-left' : 'columns'} size={13} />
      {/* 有未結案的校稿提案時，後端跟提案比，不是跟上一版比（getComparison 的預設）。按鈕要照實講。 */}
      {display.compare ? '回到文章' : job.review ? '對照 AI 提案' : '對照上一版'}
    </button>
  );

  return (
    <div className="workspace">
      {/* 編輯中整條鎖住：包括返回鍵，按下去會卸載工作區，打的字就沒了。 */}
      <header className="docbar" inert={editing !== null}>
        <div className="docbar-left">
          <button type="button" className="icon-btn" aria-label="回到稿件總覽" title="回到稿件總覽" onClick={onBack}>
            <Icon name="arrow-left" size={18} />
          </button>
          <span className="type-tag" data-type={job.target.contentType}>
            {typeLabel(job.target.contentType, job.target.postType)}
          </span>
          <h1 className="docbar-title">{job.title ?? '未命名'}</h1>
          <span className="docbar-state" data-state={job.state}>
            {STATE_LABEL[job.state]}
          </span>
        </div>

        <div className="docbar-right">
          {/* 正文空的（新稿件剛建好）：AI 與發布都還不能用，講出來，不要只是一排灰掉的按鈕（P5-T029）。 */}
          {job.bodyEmpty && !isFinished(job.state) && (
            <span className="docbar-hint" role="status">
              先寫點內容，才能請 AI 看、發布
            </span>
          )}
          {!isFinished(job.state) && (
            <AgentButton
              job={job}
              refresh={refresh}
              onError={setAgentError}
              provider={provider}
              onProvider={setProvider}
              sending={factCheckSending}
              factCheckBlocked={factCheckBlocked}
              onFactCheck={() => startFactCheck({ scope: 'article' })}
            />
          )}
          {job.published ? (
            <a className="btn" href={job.published.link} target="_blank" rel="noreferrer">
              <Icon name="external-link" size={15} />
              已發布，去看看
            </a>
          ) : (
            !isTerminal(job.state) && (
              <button type="button" className="btn btn-primary" onClick={openPublish}>
                發布…
                {pending > 0 && <span className="badge">還有 {pending} 項</span>}
              </button>
            )
          )}
          <button type="button" className="icon-btn" aria-label="重新讀取" title="重新讀取" onClick={() => void refresh()}>
            <Icon name="refresh" size={16} />
          </button>
        </div>
      </header>

      {(error ?? agentError ?? editNotice) && (
        <p className="topbar-error" role="alert">
          <Icon name="alert" size={14} /> {error ?? agentError ?? editNotice}
        </p>
      )}

      {/*
        Agent 在跑的時候，這條長條在工作區的任何畫面都看得到。
        「還在跑」這件事必須自己找上門，否則等了兩分鐘只會覺得軟體卡死了。
      */}
      {job.agentRun?.status === 'running' && (
        <AgentBanner
          run={job.agentRun}
          cancelling={cancelling}
          onCancel={() => {
            setCancelling(true);
            void api
              .cancelAgent(job.uuid)
              .catch((cause: unknown) => setError(describeError(cause)))
              .finally(() => {
                setCancelling(false);
                void refresh();
              });
          }}
        />
      )}

      {job.state === 'CANCELLED' ? (
        <RestoreBar job={job} refresh={refresh} onError={setError} />
      ) : isTerminal(job.state) && (
        <div className="terminal-bar" role="status">
          <Icon name="alert" size={15} />
          <span>
            這篇稿件{STATE_LABEL[job.state]}。
            {job.blockers.join('、')}
          </span>
        </div>
      )}

      <div className="desk">
        {/*
          校樣永遠掛在樹上，切到對照時只是被蓋住（見 styles/14-stage.css 的 .stage）。
          卸載掉的話 iframe 會重載、量到的區塊也會清空，插入圖片的位置就會是空的。
        */}
        <div className="stage" data-mode={display.compare ? 'compare' : 'proof'}>
          <ProofView
            job={job}
            mode={display.proof}
            highlights={highlights}
            activeHighlight={activeKey}
            onHighlight={onHighlight}
            focusBlock={display.proof === 'final' ? null : focusBlock}
            onBlocks={onBlocks}
            onPreviewed={onPreviewed}
            onPreviewHash={onPreviewHash}
            editing={editing}
            onEndEdit={endEdit}
            onEditTargetMissing={setEditNotice}
            selectionCheck={
              canSelectToFactCheck(display, { finished: isFinished(job.state) })
                ? {
                    blockedReason: selectionCheckBlocked,
                    note: hostedSearchNote(provider),
                    onCheck: (text) => startFactCheck({ scope: 'selection', selection: text }),
                  }
                : null
            }
            selectionImage={
              canSelectToFactCheck(display, { finished: isFinished(job.state) })
                ? {
                    blockedReason: selectionImageBlocked,
                    onRequest: async ({ text, note, spot, spotCount }) => {
                      // 畫面那一版：打字中先存過就是最後存的那一版（工作區快照可能還沒重讀到）。
                      const contentHash = selectionImageContentHash({
                        editing: editing !== null,
                        lastSaved: lastSavedHash.current,
                        jobHash: job.currentRevision?.contentHash,
                      });
                      setAgentError(null);
                      try {
                        if (contentHash === undefined) throw new Error('這篇稿件還沒有內容，沒辦法配圖');
                        const brief = await api.requestImageFromSelection(job.uuid, {
                          selection: text,
                          spot,
                          ...(spotCount === undefined ? {} : { spotCount }),
                          contentHash,
                          ...(note === null ? {} : { note }),
                        });
                        // 生圖在背後跑：打開右欄圖片區並捲到那張卡片（跟「請 AI 配一張」一樣）。
                        setImagesOpen(true);
                        setFocusBriefId(brief.id);
                        await refresh();
                      } catch (cause) {
                        setAgentError(`用此段配圖沒有開始：${describeError(cause)}`);
                      }
                    },
                  }
                : null
            }
            insertImage={
              insertable
                ? (afterBlockIndex, close) => (
                    <InsertImagePanel
                      job={job}
                      afterBlockIndex={afterBlockIndex}
                      blockText={blocks.find((block) => block.index === afterBlockIndex)?.text ?? null}
                      onRefresh={refresh}
                      onPlaced={async () => {
                        close();
                        await refresh();
                      }}
                      onClose={close}
                      onAiStarted={async (briefId) => {
                        // 生圖在背後跑：面板關掉，進度在右欄那張卡片與頂端長條（重讀之後開始輪詢）。
                        close();
                        setImagesOpen(true);
                        setFocusBriefId(briefId);
                        await refresh();
                      }}
                    />
                  )
                : null
            }
            onSaveEdit={async ({ editedBody, editedTitle, stay }) => {
              // 打字中自動存過的：基準用最後一次存成功的 hash（存好之後的重讀可能失敗，工作區快照還是舊的，Codex P1）。
              const base = nextSaveBase(lastSavedHash.current, job.currentRevision?.contentHash);
              // 標題與內文一起存成同一個新版本（P5-T029）；只送有改的那一邊。
              const saved = await api.createRevision(job.uuid, {
                ...(editedBody === undefined ? {} : { editedBody }),
                ...(editedTitle === undefined ? {} : { editedTitle }),
                origin: 'manual',
                reason: '直接在文章上改',
                // 從卡片進來改的：存成新版本時那張卡片一起結案，不用再按一次「不用改」。
                // 只改標題也算（講標題的建議，P5-T031）。
                ...(editing?.itemId == null || (editedBody === undefined && editedTitle === undefined)
                  ? {}
                  : { resolveItemId: editing.itemId }),
                // 從查證卡片「去原文改」進來的：那條查證結果一起結案（resolved-by-edit）。
                ...(editing?.factCheckId == null || (editedBody === undefined && editedTitle === undefined)
                  ? {}
                  : { resolveFactCheckId: editing.factCheckId }),
                // 編輯中被換版本時後端會回 409，不會蓋掉別人存進去的修改（P5-T005）。
                ...(base === undefined ? {} : { expectedContentHash: base }),
              });
              if (stay) {
                lastSavedHash.current = saved.contentHash;
                // 打字模式按「查證這句」先存的那一版（D-036）：留在打字模式；從卡片進來的那張已經跟著結案，之後再存不再送。
                setEditing(afterStaySave);
              } else {
                // 存好了：「找不到」之類的進場提示一起收掉（Codex 審查）。
                endEdit();
              }
              await refresh();
              return saved.contentHash;
            }}
            tools={
              <>
                {compareToggle}
                {!isFinished(job.state) && (
                  <>
                    <button type="button" className="btn btn-quiet btn-tiny" onClick={() => setSheet('source')}>
                      標題與網址
                    </button>
                    <button
                      type="button"
                      className="btn btn-quiet btn-tiny"
                      disabled={editBlocked}
                      title={editBlocked ? 'AI 還在處理這篇，等它跑完再改' : undefined}
                      onClick={() => startEdit(null)}
                    >
                      <Icon name="file-text" size={13} />
                      {job.bodyEmpty ? '開始寫' : '改原文'}
                    </button>
                  </>
                )}
              </>
            }
          />
          {display.compare && (
            <CompareView
              job={job}
              focusBlock={focusBlock}
              focusSeq={focusSeq}
              revisionKey={job.currentRevision?.contentHash ?? 'none'}
              tools={compareToggle}
            />
          )}
        </div>

        <aside className="margin" aria-label="修改建議與圖片" inert={editing !== null} data-locked={editing !== null ? 'yes' : 'no'}>
          <SuggestionColumn
            job={job}
            factChecks={factChecks}
            refresh={refresh}
            activeKey={activeKey}
            // 在對照中按卡片就留在對照，CompareView 會捲到那一段並框起來；
            // 同一時間底下的校樣也標亮，回到文章時就停在那一項。
            onActivate={activate}
            onEditSource={startEdit}
            onEditFinding={startFactCheckEdit}
            onFactCheckObservation={(item) => startFactCheck({ scope: 'observation', observationItemId: item.id })}
            factCheckBlocked={factCheckBlocked}
            factCheckNote={hostedSearchNote(provider)}
          />

          <section className="margin-section" data-open={showImages ? 'yes' : 'no'}>
            <h2 className="margin-section-head">
              <button
                type="button"
                className="margin-section-toggle"
                aria-expanded={showImages}
                onClick={() => setImagesOpen(!showImages)}
              >
                <Icon name="image" size={16} />
                <span>圖片</span>
                <span className="margin-section-hint">
                  {job.target.requireFeaturedImage && job.featuredMediaId === null
                    ? '還缺封面圖'
                    : job.imageBriefs.some((brief) => !brief.fulfilled)
                      ? `配圖 ${job.imageBriefs.filter((brief) => !brief.fulfilled).length} 張待處理`
                      : job.media.length > 0
                        ? `${job.media.length} 張`
                        : ''}
                </span>
                <Icon name={showImages ? 'chevron-down' : 'chevron-right'} size={15} />
              </button>
            </h2>
            {showImages && (
              <div className="margin-section-body">
                <MediaPanel job={job} refresh={refresh} blocks={blocks} focusBriefId={focusBriefId} editing={editing !== null} />
              </div>
            )}
          </section>
        </aside>
      </div>

      {sheet === 'source' && (
        <Sheet title="標題與網址" onClose={closeSheet}>
          <SourcePanel job={job} refresh={refresh} />
        </Sheet>
      )}

      {sheet === 'publish' && (
        <Sheet title="發布" onClose={closeSheet}>
          <PublishSheet
            job={job}
            refresh={refresh}
            previewHash={previewHash}
            onGoTo={(where) => {
              setSheet(null);
              // 「回去看」要看的是標在字上的建議或圖片區，所以回到文章，不回對照。
              setView('article');
              if (where === 'images') setImagesOpen(true);
            }}
          />
          <div className="sheet-foot">
            <CancelButton job={job} refresh={refresh} confirm={confirm} />
          </div>
        </Sheet>
      )}
    </div>
  );
}

/**
 * 已取消的稿件最上面那條（D-031）：講清楚取消了，給一顆「恢復這篇」。
 *
 * 恢復不是破壞性操作（取消時什麼都沒刪），所以不問確認。回到哪一步由後端決定；
 * 取消前已核准的會回到「還沒核准」，發布面板照常講要重新核准，這裡不另外說明。
 */
function RestoreBar({
  job,
  refresh,
  onError,
}: {
  job: JobDetail;
  refresh: () => Promise<void>;
  onError: (message: string | null) => void;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  return (
    <div className="terminal-bar restore-bar" role="status">
      <Icon name="alert" size={15} />
      <span>這篇已經取消。內容都還在，恢復之後可以繼續編輯、發布。</span>
      <button
        type="button"
        className="btn btn-tiny"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          onError(null);
          void api
            .restoreJob(job.uuid)
            .then(() => refresh())
            .catch((cause: unknown) => onError(describeError(cause)))
            .finally(() => setBusy(false));
        }}
      >
        <Icon name="undo" size={13} />
        {busy ? '恢復中…' : '恢復這篇'}
      </button>
    </div>
  );
}

function CancelButton({
  job,
  refresh,
  confirm,
}: {
  job: JobDetail;
  refresh: () => Promise<void>;
  confirm: ReturnType<typeof useConfirm>;
}): JSX.Element | null {
  if (isFinished(job.state)) return null;
  return (
    <button
      type="button"
      className="btn btn-quiet btn-tiny btn-danger-text"
      onClick={() =>
        confirm({
          title: '取消這篇稿件？',
          danger: true,
          body: (
            <p>
              「{job.title ?? '未命名'}」會標記為已取消，不能再編輯或發布；內容都留著，之後可以在這篇裡恢復。
              已經上傳到 WordPress 的東西不會被刪掉。
            </p>
          ),
          confirmLabel: '取消這篇',
          onConfirm: async () => {
            await api.cancelJob(job.uuid);
            await refresh();
          },
        })
      }
    >
      <Icon name="x" size={13} />
      取消這篇稿件
    </button>
  );
}
