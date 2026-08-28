import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { api, describeError, isFixtureMode } from '../service/client.js';
import type { LoadedJob, ProofMark } from '../service/types.js';
import { Icon } from '../icons.js';
import { shortHash } from '../lib/format.js';

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
 */

interface BlockBox {
  index: number;
  top: number;
  text: string;
}

export function ProofView({
  job,
  onBlocks,
  onPreviewed,
}: {
  job: LoadedJob;
  /** 把量到的區塊回報上去，右面板的「插入位置」要用。 */
  onBlocks?: (blocks: { index: number; text: string }[]) => void;
  /**
   * 校樣載入完就通知上層重新讀一次 job。
   * 後端在 GET /preview 的時候把 RENDERED 推進 PREVIEWED（「還沒看過校樣，
   * 開啟預覽後才能核准」），不重讀的話畫面會停在上一個狀態。
   */
  onPreviewed?: () => void;
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
  // 父層每次刷新都會給新的物件；用 ref 接住 callback，量測不必跟著重建。
  const onBlocksRef = useRef(onBlocks);
  onBlocksRef.current = onBlocks;
  const onPreviewedRef = useRef(onPreviewed);
  onPreviewedRef.current = onPreviewed;

  const revisionKey = job.currentRevision?.contentHash ?? 'none';
  const hasRevision = job.currentRevision !== null;
  const fixtures = isFixtureMode();
  // 內容一改就換一個網址，iframe 才會真的重載而不是吃快取。
  const previewSrc = `${job.previewUrl}?v=${revisionKey}`;

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
        if (!cancelled) setSrcDoc(text);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(describeError(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [job.uuid, revisionKey, hasRevision, fixtures]);

  useEffect(() => {
    setLoading(true);
    setBodyMissing(false);
  }, [revisionKey]);

  useEffect(() => () => observerRef.current?.disconnect(), []);

  const measure = useCallback(() => {
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
    const measured = children.map((element, index) => ({
      index,
      top: element.getBoundingClientRect().top + scrollY,
      text: (element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40),
    }));
    setBlocks(measured);
    onBlocksRef.current?.(measured.map(({ index, text }) => ({ index, text })));
  }, []);

  const handleLoad = useCallback(() => {
    setLoading(false);
    measure();
    const doc = frameRef.current?.contentDocument;
    if (!doc) return;
    // 預覽回錯誤時 iframe 裡會是一段 JSON，不是校樣。要說出來，不要靜靜地空著。
    setBodyMissing(doc.querySelector('.preview-body') === null);
    onPreviewedRef.current?.();
    // 字型與圖片載入完會改變高度，要再量一次。
    void doc.fonts.ready.then(() => measure());
    observerRef.current?.disconnect();
    const observer = new ResizeObserver(() => measure());
    observer.observe(doc.documentElement);
    observerRef.current = observer;
    window.setTimeout(() => measure(), 250);
  }, [measure]);

  const markGroups = groupMarks(job.marks);

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
        {job.marks.length > 0 && (
          <label className="proof-toggle">
            <input
              type="checkbox"
              checked={showMarks}
              onChange={(event) => setShowMarks(event.target.checked)}
            />
            <span>顯示校對符號</span>
          </label>
        )}
      </header>

      <div className="proof-scroll">
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
