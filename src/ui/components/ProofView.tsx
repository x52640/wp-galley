import { useCallback, useEffect, useRef, useState, type JSX, type ReactNode } from 'react';
import { api, describeError, isFixtureMode } from '../service/client.js';
import type { LoadedJob, ProofMark } from '../service/types.js';
import { Icon } from '../icons.js';
import { findIgnoringSpaces } from '../../contract/text-match.js';
import { shortHash } from '../lib/format.js';
import type { SuggestionKind } from '../lib/review-kinds.js';

/**
 * 中央校樣。
 *
 * 兩個關鍵決定：
 *
 * **一、iframe 直接指向 /api/jobs/:uuid/preview。**
 * 本機守門對每個回應都加 `X-Frame-Options: DENY`，那會連同源嵌入都擋掉；
 * 後端為校樣這一條路徑改用 `frame-ancestors`，只放行 loopback 的頁面
 * （見 src/server/plugins/local-only.ts）。所以 iframe 用 src 就好。
 *
 * `sandbox="allow-same-origin"`（**沒有** allow-scripts）：文件是同源的，
 * 所以量得到每一段的位置——頁邊符號才有辦法對齊它標的那一段——但裡面的
 * script 一律不執行。文件本身還帶著 `default-src 'none'` 的 CSP。
 *
 * 示範資料模式沒有後端可以指，改成把 HTML 放進 `srcdoc`，其餘完全一樣。
 *
 * **二、iframe 不自己捲動。**
 * 高度撐到內容的完整高度，捲動交給外層容器。這樣每一段的座標在文件裡是固定的，
 * 頁邊符號只要絕對定位在同一個捲動容器裡就會跟著一起動，不需要同步兩個捲軸。
 *
 * **三、建議標在字上（B1）。**
 * 外層把待處理的那段字包進 `<mark>`，顏色用 CSSOM（`element.style`）設定：文件的
 * CSP 擋的是 `<style>` 與 style 屬性，不管外層透過 CSSOM 改樣式；也不注入任何 script。
 * 點標記的事件由外層掛在文件上（處理函式屬於外層，iframe 自己仍然不能跑 script）。
 */

/** 校樣上要標出來的一段字。 */
export interface ProofHighlight {
  id: number;
  kind: SuggestionKind;
  text: string;
  /** 掛在第幾個頂層區塊；null＝定位不到，就在整篇裡找第一個。 */
  blockIndex: number | null;
}

/** 標記的顏色。跟 styles.css 的 --kind-* 同一套，這裡要能直接寫進 iframe。 */
const HIGHLIGHT_COLORS: Record<SuggestionKind, { bg: string; line: string }> = {
  typo: { bg: '#FCE3D6', line: '#C2410C' },
  style: { bg: '#E4EDE8', line: '#3F5B4F' },
  fact: { bg: '#DDE8F5', line: '#1E4F8A' },
  source: { bg: '#F6EDCF', line: '#8A6A14' },
};

interface BlockBox {
  index: number;
  top: number;
  /**
   * 區塊的高度。標亮某一段時要畫一個蓋住整段的框，所以高度也得量。
   *
   * 框畫在 iframe **外面**：文件本身帶著 `default-src 'none'` 的 CSP，而且
   * 「不去碰校樣文件的內部」本來就是這個元件的原則——量得到位置就夠了。
   */
  height: number;
  text: string;
}

