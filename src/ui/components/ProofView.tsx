import { useEffect, useState, type JSX, type ReactNode } from 'react';
import type { LoadedJob } from '../service/types.js';
import { Icon } from '../icons.js';
import { shortHash } from '../lib/format.js';
import type { ProofHighlight } from '../lib/proof-highlights.js';
import {
  SelectionActions,
  SelectionNotice,
  useSelectionActions,
  type SelectionCheckInput,
  type SelectionImageInput,
} from './SelectionActions.js';
import { useProofEditing } from '../lib/use-proof-editing.js';
import { useProofFrame, useProofMeasure } from '../lib/use-proof-frame.js';
import { DropWarning, EditBar, EditToolbar } from './EditToolbar.js';
import { MarkGutter } from './MarkPin.js';
import { InsertSlots, useInsertSlots } from './InsertSlots.js';

export type { ProofHighlight } from '../lib/proof-highlights.js';

/**
 * 中央校樣。這個元件只做組裝：各部分在哪裡，下面每一節都標了檔案。
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
 * **二、iframe 不自己捲動**，高度撐到內容的完整高度、捲動交給外層容器（P5-T029）。
 * 載入、量測、ResizeObserver、捲動對齊在 `lib/use-proof-frame.ts`，高度怎麼量在 `lib/proof-frame.ts`（P5-T043）。
 *
 * **三、建議標在字上（B1）。** 外層把待處理的那段字包進 `<mark>`，用 CSSOM 上色、不注入 script；
 * 點標記由外層掛在文件上的事件處理。怎麼包、點到哪一張在 `lib/proof-highlights.ts`（P5-T043）。
 * 左側的校對符號在 `MarkPin.tsx`。
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
 * 段落之間滑鼠移過去出現「在這裡插圖」，畫在 iframe 外層、位置用同一份量到的區塊座標。
 * 要不要出現由上層決定（`insertImage` 給 null 就不畫），編輯中這裡再擋一次。狀態與畫面在 `InsertSlots.tsx`（P5-T043）。
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
  const [pinned, setPinned] = useState<string | null>(null);
  const [showMarks, setShowMarks] = useState(true);
  const revisionKey = job.currentRevision?.contentHash ?? 'none';
  const hasRevision = job.currentRevision !== null;

  // effect 的順序跟抽出前一樣（React 照呼叫順序跑 effect）：渲染世代 → 打字模式 → 載入、換版本、ETag、捲動、標記
  // → 進出編輯 → 選字膠囊 → 插圖。見 lib/use-proof-frame.ts 檔頭；tests/proof-editing.test.ts 守著。
  // 量測（P5-T043 抽出）：渲染世代的 effect 與 `measure`。
  const measured = useProofMeasure({ jobState: job.state, onBlocks });
  const { frameRef, scrollRef, measure, measureToken, renderEpoch, blocks, height, column } = measured;
  // 打字模式（P5-T042 抽出）：編輯狀態、原文快照、存檔、hold、錯誤、格式工具列。
  // 必須呼叫在這個位置：裡面唯一的 effect（離開打字模式清掉 hold）抽出前就排在這裡；
  // 進入／離開編輯的 effect 仍在下面原位，只呼叫它給的函式。
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
  const { isEditing, hold, shown, saving } = edit;
  // 內容一改就換一個網址，iframe 才會真的重載而不是吃快取。
  const previewSrc = `${job.previewUrl}?v=${shown.key}&r=${shown.epoch}`;

  // 校樣本體（P5-T043 抽出）：載入、換版本、ETag、捲到清單點的段落、字上標記、捲到點的標記。
  // 選字膠囊與插圖在下面才建立；這幾個函式只在 effect 與 iframe 事件裡呼叫（render 之後），那時已經有值。
  const frame = useProofFrame({
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
    resetViews: () => {
      setPinned(null);
      insert.reset();
      selectionActions.clearPick();
    },
    attachSelection: (doc) => selectionActions.attach(doc),
    clearSelection: () => selectionActions.clearPick(),
  });
  const { fixtures, srcDoc, loading, error, bodyMissing, loadCount, focused } = frame;

  // 進入／離開編輯（內容在 useProofEditing）。標記的拆除由 useProofFrame 的標記 effect 負責（isEditing 變了它會重跑）。
  useEffect(() => {
    edit.syncEditing();
    // editing 物件本身每次都是新的；nonce 才代表「又要求了一次」。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing?.nonce, isEditing, loadCount]);

  // 選字之後的膠囊與「用此段配圖」面板（P5-T041）。iframe 的選取事件在 useProofFrame 的 handleLoad 交給它。
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

  // 在這裡插圖（P5-T043 抽出）：不給插了（進了對照、打開發布面板、開始改字…）就把打開的面板收掉。
  const insert = useInsertSlots({
    canInsert: insertImage !== null && mode === 'edit' && !isEditing && !loading && blocks.length > 0,
    blocks,
    scrollRef,
  });

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
              <MarkGutter
                marks={mode === 'edit' && !isEditing ? job.marks : []}
                blocks={blocks}
                pinned={pinned}
                onToggle={(id) => setPinned((current) => (current === id ? null : id))}
              />
            )}

            <InsertSlots state={insert} column={column} insertImage={insertImage} />

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
              onLoad={frame.handleLoad}
            />
          </div>
        )}
      </div>
    </section>
  );
}
