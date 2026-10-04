import { useCallback, useEffect, useRef, useState, type JSX, type ReactNode } from 'react';
import { api, describeError, isFixtureMode } from '../service/client.js';
import type { LoadedJob, ProofMark } from '../service/types.js';
import { Icon } from '../icons.js';
import { findIgnoringSpaces } from '../../contract/text-match.js';
import { shortHash } from '../lib/format.js';
import type { SuggestionKind } from '../lib/review-kinds.js';
import { markScopes, pickClickedMark } from '../lib/factcheck-view.js';
import {
  SelectionActions,
  SelectionNotice,
  useSelectionActions,
  type SelectionCheckInput,
  type SelectionImageInput,
} from './SelectionActions.js';
import { attachEditInterceptors, markBlank, unwrapHighlightMarks } from '../lib/proof-edit-dom.js';
import { useProofEditing } from '../lib/use-proof-editing.js';
import { DropWarning, EditBar, EditToolbar } from './EditToolbar.js';

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
 * 「不捲動」是做出來的，不是期望（P5-T029）：iframe 帶 `scrolling="no"`，載入後外層用 CSSOM 把文件的
 * `html` 設成 `overflow: hidden`（不注入 script），量高度時把 body 的下外距與 html 的下內距算進去
 * ——以前只量 body 的底邊，漏掉瀏覽器預設的 8px 下外距，文件永遠多出 8px 可以捲，滑鼠停在文章上
 * 滾輪要先把這 8px 捲完，外層才會動（「要滾兩次」）。文件不能捲，Chrome 就把滾輪直接交給外層。
 * 打字時瀏覽器為了讓游標看得見仍可能把文件捲下去；量測時一律捲回頂端。
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
 * 打字模式的狀態與流程（進出編輯、原文快照、存檔與照樣存、hold、錯誤、格式與連結）在 `lib/use-proof-editing.ts`，
 * 提示列、格式工具列、丟格式警告的畫面在 `EditToolbar.tsx`（P5-T042）；這裡只把 iframe 文件、量測與捲動容器接給它。
 *
 * **六、格式工具列（P5-T028）。**
 * 編輯中上方多一排格式按鈕（連結、粗體、斜體、H2、H3、段落、清單、引用、分隔線），出現哪些照模板的
 * allowedTags；⌘B／⌘I／⌘K 也由外層掛在文件上的 keydown 處理。指令一律由外層對 iframe 文件下
 * （`lib/rich-commands.ts`），iframe 仍然不跑 script。貼上改成保留 allowlist 內的格式、其餘丟掉；
 * 存檔前先用共用規則（`contract/rich-text.ts`）整理一次，後端再整理一次。
 *
 * **七、標題在文章上直接改（P5-T029）。**
 * 打字模式裡外框的標題（`.preview-title`）也是可編輯的：`contenteditable="plaintext-only"`，只收純文字；
 * 貼上一律插純文字、換行攤平成空格，Enter 跳到正文開頭，格式快捷鍵在標題裡不做事。
 * 按「儲存」時標題與正文一起送，存成同一個新版本；標題清空不准存（`lib/write-in-place.ts`）。
 * 正文是空的（新稿件剛建好）時放一個空段落與「從這裡開始寫…」的提示（CSSOM 規則，不改正文）。
 *
 * **五、在這裡插圖（P5-T016）。**
 * 段落之間（含最前面與最後面）滑鼠移過去出現「在這裡插圖」。跟頁邊符號一樣畫在 iframe 外層，
 * 位置用同一份量到的區塊座標算（上一段的底與下一段的頂的中間），iframe 裡什麼都不加。
 * 要不要出現由上層決定（`insertImage` 給 null 就不畫），編輯中這裡再擋一次。
 *
 * **六、選字「查證這句」（P6-T005，D-034；打字模式 D-036）。**
 * 在正文或標題上選一段字，選取下方浮出一顆膠囊按鈕（樣子跟「在這裡插圖」一致），畫在 iframe 外層，
 * 位置用選取範圍在文件裡的座標。要不要出現由上層決定（`selectionCheck` 給 null 就不畫）；不能查的時候照樣出現但反灰、講原因。
 * 選的字只當純文字送出（`Selection.toString()`），後端再驗一次長度與找不找得到。
 * 打字模式也出現：只在有非空選取時，開始打字、按 Esc、選取消失就收起。按下時內容有改就先照「儲存」存一版
 * （`onSaveEdit` 帶 `stay`），**留在打字模式、校樣不重載**（`lib/check-while-writing.ts` 的 hold：iframe 維持原本載著的那一版，
 * 游標、捲動、存檔之後又打的字都留著；離開打字模式才重載成後端存好的那一版），存好再查；存失敗就不查。
 * 膠囊、面板與按下去之後的流程在 `SelectionActions.tsx`（P5-T041）；這裡只把 iframe 的選取事件交給它。
 * 「先存再做」（`actWhileWriting`，跟「儲存」共用存檔狀態）在打字模式的 hook（`lib/use-proof-editing.ts`，P5-T042）。
 *
 * **七、選字「用此段配圖」（P5-T038，D-037）。**
 * 同一顆膠囊多一顆「用此段配圖」（上層給 `selectionImage` 才有；只選到標題的不給）。按下打開一個小面板：
 * 選圖放在選取範圍的哪裡（用畫面上的正文定位）、選填一句希望，再送出。打字模式跟「查證這句」同一套：送出時先存再送
 * （`actWhileWriting`）。字數或狀態不對時照樣出現但反灰、講原因。面板與流程同樣在 `SelectionActions.tsx`（P5-T041）。
 */

