import type { JSX } from 'react';
import type { LoadedJob } from '../service/types.js';
import { Icon } from '../icons.js';
import { shortHash, formatDateTime } from '../lib/format.js';
import { RAIL_STEPS, STATE_LABEL, isTerminal, railStatus } from '../lib/steps.js';

/**
 * 左狀態軌——版面的簽名元素。
 *
 * 兩件事必須一眼看懂：
 * 1. **走到哪裡了。** 走過的亮、還沒到的暗，中間有一條連起來的線。
 * 2. **核准在不在。** 核准那一格做成一個實體的「蓋章位」（凹槽），不是一個
 *    普通的步驟。核准失效時印章會被撕掉——形狀破了、歪了、缺一角，
 *    不是只有顏色變灰。
 *
 * 顏色永遠不是唯一的訊號：每一種狀態都同時有文字與形狀。
 */

type SealState = 'empty' | 'sealed' | 'torn';

function sealStateOf(job: LoadedJob): SealState {
  if (!job.approval) return 'empty';
  return job.approval.valid ? 'sealed' : 'torn';
}

export function StateRail({
  job,
  onRevoke,
}: {
  job: LoadedJob;
  onRevoke: () => void;
}): JSX.Element {
  const seal = sealStateOf(job);
  const terminal = isTerminal(job.state);

  return (
    <nav className="rail" aria-label="發布進度">
      <ol className="rail-steps">
        {RAIL_STEPS.filter((step) => step.key !== 'publish').map((step) => {
          const status = railStatus(step, job.state);
          return (
            <li key={step.key} className="rail-step" data-status={status}>
              <span className="rail-node" aria-hidden="true" />
              <span className="rail-num">{step.num}</span>
              <span className="rail-label">
                {step.label}
                <span className="rail-status-text">{statusText(status, step.optional === true)}</span>
              </span>
              <RailNote step={step.key} job={job} />
            </li>
          );
        })}
      </ol>

      <SealSlot job={job} seal={seal} onRevoke={onRevoke} />

      <ol className="rail-steps rail-steps-tail">
        {RAIL_STEPS.filter((step) => step.key === 'publish').map((step) => {
          const status = railStatus(step, job.state);
          return (
            <li key={step.key} className="rail-step" data-status={status}>
              <span className="rail-node" aria-hidden="true" />
              <span className="rail-num">{step.num}</span>
              <span className="rail-label">
                {step.label}
                <span className="rail-status-text">{statusText(status, false)}</span>
              </span>
              {job.published && (
                <span className="rail-note mono">
                  #{job.published.wordpressId}／{job.published.status === 'publish' ? '已公開' : '草稿'}
                </span>
              )}
            </li>
          );
        })}
      </ol>

      {terminal && (
        <p className="rail-terminal" role="status">
          <Icon name="alert" size={14} />
          {STATE_LABEL[job.state]}
        </p>
      )}

      {job.blockers.length > 0 && (
        <div className="rail-blockers">
          <h2 className="rail-blockers-title">還缺什麼</h2>
          <ul>
            {job.blockers.map((blocker) => (
              <li key={blocker}>
                <Icon name="minus" size={12} />
                <span>{blocker}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </nav>
  );
}

function statusText(status: 'done' | 'current' | 'todo', optional: boolean): string {
  if (status === 'done') return '已完成';
  if (status === 'current') return '進行中';
  return optional ? '可略過' : '尚未開始';
}

function RailNote({ step, job }: { step: string; job: LoadedJob }): JSX.Element | null {
  if (step === 'review' && job.marks.length > 0) {
    return <span className="rail-note mono">{job.marks.length} 處改動</span>;
  }
  if (step === 'media' && job.media.length > 0) {
    return <span className="rail-note mono">{job.media.length} 張圖</span>;
  }
  if (step === 'render' && job.currentRevision) {
    return <span className="rail-note mono">r{job.currentRevision.number}</span>;
  }
  return null;
}

/**
 * 蓋章位。
 *
 * `empty`  凹槽是空的，虛線圈，寫「待核准」。
 * `sealed` 印章壓在凹槽裡，微微歪一點，帶壓痕陰影，印面刻著 content hash。
 * `torn`   印章被撕掉：剩下的部分用 clip-path 切出撕裂的邊，歪斜、灰掉、
 *          缺角，旁邊掉了一小片碎屑，凹槽裡露出「核准已失效」。
 */
function SealSlot({
  job,
  seal,
  onRevoke,
}: {
  job: LoadedJob;
  seal: SealState;
  onRevoke: () => void;
}): JSX.Element {
  const hash = job.approval?.contentHash ?? job.currentRevision?.contentHash ?? null;

  return (
    <section className="seal-slot" data-seal={seal} aria-label="核准">
      <div className="seal-recess">
        {seal === 'empty' && (
          <div className="seal-empty">
            <Icon name="stamp" size={22} />
            <span className="seal-empty-text">待核准</span>
          </div>
        )}

        {seal === 'torn' && (
          <div className="seal-void">
            <Icon name="scissors" size={18} />
            <span>核准已失效</span>
          </div>
        )}

        {(seal === 'sealed' || seal === 'torn') && (
          <div className={seal === 'torn' ? 'seal-stamp is-torn' : 'seal-stamp'} aria-hidden={seal === 'torn'}>
            <span className="seal-glyph">核</span>
            <span className="seal-word">{seal === 'torn' ? '已作廢' : '已核准'}</span>
            <span className="seal-hash mono">{shortHash(job.approval?.contentHash)}</span>
          </div>
        )}

        {seal === 'torn' && <span className="seal-scrap" aria-hidden="true" />}
      </div>

      <div className="seal-meta">
        {seal === 'empty' && (
          <p className="seal-caption">看過校樣後才能核准。核准會綁住現在這一版的內容。</p>
        )}
        {seal === 'sealed' && (
          <>
            <p className="seal-caption">
              {formatDateTime(job.approval?.createdAt)} 核准
              <span className="mono seal-caption-hash"> {shortHash(hash)}</span>
            </p>
            <button type="button" className="btn btn-quiet btn-tiny" onClick={onRevoke}>
              <Icon name="undo" size={13} />
              撤銷核准
            </button>
          </>
        )}
        {seal === 'torn' && (
          <p className="seal-caption seal-caption-warn">
            內容在核准之後又改過了。
            <br />
            重看一次校樣，再核准一次。
          </p>
        )}
      </div>
    </section>
  );
}
