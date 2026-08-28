import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { api, describeError } from '../service/client.js';
import { isLoaded, type JobDetail } from '../service/types.js';
import { Icon } from '../icons.js';
import { STATE_LABEL, isFinished } from '../lib/steps.js';
import { useConfirm } from './ConfirmDialog.js';
import { ProofView } from './ProofView.js';
import { StateRail } from './StateRail.js';
import { StepPanel } from './StepPanel.js';

/**
 * 發布工作區：左狀態軌 + 大校樣 + 右操作面板。
 *
 * 只有一個資料來源：`GET /api/jobs/:uuid`。每個動作做完就重新抓一次，
 * 不在前端自己推算狀態——狀態機與核准失效都是後端的權責，前端猜錯會很危險。
 */

export function Workspace({ uuid, onBack }: { uuid: string; onBack: () => void }): JSX.Element {
  const [job, setJob] = useState<JobDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [blocks, setBlocks] = useState<{ index: number; text: string }[]>([]);
  const confirm = useConfirm();
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const next = await api.getJob(uuid);
      if (alive.current) {
        setJob(next);
        setError(null);
      }
    } catch (cause) {
      if (alive.current) setError(describeError(cause));
    }
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
    return <p className="screen-loading">載入 job…</p>;
  }

  // 設定檔把發布目標拿掉時，這個 job 沒有模板也沒有目標，做不了任何事。
  // 說清楚怎麼修，並且留下取消這條路。
  if (!isLoaded(job)) {
    return (
      <div className="screen-error">
        <p role="alert">
          <Icon name="alert" size={16} />
          這個 job 的發布目標已經不在 config/publish-targets.json 裡了，所以無法編輯或發布。
          把目標加回設定檔並重啟後端，或直接取消這個 job。
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
                title: '取消這個 job？',
                danger: true,
                body: <p>「{job.title ?? '未命名'}」會標記為已取消，之後不能再編輯或發布。</p>,
                confirmLabel: '取消 job',
                onConfirm: async () => {
                  await api.cancelJob(job.uuid);
                  await refresh();
                },
              })
            }
          >
            取消 job
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
          全部 job
        </button>

        <div className="topbar-id">
          <h1 className="topbar-title">{job.title ?? '未命名'}</h1>
          <p className="topbar-meta">
            <span>{job.target.displayName}</span>
            <span className="dot" aria-hidden="true" />
            <span className="mono">{job.template.id}</span>
            <span className="dot" aria-hidden="true" />
            <span className="mono" title="job 代號">
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
                  title: '取消這個 job？',
                  danger: true,
                  body: (
                    <p>
                      「{job.title ?? '未命名'}」會標記為已取消，之後不能再編輯或發布。
                      已經上傳到 WordPress 的東西不會被刪掉。
                    </p>
                  ),
                  confirmLabel: '取消 job',
                  onConfirm: async () => {
                    await api.cancelJob(job.uuid);
                    await refresh();
                  },
                })
              }
            >
              <Icon name="x" size={13} />
              取消 job
            </button>
          )}
        </div>
      </header>

      {error && (
        <p className="topbar-error" role="alert">
          <Icon name="alert" size={14} /> {error}
        </p>
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
                  這一版的核准會作廢，job 退回「已渲染」，要重新看過校樣再核准一次才能發布。
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
        <ProofView job={job} onBlocks={onBlocks} onPreviewed={onPreviewed} />
        <StepPanel job={job} refresh={refresh} blocks={blocks} />
      </div>
    </div>
  );
}
