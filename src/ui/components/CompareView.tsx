import { useEffect, useRef, useState, type JSX, type ReactNode } from 'react';
import { api, describeError } from '../service/client.js';
import type { Comparison, CompareRow, DiffSegment, LoadedJob } from '../service/types.js';
import { Icon } from '../icons.js';

/**
 * 左右對照。
 *
 * 三個決定：
 *
 * **一、比對在後端算。** 逐詞比對要用 `Intl.Segmenter` 斷中文詞，而區塊配對要
 * 用 parse5 拆頂層區塊——兩件事後端都已經做了，而且有測試。前端再寫一份只會
 * 得到兩套不一樣的答案，「第 n 段」到底是哪一段就沒人說得準了。
 *
 * **二、顯示的是純文字，不是排版。** 這個畫面的用途是逐字比對；排版看校樣。
 * 把 HTML 塞進來只會讓逐詞標記跟原本的標籤打架，而且 Agent 交回來的東西會直接
 * 出現在畫面上——那條線不能鬆。
 *
 * **三、左右兩欄共用同一串差異序列。** 左欄畫 same + removed，右欄畫 same + added，
 * 所以兩欄天然對齊，不需要再同步一次捲軸或高度。
 */

export function CompareView({
  job,
  focusBlock,
  /** 內容一改就重抓；父層把目前的 content hash 傳進來當作重抓的依據。 */
  revisionKey,
  tools,
}: {
  job: LoadedJob;
  /**
   * 待處理清單點過來的段落。
   *
   * 標亮只從清單進來，列本身**不可點**：整列掛點擊會跟「選取文字拿去比對」
   * 打架，而 div 上的點擊也沒有鍵盤路徑。
   */
  focusBlock: number | null;
  revisionKey: string;
  /** 工具列右邊的按鈕。對照蓋住了校樣的工具列，「回到文章」要放在這裡才按得到。 */
  tools?: ReactNode;
}): JSX.Element {
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const focusRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setComparison(null);
    setError(null);
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

  // 從清單點過來的那一段要自己滾到看得見的地方，不然使用者得自己找。
  useEffect(() => {
    if (focusBlock === null) return;
    focusRef.current?.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }, [focusBlock, comparison]);

  return (
    <section className="compare" aria-label="左右對照">
      <header className="proof-bar">
        <div className="proof-bar-left">
          {comparison !== null && comparison.against !== 'none' ? (
            <>
              <span className="proof-chip mono">{comparison.leftLabel}</span>
              <Icon name="chevron-right" size={13} />
              <span className="proof-chip mono">{comparison.rightLabel}</span>
              <span className="proof-bar-sep" aria-hidden="true" />
              <span className="proof-bar-note">
                {countChanged(comparison.rows) === 0
                  ? '兩邊一模一樣'
                  : `${countChanged(comparison.rows)} 段有差異`}
              </span>
            </>
          ) : (
            <span className="proof-bar-note">左右對照</span>
          )}
        </div>
        {tools}
      </header>

      <div className="compare-scroll" ref={scrollRef}>
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
            <div className="compare-head" aria-hidden="true">
              <span>{comparison.leftLabel}</span>
              <span>{comparison.rightLabel}</span>
            </div>
            {/*
              focusBlock 是「目前內容」的區塊索引（待處理清單是對著目前內容算的）。
              跟提案比的時候目前內容在**左**欄，跟上一版比的時候在**右**欄——
              比錯欄位的話，提案只要在焦點之前插入一段，標亮的就會是隔壁那一列。
            */}
            {comparison.rows.map((row, index) => {
              const currentIndex =
                comparison.against === 'proposal' ? row.leftIndex : row.rightIndex;
              const focused = focusBlock !== null && currentIndex === focusBlock;
              return (
                <div
                  key={`${row.kind}-${row.leftIndex}-${row.rightIndex}-${index}`}
                  className="compare-row"
                  data-kind={row.kind}
                  data-focused={focused ? 'yes' : 'no'}
                  ref={focused ? focusRef : null}
                >
                  <p className="compare-num mono" aria-hidden="true">
                    {(row.rightIndex ?? row.leftIndex ?? 0) + 1}
                  </p>
                  <div className="compare-cell compare-cell-left">
                    {row.left === null ? <Empty label="（這一版沒有這一段）" /> : <Segments segments={row.left} />}
                  </div>
                  <div className="compare-cell compare-cell-right">
                    {row.right === null ? <Empty label="（這一段被刪掉了）" /> : <Segments segments={row.right} />}
                  </div>
                  {row.note !== null && (
                    <p className="compare-note">
                      <Icon name="alert" size={13} />
                      {row.note}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

function Segments({ segments }: { segments: DiffSegment[] }): JSX.Element {
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

function Empty({ label }: { label: string }): JSX.Element {
  return <p className="compare-text compare-text-empty">{label}</p>;
}

function countChanged(rows: readonly CompareRow[]): number {
  return rows.filter((row) => row.kind !== 'same').length;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
