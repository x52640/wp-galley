/** 前後端共用的 HTTP 契約：校對符號與對照（跟上一版或 AI 提案比）。規則見 api.ts 開頭；前端與後端一律從 `api.ts` import。 */

// --- 校對符號與對照 -----------------------------------------------------------

export type ProofMarkKind = 'inserted' | 'deleted' | 'replaced' | 'moved';

/** 頁邊符號。用文字不用圖檔，才能跟著字級縮放。 */
export type ProofGlyph = '＋' | '－' | '～' | '⇄';

export interface ProofMark {
  /** 對應正文第幾個頂層區塊（以**目前**這一版的索引為準，0 起算）。 */
  readonly blockIndex: number;
  readonly kind: ProofMarkKind;
  readonly glyph: ProofGlyph;
  /** 由 diff 產生的說明，不是 Agent 寫的。 */
  readonly summary: string;
  readonly before: string | null;
  readonly after: string | null;
}

export type SegmentOp = 'same' | 'removed' | 'added';

export interface DiffSegment {
  readonly op: SegmentOp;
  readonly text: string;
}

/**
 * 對照的一列。欄位裡是**純文字**不是 HTML：這個畫面的用途是逐字比對，
 * 排版看校樣。
 */
export interface CompareRow {
  readonly kind: 'same' | 'replaced' | 'inserted' | 'deleted';
  /** 在左邊那一版的區塊索引；新增的列沒有左邊，是 null。 */
  readonly leftIndex: number | null;
  readonly rightIndex: number | null;
  readonly left: DiffSegment[] | null;
  readonly right: DiffSegment[] | null;
  /**
   * 單欄（git diff 式，D-019）用的完整序列：same、removed、added 照原本的順序排在一起，
   * 刪掉的字緊接著換上的字。整段新增就是一段 added、整段刪除就是一段 removed。
   */
  readonly segments: DiffSegment[];
  /**
   * 文字一模一樣、但標記被改掉時的說明（換了連結、換了圖片、h2 變 h3）。
   * 沒有這一句的話，這種列在對照畫面上會長得跟「沒改」完全一樣。
   */
  readonly note: string | null;
}

export interface Comparison {
  /** `proposal`＝跟 Agent 的提案比；`previous`＝跟上一版比；`none`＝沒得比。 */
  readonly against: 'proposal' | 'previous' | 'none';
  readonly leftLabel: string;
  readonly rightLabel: string;
  readonly rows: CompareRow[];
  /**
   * 正文以外的改動（D-019）：標題、網址片段、分類／標籤等 templateData 欄位，以及精選圖片。
   * 沒改的欄位不列。欄位的中文名稱與值怎麼顯示由後端決定（精選圖片給檔名／說明，不給 id），
   * 畫面照抄就好。
   */
  readonly fieldChanges: FieldChange[];
}

export interface FieldChange {
  /** templateData 的欄位名；精選圖片固定是 `featuredMedia`。 */
  readonly field: string;
  /** 給人看的名稱，例如「標題」「精選圖片」。 */
  readonly label: string;
  /** 顯示用的值；null＝這一邊沒有設定。 */
  readonly before: string | null;
  readonly after: string | null;
}
