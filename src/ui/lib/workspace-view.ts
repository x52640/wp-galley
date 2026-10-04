/**
 * 工作區（`components/Workspace.tsx`）畫面上要算的東西，不需要 React 狀態的部分（P5-T045 從 Workspace 抽出，行為不變）。
 * 讀稿件與同步（世代、篇別守衛、待同步、存檔基準）在 `use-job-workspace.ts`。
 */

import { isLoaded, type CreateRevisionInput, type FactCheckFinding, type JobDetail, type ReviewItem } from '../service/types.js';
import { SYNC_PENDING_NOTE } from './check-while-writing.js';
import { highlightText } from './review-kinds.js';

/** 進打字模式被 AI 擋住時的說明（待同步的說明是 `SYNC_PENDING_NOTE`）。 */
export const RUN_BLOCKED_NOTE = 'AI 還在處理這篇，等它跑完再改。';

/** 進打字模式被擋住時講哪一句：只有待同步（沒有 AI 在跑）才講同步，其他都講 AI 在處理。 */
export function editBlockedNote(state: { runBlocked: boolean; pendingSync: boolean }): string {
  return state.pendingSync && !state.runBlocked ? SYNC_PENDING_NOTE : RUN_BLOCKED_NOTE;
}

/**
 * 剛建好的那一篇載入失敗（或發布目標已經不在）：這次不進打字模式，旗標也清掉，
 * 不然之後重新讀取成功、或再打開同一篇時會莫名進打字模式（審查 #4）。
 */
export function isLoadFailed(state: { error: string | null; job: JobDetail | null }): boolean {
  return (state.error !== null && state.job === null) || (state.job !== null && !isLoaded(state.job));
}

/** 校樣量到的區塊跟手上的一樣（逐段字相同）：一樣就留著原本那份，不觸發重新 render。 */
export function sameBlocks(
  current: readonly { index: number; text: string }[],
  next: readonly { index: number; text: string }[],
): boolean {
  return current.length === next.length && current.every((b, i) => b.text === next[i]?.text);
}

type ImagesJob = Pick<JobDetail, 'imageBriefs' | 'featuredMediaId' | 'media'> & {
  target: { requireFeaturedImage: boolean };
};

/** 右欄圖片區要不要自己展開：有沒完成的配圖需求，或規定要封面卻還沒有。 */
export function imagesNeedAttention(job: ImagesJob): boolean {
  return job.imageBriefs.some((brief) => !brief.fulfilled) || (job.target.requireFeaturedImage && job.featuredMediaId === null);
}

/** 右欄圖片區標題旁的那一小句。 */
export function imagesHint(job: ImagesJob): string {
  return job.target.requireFeaturedImage && job.featuredMediaId === null
    ? '還缺封面圖'
    : job.imageBriefs.some((brief) => !brief.fulfilled)
      ? `配圖 ${job.imageBriefs.filter((brief) => !brief.fulfilled).length} 張待處理`
      : job.media.length > 0
        ? `${job.media.length} 張`
        : '';
}

/** 進打字模式的請求（結構同 ProofView 的 `ProofEditRequest`）。 */
export interface EditEntry {
  itemId: number | null;
  factCheckId: number | null;
  caret: string | null;
  caretSkipInside?: string | null;
  blockIndex: number | null;
  nonce: number;
}

/**
 * 「改原文」（item＝null）與校稿卡片的「自己改」：游標停在哪、要不要先講一句「找不到」。
 *
 * 按過接受、後端在每個欄位（標題、正文…）都找不到原句的（unappliable，P5-T017）：字上標不出來，
 * 游標只能放文章開頭——明講找不到，不然使用者會以為游標停的地方就是要改的地方。
 * 不用 blockIndex === null 判斷：改標題的建議也沒有段落，但它找得到，只是不在正文裡。
 * 其他卡片（觀察、查證）字與段落都標不出來的，由 ProofView 定位完回報（onEditTargetMissing，P5-T037）。
 */
export function cardEditStart(item: ReviewItem | null, nonce: number): { notice: string | null; request: EditEntry } {
  const quoted = item === null ? null : (item.change?.before ?? item.observation?.excerpt ?? null);
  const lost = item !== null && item.state === 'unappliable';
  // 空白不同之類逐字對不上、但定位（忽略空白）找得到段落的，游標放那一段開頭。
  const where = item?.blockIndex == null ? '文章開頭' : `第 ${item.blockIndex + 1} 段開頭`;
  return {
    notice: lost && quoted ? `文章裡找不到「${quoted}」，游標放在${where}。找到那句直接改，改完按儲存。` : null,
    request: {
      itemId: item?.id ?? null,
      factCheckId: null,
      caret: item === null || lost ? null : (highlightText(item) ?? quoted),
      caretSkipInside: item?.change?.after ?? null,
      blockIndex: item?.blockIndex ?? null,
      nonce,
    },
  };
}

/** 查證卡片的「去原文改」：游標停在那句前面（找不到就停在那一段開頭），存檔後那條結案（resolved-by-edit）。 */
export function findingEditStart(finding: FactCheckFinding, nonce: number): EditEntry {
  return {
    itemId: null,
    factCheckId: finding.id,
    caret: finding.excerpt,
    blockIndex: finding.blockIndex,
    nonce,
  };
}

/**
 * 在文章上改完存檔送出去的內容。標題與內文一起存成同一個新版本（P5-T029）；只送有改的那一邊。
 * `from` 是這次打字模式從哪裡進來的（卡片、查證卡片），`base` 是存檔基準（`nextSaveBase`）。
 */
export function manualRevisionInput(input: {
  editedBody: string | undefined;
  editedTitle: string | undefined;
  from: { itemId: number | null; factCheckId?: number | null } | null;
  base: string | undefined;
}): CreateRevisionInput {
  const { editedBody, editedTitle, from, base } = input;
  return {
    ...(editedBody === undefined ? {} : { editedBody }),
    ...(editedTitle === undefined ? {} : { editedTitle }),
    origin: 'manual',
    reason: '直接在文章上改',
    // 從卡片進來改的：存成新版本時那張卡片一起結案，不用再按一次「不用改」。
    // 只改標題也算（講標題的建議，P5-T031）。
    ...(from?.itemId == null || (editedBody === undefined && editedTitle === undefined)
      ? {}
      : { resolveItemId: from.itemId }),
    // 從查證卡片「去原文改」進來的：那條查證結果一起結案（resolved-by-edit）。
    ...(from?.factCheckId == null || (editedBody === undefined && editedTitle === undefined)
      ? {}
      : { resolveFactCheckId: from.factCheckId }),
    // 編輯中被換版本時後端會回 409，不會蓋掉別人存進去的修改（P5-T005）。
    ...(base === undefined ? {} : { expectedContentHash: base }),
  };
}