export function ProofView({
  job,
  mode,
  highlights = [],
  activeHighlight = null,
  onHighlight,
  tools,
  focusBlock,
  onBlocks,
  onPreviewed,
  onPreviewHash,
}: {
  job: LoadedJob;
  /** `edit`＝標出建議與校對符號；`final`＝跟網站上一樣，什麼都不標。 */
  mode: 'edit' | 'final';
  highlights?: readonly ProofHighlight[];
  activeHighlight?: number | null;
  /** 點了文章裡某個標記。 */
  onHighlight?: (id: number) => void;
  /** 放在校樣上方工具列右邊的按鈕（例如「改原文」）。 */
  tools?: ReactNode;
  /** 待處理清單點過來的段落。會捲到那一段並畫一個框。 */
  focusBlock: number | null;
  /**
   * 把量到的區塊回報上去，圖片區的「插入位置」要用。
   *
   * 換版本時會先回報一個空陣列。舊的區塊索引對新版本沒有意義，留著會讓使用者
   * 把圖片插到上一版的第 3 段——那個位置在新版本可能是別的東西。
   */
  onBlocks?: (blocks: { index: number; text: string }[]) => void;
  /**
   * 校樣載入完就通知上層重新讀一次稿件。
   * 後端在 GET /preview 的時候把 RENDERED 推進 PREVIEWED（「還沒看過校樣，
   * 開啟預覽後才能核准」），不重讀的話畫面會停在上一個狀態。
   */
  onPreviewed?: () => void;
  /**
   * 校樣回應的 ETag（後端當下算出來的 content hash），問不到時回 null。
   * 核准要綁的是使用者眼睛看到的那一份，這個值就是拿來跟稿件的 hash 對帳的。
   */
  onPreviewHash?: (hash: string | null) => void;
}): JSX.Element {
  const [srcDoc, setSrcDoc] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bodyMissing, setBodyMissing] = useState(false);
  const [blocks, setBlocks] = useState<BlockBox[]>([]);
  const [height, setHeight] = useState(600);
  const [pinned, setPinned] = useState<string | null>(null);
  const [showMarks, setShowMarks] = useState(true);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  /**
   * 量測的世代編號。
   *
   * 上一版的 iframe 排了好幾個延後的量測（字型載完、ResizeObserver、250ms 的
   * 保險），版本一換那些回呼還在路上，回來時會把剛清掉的舊區塊又補回去。所以
   * 每次量測都帶著當時的世代，過期的就直接不算。
   */
  const measureToken = useRef(0);
  // 父層每次刷新都會給新的物件；用 ref 接住 callback，量測不必跟著重建。
  const onBlocksRef = useRef(onBlocks);
  onBlocksRef.current = onBlocks;
  const onPreviewedRef = useRef(onPreviewed);
  onPreviewedRef.current = onPreviewed;
  const onPreviewHashRef = useRef(onPreviewHash);
  onPreviewHashRef.current = onPreviewHash;
  const onHighlightRef = useRef(onHighlight);
  onHighlightRef.current = onHighlight;
  const [loadCount, setLoadCount] = useState(0);

  const revisionKey = job.currentRevision?.contentHash ?? 'none';
  const hasRevision = job.currentRevision !== null;
  const fixtures = isFixtureMode();
  /**
   * 渲染的世代。
   *
   * 「渲染」不一定換 hash，但後端要等校樣**在渲染之後被載入一次**才把 RENDERED 推進
   * PREVIEWED（人一定看過才准核准）。所以每次進入 RENDERED 就換一個網址重載一次。
   */
  const [renderEpoch, setRenderEpoch] = useState(0);
  /** 示範資料上一次拿到的校樣原始碼。 */
  const lastSrcDoc = useRef<string | null>(null);
  useEffect(() => {
    if (job.state === 'RENDERED') setRenderEpoch((epoch) => epoch + 1);
  }, [job.state]);
  // 內容一改就換一個網址，iframe 才會真的重載而不是吃快取。
  const previewSrc = `${job.previewUrl}?v=${revisionKey}&r=${renderEpoch}`;

  useEffect(() => {
    if (!fixtures) return;
    let cancelled = false;
    if (!hasRevision) {
      setSrcDoc(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    api
      .fetchPreview(job.uuid)
      .then((text) => {
        if (cancelled) return;
        // 內容一模一樣時 iframe 不會重載、也就不會觸發 onLoad。抓這一次本身就等於
        // 「看過了」，所以直接收尾，不然畫面會一直停在「載入校樣…」。
        if (text === lastSrcDoc.current) {
          setLoading(false);
          onPreviewedRef.current?.();
          return;
        }
        lastSrcDoc.current = text;
        setSrcDoc(text);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(describeError(cause));
      });
    return () => {
      cancelled = true;
    };
    // renderEpoch：渲染之後要重抓一次，示範資料才會跟真的後端一樣推進 PREVIEWED。
  }, [job.uuid, revisionKey, hasRevision, fixtures, renderEpoch]);

  /**
   * 換版本＝上一版量到的東西全部作廢。
   *
   * 只把 loading 打開是不夠的：舊的 blocks 還在 state 裡，圖片區的「插入位置」
   * 就還選得到上一版的第 n 段，送出去的索引會落在新版本的別的地方。所以這裡把
   * 區塊清空並且通知父層，等新的校樣量完才會再有東西可選。
   */
  useEffect(() => {
    measureToken.current += 1;
    setLoading(true);
    setBodyMissing(false);
    setBlocks([]);
    setPinned(null);
    onBlocksRef.current?.([]);
    onPreviewHashRef.current?.(null);
  }, [revisionKey]);

  // 校樣本體是 iframe 自己載的，header 拿不到，只能另外問一次 ETag。
  useEffect(() => {
    if (!hasRevision) {
      onPreviewHashRef.current?.(null);
      return;
    }
    let cancelled = false;
    api
      .fetchPreviewHash(job.uuid)
      .then((hash) => {
        if (!cancelled) onPreviewHashRef.current?.(hash);
      })
      .catch(() => {
        // 問不到就當「無法確認」，不要因此擋住整個校樣。
        if (!cancelled) onPreviewHashRef.current?.(null);
      });
    return () => {
      cancelled = true;
    };
  }, [job.uuid, revisionKey, hasRevision]);

  useEffect(() => () => observerRef.current?.disconnect(), []);

  const measure = useCallback((token: number) => {
    if (token !== measureToken.current) return;
    const frame = frameRef.current;
    const doc = frame?.contentDocument;
    if (!frame || !doc?.body) return;

    // 先讓 iframe 貼齊內容高度，量到的座標才等於文件座標。
    //
    // 不能用 documentElement.scrollHeight：它至少等於 iframe 目前的高度，
    // 於是高度只會被撐大、不會縮回去，短文章下面會拖一片空白。改量 body 的
    // 底邊，那是純粹的內容高度。
    const scrollY = frame.contentWindow?.scrollY ?? 0;
    const bottom = doc.body.getBoundingClientRect().bottom + scrollY;
    setHeight(Math.max(Math.ceil(bottom), 200));

    const body = doc.querySelector('.preview-body');
    const children = body ? Array.from(body.children) : [];
    const measured = children.map((element, index) => {
      const box = element.getBoundingClientRect();
      return {
        index,
        top: box.top + scrollY,
        height: box.height,
        text: (element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40),
      };
    });
    setBlocks(measured);
    onBlocksRef.current?.(measured.map(({ index, text }) => ({ index, text })));
  }, []);

  const handleLoad = useCallback(() => {
    const token = measureToken.current;
    setLoading(false);
    measure(token);
    const doc = frameRef.current?.contentDocument;
    if (!doc) return;
    // 預覽回錯誤時 iframe 裡會是一段 JSON，不是校樣。要說出來，不要靜靜地空著。
    setBodyMissing(doc.querySelector('.preview-body') === null);
    onPreviewedRef.current?.();
    setLoadCount((count) => count + 1);
    // 點文章裡的標記＝在右欄亮起那一項。處理函式屬於外層，iframe 自己不跑 script。
    doc.addEventListener('click', (event) => {
      // 不能用 instanceof Element：iframe 裡的節點屬於另一個視窗，外層的 Element 認不得它。
      const target = event.target as Element | null;
      const mark = typeof target?.closest === 'function' ? target.closest('mark[data-hl]') : null;
      if (mark) onHighlightRef.current?.(Number(mark.getAttribute('data-hl')));
    });
    // 字型與圖片載入完會改變高度，要再量一次。
    void doc.fonts.ready.then(() => measure(token));
    observerRef.current?.disconnect();
    const observer = new ResizeObserver(() => measure(token));
    observer.observe(doc.documentElement);
    observerRef.current = observer;
    window.setTimeout(() => measure(token), 250);
  }, [measure]);

  // 從清單點過來的那一段：捲過去並畫框。量測還沒好就先不動，等量完這個 effect
  // 會因為 blocks 改變再跑一次。
  const focused = focusBlock === null ? undefined : blocks.find((block) => block.index === focusBlock);
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const frame = frameRef.current;
    const scroller = scrollRef.current;
    if (focused === undefined || !frame || !scroller) return;
    const offset = frame.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    scroller.scrollTo({
      top: Math.max(offset + focused.top - 96, 0),
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
  }, [focused?.index, focused?.top]);

  // 把建議標到字上。內容、清單或模式一變就整個重標：先拆掉舊的，再包新的。
  const highlightKey = highlights.map((h) => `${h.id}:${h.kind}:${h.blockIndex}:${h.text}`).join('|');
  useEffect(() => {
    const doc = frameRef.current?.contentDocument;
    const body = doc?.querySelector('.preview-body');
    if (!doc || !body) return;
    for (const mark of Array.from(body.querySelectorAll('mark[data-hl]'))) {
      mark.replaceWith(...Array.from(mark.childNodes));
    }
    body.normalize();
    if (mode !== 'edit') return;
    for (const highlight of highlights) {
      const scope = highlight.blockIndex === null ? body : body.children[highlight.blockIndex];
      if (scope) wrapFirst(doc, scope, highlight, highlight.id === activeHighlight);
    }
    measure(measureToken.current);
    // highlights 由 highlightKey 代表；陣列本身每次都是新的。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightKey, activeHighlight, mode, loadCount, measure]);

  // 從右欄點過來的那一項：捲到它在文章裡的位置。
  useEffect(() => {
    if (activeHighlight === null || mode !== 'edit') return;
    const frame = frameRef.current;
    const scroller = scrollRef.current;
    const mark = frame?.contentDocument?.querySelector(`mark[data-hl='${activeHighlight}']`);
    if (!frame || !scroller || !mark) return;
    const offset = frame.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    const top = mark.getBoundingClientRect().top + (frame.contentWindow?.scrollY ?? 0);
    scroller.scrollTo({
      top: Math.max(offset + top - 160, 0),
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
  }, [activeHighlight, mode, loadCount]);

  const markGroups = mode === 'edit' ? groupMarks(job.marks) : [];

  return (
    <section className="proof" aria-label="校樣">
      <header className="proof-bar">
        <div className="proof-bar-left">
          <span className="proof-chip mono">r{job.currentRevision?.number ?? 0}</span>
          <span className="proof-chip mono" title="內容 hash：核准就是綁在這個值上">
            {shortHash(job.currentRevision?.contentHash)}
          </span>
          <span className="proof-bar-sep" aria-hidden="true" />
          <span className="proof-bar-note">
            {job.marks.length === 0 ? '與上一版相同' : `${job.marks.length} 處改動`}
          </span>
        </div>
        {job.marks.length > 0 && mode === 'edit' && (
          <label className="proof-toggle">
            <input
              type="checkbox"
              checked={showMarks}
              onChange={(event) => setShowMarks(event.target.checked)}
            />
            <span>顯示校對符號</span>
          </label>
        )}
        {tools}
      </header>

      <div className="proof-scroll" ref={scrollRef}>
        {loading && <p className="proof-status">載入校樣…</p>}

        {error && (
          <p className="proof-status proof-status-bad" role="alert">
            <Icon name="alert" size={15} /> 校樣載入失敗：{error}
          </p>
        )}

        {bodyMissing && !error && (
          <p className="proof-status proof-status-bad" role="alert">
            <Icon name="alert" size={15} /> 校樣讀不到正文。按右邊的「重新渲染」再試一次。
          </p>
        )}

        {!loading && !error && !job.currentRevision && (
          <div className="proof-empty">
            <Icon name="file-text" size={28} />
            <p>還沒有內容。先在右邊貼上原稿，再按「渲染」。</p>
          </div>
        )}

        {hasRevision && (fixtures ? srcDoc !== null : true) && (
          <div className="proof-sheet" style={{ height: `${height}px` }}>
            {showMarks && (
              <div className="proof-gutter" aria-label="校對符號">
                {markGroups.map(({ blockIndex, marks }) =>
                  marks.map((mark, order) => {
                    const id = `${blockIndex}-${mark.kind}-${order}`;
                    const top = blocks.find((block) => block.index === blockIndex)?.top;
                    if (top === undefined) return null;
                    return (
                      <MarkPin
                        key={id}
                        id={id}
                        mark={mark}
                        top={top + order * 26}
                        pinned={pinned === id}
                        onToggle={() => setPinned((current) => (current === id ? null : id))}
                      />
                    );
                  }),
                )}
              </div>
            )}

            {focused !== undefined && (
              <div
                className="proof-focus"
                style={{ top: `${focused.top - 6}px`, height: `${focused.height + 12}px` }}
                aria-hidden="true"
              />
            )}

            <iframe
              ref={frameRef}
              className="proof-frame"
              title="文章校樣"
              {...(fixtures ? { srcDoc: srcDoc ?? '' } : { src: previewSrc })}
              sandbox="allow-same-origin"
              style={{ height: `${height}px` }}
              onLoad={handleLoad}
            />
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * 在 scope 裡找第一段相同的文字（忽略空白，規則跟後端算「第 N 段」共用），包進 `<mark>`。
 *
 * 只在單一文字節點裡找：跨過標籤的（`今天<em>讀完`）不包，跟後端逐項套用的規則
 * 一致（docs/specs/review-proposals.md）——找不到就不標，右欄的卡片照樣在。
 */
function wrapFirst(doc: Document, scope: Element, highlight: ProofHighlight, active: boolean): void {
  if (highlight.text.length === 0) return;
  const walker = doc.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node as Text;
    if (text.parentElement?.closest('mark[data-hl]')) continue;
    const hit = findIgnoringSpaces(text.data, highlight.text);
    if (hit === null) continue;
    const range = doc.createRange();
    range.setStart(text, hit.start);
    range.setEnd(text, hit.end);
    const mark = doc.createElement('mark');
    mark.setAttribute('data-hl', String(highlight.id));
    const color = HIGHLIGHT_COLORS[highlight.kind];
    mark.style.background = color.bg;
    mark.style.color = 'inherit';
    mark.style.borderBottom = `2px solid ${color.line}`;
    mark.style.borderRadius = '2px';
    mark.style.cursor = 'pointer';
    if (active) {
      mark.style.outline = `2px solid ${color.line}`;
      mark.style.outlineOffset = '2px';
    }
    range.surroundContents(mark);
    return;
  }
}

const KIND_LABEL: Record<ProofMark['kind'], string> = {
  inserted: '新增',
  deleted: '刪除',
  replaced: '改寫',
  moved: '調動',
};

function MarkPin({
  id,
  mark,
  top,
  pinned,
  onToggle,
}: {
  id: string;
  mark: ProofMark;
  top: number;
  pinned: boolean;
  onToggle: () => void;
}): JSX.Element {
  return (
    <div className="mark" style={{ top: `${top}px` }} data-pinned={pinned ? 'yes' : 'no'}>
      <button
        type="button"
        className="mark-pin"
        aria-expanded={pinned}
        aria-controls={`mark-detail-${id}`}
        onClick={onToggle}
      >
        <span className="mark-glyph" aria-hidden="true">
          {mark.glyph}
        </span>
        <span className="sr-only">
          第 {mark.blockIndex + 1} 段{KIND_LABEL[mark.kind]}：{mark.summary}
        </span>
      </button>

      <div className="mark-pop" id={`mark-detail-${id}`} role="note">
        <p className="mark-pop-head">
          <span className="mark-pop-kind">{KIND_LABEL[mark.kind]}</span>
          <span className="mark-pop-where mono">第 {mark.blockIndex + 1} 段</span>
        </p>
        <p className="mark-pop-summary">{mark.summary}</p>
        {mark.before !== null && (
          <p className="mark-pop-line">
            <span className="mark-pop-tag">前</span>
            <span className="mark-pop-before">{mark.before}</span>
          </p>
        )}
        {mark.after !== null && (
          <p className="mark-pop-line">
            <span className="mark-pop-tag">後</span>
            <span className="mark-pop-after">{mark.after}</span>
          </p>
        )}
      </div>
    </div>
  );
}

function groupMarks(marks: ProofMark[]): { blockIndex: number; marks: ProofMark[] }[] {
  const byBlock = new Map<number, ProofMark[]>();
  for (const mark of marks) {
    const bucket = byBlock.get(mark.blockIndex);
    if (bucket) bucket.push(mark);
    else byBlock.set(mark.blockIndex, [mark]);
  }
  return [...byBlock.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([blockIndex, list]) => ({ blockIndex, marks: list }));
}
