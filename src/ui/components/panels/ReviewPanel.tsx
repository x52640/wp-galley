import { useEffect, useMemo, useState, type JSX } from 'react';
import { api } from '../../service/client.js';
import type { LoadedJob, Observation, ReviewChange, ReviewItem } from '../../service/types.js';
import { Icon } from '../../icons.js';
import { useConfirm } from '../ConfirmDialog.js';
import { ErrorNote, Spinner, useAction } from './shared.js';

/**
 * 待處理清單。
 *
 * 使用者的心智模型只有一個：**清單從上往下清完，就可以發了。** 所以這張卡片
 * 是一份待辦，不是一份報告——每一項都要有下場（套用／略過／自己去改）。
 *
 * 校稿改動與觀察不是同一種東西，但都掛在文章某一段上，所以裝在同一個容器裡；
 * 階段 6 的查證發現也會掛進來（docs/specs/review-proposals.md「統一模型」）。差別只在
 * 那一項給的按鈕：改動能套用，觀察只能請人去判斷。
 *
 * **meaningChanged 為真的預設不勾選。** 這是規格的硬要求，也是提案制存在的理由：
 * Agent 改了九個地方、八個對、一個把原意改掉了，使用者要能只退那一個。
 */

const CHANGE_LABEL: Record<ReviewChange['type'], string> = {
  typo: '錯字',
  grammar: '語法',
  clarity: '清楚',
  style: '風格',
};

const OBSERVATION_LABEL: Record<Observation['kind'], string> = {
  contradiction: '前後矛盾',
  'unsupported-claim': '沒有依據',
  'missing-source': '沒標出處',
  gap: '交代不足',
};

const STATE_LABEL: Record<ReviewItem['state'], string> = {
  pending: '待處理',
  applied: '已套用',
  skipped: '已略過',
  unappliable: '要自己改',
};

