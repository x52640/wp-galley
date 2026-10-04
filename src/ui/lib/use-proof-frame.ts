import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type RefObject, type SetStateAction } from 'react';
import { api, describeError, isFixtureMode } from '../service/client.js';
import type { LoadedJob } from '../service/types.js';
import { attachEditInterceptors, markBlank } from './proof-edit-dom.js';
import { blockSnippet, contentHeight, type BlockBox } from './proof-frame.js';
import { applyHighlights, clickedMarkKey, highlightKey, type ProofHighlight } from './proof-highlights.js';
import type { ProofEditing } from './use-proof-editing.js';

/**
 * 校樣 iframe 本體（P5-T043 從 ProofView 抽出）：載入、量測、ResizeObserver、字上標記、捲動對齊。
 *
 * **iframe 不自己捲動。**
 * 高度撐到內容的完整高度，捲動交給外層容器。這樣每一段的座標在文件裡是固定的，
 * 頁邊符號只要絕對定位在同一個捲動容器裡就會跟著一起動，不需要同步兩個捲軸。
 * 「不捲動」是做出來的，不是期望（P5-T029）：iframe 帶 `scrolling="no"`，載入後外層用 CSSOM 把文件的
 * `html` 設成 `overflow: hidden`（不注入 script），量高度時把 body 的下外距與 html 的下內距算進去
 * ——以前只量 body 的底邊，漏掉瀏覽器預設的 8px 下外距，文件永遠多出 8px 可以捲，滑鼠停在文章上
 * 滾輪要先把這 8px 捲完，外層才會動（「要滾兩次」）。文件不能捲，Chrome 就把滾輪直接交給外層。
 * 打字時瀏覽器為了讓游標看得見仍可能把文件捲下去；量測時一律捲回頂端。
 *
 * **effect 的順序跟抽出前一樣**（React 照呼叫順序跑 effect），所以分成兩個 hook，ProofView 依序呼叫：
 * 1. `useProofMeasure`：渲染世代的 effect、`measure`。打字模式（`useProofEditing`）要用 `measure`，它的 effect 排在這之後。
 * 2. `useProofFrame`：示範資料抓校樣、換版本清空、問 ETag、ResizeObserver 收尾、捲到清單點的段落、標記、捲到點的標記。
 *    進出編輯的 effect 排在這之後（留在 ProofView）。
 * 選字膠囊與插圖面板在這兩個之後才建立：換版本與載入時要通知它們，用 ProofView 傳進來的函式（effect 與事件都在 render 之後才跑）。
 */

export interface ProofMeasure {
  frameRef: RefObject<HTMLIFrameElement | null>;
  scrollRef: RefObject<HTMLDivElement | null>;
  /**
   * 量測的世代編號。
   *
   * 上一版的 iframe 排了好幾個延後的量測（字型載完、ResizeObserver、250ms 的
   * 保險），版本一換那些回呼還在路上，回來時會把剛清掉的舊區塊又補回去。所以
   * 每次量測都帶著當時的世代，過期的就直接不算。
   */
  measureToken: MutableRefObject<number>;
  /** 重量區塊與高度（身分不變）。 */
  measure: (token: number) => void;
  blocks: BlockBox[];
  setBlocks: Dispatch<SetStateAction<BlockBox[]>>;
  height: number;
  /** 正文欄在 iframe 裡的水平位置：插圖的線只畫在文字那一欄，不橫跨整張紙。 */
  column: { left: number; width: number } | null;
  onBlocksRef: MutableRefObject<((blocks: { index: number; text: string }[]) => void) | undefined>;
  /**
   * 渲染的世代。
   *
   * 「渲染」不一定換 hash，但後端要等校樣**在渲染之後被載入一次**才把 RENDERED 推進
   * PREVIEWED（人一定看過才准核准）。所以每次進入 RENDERED 就換一個網址重載一次。
   */
  renderEpoch: number;
}

