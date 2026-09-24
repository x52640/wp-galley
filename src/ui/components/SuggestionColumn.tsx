import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { api } from '../service/client.js';
import type { LoadedJob, ReviewItem } from '../service/types.js';
import { Icon } from '../icons.js';
import {
  KIND_LABEL,
  KIND_ORDER,
  detailOf,
  isOpen,
  isSafeTypo,
  kindOf,
  type SuggestionKind,
} from '../lib/review-kinds.js';
import { useConfirm } from './ConfirmDialog.js';
import { ErrorNote, Spinner, useAction } from './panels/shared.js';

/**
 * B1 右欄：修改建議。
 *
 * 使用者的心智模型只有一個：**清單從上往下清完，就可以發了**
 * （docs/specs/review-proposals.md）。所以每一張卡片都要有下場：接受、保留原文、
 * 或自己去改。卡片跟校樣上標出來的字一對一：點卡片，文章捲到那裡；點文章裡
 * 標出來的字，這裡的卡片亮起來。
 *
 * **Agent 自己說可能改變原意的，永遠要一項一項看**，不會被「全部接受」帶走。
 */

type Filter = 'all' | SuggestionKind;

export function SuggestionColumn({
  job,
  refresh,
  activeId,
  onActivate,
  onEditSource,
}: {
  job: LoadedJob;
  refresh: () => Promise<void>;
  /** 目前亮起來的那一項（跟校樣上的標記同步）。 */
  activeId: number | null;
  /** 點某一項：亮起來，校樣捲到那一段。 */
  onActivate: (item: ReviewItem | null) => void;
  /** 「自己改」：直接在文章上改，游標停在這一項引用的字前面（P5-T010）。 */
  onEditSource: (item: ReviewItem) => void;
}): JSX.Element {
  const review = job.review;
  const items = useMemo(() => review?.items ?? [], [review]);
  const [filter, setFilter] = useState<Filter>('all');
  const [expandSafe, setExpandSafe] = useState(false);
  /** 接受與略過共用一個 busy：兩個請求打到同一項上，後端得處理「已套用又被略過」。 */
  const resolve = useAction();
  const confirm = useConfirm();
  const listRef = useRef<HTMLDivElement>(null);

  // 從校樣點過來的：把那張卡片捲進畫面。
  useEffect(() => {
    if (activeId === null) return;
    const card = listRef.current?.querySelector<HTMLElement>(`[data-item='${activeId}']`);
    card?.scrollIntoView({
      block: 'nearest',
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
  }, [activeId]);

  if (!review) {
    return (
      <div className="margin-empty">
        <Icon name="sparkles" size={22} />
        <p>
          還沒有修改建議。按上面的「請 AI 看一遍」，錯字與需要你判斷的地方會標在文章上，
          並一項一項列在這裡。文章不會被自動改掉。
        </p>
      </div>
    );
  }

  const open = items.filter(isOpen);
  const resolved = items.filter((item) => !isOpen(item));
  const safe = open.filter(isSafeTypo);
  const grouped = safe.length >= 2 && !expandSafe;
  const counts = new Map<SuggestionKind, number>();
  for (const item of open) counts.set(kindOf(item), (counts.get(kindOf(item)) ?? 0) + 1);

  const visible = open.filter(
    (item) => (filter === 'all' || kindOf(item) === filter) && !(grouped && isSafeTypo(item)),
  );
  const showGroup = grouped && (filter === 'all' || filter === 'typo');

  const decide = (ids: number[], decision: 'apply' | 'skip'): void => {
    void resolve.run(async () => {
      await api.resolveReview(job.uuid, { itemIds: ids, decision });
      await refresh();
    });
  };

  return (
    <div className="margin-inner" ref={listRef}>
      <div className="pills margin-filters" role="tablist" aria-label="依類型篩選建議">
        <button
          type="button"
          role="tab"
          aria-selected={filter === 'all'}
          className="pill pill-small"
          data-active={filter === 'all' ? 'yes' : 'no'}
          onClick={() => setFilter('all')}
        >
          全部 {open.length}
        </button>
        {KIND_ORDER.filter((kind) => (counts.get(kind) ?? 0) > 0).map((kind) => (
          <button
            key={kind}
            type="button"
            role="tab"
            aria-selected={filter === kind}
            className="pill pill-small"
            data-kind={kind}
            data-active={filter === kind ? 'yes' : 'no'}
            onClick={() => setFilter(kind)}
          >
            {KIND_LABEL[kind]} {counts.get(kind)}
          </button>
        ))}
      </div>

      {review.summary !== null && <p className="margin-summary">{review.summary}</p>}

      {review.stale && (
        <p className="note note-warn">
          <Icon name="alert" size={14} />
          <span>
            這份建議做完之後文章又改過了。逐項接受還是可以試，找不到位置的會直接告訴你。
          </span>
        </p>
      )}

      <ErrorNote message={resolve.error} />

      {open.length === 0 && (
        <p className="note note-good">
          <Icon name="check-circle" size={14} />
          <span>建議都處理完了。</span>
        </p>
      )}

      {showGroup && (
        <article className="s-card s-group" data-kind="typo">
          <header className="s-card-head">
            <span className="s-kind" data-kind="typo">
              錯字 ×{safe.length}
            </span>
            <span className="s-note">都不會改到意思</span>
          </header>
          <ul className="s-group-list">
            {safe.map((item) => (
              <li key={item.id}>
                <button type="button" className="s-jump" onClick={() => onActivate(item)}>
                  <s className="s-before">{item.change?.before}</s>
                  <Icon name="chevron-right" size={12} />
                  <b className="s-after">{item.change?.after}</b>
                </button>
              </li>
            ))}
          </ul>
          <div className="s-actions">
            <button
              type="button"
              className="btn btn-primary btn-tiny"
              disabled={resolve.busy}
              onClick={() => decide(safe.map((item) => item.id), 'apply')}
            >
              {resolve.busy ? <Spinner /> : <Icon name="check" size={13} />}
              全部接受
            </button>
            <button type="button" className="btn btn-quiet btn-tiny" onClick={() => setExpandSafe(true)}>
              一項一項看
            </button>
          </div>
        </article>
      )}

      {visible.map((item) => (
        <SuggestionCard
          key={item.id}
          item={item}
          active={activeId === item.id}
          busy={resolve.busy}
          onActivate={() => onActivate(activeId === item.id ? null : item)}
          onDecide={(decision) => decide([item.id], decision)}
          onEditSource={() => onEditSource(item)}
        />
      ))}

      {resolved.length > 0 && (
        <details className="margin-resolved">
          <summary>已處理 {resolved.length} 項</summary>
          <ul>
            {resolved.map((item) => (
              <li key={item.id} data-state={item.state}>
                <Icon name={item.state === 'applied' || item.alreadyDone ? 'check' : 'minus'} size={13} />
                <span>
                  {item.change
                    ? `${item.change.before} → ${item.change.after}`
                    : `「${item.observation?.excerpt ?? ''}」`}
                </span>
                <span className="dim">
                  {resolvedLabel(item)}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="margin-footer">
        <button
          type="button"
          className="btn btn-quiet btn-tiny"
          disabled={review.stale || open.length === 0}
          onClick={() =>
            confirm({
              title: '採用 AI 的整份稿？',
              body: (
                <p>
                  這跟「每一項都接受」不一樣：整份採用會直接換成 AI 交回來的內容，包含它沒列進清單的調整。
                  之後仍然要看過成品、核准才發得出去。
                </p>
              ),
              confirmLabel: '整份採用',
              onConfirm: async () => {
                await api.acceptWholeReview(job.uuid, review.id);
                await refresh();
              },
            })
          }
        >
          整份採用
        </button>
        <button
          type="button"
          className="btn btn-quiet btn-tiny btn-danger-text"
          onClick={() =>
            confirm({
              title: '丟掉這份建議？',
              danger: true,
              body: (
                <p>
                  還沒處理的 {open.length} 項會一起消失，文章不受影響（本來就還沒動過）。
                  要再拿到建議只能再請 AI 看一遍。
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
          丟掉這份建議
        </button>
      </div>
    </div>
  );
}

function SuggestionCard({
  item,
  active,
  busy,
  onActivate,
  onDecide,
  onEditSource,
}: {
  item: ReviewItem;
  active: boolean;
  busy: boolean;
  onActivate: () => void;
  onDecide: (decision: 'apply' | 'skip') => void;
  onEditSource: () => void;
}): JSX.Element {
  const kind = kindOf(item);
  const change = item.change;
  const observation = item.observation;

  return (
    <article className="s-card" data-kind={kind} data-active={active ? 'yes' : 'no'} data-item={item.id}>
      <header className="s-card-head">
        <span className="s-kind" data-kind={kind}>
          {KIND_LABEL[kind]}・{detailOf(item)}
        </span>
        {change?.meaningChanged && (
          <span className="s-risk">
            <Icon name="alert" size={12} />
            可能改變原意
          </span>
        )}
        {item.blockIndex !== null && <span className="s-where">第 {item.blockIndex + 1} 段</span>}
      </header>

      <button type="button" className="s-jump s-body" onClick={onActivate} aria-pressed={active}>
        {change ? (
          <span className="s-diff">
            <s className="s-before">{change.before}</s>
            <Icon name="chevron-right" size={12} />
            <b className="s-after">{change.after}</b>
          </span>
        ) : (
          <span className="s-quote">「{observation?.excerpt}」</span>
        )}
      </button>

      <p className="s-reason">{change ? change.reason : observation?.detail}</p>
      {observation && <p className="s-suggest">建議：{observation.suggestion}</p>}

      {item.state === 'unappliable' && (
        <p className="s-hint">
          文章裡找不到「{change?.before}」，沒辦法自動改。要改的話按「自己改」，在文章裡找到那句直接改；不改就保留原文。
        </p>
      )}

      <div className="s-actions">
        {change && item.state === 'pending' && (
          <button type="button" className="btn btn-primary btn-tiny" disabled={busy} onClick={() => onDecide('apply')}>
            <Icon name="check" size={13} />
            接受
          </button>
        )}
        <button type="button" className="btn btn-quiet btn-tiny" onClick={onEditSource}>
          {change ? '自己改' : '去原文改'}
        </button>
        <button type="button" className="btn btn-quiet btn-tiny" disabled={busy} onClick={() => onDecide('skip')}>
          {change ? '保留原文' : '不用改'}
        </button>
      </div>
    </article>
  );
}

/**
 * 已處理那一項的下場。四種要分得開（P5-T012、P5-T017）：
 * 按了接受、自己在文章上改掉、文章裡早就是改好的樣子、決定不改。
 */
function resolvedLabel(item: ReviewItem): string {
  if (item.state === 'applied') return '已接受';
  if (item.alreadyDone) return '已經改好了';
  if (item.resolvedByEdit) return '自己改了';
  return '保留原文';
}