export function ReviewPanel({
  job,
  refresh,
  onFocusBlock,
}: {
  job: LoadedJob;
  refresh: () => Promise<void>;
  /** 點某一項就跳到那一段。null 代表取消標亮。 */
  onFocusBlock: (index: number | null) => void;
}): JSX.Element {
  const review = job.review;
  const items = useMemo(() => review?.items ?? [], [review]);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  /**
   * 套用與略過**共用一個 busy 旗標**。
   *
   * 各自一個的話，使用者可以在套用還沒回來的時候按略過，兩個請求打到同一項上，
   * 後端就得處理「已經套用的項目被標成略過」。那個洞後端也堵了，但畫面本來就
   * 不該讓它發生。
   */
  const resolve = useAction();
  const confirm = useConfirm();

  /**
   * 預設勾選哪些：**只勾安全的改動**。
   *
   * `meaningChanged` 為真的、觀察、已經處理過的都不勾。這樣「套用勾選的 N 項」
   * 一按就把不必動腦的部分清掉，剩下的是真的需要人判斷的。
   */
  useEffect(() => {
    setChecked(
      new Set(
        items
          .filter((item) => item.state === 'pending' && item.change?.meaningChanged === false)
          .map((item) => item.id),
      ),
    );
  }, [items]);

  if (!review) {
    return (
      <div className="stack">
        <p className="field-hint">
          目前沒有待處理的項目。交給 Agent 校稿之後，它的建議會列在這裡，一項一項決定要不要採用。
        </p>
      </div>
    );
  }

  // 「還沒有下場」的項目：pending 加上 unappliable（定位不到、等使用者決定）。
  const open = items.filter((item) => item.state === 'pending' || item.state === 'unappliable');
  const selected = [...checked].filter((id) => open.some((item) => item.id === id));

  const toggle = (id: number): void =>
    setChecked((now) => {
      const next = new Set(now);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="stack">
      <p className="review-meta">
        <span className="mono">{review.provider}</span>
        {review.summary !== null && <span className="review-summary">{review.summary}</span>}
      </p>

      {review.stale && (
        <p className="note note-warn">
          <Icon name="alert" size={14} />
          <span>
            這份建議做完之後，內容又被改過了。逐項套用還是可以試，找不到位置的那幾項會直接告訴你；
            「全部接受」會被擋下來，因為那會用舊稿蓋掉你後來的修改。
          </span>
        </p>
      )}

      <ul className="review-list">
        {items.map((item) => (
          <li key={item.id} className="review-item" data-state={item.state}>
            <div className="review-item-head">
              {item.type === 'change' && item.state === 'pending' ? (
                <label className="review-check">
                  <input
                    type="checkbox"
                    checked={checked.has(item.id)}
                    onChange={() => toggle(item.id)}
                  />
                  <span className="sr-only">選取這一項</span>
                </label>
              ) : (
                <span className="review-glyph" aria-hidden="true">
                  <Icon
                    name={item.type === 'observation' ? 'flag' : item.state === 'applied' ? 'check' : 'minus'}
                    size={14}
                  />
                </span>
              )}

              <span className="review-kind" data-risky={item.change?.meaningChanged ? 'yes' : 'no'}>
                {item.change ? CHANGE_LABEL[item.change.type] : OBSERVATION_LABEL[item.observation!.kind]}
              </span>

              {item.state !== 'pending' && <span className="review-state">{STATE_LABEL[item.state]}</span>}

              {item.blockIndex !== null && (
                <button
                  type="button"
                  className="btn btn-quiet btn-tiny review-jump"
                  onClick={() => onFocusBlock(item.blockIndex)}
                >
                  第 {item.blockIndex + 1} 段
                </button>
              )}
            </div>

            {item.change && <ChangeBody change={item.change} />}
            {item.observation && <ObservationBody observation={item.observation} />}

            {item.state === 'unappliable' && (
              <p className="review-hint">
                這句話在目前的內容裡找不到（可能被別的改動吃掉了，或是夾在標籤中間）。
                到「原稿」那一格自己改，或略過它。
              </p>
            )}

            {(item.state === 'pending' || item.state === 'unappliable') && (
              <div className="review-item-actions">
                {item.type === 'change' && (
                  <button
                    type="button"
                    className="btn btn-quiet btn-tiny"
                    disabled={resolve.busy}
                    onClick={() =>
                      void resolve.run(async () => {
                        await api.resolveReview(job.uuid, { itemIds: [item.id], decision: 'apply' });
                        await refresh();
                      })
                    }
                  >
                    {item.state === 'unappliable' ? '再試一次' : '套用'}
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-quiet btn-tiny"
                  disabled={resolve.busy}
                  onClick={() =>
                    void resolve.run(async () => {
                      await api.resolveReview(job.uuid, { itemIds: [item.id], decision: 'skip' });
                      await refresh();
                    })
                  }
                >
                  {item.type === 'observation' ? '知道了' : '略過'}
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>

      <ErrorNote message={resolve.error} />

      <div className="review-actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={resolve.busy || selected.length === 0}
          onClick={() =>
            void resolve.run(async () => {
              await api.resolveReview(job.uuid, { itemIds: selected, decision: 'apply' });
              await refresh();
            })
          }
        >
          {resolve.busy ? <Spinner /> : <Icon name="check" size={14} />}
          套用勾選的 {selected.length} 項
        </button>

        <button
          type="button"
          className="btn btn-quiet"
          disabled={resolve.busy || open.length === 0}
          onClick={() =>
            void resolve.run(async () => {
              await api.resolveReview(job.uuid, {
                itemIds: open.map((item) => item.id),
                decision: 'skip',
              });
              await refresh();
            })
          }
        >
          全部略過
        </button>
      </div>

      <div className="review-actions review-actions-quiet">
        <button
          type="button"
          className="btn btn-quiet btn-tiny"
          disabled={review.stale}
          onClick={() =>
            confirm({
              title: '接受 Agent 的整份稿？',
              body: (
                <p>
                  這跟「把每一項都勾起來」不一樣：逐項套用只會套上清單列出來的改動，
                  整份接受會直接採用 Agent 交回來的內容，包含它沒列進清單的調整。
                  之後仍然要重新預覽並核准才發得出去。
                </p>
              ),
              confirmLabel: '整份接受',
              // 不包 useAction：失敗要讓對話框自己說，包起來會被當成成功關掉。
              onConfirm: async () => {
                await api.acceptWholeReview(job.uuid, review.id);
                await refresh();
              },
            })
          }
        >
          全部接受
        </button>

        <button
          type="button"
          className="btn btn-quiet btn-tiny btn-danger-text"
          onClick={() =>
            confirm({
              title: '丟掉這份校稿建議？',
              danger: true,
              body: (
                <p>
                  清單上還沒處理的 {open.length} 項會一起消失，文章內容不受影響（本來就還沒動過）。
                  要再拿到建議只能重新交給 Agent 跑一次。
                </p>
              ),
              confirmLabel: '丟掉',
              onConfirm: async () => {
                await api.discardReview(job.uuid, '使用者丟棄這份校稿提案', review.id);
                await refresh();
              },
            })
          }
        >
          丟掉
        </button>
      </div>
    </div>
  );
}

function ChangeBody({ change }: { change: ReviewChange }): JSX.Element {
  return (
    <div className="review-body">
      <p className="review-diff">
        <span className="seg" data-op="removed">
          {change.before}
        </span>
        <Icon name="chevron-right" size={12} />
        <span className="seg" data-op="added">
          {change.after}
        </span>
      </p>
      <p className="review-reason">{change.reason}</p>
      {change.meaningChanged && (
        <p className="review-risk">
          <Icon name="alert" size={13} />
          Agent 自己說這一項可能改變原意。看過再決定。
        </p>
      )}
    </div>
  );
}

function ObservationBody({ observation }: { observation: Observation }): JSX.Element {
  return (
    <div className="review-body">
      <p className="review-excerpt">「{observation.excerpt}」</p>
      <p className="review-reason">{observation.detail}</p>
      <p className="review-suggest">
        <Icon name="chevron-right" size={12} />
        {observation.suggestion}
      </p>
    </div>
  );
}
