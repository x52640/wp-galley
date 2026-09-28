import { useCallback, useEffect, useRef, useState, type JSX, type ReactNode } from 'react';
import { api, describeError, isFixtureMode } from '../service/client.js';
import type { LoadedJob, ProofMark } from '../service/types.js';
import { Icon } from '../icons.js';
import { findIgnoringSpaces } from '../../contract/text-match.js';
import { shortHash } from '../lib/format.js';
import type { SuggestionKind } from '../lib/review-kinds.js';
import { FormatBar, type LinkEditorState } from './FormatBar.js';
import {
  availableCommands,
  decideEditSave,
  formatStateFrom,
  nextLinkEditor,
  shortcutCommand,
  type FormatCommand,
  type FormatState,
} from '../lib/rich-format.js';
import {
  applyLink,
  cleanEditedBody,
  snapshotBody,
  cleanPastedHtml,
  currentLink,
  removeLink,
  runCommand,
  saveSelection,
  selectionAncestors,
  type RichAllow,
} from '../lib/rich-commands.js';
import type { RichUnit } from '../../contract/rich-text.js';

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
 *
 * **四、直接在文章上改（P5-T010）。**
 * 編輯時把 `.preview-body` 設成 contenteditable：使用者看到的是排好版的文章，不是標籤。
 * 這不需要 iframe 跑任何 script——打字是瀏覽器本身的行為，貼上的攔截與游標定位都由外層做。
 * 編輯中暫停字上標記與頁邊符號（位置會隨打字跑掉）。存檔送的是正文 HTML，後端整理後照常渲染。
 *
 * **六、格式工具列（P5-T028）。**
 * 編輯中上方多一排格式按鈕（連結、粗體、斜體、H2、H3、段落、清單、引用、分隔線），出現哪些照模板的
 * allowedTags；⌘B／⌘I／⌘K 也由外層掛在文件上的 keydown 處理。指令一律由外層對 iframe 文件下
 * （`lib/rich-commands.ts`），iframe 仍然不跑 script。貼上改成保留 allowlist 內的格式、其餘丟掉；
 * 存檔前先用共用規則（`contract/rich-text.ts`）整理一次，後端再整理一次。
 *
 * **五、在這裡插圖（P5-T016）。**
 * 段落之間（含最前面與最後面）滑鼠移過去出現「在這裡插圖」。跟頁邊符號一樣畫在 iframe 外層，
 * 位置用同一份量到的區塊座標算（上一段的底與下一段的頂的中間），iframe 裡什麼都不加。
 * 要不要出現由上層決定（`insertImage` 給 null 就不畫），編輯中這裡再擋一次。
 */

/** 要進入編輯時帶的資訊。`nonce` 讓「同一段再點一次」也會重新定位游標。 */
export interface ProofEditRequest {
  /** 從哪張建議卡片進來的；存檔時那一項一起標成已處理（P5-T012）。null＝從上方「改原文」。 */
  itemId: number | null;
  /** 游標要停在哪段字前面；null＝文章開頭。 */
  caret: string | null;
  /** 落在這段字（建議的 after）裡的 caret 不算，跟後端套用同一條規則（P5-T017）。 */
  caretSkipInside?: string | null;
  blockIndex: number | null;
  nonce: number;
}

/** 校樣上要標出來的一段字。 */
export interface ProofHighlight {
  id: number;
  kind: SuggestionKind;
  text: string;
  /** 掛在第幾個頂層區塊；null＝定位不到，就在整篇裡找第一個。 */
  blockIndex: number | null;
  /**
   * 落在這段字（建議的 after）裡的不標（P5-T017）：「很多事→很多事情」在已經有「很多事情」的文章裡，
   * 要標的是另一個還沒改的「很多事」，跟按接受真的會改的位置一致。
   */
  skipInside?: string | null;
}

/** 標記的顏色。跟 styles.css 的 --kind-* 同一套，這裡要能直接寫進 iframe。 */
const HIGHLIGHT_COLORS: Record<SuggestionKind, { bg: string; line: string }> = {
  typo: { bg: '#FCE3D6', line: '#C2410C' },
  style: { bg: '#E4EDE8', line: '#3F5B4F' },
  fact: { bg: '#DDE8F5', line: '#1E4F8A' },
  source: { bg: '#F6EDCF', line: '#8A6A14' },
};