/** 要進入編輯時帶的資訊。`nonce` 讓「同一段再點一次」也會重新定位游標。 */
export interface ProofEditRequest {
  /** 從哪張建議卡片進來的；存檔時那一項一起標成已處理（P5-T012）。null＝從上方「改原文」。 */
  itemId: number | null;
  /** 從哪張查證卡片「去原文改」進來的（D-034）；存檔時那條結成 resolved-by-edit。 */
  factCheckId?: number | null;
  /** 游標要停在哪段字前面；null＝文章開頭。 */
  caret: string | null;
  /** 落在這段字（建議的 after）裡的 caret 不算，跟後端套用同一條規則（P5-T017）。 */
  caretSkipInside?: string | null;
  blockIndex: number | null;
  nonce: number;
}

/** 校樣上要標出來的一段字。 */
export interface ProofHighlight {
  /** 卡片的 key：校稿 `r<id>`、查證 `f<id>`（兩張表的 id 會撞號）。 */
  id: string;
  /** 校稿的四種分類，或查證（跟校稿不同的樣式，D-034）。 */
  kind: SuggestionKind | 'factcheck';
  text: string;
  /** 掛在第幾個頂層區塊；null＝定位不到，就在整篇裡找第一個。 */
  blockIndex: number | null;
  /**
   * 落在這段字（建議的 after）裡的不標（P5-T017）：「很多事→很多事情」在已經有「很多事情」的文章裡，
   * 要標的是另一個還沒改的「很多事」，跟按接受真的會改的位置一致。
   */
  skipInside?: string | null;
}

/**
 * 標記的顏色。跟 styles/01-tokens.css 的 --kind-* 同一套，這裡要能直接寫進 iframe。
 * 查證（`factcheck`，對應 --kind-check）用靛藍**虛線底線**、很淡的底，跟校稿的實線底線分得開；
 * 它用 text-decoration 畫線，校稿標記包在它裡面（同一句既有觀察卡片又有查證）時兩條線都看得到。
 */
const HIGHLIGHT_COLORS: Record<SuggestionKind | 'factcheck', { bg: string; line: string; dashed?: boolean }> = {
  typo: { bg: '#FCE3D6', line: '#C2410C' },
  style: { bg: '#E4EDE8', line: '#3F5B4F' },
  fact: { bg: '#DDE8F5', line: '#1E4F8A' },
  source: { bg: '#F6EDCF', line: '#8A6A14' },
  factcheck: { bg: '#F0EFFB', line: '#3730A3', dashed: true },
};

