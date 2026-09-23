import { useCallback, useEffect, useState, type DragEvent, type JSX } from 'react';
import { api, describeError } from '../service/client.js';
import type { JobSummary, PublishTargetSummary } from '../service/types.js';
import { Icon } from '../icons.js';
import { formatRelative } from '../lib/format.js';
import { isFinished, isTerminal } from '../lib/steps.js';

/**
 * 稿件總覽（B0，決策 D-013）。
 *
 * 每一篇只回答一個問題：**下一步是什麼**。所以一列只有一顆「打開」，旁邊用一句話
 * 講目前的狀態（還有幾項建議、可以發了…），不列版本號與 hash——那些是工作區裡
 * 才需要的東西。
 *
 * 開新稿有兩條路：按「新長文／新日記」，或直接把文字檔拖進來、⌘V 貼上。類型一開始
 * 就決定，因為**類型決定發到哪裡**（長文 → read-think、日記 → diary），之後不必再選。
 *
 * 介面上一律叫「稿件」。程式裡叫 job（型別、API、網址都是），但那是系統怎麼蓋的，
 * 不是使用者認得的東西。
 */

type TypeFilter = 'all' | string;

/** 模板的 contentType → 介面上的叫法。 */
export const TYPE_LABEL: Record<string, string> = {
  longform: '長文',
  diary: '日記',
};

export function typeLabel(contentType: string | undefined): string {
  return contentType === undefined ? '稿件' : (TYPE_LABEL[contentType] ?? contentType);
}

/** 拖放與貼上只收純文字：.docx 要多裝一個解析套件，先不收。 */
const TEXT_TYPES = ['text/plain', 'text/markdown', ''];

