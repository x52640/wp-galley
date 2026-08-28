import { useCallback, useEffect, useState, type JSX } from 'react';
import { api, describeError } from '../service/client.js';
import type { JobState, JobSummary, JobTarget } from '../service/types.js';
import { Icon } from '../icons.js';
import { formatRelative } from '../lib/format.js';
import { STATE_LABEL, isFinished } from '../lib/steps.js';

/**
 * 稿件列表：進工作區的入口，也是「現在有幾件事在手上」的總覽。
 *
 * 介面上一律叫「稿件」。程式裡叫 job（型別、API、網址都是），但那是系統怎麼蓋的，
 * 不是使用者認得的東西。
 */

const FILTERS: { key: string; label: string; states: JobState[] | null }[] = [
  { key: 'active', label: '進行中', states: ['SOURCE', 'REVIEWED', 'MEDIA_READY', 'RENDERED', 'PREVIEWED', 'APPROVED', 'PUBLISHING'] },
  { key: 'published', label: '已發布', states: ['PUBLISHED'] },
  { key: 'closed', label: '已結束', states: ['FAILED', 'CANCELLED', 'SUPERSEDED'] },
  { key: 'all', label: '全部', states: null },
];

export function JobList({
  onOpen,
  onNew,
}: {
  onOpen: (uuid: string) => void;
  onNew: () => void;
}): JSX.Element {
  const [filter, setFilter] = useState('active');
  const [jobs, setJobs] = useState<JobSummary[] | null>(null);
  // JobSummary 只有 targetKey，沒有顯示名稱，所以另外拿一份發布目標來對照。
  const [targets, setTargets] = useState<Map<string, JobTarget>>(new Map());
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setJobs(await api.listJobs());
    } catch (cause) {
      setError(describeError(cause));
      setJobs([]);
    }
    try {
      const list = await api.listTargets();
      setTargets(new Map(list.map((target) => [target.key, target])));
    } catch {
      // 對照表拿不到就退回顯示 key，不值得為此擋住整個列表。
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const active = FILTERS.find((f) => f.key === filter) ?? FILTERS[0];
  const shown = (jobs ?? []).filter(
    (job) => active?.states === null || active?.states === undefined || active.states.includes(job.state),
  );

  return (
    <div className="list-screen">
      <header className="list-head">
        <div>
          <h1 className="list-title">發布台</h1>
          <p className="list-sub">把稿子變成 www.remusplus.com 上的文章。</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={onNew}>
          <Icon name="plus" size={15} />
          新增稿件
        </button>
      </header>

      <div className="list-filters" role="tablist" aria-label="篩選">
        {FILTERS.map((option) => (
          <button
            key={option.key}
            type="button"
            role="tab"
            aria-selected={filter === option.key}
            className="chip"
            data-active={filter === option.key ? 'yes' : 'no'}
            onClick={() => setFilter(option.key)}
          >
            {option.label}
          </button>
        ))}
        <button type="button" className="btn btn-quiet btn-tiny list-reload" onClick={() => void load()}>
          <Icon name="refresh" size={13} />
          重新讀取
        </button>
      </div>

      {error && (
        <p className="note note-bad" role="alert">
          <Icon name="alert" size={14} />
          <span>{error}</span>
        </p>
      )}

      {jobs === null && <p className="screen-loading">載入中…</p>}

      {jobs !== null && shown.length === 0 && (
        <div className="list-empty">
          <Icon name="file-text" size={26} />
          <p>這裡還沒有稿件。貼一篇稿子進來，發布台會幫你走完校稿、配圖、核准到發布。</p>
          <button type="button" className="btn btn-primary" onClick={onNew}>
            <Icon name="plus" size={15} />
            新增稿件
          </button>
        </div>
      )}

      {shown.length > 0 && (
        <ul className="job-list">
          {shown.map((job) => (
            <li key={job.uuid}>
              <button type="button" className="job-row" onClick={() => onOpen(job.uuid)}>
                <span className="state-badge" data-state={job.state}>
                  {STATE_LABEL[job.state]}
                </span>
                <span className="job-row-main">
                  <span className="job-row-title">{job.title ?? '未命名'}</span>
                  <span className="job-row-meta">
                    <span>
                      {(job.targetKey === null
                        ? null
                        : (targets.get(job.targetKey)?.displayName ?? job.targetKey)) ?? '目標已移除'}
                    </span>
                    {job.revisionNumber !== null && (
                      <>
                        <span className="dot" aria-hidden="true" />
                        <span className="mono">r{job.revisionNumber}</span>
                      </>
                    )}
                    <span className="dot" aria-hidden="true" />
                    <span>{formatRelative(job.updatedAt)}</span>
                    {job.publishedId !== null && (
                      <>
                        <span className="dot" aria-hidden="true" />
                        <span className="mono">#{job.publishedId}</span>
                      </>
                    )}
                  </span>
                </span>
                {!isFinished(job.state) && <span className="job-row-live" aria-label="進行中" />}
                <Icon name="chevron-right" size={16} className="job-row-caret" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
