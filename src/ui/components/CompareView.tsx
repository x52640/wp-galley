import { useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX, type ReactNode } from 'react';
import { api, describeError } from '../service/client.js';
import type { Comparison, CompareRow, DiffSegment, FieldChange, LoadedJob } from '../service/types.js';
import { buildDiffEntries, currentIndexOf, runKeyForBlock, summarizeComparison } from '../lib/diff-view.js';
import { Icon } from '../icons.js';

/**
 * 對照（D-019，git diff 式）。
 *
 * 以前是左右兩欄把全文列兩次，改動淹沒在沒變的段落裡；只換了封面的版本還寫「兩邊一模一樣」。
 * 現在是單欄：
 *
 * - 最上面一句先講結論（正文改／增／刪幾段，以及標題、網址、封面、分類這些正文以外的改動）。
 * - 只列有改的段落，刪掉的字紅色刪除線、加上的字綠色，直接標在句子裡。
 * - 連續沒變的段落收成一行，點了展開、再點收起。
 *
 * 幾個不變的決定：
 *
 * **比對在後端算。** 逐詞比對要用 `Intl.Segmenter` 斷中文詞，區塊配對要用 parse5 拆頂層區塊——
 * 兩件事後端都做了而且有測試。前端只決定收合與呈現（`lib/diff-view.ts`）。
 *
 * **顯示的是純文字，不是排版。** 排版看校樣；把 HTML 塞進來會讓逐詞標記跟標籤打架，
 * 而且 Agent 交回來的東西會直接出現在畫面上——那條線不能鬆。
 */

