/**
 * 前端唯一認定的資料形狀。
 *
 * 這份型別是照 `src/core/service.ts` 的對外型別與 `src/server/routes/jobs.ts`
 * 的實際回應抄下來的，不是自己想的。後端改了欄位就改這一個檔，畫面不用動。
 *
 * 幾個容易踩到的實情：
 * - `target` 與 `template` 可能是 `null`（設定檔把發布目標拿掉了）。
 * - `MediaAsset.url` 是 **WordPress 的公開網址**，還沒上傳成功時是 `null`，
 *   不是本機縮圖。
 * - `JobSummary` 只有 `targetKey`，沒有顯示名稱，列表要自己對照發布目標。
 */

export type JobState =
  | 'SOURCE'
  | 'REVIEWED'
  | 'MEDIA_READY'
  | 'RENDERED'
  | 'PREVIEWED'
  | 'APPROVED'
  | 'PUBLISHING'
  | 'PUBLISHED'
  | 'FAILED'
  | 'CANCELLED'
  | 'SUPERSEDED';

export type RevisionOrigin =
  | 'source'
  | 'agent_review'
  | 'media'
  | 'template_switch'
  | 'chat'
  | 'manual';

export type AgentProvider = 'codex' | 'claude' | 'google';

export type AgentRunStatus = 'running' | 'succeeded' | 'failed' | 'cancelled' | 'timeout';

/** 存成草稿與直接公開是兩個不同的決定。 */
export type PublishStatus = 'draft' | 'publish';

// --- 校對符號 -------------------------------------------------------------

export type ProofMarkKind = 'inserted' | 'deleted' | 'replaced' | 'moved';

/** 頁邊符號。用文字不用圖檔，才能跟著字級縮放。 */
export type ProofGlyph = '＋' | '－' | '～' | '⇄';

export interface ProofMark {
  /** 對應正文第幾個頂層區塊（以目前這一版的索引為準，0 起算）。 */
  blockIndex: number;
  kind: ProofMarkKind;
  glyph: ProofGlyph;
  /** 由 diff 產生的說明，不是 Agent 寫的。 */
  summary: string;
  before: string | null;
  after: string | null;
}

// --- 待處理清單（階段 5.5） -------------------------------------------------

export type ReviewItemType = 'change' | 'observation';
export type ReviewItemState = 'pending' | 'applied' | 'skipped' | 'unappliable';

export interface ReviewChange {
  type: 'typo' | 'grammar' | 'clarity' | 'style';
  before: string;
  after: string;
  reason: string;
  /** Agent 自評有沒有改變原意。true 者要標紅且**預設不勾選**。 */
  meaningChanged: boolean;
}

export interface Observation {
  kind: 'contradiction' | 'unsupported-claim' | 'missing-source' | 'gap';
  /** 掛在正文第幾個頂層區塊上，跟校對符號用同一套索引。 */
  blockIndex: number;
  excerpt: string;
  detail: string;
  suggestion: string;
}

/**
 * 清單上的一項。
 *
 * 改動與觀察不是同一種東西（一個能自動套用，一個只能請人判斷），但都是
 * 「掛在文章某一段上的待辦事項」，所以用同一個容器裝——階段 6 的查證發現
 * 也會掛進來。差別只在那一項給的按鈕。
 */
export interface ReviewItem {
  id: number;
  ordinal: number;
  type: ReviewItemType;
  state: ReviewItemState;
  change: ReviewChange | null;
  observation: Observation | null;
  /**
   * 這一項掛在正文第幾個頂層區塊上（後端每次讀取時重算）。
   * null = 在目前的內容裡定位不到，那一項就沒有「跳到該段」。
   */
  blockIndex: number | null;
  resolvedAt: string | null;
}

export interface ReviewProposal {
  id: number;
  provider: string;
  summary: string | null;
  createdAt: string;
  baseContentHash: string;
  /** 提案之後內容又被改過。逐項套用還能試，「全部接受」會被後端擋下。 */
  stale: boolean;
  pendingCount: number;
  items: ReviewItem[];
}

