import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { api, describeError } from '../service/client.js';
import { isLoaded, type JobDetail, type ReviewItem } from '../service/types.js';
import { Icon } from '../icons.js';
import { STATE_LABEL, isFinished, isTerminal } from '../lib/steps.js';
import { highlightText, kindOf } from '../lib/review-kinds.js';
import { AgentBanner } from './AgentProgress.js';
import { AgentButton } from './AgentButton.js';
import { useConfirm } from './ConfirmDialog.js';
import { CompareView } from './CompareView.js';
import { typeLabel } from './JobList.js';
import { ProofView, type ProofHighlight } from './ProofView.js';
import { Sheet } from './Sheet.js';
import { SuggestionColumn } from './SuggestionColumn.js';
import { ViewSwitch, type StageMode } from './ViewSwitch.js';
import { MediaPanel } from './panels/MediaPanel.js';
import { PublishSheet } from './PublishSheet.js';
import { SourcePanel } from './panels/SourcePanel.js';

/**
 * 工作區（B1，決策 D-013）：文章在中間，建議標在字上，右邊的卡片一對一對應。
 *
 * 上方只有三件事：看哪一種檢視、請 AI 看一遍、發布。其他動作都跟著內容走——
 * 要改字就在卡片上按、要改原文就打開抽屜，不必去找「現在是第幾步」。
 *
 * 只有一個資料來源：`GET /api/jobs/:uuid`。每個動作做完就重新抓一次，
 * 不在前端自己推算狀態——狀態機與核准失效都是後端的權責，前端猜錯會很危險。
 *
 * 介面上一律叫「稿件」；程式裡叫 job（型別、API、網址都是），兩者刻意不同名。
 */

type SheetKey = 'source' | 'publish' | null;

export function Workspace({ uuid, onBack }: { uuid: string; onBack: () => void }): JSX.Element {
  const [job, setJob] = useState<JobDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [blocks, setBlocks] = useState<{ index: number; text: string }[]>([]);
  // 校樣回應的 ETag：使用者眼前那一份的 hash。null = 還沒問到或問不到。
  const [previewHash, setPreviewHash] = useState<string | null>(null);
  const [mode, setMode] = useState<StageMode>('edit');
  /** 亮起來的那一項建議（校樣上的標記與右欄卡片同步）。 */
  const [activeId, setActiveId] = useState<number | null>(null);
  /** 要框起來的段落。建議定位不到字（例如要自己改的那種）時，至少框出那一段。 */
  const [focusBlock, setFocusBlock] = useState<number | null>(null);
  const [sheet, setSheet] = useState<SheetKey>(null);
  const [imagesOpen, setImagesOpen] = useState<boolean | null>(null);
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
      const next = await api.getJob(uuid);
      if (isCurrent()) {
        setJob(next);
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
    setActiveId(null);
    setFocusBlock(null);
    setSheet(null);
    setMode('edit');
  }, [uuid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 有東西在跑的時候才輪詢。閒著的時候不打擾後端。
  const working = job?.state === 'PUBLISHING' || job?.agentRun?.status === 'running';
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
  const highlights = useMemo<ProofHighlight[]>(
    () =>
      items.flatMap((item) => {
        const text = highlightText(item);
        return text === null ? [] : [{ id: item.id, kind: kindOf(item), text, blockIndex: item.blockIndex }];
      }),
    [items],
  );

  const activate = useCallback((item: ReviewItem | null) => {
    setActiveId(item?.id ?? null);
    setFocusBlock(item?.blockIndex ?? null);
  }, []);

  const onHighlight = useCallback(
    (id: number) => {
      const item = items.find((candidate) => candidate.id === id);
      if (item) activate(item);
    },
    [items, activate],
  );

  const openPublish = useCallback(() => {
    // 發布前要看的是成品：跟網站上一模一樣、什麼都不標的那一份。
    setMode('final');
    setSheet('publish');
  }, []);

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

  return (
    <div className="workspace">
      <header className="docbar">
        <div className="docbar-left">
          <button type="button" className="icon-btn" aria-label="回到稿件總覽" title="回到稿件總覽" onClick={onBack}>
            <Icon name="arrow-left" size={18} />
          </button>
          <span className="type-tag" data-type={job.target.contentType}>
            {typeLabel(job.target.contentType)}
          </span>
          <h1 className="docbar-title">{job.title ?? '未命名'}</h1>
          <span className="docbar-state" data-state={job.state}>
            {STATE_LABEL[job.state]}
          </span>
        </div>

        <div className="docbar-right">
          <ViewSwitch mode={mode} onMode={setMode} />
          {!isFinished(job.state) && <AgentButton job={job} refresh={refresh} onError={setAgentError} />}
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

      {(error ?? agentError) && (
        <p className="topbar-error" role="alert">
          <Icon name="alert" size={14} /> {error ?? agentError}
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

      {isTerminal(job.state) && (
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
          校樣永遠掛在樹上，切到對照時只是被蓋住（見 styles.css 的 .stage）。
          卸載掉的話 iframe 會重載、量到的區塊也會清空，插入圖片的位置就會是空的。
        */}
        <div className="stage" data-mode={mode === 'compare' ? 'compare' : 'proof'}>
          <ProofView
            job={job}
            mode={mode === 'final' ? 'final' : 'edit'}
            highlights={highlights}
            activeHighlight={activeId}
            onHighlight={onHighlight}
            focusBlock={mode === 'final' ? null : focusBlock}
            onBlocks={onBlocks}
            onPreviewed={onPreviewed}
            onPreviewHash={onPreviewHash}
            tools={
              !isFinished(job.state) && (
                <button type="button" className="btn btn-quiet btn-tiny" onClick={() => setSheet('source')}>
                  <Icon name="file-text" size={13} />
                  改原文
                </button>
              )
            }
          />
          {mode === 'compare' && (
            <CompareView job={job} focusBlock={focusBlock} revisionKey={job.currentRevision?.contentHash ?? 'none'} />
          )}
        </div>

        <aside className="margin" aria-label="修改建議與圖片">
          <SuggestionColumn
            job={job}
            refresh={refresh}
            activeId={activeId}
            onActivate={(item) => {
              if (mode === 'final') setMode('edit');
              activate(item);
            }}
            onEditSource={() => setSheet('source')}
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
                      ? `AI 建議 ${job.imageBriefs.filter((brief) => !brief.fulfilled).length} 張`
                      : job.media.length > 0
                        ? `${job.media.length} 張`
                        : ''}
                </span>
                <Icon name={showImages ? 'chevron-down' : 'chevron-right'} size={15} />
              </button>
            </h2>
            {showImages && (
              <div className="margin-section-body">
                <MediaPanel job={job} refresh={refresh} blocks={blocks} />
              </div>
            )}
          </section>
        </aside>
      </div>

      {sheet === 'source' && (
        <Sheet title="改原文" onClose={closeSheet} wide>
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
              setMode('edit');
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
              「{job.title ?? '未命名'}」會標記為已取消，之後不能再編輯或發布。
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
