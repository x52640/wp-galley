import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { api } from '../service/client.js';
import type { FactCheckFinding, FactCheckListResponse, LoadedJob, ReviewItem } from '../service/types.js';
import { Icon } from '../icons.js';
import { canFactCheckObservation } from '../../contract/factcheck.js';
import { isOpenFinding, latestRunNote, mergeByBlock, resolvedFindingLabel } from '../lib/factcheck-view.js';
import { FactcheckCard } from './FactcheckCard.js';
import { FcIcon } from './FactcheckIcon.js';
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
 *
 * AI 查證的卡片（D-034，P6-T005）跟校稿卡片混在同一張清單、依段落順序排；它不是改動，沒有「接受」。
 * 卡片的 key：校稿 `r<id>`、查證 `f<id>`（兩張表的 id 會撞號）。
 */

type Filter = 'all' | SuggestionKind | 'factcheck';

/** 清單上的一張卡片：校稿或查證。 */
type Entry =
  | { key: string; blockIndex: number | null; item: ReviewItem; finding?: undefined }
  | { key: string; blockIndex: number | null; finding: FactCheckFinding; item?: undefined };

export function reviewKey(item: ReviewItem): string {
  return `r${item.id}`;
}
export function findingKey(finding: FactCheckFinding): string {
  return `f${finding.id}`;
}