export function useProofMeasure({
  jobState,
  onBlocks,
}: {
  jobState: LoadedJob['state'];
  onBlocks: ((blocks: { index: number; text: string }[]) => void) | undefined;
}): ProofMeasure {
  const [blocks, setBlocks] = useState<BlockBox[]>([]);
  const [height, setHeight] = useState(600);
  const [column, setColumn] = useState<{ left: number; width: number } | null>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const measureToken = useRef(0);
  // 父層每次刷新都會給新的物件；用 ref 接住 callback，量測不必跟著重建。
  const onBlocksRef = useRef(onBlocks);
  onBlocksRef.current = onBlocks;
  const [renderEpoch, setRenderEpoch] = useState(0);
  useEffect(() => {
    if (jobState === 'RENDERED') setRenderEpoch((epoch) => epoch + 1);
  }, [jobState]);
  const measure = useCallback((token: number) => {
    if (token !== measureToken.current) return;
    const frame = frameRef.current;
    const doc = frame?.contentDocument;
    if (!frame || !doc?.body) return;

    // 先讓 iframe 貼齊內容高度，量到的座標才等於文件座標（contentHeight 說明為什麼不用 scrollHeight）。
    // 文件本身不能捲（html overflow: hidden）；打字時瀏覽器為了游標把它捲下去的，捲回頂端。
    const scrollY = frame.contentWindow?.scrollY ?? 0;
    setHeight(Math.max(contentHeight(doc), 200));

    const body = doc.querySelector('.preview-body');
    const children = body ? Array.from(body.children) : [];
    if (body) {
      const box = body.getBoundingClientRect();
      setColumn((current) =>
        current !== null && current.left === box.left && current.width === box.width
          ? current
          : { left: box.left, width: box.width },
      );
    }
    const measured = children.map((element, index) => {
      const box = element.getBoundingClientRect();
      return { index, top: box.top + scrollY, height: box.height, text: blockSnippet(element.textContent) };
    });
    setBlocks(measured);
    onBlocksRef.current?.(measured.map(({ index, text }) => ({ index, text })));
    if (scrollY !== 0) frame.contentWindow?.scrollTo(0, 0);
  }, []);
  const scrollRef = useRef<HTMLDivElement>(null);
  return { frameRef, scrollRef, measureToken, measure, blocks, setBlocks, height, column, onBlocksRef, renderEpoch };
}

export interface ProofFrameState {
  /** 示範資料模式：iframe 用 srcdoc，不指向後端。 */
  fixtures: boolean;
  srcDoc: string | null;
  loading: boolean;
  error: string | null;
  /** 預覽回的不是校樣（讀不到 `.preview-body`）。 */
  bodyMissing: boolean;
  /** iframe 載入完幾次；標記與進出編輯靠它在重載後重跑。 */
  loadCount: number;
  /** 清單點過來、量得到的那一段（畫框用）。 */
  focused: BlockBox | undefined;
  handleLoad: () => void;
}

