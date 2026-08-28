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
}

export interface AgentReviewInput {
  provider: AgentProvider;
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
  revision: Revision | null;
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

  runAgent(uuid: string, input: AgentReviewInput): Promise<AgentRunResult>;
  cancelAgent(uuid: string): Promise<void>;

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