export interface ReviewResolveResult {
  revision: Revision | null;
  applied: number[];
  skipped: number[];
  /** 想套用但在目前內容裡定位不到。這幾項得自己改。 */
  unappliable: number[];
  review: ReviewProposal | null;
}

// --- 配圖需求 ---------------------------------------------------------------

/**
 * 一條配圖需求。
 *
 * **這裡不生圖。** 三個 Agent CLI 都不能產生圖片，生圖 API 也還沒選。所以自動化的
 * 只有前半段：Agent 說出「哪一段該放什麼圖、prompt 長怎樣」，使用者拿去生完回來
 * 在同一格上傳，靠 `key` 對回這條需求。
 */
export interface ImageBrief {
  id: number;
  key: string;
  purpose: string;
  /** 拿去貼進生圖工具的那段文字。 */
  prompt: string;
  aspectRatio: string;
  altText: string;
  caption: string | null;
  /** Agent 講的位置描述（「第三段之後」）。**不是**區塊索引。 */
  placement: string | null;
  /** 已經有圖對上這條需求了。 */
  fulfilled: boolean;
  dismissed: boolean;
  createdAt: string;
}

// --- 左右對照 ---------------------------------------------------------------

export type SegmentOp = 'same' | 'removed' | 'added';

export interface DiffSegment {
  op: SegmentOp;
  text: string;
}

export interface CompareRow {
  kind: 'same' | 'replaced' | 'inserted' | 'deleted';
  leftIndex: number | null;
  rightIndex: number | null;
  left: DiffSegment[] | null;
  right: DiffSegment[] | null;
  /** 文字一樣但標記改了時的說明；其他情況是 null。 */
  note: string | null;
}

export interface Comparison {
  against: 'proposal' | 'previous' | 'none';
  leftLabel: string;
  rightLabel: string;
  rows: CompareRow[];
}

// --- Job ------------------------------------------------------------------

export interface JobTarget {
  key: string;
  displayName: string;
  contentType: string;
  taxonomy: string | null;
  requireFeaturedImage: boolean;
  /** 只有 GET /api/wordpress 會給；JobDetail 裡沒有。 */
  postType?: string;
  templateId?: string;
  allowCreateTerms?: boolean;
}

export interface JobTemplate {
  id: string;
  hash: string;
  strictness: string;
}

export interface Revision {
  id: number;
  number: number;
  origin: RevisionOrigin;
  contentHash: string;
  templateData: Record<string, unknown>;
  featuredMediaId: number | null;
  /** 真正會送去 WordPress 的正文 HTML。 */
  publishHtml: string;
  createdAt: string;
}

export interface MediaAsset {
  id: number;
  jobId: number;
  mimeType: string;
  byteSize: number;
  sha256: string;
  width: number | null;
  height: number | null;
  altText: string | null;
  caption: string | null;
  briefKey: string | null;
  wordpressMediaId: number | null;
  /** WordPress 媒體庫的公開網址；還沒上傳成功就是 null。 */
  url: string | null;
  /** 有沒有被插進目前這一版的正文。 */
  placed: boolean;
  /** 插在第幾個頂層區塊後面（-1 = 放在最前面）；沒插進正文就是 null。 */
  placedAfterBlockIndex: number | null;
  featured: boolean;
  createdAt: string;
}

export interface Approval {
  id: number;
  contentHash: string;
  createdAt: string;
  /** false = 印章被撕掉了：內容在核准之後又改過。 */
  valid: boolean;
}

export interface AgentRun {
  status: AgentRunStatus;
  provider: string;
  /** 這一趟做的是什麼。 */
  task: AgentTask;
  startedAt: string;
  finishedAt: string | null;
  errorMessage: string | null;
}

export interface PublishedRef {
  wordpressId: number;
  status: string;
  link: string;
}

