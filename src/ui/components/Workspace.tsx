import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { api, describeError } from '../service/client.js';
import { isLoaded, type JobDetail } from '../service/types.js';
import { Icon } from '../icons.js';
import { STATE_LABEL, isFinished } from '../lib/steps.js';
import { AgentBanner } from './AgentProgress.js';
import { useConfirm } from './ConfirmDialog.js';
import { CompareView } from './CompareView.js';
import { ProofView } from './ProofView.js';
import type { StageMode } from './ViewSwitch.js';
import { StateRail } from './StateRail.js';
import { StepPanel } from './StepPanel.js';

/**
 * 發布工作區：左狀態軌 + 大校樣 + 右操作面板。
 *
 * 只有一個資料來源：`GET /api/jobs/:uuid`。每個動作做完就重新抓一次，
 * 不在前端自己推算狀態——狀態機與核准失效都是後端的權責，前端猜錯會很危險。
 *
 * 介面上一律叫「稿件」；程式裡叫 job（型別、API、網址都是），兩者刻意不同名。
 */

export function Workspace({ uuid, onBack }: { uuid: string; onBack: () => void }): JSX.Element {
  const [job, setJob] = useState<JobDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [blocks, setBlocks] = useState<{ index: number; text: string }[]>([]);
  // 校樣回應的 ETag：使用者眼前那一份的 hash。null = 還沒問到或問不到。
  const [previewHash, setPreviewHash] = useState<string | null>(null);
  /** 主區的檢視。預設永遠是校樣——左右對照是「要逐字比對時才切過去」的地方。 */
  const [mode, setMode] = useState<StageMode>('proof');
  /**
   * 待處理清單點過來的段落。
   *
   * 放在這裡而不是各自的元件裡，是因為兩個檢視都要用同一個值：在校樣上是畫框，
   * 在左右對照上是標亮那一列。清單點一次，切到哪個檢視都看得到同一段。
   */
  const [focusBlock, setFocusBlock] = useState<number | null>(null);
  /** 頂端長條上的「停止」按下之後，避免連按。 */
  const [cancelling, setCancelling] = useState(false);
  const confirm = useConfirm();
  const alive = useRef(true);
  /**
   * 重新讀取的世代編號。
   *
   * 校樣載入、輪詢、手動重讀、每個動作做完的重讀會同時在路上，回應的順序不保證
   * 跟送出的順序一樣。沒有這個編號的話，最後才回來的那個（可能是最舊的快照）
   * 會蓋掉比較新的畫面——狀態機的畫面倒退回去，看起來像後端壞了。
   * 規則很簡單：只有最新一次送出的回應可以寫進畫面。
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
    setFocusBlock(null);
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
  // 只有真的可能改變狀態時才重讀，不要每次載入都多打一次 API。
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

  const onPreviewHash = useCallback((hash: string | null) => {
    setPreviewHash(hash);
  }, []);

  if (error && !job) {
    return (
      <div className="screen-error">
        <p role="alert">
          <Icon name="alert" size={16} /> {error}
        </p>
        <button type="button" className="btn btn-quiet" onClick={onBack}>
          <Icon name="arrow-left" size={14} />
          回到列表
        </button>
      </div>
    );
  }

  if (!job) {
    return <p className="screen-loading">載入稿件…</p>;
  }

  // 設定檔把發布目標拿掉時，這篇稿件沒有模板也沒有目標，做不了任何事。
  // 說清楚怎麼修，並且留下取消這條路。
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
            回到列表
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={() =>
              confirm({
                title: '取消這篇稿件？',
                danger: true,
                body: <p>「{job.title ?? '未命名'}」會標記為已取消，之後不能再編輯或發布。</p>,
                confirmLabel: '取消這篇',
                onConfirm: async () => {
                  await api.cancelJob(job.uuid);
                  await refresh();
                },
              })
            }
          >
            取消這篇
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="workspace">
      <header className="topbar">
        <button type="button" className="btn btn-quiet btn-tiny" onClick={onBack}>
          <Icon name="arrow-left" size={14} />
          全部稿件
        </button>

        <div className="topbar-id">
          <h1 className="topbar-title">{job.title ?? '未命名'}</h1>
          <p className="topbar-meta">
            <span>{job.target.displayName}</span>
            <span className="dot" aria-hidden="true" />
            <span className="mono">{job.template.id}</span>
            <span className="dot" aria-hidden="true" />
            <span className="mono" title="稿件代號">
              {job.uuid.slice(0, 8)}
            </span>
            <span className="dot" aria-hidden="true" />
            <span className="mono" title="版本數">
              {job.revisionCount} 版
            </span>
          </p>
        </div>

        <span className="state-badge" data-state={job.state}>
          {STATE_LABEL[job.state]}
        </span>

        <div className="topbar-actions">
          <button type="button" className="btn btn-quiet btn-tiny" onClick={() => void refresh()}>
            <Icon name="refresh" size={13} />
            重新讀取
          </button>
          {!isFinished(job.state) && (
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
              取消這篇
            </button>
          )}
        </div>
      </header>

      {error && (
        <p className="topbar-error" role="alert">
          <Icon name="alert" size={14} /> {error}
        </p>
      )}

      {/*
        Agent 在跑的時候，這條長條在工作區的任何畫面都看得到。
        使用者在看校樣或左右對照時不會把右面板打開，「還在跑」這件事必須自己找上門，
        否則等了兩分鐘只會覺得軟體卡死了。
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

      <div className="panes">
        <StateRail
          job={job}
          onRevoke={() =>
            confirm({
              title: '撤銷核准？',
              danger: true,
              body: (
                <p>
                  這一版的核准會作廢，這篇稿件退回「已渲染」，要重新看過校樣再核准一次才能發布。
                </p>
              ),
              confirmLabel: '撤銷核准',
              onConfirm: async () => {
                await api.revokeApproval(job.uuid, '使用者在發布台手動撤銷');
                await refresh();
              },
            })
          }
        />
        {/*
          校樣永遠掛在樹上，切到左右對照時只是被蓋住（見 styles.css 的 .stage）。
          卸載掉的話 iframe 會重載、量到的區塊也會清空，右面板的「插入位置」
          就會在切回來之前一直是空的。
        */}
        <div className="stage" data-mode={mode}>
          <ProofView
            job={job}
            mode={mode}
            onMode={setMode}
            focusBlock={focusBlock}
            onBlocks={onBlocks}
            onPreviewed={onPreviewed}
            onPreviewHash={onPreviewHash}
          />
          {mode === 'compare' && (
            <CompareView
              job={job}
              mode={mode}
              onMode={setMode}
              focusBlock={focusBlock}
              revisionKey={job.currentRevision?.contentHash ?? 'none'}
            />
          )}
        </div>
        <StepPanel
          job={job}
          refresh={refresh}
          blocks={blocks}
          previewHash={previewHash}
          onFocusBlock={setFocusBlock}
        />
      </div>
    </div>
  );
}