export function useProofFrame({
  job,
  mode,
  hasRevision,
  revisionKey,
  measured,
  edit,
  highlights,
  activeHighlight,
  onHighlight,
  focusBlock,
  onPreviewed,
  onPreviewHash,
  resetViews,
  attachSelection,
  clearSelection,
}: {
  job: LoadedJob;
  mode: 'edit' | 'final';
  hasRevision: boolean;
  revisionKey: string;
  measured: ProofMeasure;
  edit: ProofEditing;
  highlights: readonly ProofHighlight[];
  activeHighlight: string | null;
  onHighlight: ((id: string) => void) | undefined;
  focusBlock: number | null;
  onPreviewed: (() => void) | undefined;
  onPreviewHash: ((hash: string | null) => void) | undefined;
  /** 換版本時一起收掉的畫面（頁邊符號的說明、插圖面板、選字膠囊）。 */
  resetViews: () => void;
  /** 把 iframe 的選取事件交給選字膠囊（`useSelectionActions().attach`）。 */
  attachSelection: (doc: Document) => void;
  /** 收起選字膠囊（開始打字時）。 */
  clearSelection: () => void;
}): ProofFrameState {
  const { frameRef, scrollRef, measureToken, measure, blocks, setBlocks, onBlocksRef } = measured;
  const { isEditing, editingRef, shown, refreshFormat } = edit;
  const [srcDoc, setSrcDoc] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bodyMissing, setBodyMissing] = useState(false);
  const observerRef = useRef<ResizeObserver | null>(null);
  const onPreviewedRef = useRef(onPreviewed);
  onPreviewedRef.current = onPreviewed;
  const onPreviewHashRef = useRef(onPreviewHash);
  onPreviewHashRef.current = onPreviewHash;
  const onHighlightRef = useRef(onHighlight);
  onHighlightRef.current = onHighlight;
  const activeHighlightRef = useRef(activeHighlight);
  activeHighlightRef.current = activeHighlight;
  const [loadCount, setLoadCount] = useState(0);
  const fixtures = isFixtureMode();
  /** 示範資料上一次拿到的校樣原始碼。 */
  const lastSrcDoc = useRef<string | null>(null);

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
    // 用 shown（不是 revisionKey）：打字中自己存的版本不重抓（D-036）。
  }, [job.uuid, shown.key, hasRevision, fixtures, shown.epoch]);

  /**
   * 換版本＝上一版量到的東西全部作廢。
   *
   * 只把 loading 打開是不夠的：舊的 blocks 還在 state 裡，圖片區的「插入位置」
   * 就還選得到上一版的第 n 段，送出去的索引會落在新版本的別的地方。所以這裡把
   * 區塊清空並且通知父層，等新的校樣量完才會再有東西可選。
   */
  useEffect(() => {
    // 編輯到一半版本被換掉（理論上編輯中動作都鎖住了，這是最後一道防線）：打的字留不住，要講出來（useProofEditing）。
    edit.abandonOnNewVersion();
    measureToken.current += 1;
    setLoading(true);
    setBodyMissing(false);
    setBlocks([]);
    resetViews();
    onBlocksRef.current?.([]);
    onPreviewHashRef.current?.(null);
    // shown.key：打字中自己存的版本（D-036）不算「被換掉」，離開打字模式時才換。
  }, [shown.key]);

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

  const handleLoad = useCallback(() => {
    const token = measureToken.current;
    setLoading(false);
    measure(token);
    const doc = frameRef.current?.contentDocument;
    if (!doc) return;
    // 文件不自己捲動（見檔頭）：捲動全部交給外層，滑鼠停在文章上滾一次就動。
    doc.documentElement.style.overflow = 'hidden';
    // body 包住浮動（alignleft／alignright 的圖），高度才量得到最後一張浮動圖的底（見 contentHeight）。
    if (doc.body) doc.body.style.display = 'flow-root';
    // 預覽回錯誤時 iframe 裡會是一段 JSON，不是校樣。要說出來，不要靜靜地空著。
    setBodyMissing(doc.querySelector('.preview-body') === null);
    onPreviewedRef.current?.();
    setLoadCount((count) => count + 1);
    // 點文章裡的標記＝在右欄亮起那一項。處理函式屬於外層，iframe 自己不跑 script。
    doc.addEventListener('click', (event) => {
      const key = clickedMarkKey(event.target as Element | null, activeHighlightRef.current);
      if (key === null || editingRef.current) return;
      onHighlightRef.current?.(key);
    });
    // 選字之後的膠囊（查證這句、用此段配圖；SelectionActions.tsx）：選了字就浮出、Esc 收起。
    attachSelection(doc);
    // 編輯中：打字會改變高度，要重量；正文空不空決定要不要顯示「從這裡開始寫…」。
    doc.addEventListener('input', () => {
      // 開始打字：膠囊收起（不擋打字）。
      clearSelection();
      if (!editingRef.current) return;
      const body = doc.querySelector<HTMLElement>('.preview-body');
      if (body) markBlank(body);
      measure(measureToken.current);
    });
    // 打字時瀏覽器可能把文件捲下去讓游標看得見；文件不該自己捲，捲回來並重量高度。
    doc.addEventListener('scroll', () => {
      if ((doc.defaultView?.scrollY ?? 0) !== 0) measure(measureToken.current);
    });
    // 貼上整理、拖放、按鍵攔截（P5-T028、P5-T029）：規則在 lib/proof-edit.ts。
    attachEditInterceptors(doc, {
      isEditing: () => editingRef.current,
      allow: () => edit.allowRef.current,
      formatState: () => edit.formatStateRef.current,
      runCommand: (command) => edit.doCommandRef.current(command),
    });
    doc.addEventListener('selectionchange', () => {
      if (editingRef.current) refreshFormat();
    });
    // 字型與圖片載入完會改變高度，要再量一次。
    void doc.fonts.ready.then(() => measure(token));
    observerRef.current?.disconnect();
    const observer = new ResizeObserver(() => measure(token));
    observer.observe(doc.documentElement);
    observerRef.current = observer;
    window.setTimeout(() => measure(token), 250);
  }, [measure, refreshFormat]);

  // 從清單點過來的那一段：捲過去並畫框。量測還沒好就先不動，等量完這個 effect
  // 會因為 blocks 改變再跑一次。
  const focused = focusBlock === null ? undefined : blocks.find((block) => block.index === focusBlock);
  useEffect(() => {
    const frame = frameRef.current;
    const scroller = scrollRef.current;
    // 打字中不捲（例如查證跑完自動亮起那張卡片）：游標與捲動位置不能被拉走（D-036）。
    if (focused === undefined || !frame || !scroller || editingRef.current) return;
    const offset = frame.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    scroller.scrollTo({
      top: Math.max(offset + focused.top - 96, 0),
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
  }, [focused?.index, focused?.top]);

  // 把建議標到字上。內容、清單或模式一變就整個重標：先拆掉舊的，再包新的（lib/proof-highlights.ts）。
  const highlightsKey = highlightKey(highlights);
  useEffect(() => {
    // 編輯中不碰正文：輪詢換掉清單也不重標，否則 normalize() 會讓游標跳掉。
    // 進入編輯時的拆標記由 ProofView 的編輯 effect（syncEditing）負責。
    if (isEditing) return;
    const doc = frameRef.current?.contentDocument;
    if (!doc) return;
    if (applyHighlights(doc, highlights, activeHighlight, mode)) measure(measureToken.current);
    // highlights 由 highlightsKey 代表；陣列本身每次都是新的。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightsKey, activeHighlight, mode, loadCount, measure, isEditing]);

  // 從右欄點過來的那一項：捲到它在文章裡的位置。
  useEffect(() => {
    if (activeHighlight === null || mode !== 'edit' || isEditing) return;
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

  return { fixtures, srcDoc, loading, error, bodyMissing, loadCount, focused, handleLoad };
}