/** 前端整個工作區靠這一個回應渲染。 */
export interface JobDetail {
  uuid: string;
  state: JobState;
  title: string | null;
  /** 設定檔把發布目標拿掉時會是 null，這時整個 job 只剩下取消一途。 */
  target: JobTarget | null;
  template: JobTemplate | null;
  currentRevision: Revision | null;
  revisionCount: number;
  /** 預覽用 HTML 的網址，不是內容本身。 */
  previewUrl: string;
  /** 相對於上一個 revision 的改動，給頁邊校對符號用。 */
  marks: ProofMark[];
  media: MediaAsset[];
  featuredMediaId: number | null;
  approval: Approval | null;
  /** 目前狀態下還缺什麼才能發布。空陣列 = 可以發。 */
  blockers: string[];
  published: PublishedRef | null;
  agentRun: AgentRun | null;
  /** 待處理清單。沒有未結案的校稿提案就是 null。 */
  review: ReviewProposal | null;
  /** 配圖需求。已經丟掉的不會出現。 */
  imageBriefs: ImageBrief[];
  sourceText: string | null;
}

/** target 與 template 都在的 job。工作區在進去之前先確認過。 */
export type LoadedJob = JobDetail & { target: JobTarget; template: JobTemplate };

export function isLoaded(job: JobDetail): job is LoadedJob {
  return job.target !== null && job.template !== null;
}

export interface JobSummary {
  uuid: string;
  state: JobState;
  title: string | null;
  targetKey: string | null;
  templateId: string | null;
  createdAt: string;
  updatedAt: string;
  revisionCount: number;
  revisionNumber: number | null;
  approved: boolean;
  publishedId: number | null;
}

// --- 分類項目 -------------------------------------------------------------

/** WordPress 的 term。名字叫 tag 的分類法也可能是階層式的，看 hierarchical。 */
export interface Term {
  id: number;
  name: string;
  slug: string;
  count?: number;
  parent?: number;
}

// --- 請求與回應 -----------------------------------------------------------

export interface CreateJobInput {
  targetKey: string;
  sourceText: string;
  title?: string;
  templateData?: Record<string, unknown>;
}

export interface CreateRevisionInput {
  origin?: RevisionOrigin;
  /** 整份取代目前的 templateData；沒給就沿用上一版。 */
  templateData?: Record<string, unknown>;
  sourceText?: string;
  /** null = 清除精選圖片；不給 = 沿用。 */
  featuredMediaId?: number | null;
  reason?: string;
  /**
   * 這次編輯是根據哪一版算出來的（那一版的 content hash）。
   *
   * `templateData` 是**整份取代**，所以兩個面板各自送出時，晚到的那一份會把先
   * 到的欄位蓋掉。帶上這個值，後端就能在對不上時直接拒絕，而不是默默覆蓋。
   * 後端還沒支援時會被 zod 忽略（不會報錯），畫面行為不變。
   */
  expectedContentHash?: string;
}

/** `review` 校稿（產生待處理清單）；`images` 配圖需求（不會洗掉待處理清單）。 */
export type AgentTask = 'review' | 'images';

export interface AgentReviewInput {
  provider: AgentProvider;
  /** 預設 review。 */
  task?: AgentTask;
  model?: string;
  instruction?: string;
  timeoutMs?: number;
}

/** 前端拿到的是 Blob；轉成 base64 是 client.ts 的事。 */
export interface AddMediaInput {
  file: Blob;
  filename: string;
  mimeType: string;
  altText?: string;
  caption?: string;
  briefKey?: string;
}

export interface PublishInput {
  status: PublishStatus;
  confirm?: boolean;
}

export interface RenderOutcome {
  revisionId: number;
  revisionNumber: number;
  contentHash: string;
  publishHtml: string;
  previewDocument: string;
  sanitize: { changed: boolean; removedTags: string[]; removedAttributes: string[] };
  state: JobState;
}

export interface AgentRunResult {
  runId: string;
  status: AgentRunStatus;
  summary: string | null;
  changes: ReviewChange[];
  observations: Observation[];
  imageBriefs: ImageBrief[];
  task: AgentTask;
  /**
   * 校稿結果存成提案，**文章一個字都還沒動**。要套用哪幾項由使用者逐項決定。
   * 這裡沒有 revision 欄位是刻意的（見 docs/STAGE-5-CONTRACT.md 第七節）。
   * `task === 'images'` 那一趟不產生提案，所以是 null。
   */
  review: ReviewProposal | null;
}

