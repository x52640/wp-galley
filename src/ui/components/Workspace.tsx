import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { api, describeError } from '../service/client.js';
import {
  isLoaded,
  type AgentProvider,
  type FactCheckFinding,
  type FactCheckRequest,
  type ReviewItem,
} from '../service/types.js';
import { Icon } from '../icons.js';
import { STATE_LABEL, isFinished, isTerminal } from '../lib/steps.js';
import { highlightText, kindOf } from '../lib/review-kinds.js';
import { canInsertImages, canSelectToFactCheck, stageDisplay, type StageView } from '../lib/stage-view.js';
import { factCheckBlockedReason, hostedSearchNote, isNewCancelledRun, isOpenFinding } from '../lib/factcheck-view.js';
import { afterStaySave, dropStaleFactCheck, selectionCheckBlockedReason } from '../lib/check-while-writing.js';
import { loadProvider, saveProvider } from '../lib/agent-tasks.js';
import { AgentBanner } from './AgentProgress.js';
import { AgentButton } from './AgentButton.js';
import { CancelButton } from './CancelButton.js';
import { useConfirm } from './ConfirmDialog.js';
import { CompareView } from './CompareView.js';
import { typeLabel } from './JobList.js';
import { InsertImagePanel } from './InsertImagePanel.js';
import { ProofView, type ProofEditRequest, type ProofHighlight } from './ProofView.js';
import { RestoreBar } from './RestoreBar.js';
import { Sheet } from './Sheet.js';
import { SuggestionColumn, findingKey, reviewKey } from './SuggestionColumn.js';
import { MediaPanel, useImageGenerationStatus } from './panels/MediaPanel.js';
import { selectionImageBlockedReason } from '../lib/selection-image-view.js';
import { useJobWorkspace } from '../lib/use-job-workspace.js';
import {
  cardEditStart,
  findingEditStart,
  imagesHint,
  imagesNeedAttention,
  isLoadFailed,
  manualRevisionInput,
  sameBlocks,
} from '../lib/workspace-view.js';
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
 * 只有一個資料來源：`GET /api/jobs/:uuid`。讀稿件與同步（世代、篇別守衛、待同步、存檔基準）在
 * `lib/use-job-workspace.ts`；這裡只管版面與把結果傳給子元件（P5-T045）。
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
  const [agentError, setAgentError] = useState<string | null>(null);
  const [blocks, setBlocks] = useState<{ index: number; text: string }[]>([]);
  // 校樣回應的 ETag：使用者眼前那一份的 hash。null = 還沒問到或問不到。
  const [previewHash, setPreviewHash] = useState<string | null>(null);
  /** 文章或對照。成品不在這裡：它跟著發布面板走。 */
  const [view, setView] = useState<StageView>('article');
  /** 亮起來的那一張卡片（校樣上的標記與右欄卡片同步）：校稿 `r<id>`、查證 `f<id>`。 */
  const [activeKey, setActiveKey] = useState<string | null>(null);
  /** 按了查證、請求剛送出但 agentRun 還沒出現在稿件上：這段時間也不給再按。 */
  const [sendingUuid, setSendingUuid] = useState<string | null>(null);
  /**
   * 記的是「哪一篇」在送：App 換篇時沿用同一個 Workspace（沒有 key），A 的查證還在等的時候切到 B，
   * B 不能看起來也在送（Codex 審查 1）。
   */
  const factCheckSending = sendingUuid === uuid;
  /**
   * 交給哪一家（記在 localStorage）。放在工作區而不是 AgentButton 裡：三個查證入口與它們旁邊的
   * Antigravity 說明都要跟著選單上換的那一家走。
   */
  const [provider, setProviderState] = useState<AgentProvider>(loadProvider);
  const setProvider = useCallback((next: AgentProvider) => {
    setProviderState(next);
    saveProvider(next);
  }, []);
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

  // 換到這一篇：別篇已經結束的「建議網址」結果丟掉（還在跑的留著，D-026）。
  useEffect(() => forgetOtherSlugSuggests(uuid), [uuid]);

  // 換一篇稿件就把上一篇的畫面丟掉（跟 hook 清稿件、查證結果、存檔基準在同一個 effect 裡做）。
  const resetView = useCallback(() => {
    setBlocks([]);
    setPreviewHash(null);
    setActiveKey(null);
    setFocusBlock(null);
    setSheet(null);
    setEditing(null);
    setEditNotice(null);
    setFocusBriefId(null);
    setView('article');
  }, []);

  const {
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
    editBlockedNote,
    knownHash,
    rememberSaved,
    forgetSaved,
    saveBase,
  } = useJobWorkspace({ uuid, editing: editing !== null, factCheckSending, onSwitchJob: resetView });

  /** 最近一次查證的 id（送出前記下來，分得出「這次被停止」與「這次在開紀錄之前就失敗」）。 */
  const latestRunId = useRef<number | null>(null);
  latestRunId.current = factChecks?.latestRun?.id ?? null;
  const editBlockedRef = useRef({ blocked: editBlocked, note: editBlockedNote });
  editBlockedRef.current = { blocked: editBlocked, note: editBlockedNote };

  // 後端在 GET /preview 時把 RENDERED 推進 PREVIEWED，所以看完校樣要重讀一次。
  const stateRef = useRef(job?.state);
  stateRef.current = job?.state;
  const onPreviewed = useCallback(() => {
    if (stateRef.current === 'RENDERED') void refresh();
  }, [refresh]);

  const onBlocks = useCallback((next: { index: number; text: string }[]) => {
    setBlocks((current) => (sameBlocks(current, next) ? current : next));
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
      const stillHere = (): boolean => isOnJob(origin);
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
          if (isAlive()) setSendingUuid((current) => (current === origin ? null : current));
          if (stillHere()) await refresh();
        }
        // 查一句（選字、觀察卡片）的結果只有一張：直接亮起來、右欄捲到它，不用自己找。
        const only = created.length === 1 ? created[0] : undefined;
        if (only !== undefined && stillHere()) activate({ key: findingKey(only), blockIndex: only.blockIndex });
      })();
    },
    [uuid, refresh, activate, provider, isAlive, isOnJob],
  );

  const startEdit = useCallback((item: ReviewItem | null) => {
    // AI 跑完會產生新版本、校樣會重載，編到一半的字就沒了。等它跑完再改（查證不在此列，D-036）。
    if (editBlockedRef.current.blocked) {
      setEditNotice(editBlockedRef.current.note);
      return;
    }
    // 找不到原句的卡片先講一句（lib/workspace-view.ts 的 cardEditStart）。
    const entry = cardEditStart(item, Date.now());
    setEditNotice(entry.notice);
    // 對照蓋在校樣上面，看不到正在改的文章；先回到文章再進編輯。
    setView('article');
    setSheet(null);
    setEditing(entry.request);
  }, []);
  /** 查證卡片的「去原文改」：游標停在那句前面（找不到就停在那一段開頭），存檔後那條結案（resolved-by-edit）。 */
  const startFactCheckEdit = useCallback((finding: FactCheckFinding) => {
    if (editBlockedRef.current.blocked) {
      setEditNotice(editBlockedRef.current.note);
      return;
    }
    setEditNotice(null);
    setView('article');
    setSheet(null);
    setEditing(findingEditStart(finding, Date.now()));
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
  const loadFailed = isLoadFailed({ error, job });
  useEffect(() => {
    if (startEditing && loadFailed) onStartedEditing?.();
  }, [startEditing, loadFailed, onStartedEditing]);

  // 去原文改的那條在打字中被新的查證結果取代或已處理（D-036）：之後存檔不再送它（後端遇到也照存不結案，這裡讓前端跟著，審查 1）。
  useEffect(() => {
    setEditing((current) => dropStaleFactCheck(current, factChecks?.findings ?? null));
  }, [factChecks]);

  // 離開打字模式（或換篇）：打字中存過的那一版不再當存檔基準（D-036）。
  useEffect(() => {
    if (editing === null) forgetSaved();
  }, [editing, uuid, forgetSaved]);

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
  const showImages = imagesOpen ?? imagesNeedAttention(job);
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
              onError={onThisJob(setAgentError)}
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
            // 停止回來時已經換篇：不動新篇的畫面（第三輪審查）。
            const here = onThisJob((run: () => void) => run());
            void api
              .cancelAgent(job.uuid)
              .catch((cause: unknown) => here(() => setError(describeError(cause))))
              .finally(() => {
                setCancelling(false);
                here(() => void refresh());
              });
          }}
        />
      )}

      {job.state === 'CANCELLED' ? (
        <RestoreBar job={job} refresh={refresh} onError={onThisJob(setError)} />
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
                    // 畫面知道的目前版本：打字中先存過就是最後存的那一版（工作區快照可能還沒重讀到）。
                    currentHash: knownHash,
                    loadSpots: async (text) => {
                      // 換篇時沿用同一個元件：不是發起的那一篇就什麼都不做（第二輪審查）。
                      const origin = job.uuid;
                      const stillHere = (): boolean => isOnJob(origin);
                      if (!stillHere()) return null;
                      // 跟 currentHash 同一個值（PR #28 Codex P2）：查位置用的版本與面板比對的版本一致。
                      const contentHash = knownHash;
                      if (contentHash === undefined) throw new Error('這篇稿件還沒有內容，沒辦法配圖');
                      const result = await api.selectionImageSpots(origin, { selection: text, contentHash });
                      return stillHere() ? result : null;
                    },
                    onRequest: async ({ text, note, spot, contentHash }) => {
                      // 回來時可能已經換到別篇（Workspace 重用）：清錯誤、送請求之前就先確認還在發起的那一篇。
                      const origin = job.uuid;
                      const stillHere = (): boolean => isOnJob(origin);
                      if (!stillHere()) return;
                      setAgentError(null);
                      try {
                        const brief = await api.requestImageFromSelection(origin, {
                          selection: text,
                          spot,
                          contentHash,
                          ...(note === null ? {} : { note }),
                        });
                        if (!stillHere()) return;
                        // 生圖在背後跑：打開右欄圖片區並捲到那張卡片（跟「請 AI 配一張」一樣）。
                        setImagesOpen(true);
                        setFocusBriefId(brief.id);
                        await refresh();
                      } catch (cause) {
                        if (stillHere()) setAgentError(`用此段配圖沒有開始：${describeError(cause)}`);
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
                        // 送出期間已經換篇（第三輪審查）：不打開右欄、不捲卡片、不重讀。
                        if (!isOnJob(job.uuid)) return;
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
              // 存好之後換到別篇（Workspace 重用）：不碰存檔基準、編輯狀態、refresh（第二輪審查）。
              const origin = job.uuid;
              // 打字中自動存過的：基準用最後一次存成功的 hash（存好之後的重讀可能失敗，工作區快照還是舊的，Codex P1）。
              const base = saveBase(job.currentRevision?.contentHash);
              // 標題與內文一起存成同一個新版本（P5-T029）；只送有改的那一邊；從卡片進來的一起結案（lib/workspace-view.ts）。
              const saved = await api.createRevision(
                job.uuid,
                manualRevisionInput({ editedBody, editedTitle, from: editing, base }),
              );
              if (!isOnJob(origin)) return saved.contentHash;
              if (stay) {
                rememberSaved(saved.contentHash);
                // 打字模式按「查證這句」先存的那一版（D-036）：留在打字模式；從卡片進來的那張已經跟著結案，之後再存不再送。
                setEditing(afterStaySave);
              } else {
                // 存好就離開打字模式；之後的重讀若失敗，會進入待同步、擋住再進打字模式（P5-T040 #1）。
                rememberSaved(saved.contentHash);
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
                      title={editBlocked ? editBlockedNote : undefined}
                      onClick={() => startEdit(null)}
                    >
                      <Icon name="file-text" size={13} />
                      {job.bodyEmpty ? '開始寫' : '改原文'}
                    </button>
                    {pendingSync && (
                      <span className="field-hint" role="status">
                        正在同步最新版本…
                      </span>
                    )}
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
                <span className="margin-section-hint">{imagesHint(job)}</span>
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
          <SourcePanel job={job} refresh={refresh} sync={syncJob} />
        </Sheet>
      )}

      {sheet === 'publish' && (
        <Sheet title="發布" onClose={closeSheet}>
          <PublishSheet
            job={job}
            refresh={refresh}
            sync={syncJob}
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