export function SuggestionColumn({
  job,
  factChecks,
  refresh,
  activeKey,
  onActivate,
  onEditSource,
  onEditFinding,
  onFactCheckObservation,
  factCheckBlocked,
  factCheckNote,
  contentLocked,
}: {
  job: LoadedJob;
  /** 這篇的查證結果（`GET …/factchecks`）；還沒讀到或後端沒有這個功能是 null。 */
  factChecks: FactCheckListResponse | null;
  refresh: () => Promise<void>;
  /** 目前亮起來的那一張（`r<id>`／`f<id>`，跟校樣上的標記同步）。 */
  activeKey: string | null;
  /** 點某一張：亮起來，校樣捲到那一段。null＝取消。 */
  onActivate: (entry: { key: string; blockIndex: number | null } | null) => void;
  /** 「自己改」：直接在文章上改，游標停在這一項引用的字前面（P5-T010）。 */
  onEditSource: (item: ReviewItem) => void;
  /** 查證卡片的「去原文改」：游標停在那句前面，存檔後那張結案（resolved-by-edit）。 */
  onEditFinding: (finding: FactCheckFinding) => void;
  /** 觀察卡片上的「查證」（D-034）。 */
  onFactCheckObservation: (item: ReviewItem) => void;
  /** 查證現在不能按的原因；能按是 null。 */
  factCheckBlocked: string | null;
  /** 這一家查證的限制說明（Antigravity 不能只開搜尋）；沒有是 null。 */
  factCheckNote: string | null;
  /** 內容鎖住（查證在跑，D-034）：接受、自己改、整份採用都不能按，這是原因。 */
  contentLocked: string | null;
}): JSX.Element {
  const review = job.review;
  const items = useMemo(() => review?.items ?? [], [review]);
  const findings = useMemo(() => factChecks?.findings ?? [], [factChecks]);
  const [filter, setFilter] = useState<Filter>('all');
  const [expandSafe, setExpandSafe] = useState(false);
  /** 「知道了」過的那一次查證說明（只在這次開著的期間記得）。 */
  const [hiddenRunNote, setHiddenRunNote] = useState<number | null>(null);
  /** 接受與略過共用一個 busy：兩個請求打到同一項上，後端得處理「已套用又被略過」。 */
  const resolve = useAction();
  const dismiss = useAction();
  const confirm = useConfirm();
  const listRef = useRef<HTMLDivElement>(null);

  // 從校樣點過來的：把那張卡片捲進畫面。
  useEffect(() => {
    if (activeKey === null) return;
    const card = listRef.current?.querySelector<HTMLElement>(`[data-item='${activeKey}']`);
    card?.scrollIntoView({
      block: 'nearest',
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
  }, [activeKey]);

  const latestRun = factChecks?.latestRun ?? null;
  const runNote = latestRun !== null && latestRun.id !== hiddenRunNote ? latestRunNote(latestRun) : null;

  if (!review && findings.length === 0 && runNote === null) {
    return (
      <div className="margin-empty">
        <Icon name="sparkles" size={22} />
        <p>
          還沒有修改建議。按上面的「請 AI 看一遍」，錯字與需要你判斷的地方會標在文章上，
          並一項一項列在這裡。文章不會被自動改掉。
        </p>
        <p className="margin-empty-sub">
          想確認某句話對不對：在文章上選字按「查證這句」，或從「請 AI 看一遍」旁的選單按「一鍵查證」。
        </p>
      </div>
    );
  }

  const open = items.filter(isOpen);
  const resolved = items.filter((item) => !isOpen(item));
  const openFindings = findings.filter(isOpenFinding);
  const resolvedFindings = findings.filter((finding) => !isOpenFinding(finding) && finding.status !== 'superseded');
  const safe = open.filter(isSafeTypo);
  const grouped = safe.length >= 2 && !expandSafe;
  const counts = new Map<SuggestionKind, number>();
  for (const item of open) counts.set(kindOf(item), (counts.get(kindOf(item)) ?? 0) + 1);

  const visibleItems = open.filter(
    (item) => (filter === 'all' || kindOf(item) === filter) && !(grouped && isSafeTypo(item)),
  );
  const visibleFindings = filter === 'all' || filter === 'factcheck' ? openFindings : [];
  const entries = mergeByBlock<Entry>([
    ...visibleItems.map((item) => ({ key: reviewKey(item), blockIndex: item.blockIndex, item })),
    ...visibleFindings.map((finding) => ({ key: findingKey(finding), blockIndex: finding.blockIndex, finding })),
  ]);
  const showGroup = grouped && (filter === 'all' || filter === 'typo');
  const allOpen = open.length + openFindings.length;
  const resolvedCount = resolved.length + resolvedFindings.length;

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
          全部 {allOpen}
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
        {openFindings.length > 0 && (
          <button
            type="button"
            role="tab"
            aria-selected={filter === 'factcheck'}
            className="pill pill-small"
            data-kind="factcheck"
            data-active={filter === 'factcheck' ? 'yes' : 'no'}
            onClick={() => setFilter('factcheck')}
          >
            查證 {openFindings.length}
          </button>
        )}
      </div>

      {review && review.summary !== null && <p className="margin-summary">{review.summary}</p>}

      {runNote !== null && latestRun !== null && (
        <p className={`note note-${runNote.tone === 'bad' ? 'bad' : runNote.tone === 'warn' ? 'warn' : 'info'} fc-run-note`} role="status">
          <FcIcon name={runNote.tone === 'bad' ? 'alert' : 'search-check'} size={14} />
          <span>{runNote.text}</span>
          <button type="button" className="btn btn-quiet btn-tiny" onClick={() => setHiddenRunNote(latestRun.id)}>
            知道了
          </button>
        </p>
      )}

      {review?.stale && (
        <p className="note note-warn">
          <Icon name="alert" size={14} />
          <span>
            這份建議做完之後文章又改過了。逐項接受還是可以試，找不到位置的會直接告訴你。
          </span>
        </p>
      )}

      <ErrorNote message={resolve.error} />
      <ErrorNote message={dismiss.error} />

      {allOpen === 0 && (review !== null || findings.length > 0) && (
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
                <button type="button" className="s-jump" onClick={() => onActivate({ key: reviewKey(item), blockIndex: item.blockIndex })}>
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
              disabled={resolve.busy || contentLocked !== null}
              title={contentLocked ?? undefined}
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

      {entries.map((entry) =>
        entry.item !== undefined ? (
          <SuggestionCard
            key={entry.key}
            item={entry.item}
            active={activeKey === entry.key}
            busy={resolve.busy}
            locked={contentLocked}
            factCheckBlocked={factCheckBlocked}
            factCheckNote={factCheckNote}
            onActivate={() => onActivate(activeKey === entry.key ? null : entry)}
            onDecide={(decision) => decide([entry.item.id], decision)}
            onEditSource={() => onEditSource(entry.item)}
            onFactCheck={() => onFactCheckObservation(entry.item)}
          />
        ) : (
          <FactcheckCard
            key={entry.key}
            finding={entry.finding}
            active={activeKey === entry.key}
            busy={dismiss.busy}
            locked={contentLocked}
            onActivate={() => onActivate(activeKey === entry.key ? null : entry)}
            onJump={() => onActivate(entry)}
            onEdit={() => onEditFinding(entry.finding)}
            onDismiss={() =>
              void dismiss.run(async () => {
                await api.dismissFactCheck(job.uuid, entry.finding.id);
                await refresh();
              })
            }
          />
        ),
      )}

      {resolvedCount > 0 && (
        <details className="margin-resolved">
          <summary>已處理 {resolvedCount} 項</summary>
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
            {resolvedFindings.map((finding) => (
              <li key={findingKey(finding)} data-state={finding.status}>
                <FcIcon name={finding.status === 'resolved-by-edit' || finding.excerptGone ? 'check' : 'search-check'} size={13} />
                <span>「{finding.excerpt}」</span>
                <span className="dim">查證・{resolvedFindingLabel(finding)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {review && (
      <div className="margin-footer">
        <button
          type="button"
          className="btn btn-quiet btn-tiny"
          disabled={review.stale || open.length === 0 || contentLocked !== null}
          title={contentLocked ?? undefined}
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
      )}
    </div>
  );
}

function SuggestionCard({
  item,
  active,
  busy,
  locked,
  factCheckBlocked,
  factCheckNote,
  onActivate,
  onDecide,
  onEditSource,
  onFactCheck,
}: {
  item: ReviewItem;
  active: boolean;
  busy: boolean;
  /** 內容鎖住的原因（查證在跑）；接受、自己改反灰。 */
  locked: string | null;
  factCheckBlocked: string | null;
  factCheckNote: string | null;
  onActivate: () => void;
  onDecide: (decision: 'apply' | 'skip') => void;
  onEditSource: () => void;
  onFactCheck: () => void;
}): JSX.Element {
  const kind = kindOf(item);
  const change = item.change;
  const observation = item.observation;
  // 「這句沒出處」「沒標出處」「前後矛盾」多一顆「查證」（D-034）：AI 校稿說沒出處，按一下就去找。
  const checkable = observation !== null && canFactCheckObservation(observation.kind) && isOpen(item);

  return (
    <article className="s-card" data-kind={kind} data-active={active ? 'yes' : 'no'} data-item={reviewKey(item)}>
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
          <button
            type="button"
            className="btn btn-primary btn-tiny"
            disabled={busy || locked !== null}
            title={locked ?? undefined}
            onClick={() => onDecide('apply')}
          >
            <Icon name="check" size={13} />
            接受
          </button>
        )}
        {checkable && (
          <button
            type="button"
            className="btn btn-tiny fc-check-btn"
            disabled={factCheckBlocked !== null}
            title={factCheckBlocked ?? '請 AI 找來源查這句（通常 1～3 分鐘，用掉兩次額度）'}
            onClick={onFactCheck}
          >
            <FcIcon name="search-check" size={13} />
            查證
          </button>
        )}
        <button
          type="button"
          className="btn btn-quiet btn-tiny"
          disabled={locked !== null}
          title={locked ?? undefined}
          onClick={onEditSource}
        >
          {change ? '自己改' : '去原文改'}
        </button>
        <button type="button" className="btn btn-quiet btn-tiny" disabled={busy} onClick={() => onDecide('skip')}>
          {change ? '保留原文' : '不用改'}
        </button>
      </div>
      {/* 「查證」的說明寫出來，不只靠滑過去：反灰的原因，或這一家的限制（跟選單、膠囊一致）。 */}
      {checkable && (factCheckBlocked ?? factCheckNote) !== null && (
        <p className="fc-card-note" data-tone={factCheckBlocked !== null ? 'dim' : 'warn'}>
          <FcIcon name="search-check" size={12} />
          <span>{factCheckBlocked !== null ? `查證：${factCheckBlocked}` : factCheckNote}</span>
        </p>
      )}
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