export interface PublishResult {
  wordpressId: number;
  status: string;
  link: string;
  created: boolean;
  /** 對不上既有分類項目的名稱。不自動建立，交給使用者處理。 */
  unknownTerms: string[];
  /** 落到 wp:html 逃生門的區塊數，大於 0 值得提醒使用者。 */
  fallbackBlocks: number;
}

// --- 前端看到的 API 介面 ---------------------------------------------------

/**
 * 真實後端與示範資料都實作這一個介面，畫面完全分不出差別。
 * 後端還沒好的時候，加上 `?fixtures=1` 就能把每個畫面與狀態都走一遍。
 */
export interface PublisherApi {
  listJobs(filter?: { state?: JobState[] }): Promise<JobSummary[]>;
  /** 後端回的是剛建立的 job；畫面只需要 uuid 就能跳進工作區。 */
  createJob(input: CreateJobInput): Promise<{ uuid: string }>;
  getJob(uuid: string): Promise<JobDetail>;
  cancelJob(uuid: string): Promise<void>;

  createRevision(uuid: string, input: CreateRevisionInput): Promise<Revision>;
  listRevisions(uuid: string): Promise<Revision[]>;
  render(uuid: string): Promise<RenderOutcome>;
  /** 預覽 HTML 的原始碼。iframe 用 srcdoc 載入，見 ProofView 的說明。 */
  fetchPreview(uuid: string): Promise<string>;
  /**
   * 校樣回應的 ETag，也就是**後端當下算出來的** content hash。
   *
   * 核准要綁的是使用者眼睛看到的那一份，而 `GET /api/jobs/:uuid` 的 hash 有可能
   * 已經比校樣新（或舊）。拿不到 ETag 時回 null，代表「無法確認」。
   */
  fetchPreviewHash(uuid: string): Promise<string | null>;

  runAgent(uuid: string, input: AgentReviewInput): Promise<AgentRunResult>;
  cancelAgent(uuid: string): Promise<void>;

  /** 逐項套用或略過。套用會產生新版本，略過不動內容。 */
  resolveReview(
    uuid: string,
    input: { itemIds: number[]; decision: 'apply' | 'skip' },
  ): Promise<ReviewResolveResult>;
  /**
   * 採用 Agent 的整份稿。跟「把每一項都勾起來」不一樣，見 CoreService 的說明。
   *
   * 兩個整份操作都要帶 `proposalId`：確認對話框開著的時候如果又跑了一次校稿，
   * 不帶的話會作用在使用者沒看過的那一份上。
   */
  acceptWholeReview(uuid: string, proposalId: number): Promise<ReviewResolveResult>;
  discardReview(uuid: string, reason: string, proposalId: number): Promise<void>;
  /** 左右對照。不給 against 就是「有提案跟提案比，沒有就跟上一版比」。 */
  fetchComparison(uuid: string, against?: 'proposal' | 'previous'): Promise<Comparison>;
  /** 丟掉一條配圖需求。 */
  dismissImageBrief(uuid: string, briefId: number): Promise<void>;

  addMedia(uuid: string, input: AddMediaInput): Promise<MediaAsset>;
  replaceMedia(uuid: string, assetId: number, input: AddMediaInput): Promise<MediaAsset>;
  removeMedia(uuid: string, assetId: number): Promise<void>;
  /** afterBlockIndex：-1 放在最前面，n 放在第 n 個頂層區塊後面。 */
  placeMedia(uuid: string, assetId: number, afterBlockIndex: number): Promise<void>;
  setFeaturedMedia(uuid: string, assetId: number | null): Promise<void>;

  approve(uuid: string, contentHash: string): Promise<Approval>;
  revokeApproval(uuid: string, reason: string): Promise<void>;

  publish(uuid: string, input: PublishInput): Promise<PublishResult>;

  /** 分類項目只讀既有的；要建立新項目得使用者明確確認。 */
  listTerms(taxonomy: string): Promise<Term[]>;
  createTerm(taxonomy: string, name: string): Promise<Term>;

  listTargets(): Promise<JobTarget[]>;
}