/**
 * 直接在文章上改時，標出「要改的是哪裡」（P5-T011）。
 *
 * 用 CSS Custom Highlight（`CSS.highlights` ＋ `::highlight()`），不用 `<mark>`：它只在畫面上
 * 上色，不改 DOM，所以不會混進要存檔的正文，也不會在打字時被 contenteditable 拆成碎片。
 * 顏色是螢光筆黃，刻意跟四種建議標記都不同——這個標記的意思是「游標在這裡」，不是「這裡有建議」。
 */
const EDIT_TARGET = 'publisher-edit-target';
const EDIT_TARGET_RULE = `::highlight(${EDIT_TARGET}) { background-color: #FFE066; text-decoration: underline 2px #1C1B19; }`;

function showEditTarget(frame: HTMLIFrameElement, target: Range | null): void {
  // 要用 iframe 自己視窗的 CSS 與 Highlight：Range 屬於那份文件。
  const win = frame.contentWindow as (Window & typeof globalThis) | null;
  const doc = frame.contentDocument;
  const registry = win?.CSS?.highlights;
  if (!win || !doc || !registry || typeof win.Highlight !== 'function') return; // 舊瀏覽器：只有游標，沒有標色
  registry.delete(EDIT_TARGET);
  if (target === null) return;
  const sheet = doc.styleSheets[0];
  if (sheet && !doc.documentElement.hasAttribute('data-edit-target-rule')) {
    // CSSOM 插規則，不動文件的 <style>；每份文件只插一次。
    sheet.insertRule(EDIT_TARGET_RULE, sheet.cssRules.length);
    doc.documentElement.setAttribute('data-edit-target-rule', '');
  }
  registry.set(EDIT_TARGET, new win.Highlight(target));
}

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
  editing = null,
  onSaveEdit,
  onEndEdit,
  insertImage = null,
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
  /** 不是 null 就是在直接改文章。 */
  editing?: ProofEditRequest | null;
  /**
   * 存檔：送出改過的正文 HTML，回傳存完之後那一版的 content hash。成功後由上層結束編輯；
   * 失敗就丟錯，留在編輯中。
   */
  onSaveEdit?: (html: string) => Promise<string>;
  /** 沒改就離開、按了取消，或編輯中版本被換掉（帶著要告訴使用者的話）。 */
  onEndEdit?: (notice?: string) => void;
  /**
   * 「在這裡插圖」按下去之後的面板內容（P5-T016）。null＝不給插（對照中、成品、稿件結束…）。
   * `afterBlockIndex` 跟 `placeMedia` 同一套索引，-1＝最前面。
   */
  insertImage?: ((afterBlockIndex: number, close: () => void) => ReactNode) | null;
}): JSX.Element {
  const [srcDoc, setSrcDoc] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bodyMissing, setBodyMissing] = useState(false);
  const [blocks, setBlocks] = useState<BlockBox[]>([]);
  const [height, setHeight] = useState(600);
  const [pinned, setPinned] = useState<string | null>(null);
  /** 正文欄在 iframe 裡的水平位置：插圖的線只畫在文字那一欄，不橫跨整張紙。 */
  const [column, setColumn] = useState<{ left: number; width: number } | null>(null);
  /** 打開了哪一個「在這裡插圖」（插在第幾塊之後）；null＝沒打開。 */
  const [inserting, setInserting] = useState<number | null>(null);
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
  const isEditing = editing !== null;
  const editingRef = useRef(isEditing);
  editingRef.current = isEditing;
  const onEndEditRef = useRef(onEndEdit);
  onEndEditRef.current = onEndEdit;
  /** 進入編輯那一刻的正文，用來判斷「有沒有改」與取消時還原。 */
  const originalBody = useRef<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  /** 進入編輯那一刻、整理過的正文：存檔時比對「有沒有改」要用同一套整理規則，不然沒改也會算改。 */
  const originalClean = useRef<string | null>(null);
  /** 進入編輯那一刻的頂層區塊：存檔時沒動過的區塊原樣保留，只整理改過的（P5-T028 審查）。 */
  const originalUnits = useRef<RichUnit[] | null>(null);

  // --- 格式（P5-T028） ---
  const allow: RichAllow = { tags: job.template.allowedTags, schemes: job.template.allowedSchemes };
  const allowRef = useRef(allow);
  allowRef.current = allow;
  const commands = availableCommands(allow.tags);
  const commandsRef = useRef(commands);
  commandsRef.current = commands;
  /** 游標所在的格式；null＝游標不在正文裡（或不在編輯中）。 */
  const [formatState, setFormatState] = useState<FormatState | null>(null);
  const formatStateRef = useRef(formatState);
  formatStateRef.current = formatState;
  const [linkEditor, setLinkEditor] = useState<LinkEditorState | null>(null);
  /** 打開連結輸入框時存下的選取範圍與既有連結：焦點離開 iframe 後還要套在同一段字上。 */
  const linkTarget = useRef<{ range: Range | null; existing: Element | null } | null>(null);
  const linkSessions = useRef(0);
  /** 存檔時發現有模板不支援、會被拿掉的格式：先講出來，使用者按「照樣存」才存。 */
  const [dropWarning, setDropWarning] = useState<string[] | null>(null);

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
    // 編輯到一半版本被換掉（理論上編輯中動作都鎖住了，這是最後一道防線）：
    // 校樣要重載，打的字留不住，至少要講出來，不能靜靜消失。
    if (editingRef.current) {
      originalBody.current = null;
      onEndEditRef.current?.('這篇稿件在你編輯的時候有了新版本，剛才打的字沒有存到。請再改一次。');
    }
    measureToken.current += 1;
    setLoading(true);
    setBodyMissing(false);
    setBlocks([]);
    setPinned(null);
    setInserting(null);
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

  const editBody = (): HTMLElement | null =>
    frameRef.current?.contentDocument?.querySelector<HTMLElement>('.preview-body') ?? null;

  /** 重讀游標所在的格式（按鈕亮起與停用）。 */
  const refreshFormat = useCallback(() => {
    const doc = frameRef.current?.contentDocument;
    const body = doc?.querySelector('.preview-body');
    if (!doc || !body || !editingRef.current) {
      setFormatState(null);
      return;
    }
    const ancestors = selectionAncestors(doc, body);
    setFormatState(ancestors === null ? null : formatStateFrom(ancestors));
  }, []);

  const openLinkEditor = useCallback(() => {
    const doc = frameRef.current?.contentDocument;
    const body = doc?.querySelector('.preview-body');
    if (!doc || !body || !commandsRef.current.includes('link')) return;
    const existing = currentLink(doc, body);
    linkTarget.current = { range: saveSelection(doc, body), existing };
    linkSessions.current += 1;
    const counter = linkSessions.current;
    setLinkEditor((previous) => nextLinkEditor(previous, existing?.getAttribute('href') ?? null, counter));
  }, []);

  const closeLinkEditor = useCallback((refocus = true) => {
    setLinkEditor(null);
    const target = linkTarget.current;
    linkTarget.current = null;
    const frame = frameRef.current;
    const body = frame?.contentDocument?.querySelector<HTMLElement>('.preview-body');
    if (!refocus || !frame || !body) return;
    frame.contentWindow?.focus();
    body.focus();
    if (target?.range) {
      const selection = frame.contentDocument?.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(target.range);
    }
  }, []);

  const doCommand = useCallback(
    (command: FormatCommand) => {
      const frame = frameRef.current;
      const body = frame?.contentDocument?.querySelector<HTMLElement>('.preview-body');
      const state = formatStateRef.current;
      if (!frame || !body || !editingRef.current || !commandsRef.current.includes(command)) return;
      if (command === 'link') {
        openLinkEditor();
        return;
      }
      if (state === null) return;
      runCommand(frame, body, command, state);
      refreshFormat();
      measure(measureToken.current);
    },
    [measure, openLinkEditor, refreshFormat],
  );
  const doCommandRef = useRef(doCommand);
  doCommandRef.current = doCommand;

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
      if (mark && !editingRef.current) onHighlightRef.current?.(Number(mark.getAttribute('data-hl')));
    });
    // 編輯中：打字會改變高度，要重量。
    doc.addEventListener('input', () => {
      if (editingRef.current) measure(measureToken.current);
    });
    // 貼上（P5-T028）：有格式的剪貼簿只保留模板 allowlist 內的標籤（粗體、連結、標題、清單…），
    // 樣式、class、span、script、不允許的連結一律拿掉、字留著；只有純文字就照舊插純文字。
    doc.addEventListener('paste', (event) => {
      if (!editingRef.current) return;
      event.preventDefault();
      const html = event.clipboardData?.getData('text/html') ?? '';
      const cleaned = html.trim().length > 0 ? cleanPastedHtml(html, allowRef.current) : '';
      if (cleaned.trim().length > 0) {
        doc.execCommand('insertHTML', false, cleaned);
      } else {
        doc.execCommand('insertText', false, event.clipboardData?.getData('text/plain') ?? '');
      }
    });
    // 拖檔案進來：瀏覽器會把圖片直接塞進正文（不經過媒體庫）。擋掉；插圖走「在這裡插圖」。
    doc.addEventListener('drop', (event) => {
      if (editingRef.current && event.dataTransfer?.types.includes('Files')) event.preventDefault();
    });
    // 格式快捷鍵：⌘B／⌘I／⌘K；⌘U（底線，不在 allowlist）攔下來不做事。
    doc.addEventListener('keydown', (event) => {
      if (!editingRef.current) return;
      const shortcut = shortcutCommand(event);
      if (shortcut === null) return;
      event.preventDefault();
      if (shortcut === 'block') return;
      const state = formatStateRef.current;
      if (state !== null && !isShortcutEnabled(shortcut, state)) return;
      doCommandRef.current(shortcut);
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
    // 編輯中不碰正文：輪詢換掉清單也不重標，否則 normalize() 會讓游標跳掉。
    // 進入編輯時的拆標記由下面的編輯 effect 負責。
    if (isEditing) return;
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
  }, [highlightKey, activeHighlight, mode, loadCount, measure, isEditing]);

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

  // 進入／離開編輯。標記的拆除由上面那個 effect 負責（isEditing 變了它會重跑）。
  useEffect(() => {
    const frame = frameRef.current;
    const doc = frame?.contentDocument;
    const body = doc?.querySelector<HTMLElement>('.preview-body');
    if (!frame || !doc || !body) return;
    if (editing === null) {
      showEditTarget(frame, null);
      body.removeAttribute('contenteditable');
      originalBody.current = null;
      originalClean.current = null;
      originalUnits.current = null;
      setFormatState(null);
      setLinkEditor(null);
      setDropWarning(null);
      linkTarget.current = null;
      return;
    }
    for (const mark of Array.from(body.querySelectorAll('mark[data-hl]'))) {
      mark.replaceWith(...Array.from(mark.childNodes));
    }
    body.normalize();
    if (originalBody.current === null) {
      originalBody.current = body.innerHTML;
      originalUnits.current = snapshotBody(body);
      originalClean.current = cleanEditedBody(body, allowRef.current, originalUnits.current).html;
    }
    body.setAttribute('contenteditable', 'true');
    // 按 Enter 開新段落用 <p>，不要 Chrome 預設的 <div>。
    doc.execCommand('defaultParagraphSeparator', false, 'p');
    setSaveError(null);

    const { caret: range, target } = editTarget(doc, body, editing);
    showEditTarget(frame, target);
    frame.contentWindow?.focus();
    body.focus();
    const selection = doc.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    refreshFormat();

    const scroller = scrollRef.current;
    const anchor = range.startContainer.nodeType === 1 ? (range.startContainer as Element) : range.startContainer.parentElement;
    if (scroller && anchor) {
      const offset = frame.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
      const top = anchor.getBoundingClientRect().top + (frame.contentWindow?.scrollY ?? 0);
      scroller.scrollTo({
        top: Math.max(offset + top - 160, 0),
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      });
    }
    // editing 物件本身每次都是新的；nonce 才代表「又要求了一次」。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing?.nonce, isEditing, loadCount]);

  const cancelEdit = (): void => {
    const body = editBody();
    if (body && originalBody.current !== null) body.innerHTML = originalBody.current;
    measure(measureToken.current);
    onEndEdit?.();
  };

  const saveEdit = async (force = false): Promise<void> => {
    const body = editBody();
    if (!body) return;
    // 存檔前整理一次（P5-T028）：b／i 轉 strong／em、瀏覽器的 div／<p><ul> 整理好、模板不支援的格式拿掉。
    // 後端照同一套規則再整理一次，再走 sanitize。
    const { html, dropped } = cleanEditedBody(body, allow, originalUnits.current);
    // 先拿到手：存檔成功時上層會結束編輯，編輯 effect 會把 originalBody 清掉。
    const original = originalBody.current;
    const decision = decideEditSave({
      cleaned: html,
      originalClean: originalClean.current ?? (original ?? '').trim(),
      dropped,
      force,
    });
    if (decision === 'unchanged') {
      // 沒有實質改動（例如只多按了 Enter）：不送出，但畫面要還原成進入編輯時的正文再重量，
      // 不然校樣多一個空區塊，「在這裡插圖」的索引會跟後端差一格（審查 #1）。
      if (original !== null) body.innerHTML = original;
      measure(measureToken.current);
      onEndEdit?.();
      return;
    }
    // 格式不能默默消失：有會被拿掉的，先講出來。
    if (decision === 'confirm-drop') {
      setDropWarning(dropped);
      return;
    }
    setDropWarning(null);
    setSaving(true);
    setSaveError(null);
    try {
      const savedHash = await onSaveEdit?.(html);
      // 整理之後跟原本一樣（例如只多按了一個 Enter），後端不建新版本，校樣也不會重載；
      // 把畫面還原成那一版，不要留著沒整理過的樣子。
      if (savedHash === revisionKey && original !== null) {
        body.innerHTML = original;
        measure(measureToken.current);
      }
    } catch (cause) {
      setSaveError(describeError(cause));
    } finally {
      setSaving(false);
    }
  };

  const markGroups = mode === 'edit' && !isEditing ? groupMarks(job.marks) : [];

  // 不給插了（進了對照、打開發布面板、開始改字…）就把打開的面板收掉。
  const canInsert = insertImage !== null && mode === 'edit' && !isEditing && !loading && blocks.length > 0;
  useEffect(() => {
    if (!canInsert) setInserting(null);
  }, [canInsert]);
  const slots = canInsert ? insertSlots(blocks) : [];
  const openSlot = inserting === null ? undefined : slots.find((slot) => slot.after === inserting);
  /** 關掉插圖面板，焦點回到打開它的那顆「在這裡插圖」（放好之後版本換了、按鈕不在了就算了）。 */
  const closeInsert = useCallback(() => {
    const after = inserting;
    setInserting(null);
    if (after === null) return;
    window.requestAnimationFrame(() => {
      scrollRef.current?.querySelector<HTMLElement>(`.insert-slot-btn[data-after='${after}']`)?.focus({ preventScroll: true });
    });
  }, [inserting]);
  // 面板打開在段落下面，靠近視窗底時會被切掉；捲到看得見整個面板為止。
  const popRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (inserting === null) return;
    popRef.current?.scrollIntoView({
      block: 'nearest',
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
  }, [inserting]);

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
        {isEditing ? (
          <div className="proof-editbar" role="status">
            <span className="proof-editbar-note">直接在文章上打字；貼上時保留粗體、連結、標題與清單，其他樣式會拿掉。</span>
            <button type="button" className="btn btn-quiet btn-tiny" disabled={saving} onClick={cancelEdit}>
              取消
            </button>
            <button type="button" className="btn btn-primary btn-tiny" disabled={saving} onClick={() => void saveEdit()}>
              <Icon name="check" size={13} />
              {saving ? '儲存中…' : '儲存'}
            </button>
          </div>
        ) : (
          <>
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
          </>
        )}
      </header>
      {isEditing && (
        <FormatBar
          commands={commands}
          state={formatState}
          onCommand={doCommand}
          link={linkEditor}
          schemes={allow.schemes}
          onApplyLink={(href) => {
            const frame = frameRef.current;
            const body = editBody();
            const target = linkTarget.current;
            setLinkEditor(null);
            linkTarget.current = null;
            if (!frame || !body) return;
            applyLink(frame, body, target?.range ?? null, href, target?.existing ?? null);
            refreshFormat();
          }}
          onRemoveLink={() => {
            const frame = frameRef.current;
            const body = editBody();
            const existing = linkTarget.current?.existing ?? null;
            setLinkEditor(null);
            linkTarget.current = null;
            if (!frame || !body || existing === null) return;
            removeLink(frame, body, existing);
            refreshFormat();
          }}
          onCloseLink={() => closeLinkEditor()}
        />
      )}
      {dropWarning !== null && (
        <div className="proof-status proof-status-warn" role="alert">
          <Icon name="alert" size={15} />
          <span>這個版型不支援：{dropWarning.join('、')}。存檔時會拿掉這些格式，字會留著。</span>
          <button type="button" className="btn btn-quiet btn-tiny" onClick={() => setDropWarning(null)}>
            回去改
          </button>
          <button type="button" className="btn btn-primary btn-tiny" disabled={saving} onClick={() => void saveEdit(true)}>
            照樣存
          </button>
        </div>
      )}
      {saveError && (
        <p className="proof-status proof-status-bad" role="alert">
          <Icon name="alert" size={15} /> 沒存成功：{saveError}
        </p>
      )}

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
          <div className="proof-sheet" data-editing={isEditing ? 'yes' : 'no'} style={{ height: `${height}px` }}>
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

            {slots.length > 0 && column !== null && (
              <div className="proof-inserts" aria-label="插入圖片的位置">
                {slots.map((slot) => (
                  <div
                    key={slot.after}
                    className="insert-slot"
                    data-open={inserting === slot.after ? 'yes' : 'no'}
                    style={{ top: `${slot.y - 12}px`, left: `${column.left}px`, width: `${column.width}px` }}
                  >
                    <button
                      type="button"
                      className="insert-slot-btn"
                      data-after={slot.after}
                      aria-expanded={inserting === slot.after}
                      onClick={() => setInserting((current) => (current === slot.after ? null : slot.after))}
                    >
                      <Icon name="image-plus" size={13} />
                      在這裡插圖
                      <span className="sr-only">
                        {slot.after < 0 ? '（文章最前面）' : `（第 ${slot.after + 1} 段之後）`}
                      </span>
                    </button>
                  </div>
                ))}
                {openSlot !== undefined && insertImage !== null && (
                  <div
                    ref={popRef}
                    className="insert-pop"
                    style={{ top: `${openSlot.y + 16}px`, left: `${column.left}px`, width: `${Math.min(column.width, 416)}px` }}
                  >
                    {insertImage(openSlot.after, closeInsert)}
                  </div>
                )}
              </div>
            )}

            {focused !== undefined && !isEditing && (
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

function isShortcutEnabled(command: 'bold' | 'italic' | 'link', state: FormatState): boolean {
  return command === 'link' || !(command === 'bold' && (state.block === 'h2' || state.block === 'h3'));
}

/**
 * 游標要放哪裡、要標出哪一段。
 *
 * - 游標：那一項引用的字前面（忽略空白，跟定位同一套規則）；找不到就放那一段的開頭，
 *   再不行就放文章開頭。
 * - 標色：找得到字就標那段字；找不到但知道是第幾段，就標整段（至少是「大概在這裡」）；
 *   從上方「改原文」進來的沒有目標，不標。
 */
function editTarget(doc: Document, body: Element, request: ProofEditRequest): { caret: Range; target: Range | null } {
  const caret = doc.createRange();
  const block = request.blockIndex === null ? null : (body.children[request.blockIndex] ?? null);
  const scope = block ?? body;
  if (request.caret !== null) {
    const walker = doc.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const hit = findIgnoringSpaces((node as Text).data, request.caret, request.caretSkipInside);
      if (hit === null) continue;
      caret.setStart(node, hit.start);
      caret.collapse(true);
      const target = doc.createRange();
      target.setStart(node, hit.start);
      target.setEnd(node, hit.end);
      return { caret, target };
    }
  }
  caret.selectNodeContents(scope);
  caret.collapse(true);
  if (block === null) return { caret, target: null };
  const target = doc.createRange();
  target.selectNodeContents(block);
  return { caret, target };
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
    const hit = findIgnoringSpaces(text.data, highlight.text, highlight.skipInside);
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

/**
 * 段落之間可以插圖的位置：最前面（-1）、每一段之後。`y` 是兩段之間空白的中間
 * （最前面是第一段頂上一點，最後面是最後一段底下一點），座標跟頁邊符號同一套。
 */
function insertSlots(blocks: readonly BlockBox[]): { after: number; y: number }[] {
  const sorted = [...blocks].sort((a, b) => a.index - b.index);
  const first = sorted[0];
  if (first === undefined) return [];
  const slots = [{ after: -1, y: first.top - 18 }];
  sorted.forEach((block, i) => {
    const bottom = block.top + block.height;
    const next = sorted[i + 1];
    slots.push({ after: block.index, y: next === undefined ? bottom + 18 : (bottom + next.top) / 2 });
  });
  return slots;
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