export function CompareView({
  job,
  focusBlock,
  focusSeq,
  /** 內容一改就重抓；父層把目前的 content hash 傳進來當作重抓的依據。 */
  revisionKey,
  tools,
}: {
  job: LoadedJob;
  /**
   * 右欄卡片點過來的段落（目前文章的區塊索引）。
   *
   * 標亮只從卡片進來，列本身**不可點**：整列掛點擊會跟「選取文字」打架，
   * 而 div 上的點擊也沒有鍵盤路徑。
   */
  focusBlock: number | null;
  /** 每點一次卡片加一。同一張卡片連點兩次（中間把那一組收起來了）也要再展開、再捲過去。 */
  focusSeq: number;
  revisionKey: string;
  /** 工具列右邊的按鈕。對照蓋住了校樣的工具列，「回到文章」要放在這裡才按得到。 */
  tools?: ReactNode;
}): JSX.Element {
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 展開的那幾組沒變的段落。 */
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const focusRef = useRef<HTMLDivElement>(null);
  /** 點過卡片、還沒捲過去。展開一組之後要等畫面長出那一段才捲得到，所以不能在同一個 effect 裡捲。 */
  const pendingScroll = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setComparison(null);
    setError(null);
    setExpanded(new Set());
    api
      .fetchComparison(job.uuid)
      .then((next) => {
        if (!cancelled) setComparison(next);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(describeError(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [job.uuid, revisionKey, job.review?.id]);

  const entries = useMemo(() => (comparison === null ? [] : buildDiffEntries(comparison)), [comparison]);

  // 卡片指到的段落被收起來了就展開那一組，然後捲過去。
  useEffect(() => {
    if (focusBlock === null || comparison === null) return;
    const key = runKeyForBlock(entries, focusBlock, comparison.against);
    pendingScroll.current = true;
    if (key !== null) {
      // 展開之後重畫，下面的 layout effect 再捲；已經展開的話 setExpanded 不會重畫，直接捲。
      setExpanded((current) => (current.has(key) ? current : new Set(current).add(key)));
    }
    scrollToFocus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusBlock, focusSeq, comparison, entries]);

  useLayoutEffect(() => {
    scrollToFocus();
  });

  function scrollToFocus(): void {
    if (!pendingScroll.current || focusRef.current === null) return;
    pendingScroll.current = false;
    focusRef.current.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }

  const toggle = (key: string): void =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const isFocused = (row: CompareRow): boolean =>
    focusBlock !== null && comparison !== null && currentIndexOf(row, comparison.against) === focusBlock;

  return (
    <section className="compare" aria-label="對照">
      <header className="proof-bar">
        <div className="proof-bar-left">
          {comparison !== null && comparison.against !== 'none' ? (
            <>
              <span className="proof-chip mono">{comparison.leftLabel}</span>
              <Icon name="chevron-right" size={13} />
              <span className="proof-chip mono">{comparison.rightLabel}</span>
            </>
          ) : (
            <span className="proof-bar-note">對照</span>
          )}
        </div>
        {tools}
      </header>

      <div className="compare-scroll">
        {error !== null && (
          <p className="proof-status proof-status-bad" role="alert">
            <Icon name="alert" size={15} /> 對照載入失敗：{error}
          </p>
        )}

        {error === null && comparison === null && <p className="proof-status">載入對照…</p>}

        {comparison !== null && comparison.against === 'none' && (
          <div className="proof-empty">
            <Icon name="columns" size={28} />
            <p>沒有可以對照的東西。這篇只有一個版本，也沒有待處理的校稿提案。</p>
          </div>
        )}

        {comparison !== null && comparison.against !== 'none' && (
          <div className="compare-sheet">
            <div className="diff-summary">
              <p className="diff-summary-line">{summarizeComparison(comparison)}</p>
              {comparison.fieldChanges.length > 0 && (
                <ul className="diff-fields">
                  {comparison.fieldChanges.map((change) => (
                    <FieldLine key={change.field} change={change} />
                  ))}
                </ul>
              )}
            </div>

            {entries.map((entry) => {
              if (entry.type === 'change') {
                const focused = isFocused(entry.row);
                return (
                  <div
                    key={entry.key}
                    className="diff-row"
                    data-kind={entry.row.kind}
                    data-focused={focused ? 'yes' : 'no'}
                    ref={focused ? focusRef : null}
                  >
                    <p className="diff-row-head">
                      <span className="diff-pos">{entry.position}</span>
                      <span className="diff-kind" data-kind={entry.row.kind}>
                        {entry.kindLabel}
                      </span>
                    </p>
                    <Segments segments={entry.row.segments} />
                    {entry.row.note !== null && (
                      <p className="compare-note">
                        <Icon name="alert" size={13} />
                        {entry.row.note}
                      </p>
                    )}
                  </div>
                );
              }

              const open = expanded.has(entry.key);
              const range = entry.first === entry.last ? `第 ${entry.first} 段` : `第 ${entry.first}–${entry.last} 段`;
              return (
                <div key={entry.key} className="diff-fold" data-open={open ? 'yes' : 'no'}>
                  <button
                    type="button"
                    className="diff-fold-toggle"
                    aria-expanded={open}
                    onClick={() => toggle(entry.key)}
                  >
                    <Icon name={open ? 'chevron-down' : 'chevron-right'} size={13} />
                    <span>
                      ⋯ {range}沒變{entry.count > 1 ? `（${entry.count} 段）` : ''} ⋯
                    </span>
                    <span className="diff-fold-hint">{open ? '收起' : '展開'}</span>
                  </button>
                  {open &&
                    entry.rows.map((row, index) => {
                      const focused = isFocused(row);
                      return (
                        <div
                          key={index}
                          className="diff-row"
                          data-kind="same"
                          data-focused={focused ? 'yes' : 'no'}
                          ref={focused ? focusRef : null}
                        >
                          <p className="diff-row-head">
                            <span className="diff-pos">第 {entry.first + index} 段</span>
                          </p>
                          <Segments segments={row.segments} />
                        </div>
                      );
                    })}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

function FieldLine({ change }: { change: FieldChange }): JSX.Element {
  return (
    <li className="diff-field">
      <span className="diff-field-label">{change.label}</span>
      {change.before === null ? (
        <span className="diff-field-none">（沒有）</span>
      ) : (
        <del className="seg" data-op="removed">
          <span className="sr-only">原本是</span>
          {change.before}
        </del>
      )}
      <Icon name="chevron-right" size={12} />
      {change.after === null ? (
        <span className="diff-field-none">（拿掉了）</span>
      ) : (
        <ins className="seg" data-op="added">
          <span className="sr-only">改成</span>
          {change.after}
        </ins>
      )}
    </li>
  );
}

function Segments({ segments }: { segments: DiffSegment[] }): JSX.Element {
  if (segments.length === 0) return <p className="compare-text compare-text-empty">（這一段沒有文字，例如圖片或分隔線）</p>;
  return (
    <p className="compare-text">
      {segments.map((segment, index) =>
        segment.op === 'same' ? (
          <span key={index}>{segment.text}</span>
        ) : (
          // 不只靠顏色：刪掉的加刪除線，加上的加底線，另外給螢幕閱讀器一句話。
          <mark key={index} className="seg" data-op={segment.op}>
            <span className="sr-only">{segment.op === 'removed' ? '刪除起' : '新增起'}</span>
            {segment.text}
            <span className="sr-only">{segment.op === 'removed' ? '刪除迄' : '新增迄'}</span>
          </mark>
        ),
      )}
    </p>
  );
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