/**
 * 文件內容的完整高度（P5-T029）。
 *
 * 不能用 documentElement.scrollHeight：它至少等於 iframe 目前的高度，高度只會被撐大、不會縮回去。
 * 量 body 的底邊，再加上 body 的下外距（瀏覽器預設 8px）與最後一個子元素可能穿出來的下外距、html 的下內距與框線
 * ——少算任何一點，文件就會多出幾 px 可以捲。
 *
 * 浮動（`alignleft`／`alignright` 的圖）不撐高父元素：載入時外層把 body 設成 `display: flow-root`（CSSOM），
 * body 的底邊才包得住最後一張浮動圖。再保險一層：文件的內容比 iframe 目前的高度還高（scrollHeight 大於 clientHeight，
 * 例如絕對定位的東西穿出來），就用 scrollHeight——iframe 不能捲，少算就是把內容裁掉（P5-T029 審查 #3）。
 * 只在「超出」時才用 scrollHeight：它至少等於 iframe 目前的高度，平常用它的話高度只會變大、不會縮回去。
 */
function contentHeight(doc: Document): number {
  const win = doc.defaultView;
  const body = doc.body;
  const scrollY = win?.scrollY ?? 0;
  const px = (value: string | undefined): number => {
    const n = Number.parseFloat(value ?? '');
    return Number.isFinite(n) ? n : 0;
  };
  const bodyStyle = win?.getComputedStyle(body);
  const htmlStyle = win?.getComputedStyle(doc.documentElement);
  const last = body.lastElementChild;
  const lastMargin = last ? px(win?.getComputedStyle(last).marginBottom) : 0;
  let bottom = body.getBoundingClientRect().bottom + scrollY;
  if (last) bottom = Math.max(bottom, last.getBoundingClientRect().bottom + scrollY + lastMargin);
  bottom += px(bodyStyle?.marginBottom) + px(htmlStyle?.paddingBottom) + px(htmlStyle?.borderBottomWidth);
  const root = doc.documentElement;
  const measured = Math.ceil(bottom);
  if (root.scrollHeight > root.clientHeight) return Math.max(measured, root.scrollHeight);
  // 差不到幾 px 就維持目前的高度：量法跟 scrollHeight 差個一兩 px 時，不會在「超出→撐高→縮回→又超出」之間來回跳。
  if (root.clientHeight > measured && root.clientHeight - measured < 4) return root.clientHeight;
  return measured;
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
  onEditTargetMissing,
  insertImage = null,
  selectionCheck = null,
  selectionImage = null,
}: {
  job: LoadedJob;
  /** `edit`＝標出建議與校對符號；`final`＝跟網站上一樣，什麼都不標。 */
  mode: 'edit' | 'final';
  highlights?: readonly ProofHighlight[];
  activeHighlight?: string | null;
  /** 點了文章裡某個標記（卡片的 key）。 */
  onHighlight?: (id: string) => void;
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
  onSaveEdit?: (save: { editedBody?: string; editedTitle?: string; stay?: boolean }) => Promise<string>;
  /** 沒改就離開、按了取消，或編輯中版本被換掉（帶著要告訴使用者的話）。 */
  onEndEdit?: (notice?: string) => void;
  /** 進入編輯時要找的字與段落都標不出來（游標掉在文章開頭）：要在頂端講的話（P5-T037）。 */
  onEditTargetMissing?: (notice: string) => void;
  /**
   * 「在這裡插圖」按下去之後的面板內容（P5-T016）。null＝不給插（對照中、成品、稿件結束…）。
   * `afterBlockIndex` 跟 `placeMedia` 同一套索引，-1＝最前面。
   */
  insertImage?: ((afterBlockIndex: number, close: () => void) => ReactNode) | null;
  /**
   * 選字「查證這句」（P6-T005）。null＝不給（對照、成品、改字中、稿件結束）。
   * `blockedReason` 不是 null 時膠囊照樣出現但反灰、講原因（另一個 AI 動作在跑…）。
   */
  selectionCheck?: SelectionCheckInput | null;
  /**
   * 選字「用此段配圖」（P5-T038）。null＝不給。`blockedReason` 不是 null 時照樣出現但反灰、講原因。
   * 位置選項由後端在存好的那一版上算（`loadSpots`，第二輪審查）：打字模式由這裡先自動存，再問選項。
   * `loadSpots` 換篇時回 null（不顯示）；錯誤丟出來，面板上講。`onRequest` 自己接住錯誤（講在頂端），這裡只等它結束。
   * `currentHash`：畫面知道的目前版本（打字中最後存的那一版，否則工作區的版本）；不是選項來源那一版就關掉面板請重選。
   */
  selectionImage?: SelectionImageInput | null;
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
  const activeHighlightRef = useRef(activeHighlight);
  activeHighlightRef.current = activeHighlight;
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
      return {
        index,
        top: box.top + scrollY,
        height: box.height,
        text: (element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40),
      };
    });
    setBlocks(measured);
    onBlocksRef.current?.(measured.map(({ index, text }) => ({ index, text })));
    if (scrollY !== 0) frame.contentWindow?.scrollTo(0, 0);
  }, []);
  const scrollRef = useRef<HTMLDivElement>(null);
  // 打字模式（P5-T042 抽出）：編輯狀態、原文快照、存檔、hold、錯誤、格式工具列。
  // 必須呼叫在這個位置：裡面唯一的 effect（離開打字模式清掉 hold）抽出前就排在這裡；
  // 進入／離開編輯與「版本被換掉」的 effect 仍在下面原位，只呼叫它給的函式。
  const edit = useProofEditing({
    job,
    editing,
    revisionKey,
    renderEpoch,
    frameRef,
    scrollRef,
    measure,
    measureToken,
    onSaveEdit,
    onEndEdit,
    onEditTargetMissing,
  });
  const { isEditing, editingRef, hold, shown, saving, refreshFormat } = edit;
  // 內容一改就換一個網址，iframe 才會真的重載而不是吃快取。
  const previewSrc = `${job.previewUrl}?v=${shown.key}&r=${shown.epoch}`;

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
    setPinned(null);
    setInserting(null);
    selectionActions.clearPick();
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
    // 文件不自己捲動（見檔頭「二」）：捲動全部交給外層，滑鼠停在文章上滾一次就動。
    doc.documentElement.style.overflow = 'hidden';
    // body 包住浮動（alignleft／alignright 的圖），高度才量得到最後一張浮動圖的底（見 contentHeight）。
    if (doc.body) doc.body.style.display = 'flow-root';
    // 預覽回錯誤時 iframe 裡會是一段 JSON，不是校樣。要說出來，不要靜靜地空著。
    setBodyMissing(doc.querySelector('.preview-body') === null);
    onPreviewedRef.current?.();
    setLoadCount((count) => count + 1);
    // 點文章裡的標記＝在右欄亮起那一項。處理函式屬於外層，iframe 自己不跑 script。
    doc.addEventListener('click', (event) => {
      // 不能用 instanceof Element：iframe 裡的節點屬於另一個視窗，外層的 Element 認不得它。
      const target = event.target as Element | null;
      const mark = typeof target?.closest === 'function' ? target.closest('mark[data-hl]') : null;
      if (!mark || editingRef.current) return;
      // 同一段字有兩種標記（查證包在校稿裡面）時，點擊只會落在內層：已經亮著再點一次就換外層（審查 A）。
      const parent = mark.parentElement?.closest('mark[data-hl]') ?? null;
      const key = pickClickedMark(
        { key: mark.getAttribute('data-hl') ?? '', text: mark.textContent ?? '' },
        parent === null ? null : { key: parent.getAttribute('data-hl') ?? '', text: parent.textContent ?? '' },
        activeHighlightRef.current,
      );
      onHighlightRef.current?.(key);
    });
    // 選字之後的膠囊（查證這句、用此段配圖；SelectionActions.tsx）：選了字就浮出、Esc 收起。
    selectionActions.attach(doc);
    // 編輯中：打字會改變高度，要重量；正文空不空決定要不要顯示「從這裡開始寫…」。
    doc.addEventListener('input', () => {
      // 開始打字：膠囊收起（不擋打字）。
      selectionActions.clearPick();
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

  // 把建議標到字上。內容、清單或模式一變就整個重標：先拆掉舊的，再包新的。
  const highlightKey = highlights.map((h) => `${h.id}:${h.kind}:${h.blockIndex}:${h.text}`).join('|');
  useEffect(() => {
    // 編輯中不碰正文：輪詢換掉清單也不重標，否則 normalize() 會讓游標跳掉。
    // 進入編輯時的拆標記由下面的編輯 effect 負責。
    if (isEditing) return;
    const doc = frameRef.current?.contentDocument;
    const body = doc?.querySelector('.preview-body');
    if (!doc || !body) return;
    // 標題裡也可能有查證的標記（只出現在標題的那句，Codex 審查 4）：跟正文一起拆。
    const title = doc.querySelector('.preview-title');
    unwrapHighlightMarks(body);
    if (title) unwrapHighlightMarks(title);
    if (mode !== 'edit') return;
    for (const highlight of highlights) {
      const active = highlight.id === activeHighlight;
      for (const where of markScopes(highlight.kind, highlight.blockIndex)) {
        const scope = where === 'block' ? body.children[highlight.blockIndex ?? -1] : where === 'title' ? title : body;
        if (scope && wrapFirst(doc, scope, highlight, active)) break;
      }
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

  // 進入／離開編輯（內容在 useProofEditing）。標記的拆除由上面那個 effect 負責（isEditing 變了它會重跑）。
  useEffect(() => {
    edit.syncEditing();
    // editing 物件本身每次都是新的；nonce 才代表「又要求了一次」。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing?.nonce, isEditing, loadCount]);

  const markGroups = mode === 'edit' && !isEditing ? groupMarks(job.marks) : [];

  // 選字之後的膠囊與「用此段配圖」面板（P5-T041）。iframe 的選取事件在 handleLoad 交給它；
  // handleLoad 與「換版本」的 effect 寫在上面，但都在 render 完才跑，那時這裡已經有值。
  const selectionActions = useSelectionActions({
    jobUuid: job.uuid,
    mode,
    isEditing,
    revisionKey,
    hold,
    frameRef,
    selectionCheck,
    selectionImage,
    actWhileWriting: edit.actWhileWriting,
  });

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
          <EditBar edit={edit} />
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
      {isEditing && <EditToolbar edit={edit} />}
      <DropWarning edit={edit} />
      {edit.saveError && (
        <p className="proof-status proof-status-bad" role="alert">
          <Icon name="alert" size={15} /> 沒存成功：{edit.saveError}
        </p>
      )}
      <SelectionNotice actions={selectionActions} />
      {edit.actError && !edit.saveError && (
        <p className="proof-status proof-status-bad" role="alert">
          <Icon name="alert" size={15} /> 已存，但接著的動作沒做成：{edit.actError}
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

            <SelectionActions actions={selectionActions} editing={isEditing} saving={saving} />

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
              // 文件不自己捲動（見檔頭「二」）；載入後外層再用 CSSOM 把 html 設成 overflow: hidden。
              scrolling="no"
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
function wrapFirst(doc: Document, scope: Element, highlight: ProofHighlight, active: boolean): boolean {
  if (highlight.text.length === 0) return false;
  const group = highlight.kind === 'factcheck' ? 'factcheck' : 'review';
  const walker = doc.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node as Text;
    // 同一種（校稿／查證）的標記裡不再包；另一種的可以包在裡面（同一句既有觀察卡片又有查證）。
    if (text.parentElement?.closest(`mark[data-hl-group='${group}']`)) continue;
    const hit = findIgnoringSpaces(text.data, highlight.text, highlight.skipInside);
    if (hit === null) continue;
    const range = doc.createRange();
    range.setStart(text, hit.start);
    range.setEnd(text, hit.end);
    const mark = doc.createElement('mark');
    mark.setAttribute('data-hl', highlight.id);
    mark.setAttribute('data-hl-group', group);
    const color = HIGHLIGHT_COLORS[highlight.kind];
    mark.style.background = color.bg;
    mark.style.color = 'inherit';
    if (color.dashed) {
      mark.style.textDecoration = `underline dashed ${color.line}`;
      mark.style.textDecorationThickness = '2px';
      mark.style.textUnderlineOffset = '5px';
    } else {
      mark.style.borderBottom = `2px solid ${color.line}`;
    }
    mark.style.borderRadius = '2px';
    mark.style.cursor = 'pointer';
    if (active) {
      mark.style.outline = `2px solid ${color.line}`;
      mark.style.outlineOffset = '2px';
    }
    range.surroundContents(mark);
    return true;
  }
  return false;
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