export function JobList({
  onOpen,
  onNew,
}: {
  onOpen: (uuid: string) => void;
  /** targetKey 省略＝讓使用者自己選類型；text 是拖放或貼上帶進來的原稿。 */
  onNew: (targetKey?: string, text?: string) => void;
}): JSX.Element {
  const [filter, setFilter] = useState<TypeFilter>('all');
  const [jobs, setJobs] = useState<JobSummary[] | null>(null);
  // JobSummary 只有 targetKey，沒有顯示名稱，所以另外拿一份發布目標來對照。
  const [targets, setTargets] = useState<PublishTargetSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [dropError, setDropError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setJobs(await api.listJobs());
    } catch (cause) {
      setError(describeError(cause));
      setJobs([]);
    }
    try {
      setTargets(await api.listTargets());
    } catch {
      // 對照表拿不到就退回顯示 key，不值得為此擋住整個列表。
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // ⌘V：游標不在輸入框裡時，貼上的文字直接變成一篇新稿。
  useEffect(() => {
    const onPaste = (event: ClipboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target && (target.closest('input, textarea, [contenteditable="true"]') !== null)) return;
      const text = event.clipboardData?.getData('text/plain') ?? '';
      if (text.trim().length === 0) return;
      event.preventDefault();
      onNew(undefined, text);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [onNew]);

  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setDragging(false);
    setDropError(null);
    const file = event.dataTransfer.files[0];
    if (!file) {
      const text = event.dataTransfer.getData('text/plain');
      if (text.trim().length > 0) onNew(undefined, text);
      return;
    }
    if (!TEXT_TYPES.includes(file.type) && !/\.(txt|md|markdown)$/i.test(file.name)) {
      setDropError(`「${file.name}」不是純文字檔。先存成 .txt 或 .md，或打開後直接複製貼上。`);
      return;
    }
    void file.text().then((text) => {
      if (text.trim().length === 0) setDropError(`「${file.name}」是空的。`);
      else onNew(undefined, text);
    });
  };

  const targetOf = (job: JobSummary): PublishTargetSummary | undefined =>
    targets.find((target) => target.key === job.targetKey);

  const shown = (jobs ?? []).filter(
    (job) => filter === 'all' || targetOf(job)?.contentType === filter,
  );
  const open = shown.filter((job) => !isFinished(job.state) || job.state === 'FAILED');
  const sent = shown.filter((job) => job.state === 'PUBLISHED');
  const closed = shown.filter((job) => isTerminal(job.state) && job.state !== 'FAILED');

  const contentTypes = [...new Set(targets.map((target) => target.contentType))];
  const countOf = (type: TypeFilter): number =>
    (jobs ?? []).filter((job) => type === 'all' || targetOf(job)?.contentType === type).length;

  return (
    <div className="b0">
      <header className="appbar">
        <span className="brand">發布台</span>
        <a className="icon-btn" href="#/diagnostics" aria-label="環境診斷" title="環境診斷">
          <Icon name="gauge" size={18} />
        </a>
      </header>

      <main className="inbox">
        <div className="inbox-head">
          <h1 className="inbox-title">稿件</h1>
          <div className="row">
            {/* 長文放最後、用主色：寫長文才需要走完整套流程，日記多半貼了就發。 */}
            {[...targets]
              .sort((a, b) => (a.contentType === 'longform' ? 1 : 0) - (b.contentType === 'longform' ? 1 : 0))
              .map((target, index, list) => (
                <button
                  key={target.key}
                  type="button"
                  className={`btn btn-big ${index === list.length - 1 ? 'btn-primary' : ''}`}
                  onClick={() => onNew(target.key)}
                >
                  <Icon name="plus" size={16} />
                  新{typeLabel(target.contentType)}
                </button>
              ))}
            {targets.length === 0 && (
              <button type="button" className="btn btn-big btn-primary" onClick={() => onNew()}>
                <Icon name="plus" size={16} />
                新稿件
              </button>
            )}
          </div>
        </div>

        <div
          className="dropzone"
          data-dragging={dragging ? 'yes' : 'no'}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <Icon name="upload" size={20} />
          <span>把 .txt／.md 拖到這裡，或直接 ⌘V 貼上，會先問你是長文還是日記</span>
        </div>
        {dropError && (
          <p className="note note-warn" role="alert">
            <Icon name="alert" size={14} />
            <span>{dropError}</span>
          </p>
        )}

        <div className="inbox-tools">
          <div className="pills" role="tablist" aria-label="依類型篩選">
            {(['all', ...contentTypes] as TypeFilter[]).map((type) => (
              <button
                key={type}
                type="button"
                role="tab"
                aria-selected={filter === type}
                className="pill"
                data-active={filter === type ? 'yes' : 'no'}
                onClick={() => setFilter(type)}
              >
                {type === 'all' ? '全部' : typeLabel(type)} {countOf(type)}
              </button>
            ))}
          </div>
          <button type="button" className="btn btn-quiet btn-tiny" onClick={() => void load()}>
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

        {jobs !== null && open.length === 0 && sent.length === 0 && (
          <div className="inbox-empty">
            <Icon name="file-text" size={26} />
            <p>
              {filter === 'all'
                ? '還沒有稿件。按上面的「新長文」或「新日記」，或直接把稿子貼進來。'
                : `還沒有${typeLabel(filter)}。`}
            </p>
          </div>
        )}

        {open.length > 0 && (
          <section className="inbox-section" aria-label="還沒發的">
            <ul className="job-cards">
              {open.map((job) => (
                <li key={job.uuid}>
                  <JobCard job={job} target={targetOf(job)} onOpen={onOpen} />
                </li>
              ))}
            </ul>
          </section>
        )}

        {sent.length > 0 && (
          <section className="inbox-section" aria-label="已經發出去">
            <h2 className="inbox-subhead">已經發出去</h2>
            <ul className="sent-list">
              {sent.map((job) => (
                <li key={job.uuid}>
                  <button type="button" className="sent-row" onClick={() => onOpen(job.uuid)}>
                    <span className="type-tag" data-type={targetOf(job)?.contentType ?? 'unknown'}>
                      {typeLabel(targetOf(job)?.contentType)}
                    </span>
                    <span className="sent-title">{job.title ?? '未命名'}</span>
                    <span className="sent-meta">
                      {formatRelative(job.updatedAt)}送到「{targetOf(job)?.displayName ?? job.targetKey}」
                      {job.publishedId !== null && <span className="mono"> #{job.publishedId}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {closed.length > 0 && (
          <details className="inbox-closed">
            <summary>已結束的 {closed.length} 篇（取消或被取代）</summary>
            <ul className="sent-list">
              {closed.map((job) => (
                <li key={job.uuid}>
                  <button type="button" className="sent-row" onClick={() => onOpen(job.uuid)}>
                    <span className="type-tag" data-type={targetOf(job)?.contentType ?? 'unknown'}>
                      {typeLabel(targetOf(job)?.contentType)}
                    </span>
                    <span className="sent-title">{job.title ?? '未命名'}</span>
                    <span className="sent-meta">{job.state === 'CANCELLED' ? '已取消' : '已被取代'}</span>
                  </button>
                </li>
              ))}
            </ul>
          </details>
        )}
      </main>
    </div>
  );
}

/** 一句話講「這篇現在卡在哪」。顏色只是輔助，文字本身就要說得清楚。 */
function statusOf(job: JobSummary): { text: string; tone: 'todo' | 'ready' | 'idle' | 'bad' } {
  if (job.state === 'FAILED') return { text: '發布失敗，打開看原因', tone: 'bad' };
  if (job.state === 'PUBLISHING') return { text: '正在送去 WordPress…', tone: 'idle' };
  if (job.pendingReviewCount > 0) return { text: `還有 ${job.pendingReviewCount} 項建議`, tone: 'todo' };
  if (job.approved) return { text: '已核准，按發布就好', tone: 'ready' };
  if (job.state === 'SOURCE') return { text: '還沒請 AI 看', tone: 'idle' };
  return { text: '可以發了', tone: 'ready' };
}

function JobCard({
  job,
  target,
  onOpen,
}: {
  job: JobSummary;
  target: PublishTargetSummary | undefined;
  onOpen: (uuid: string) => void;
}): JSX.Element {
  const status = statusOf(job);
  return (
    <button type="button" className="job-card" onClick={() => onOpen(job.uuid)}>
      <span className="type-tag" data-type={target?.contentType ?? 'unknown'}>
        {typeLabel(target?.contentType)}
      </span>
      <span className="job-card-main">
        <span className="job-card-title">{job.title ?? '未命名'}</span>
        <span className="job-card-meta">
          {target?.displayName ?? job.targetKey ?? '發布目標已移除'}・{formatRelative(job.updatedAt)}改過
        </span>
      </span>
      <span className="job-card-status" data-tone={status.tone}>
        {status.tone === 'ready' ? <Icon name="check" size={15} /> : <span className="status-dot" aria-hidden="true" />}
        {status.text}
      </span>
      <span className="job-card-open" data-tone={status.tone}>
        打開
      </span>
    </button>
  );
}
