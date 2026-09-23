/**
 * 前後端共用的 HTTP 契約（docs/specs/http-api.md，決策 D-015）。
 *
 * **這是線上資料形狀的唯一定義。** 後端的 CoreService 回傳這些型別，路由把它們
 * 包進回應信封，前端直接 import 同一份——後端改了欄位，前端在編譯期就會壞，
 * 不會等到畫面出錯才發現。以前前端有一份手抄的，抄漏了沒有人知道。
 *
 * 規則：
 * - 這個資料夾**不准 import 任何東西**（不准 Fastify、React、`node:*`，也不准
 *   `src/core`）。依賴方向是 core／server／ui → contract，反過來就會把後端拖進
 *   瀏覽器 bundle。
 * - 只放會過網路的形狀。後端內部用的列（`*Row`）、前端才有的東西（Blob）不放這裡。
 * - 欄位一律 readonly：這些是讀到的資料，不是拿來改的狀態。
 */

// --- 列舉 -------------------------------------------------------------------

export const JOB_STATES = [
  'SOURCE',
  'REVIEWED',
  'MEDIA_READY',
  'RENDERED',
  'PREVIEWED',
  'APPROVED',
  'PUBLISHING',
  'PUBLISHED',
  'FAILED',
  'CANCELLED',
  'SUPERSEDED',
] as const;

export type JobState = (typeof JOB_STATES)[number];

export type RevisionOrigin = 'source' | 'agent_review' | 'media' | 'template_switch' | 'chat' | 'manual';

export type AgentProvider = 'codex' | 'claude' | 'google';

export type AgentRunStatus = 'running' | 'succeeded' | 'failed' | 'cancelled' | 'timeout';

/**
 * 這一趟要 Agent 做什麼。
 *
 * `review` 是校稿（產生待處理清單），`images` 是配圖需求（產生 imageBriefs）。
 * 兩者共用同一份輸出 schema，差別在 prompt 與**結果怎麼落地**——配圖那一趟
 * 不會建立提案，所以按「一鍵配圖」不會把還沒清完的校稿清單洗掉。
 */
export type AgentTask = 'review' | 'images';

/** 存成草稿與直接公開是兩個不同的決定。 */
export type PublishStatus = 'draft' | 'publish';

export type ReviewItemType = 'change' | 'observation';
export type ReviewItemState = 'pending' | 'applied' | 'skipped' | 'unappliable';

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
 * 左右對照的一列。欄位裡是**純文字**不是 HTML：這個畫面的用途是逐字比對，
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
}

// --- Agent 的輸出 -------------------------------------------------------------

export interface ReviewChange {
  readonly type: 'typo' | 'grammar' | 'clarity' | 'style';
  readonly before: string;
  readonly after: string;
  readonly reason: string;
  /** Agent 自評有沒有改變原意。true 者 UI 必須標紅並預設不套用。 */
  readonly meaningChanged: boolean;
}

/** 需要人判斷的觀察。不是可以自動套用的改動。 */
export interface Observation {
  readonly kind: 'contradiction' | 'unsupported-claim' | 'missing-source' | 'gap';
  /** 對應正文第幾個頂層區塊，讓 UI 把它掛到那一段。 */
  readonly blockIndex: number;
  /** 原文中被指涉的片段，用來標亮。 */
  readonly excerpt: string;
  readonly detail: string;
  /** 建議怎麼處理；**不是**自動套用的改動。 */
  readonly suggestion: string;
}

/**
 * Agent 交回來的一條配圖需求，**還沒存進資料庫**，所以沒有 id。
 * 存進去之後的樣子是 `ImageBrief`。
 */
export interface ImageBriefDraft {
  /** 供 templateData 的 featuredImageBriefKey 指向。 */
  readonly key: string;
  readonly purpose: string;
  readonly prompt: string;
  readonly aspectRatio: string;
  readonly altText: string;
  readonly caption?: string;
  /** 建議插入的位置描述，例如「第三段之後」。 */
  readonly placement?: string;
}

// --- 待處理清單 --------------------------------------------------------------

/**
 * 清單上的一項。
 *
 * 校稿改動與觀察不是同一種東西（一個可以自動套用，一個只能請人判斷），但都是
 * 「掛在文章某一段上的待辦事項」，所以裝在同一個容器裡
 * （docs/specs/review-proposals.md「統一模型」）。
 */
export interface ReviewItem {
  readonly id: number;
  readonly ordinal: number;
  readonly type: ReviewItemType;
  readonly state: ReviewItemState;
  /** `type === 'change'` 時才有。 */
  readonly change: ReviewChange | null;
  /** `type === 'observation'` 時才有。 */
  readonly observation: Observation | null;
  /**
   * 掛在正文第幾個頂層區塊上。**每次讀取時重算**；定位不到就是 null，
   * 那一項就沒有「跳到該段」。
   */
  readonly blockIndex: number | null;
  readonly resolvedAt: string | null;
}

export interface ReviewProposal {
  readonly id: number;
  readonly provider: string;
  readonly summary: string | null;
  readonly createdAt: string;
  /** 這份提案是對著哪一份內容做的。 */
  readonly baseContentHash: string;
  /** 提案之後內容又被改過。逐項套用還能試，「全部接受」會被後端擋下。 */
  readonly stale: boolean;
  /** 還沒有下場的項目數：`pending` 加上 `unappliable`。 */
  readonly pendingCount: number;
  readonly items: ReviewItem[];
}

export interface ReviewResolveResult {
  /** 有東西真的被套用才會產生新版本；只是略過的話是 null。 */
  readonly revision: Revision | null;
  readonly applied: number[];
  readonly skipped: number[];
  /** 想套用但在目前內容裡定位不到。這幾項得使用者自己改。 */
  readonly unappliable: number[];
  readonly review: ReviewProposal | null;
}

/**
 * 存進資料庫的一條配圖需求。**這裡不生圖**，只把「該配什麼圖」講清楚；
 * 使用者生完圖回來上傳時帶 `key`，就對回這一條。
 */
export interface ImageBrief {
  readonly id: number;
  readonly key: string;
  readonly purpose: string;
  /** 拿去貼進生圖工具的那段文字。 */
  readonly prompt: string;
  readonly aspectRatio: string;
  readonly altText: string;
  readonly caption: string | null;
  /** Agent 講的位置描述（「第三段之後」）。**不是**區塊索引。 */
  readonly placement: string | null;
  /** 已經有圖對上這條需求了。 */
  readonly fulfilled: boolean;
  readonly dismissed: boolean;
  readonly createdAt: string;
}

// --- Job -------------------------------------------------------------------

export interface Job {
  readonly uuid: string;
  readonly state: JobState;
  readonly title: string | null;
  readonly targetKey: string | null;
  readonly templateId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface JobSummary extends Job {
  readonly revisionCount: number;
  readonly revisionNumber: number | null;
  readonly approved: boolean;
  readonly publishedId: number | null;
}

export interface JobTarget {
  readonly key: string;
  readonly displayName: string;
  readonly contentType: string;
  readonly taxonomy: string | null;
  readonly requireFeaturedImage: boolean;
  /** 設定檔有沒有允許從發布台建立新的分類項目（D-004：預設不允許）。 */
  readonly allowCreateTerms: boolean;
}

export interface JobTemplate {
  readonly id: string;
  readonly hash: string;
  readonly strictness: string;
}

export interface Revision {
  readonly id: number;
  readonly number: number;
  readonly origin: RevisionOrigin;
  readonly contentHash: string;
  readonly templateData: Record<string, unknown>;
  readonly featuredMediaId: number | null;
  /** 真正會送去 WordPress 的正文 HTML。 */
  readonly publishHtml: string;
  readonly createdAt: string;
}

export interface MediaAsset {
  readonly id: number;
  readonly jobId: number;
  readonly mimeType: string;
  readonly byteSize: number;
  readonly sha256: string;
  /** 目前不解析影像尺寸，永遠是 null；欄位保留給日後需要時填。 */
  readonly width: number | null;
  readonly height: number | null;
  readonly altText: string | null;
  readonly caption: string | null;
  readonly briefKey: string | null;
  readonly wordpressMediaId: number | null;
  /** WordPress 媒體庫的公開網址；沒上傳成功就是 null，不是本機縮圖。 */
  readonly url: string | null;
  /** 有沒有被插進目前這一版的正文。 */
  readonly placed: boolean;
  /**
   * 圖片被插在第幾個頂層區塊後面（-1 = 最前面），沒插進正文就是 null。
   * 跟 `placeMedia` 的 `afterBlockIndex` 是同一套索引。
   */
  readonly placedAfterBlockIndex: number | null;
  readonly featured: boolean;
  readonly createdAt: string;
}

export interface Approval {
  readonly id: number;
  readonly contentHash: string;
  readonly createdAt: string;
  /** false = 印章被撕掉了：內容在核准之後又改過。 */
  readonly valid: boolean;
}

export interface AgentRun {
  readonly status: AgentRunStatus;
  readonly provider: string;
  /** 這一趟做的是什麼。畫面靠它決定要說「校稿」還是「想配圖」。 */
  readonly task: AgentTask;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly errorMessage: string | null;
}

export interface PublishedRef {
  readonly wordpressId: number;
  readonly status: string;
  readonly link: string;
}

/** 前端整個工作區靠這一個回應渲染。 */
export interface JobDetail {
  readonly uuid: string;
  readonly state: JobState;
  readonly title: string | null;
  /** 設定檔把發布目標拿掉時會是 null，這時整個 job 只剩下取消一途。 */
  readonly target: JobTarget | null;
  readonly template: JobTemplate | null;
  readonly currentRevision: Revision | null;
  readonly revisionCount: number;
  /** 預覽用 HTML 的網址，不是內容本身——內容走 iframe 載入。 */
  readonly previewUrl: string;
  /** 相對於上一個 revision 的改動，給頁邊校對符號用。 */
  readonly marks: ProofMark[];
  readonly media: MediaAsset[];
  readonly featuredMediaId: number | null;
  readonly approval: Approval | null;
  /** 目前狀態下還缺什麼才能發布。空陣列代表可以發。 */
  readonly blockers: string[];
  readonly published: PublishedRef | null;
  readonly agentRun: AgentRun | null;
  /** 待處理清單。沒有未結案的校稿提案就是 null。 */
  readonly review: ReviewProposal | null;
  /** 配圖需求。已經丟掉的不列進來。 */
  readonly imageBriefs: ImageBrief[];
  readonly sourceText: string | null;
}

export interface RenderOutcome {
  readonly revisionId: number;
  readonly revisionNumber: number;
  readonly contentHash: string;
  readonly publishHtml: string;
  readonly previewDocument: string;
  readonly sanitize: {
    readonly changed: boolean;
    readonly removedTags: string[];
    readonly removedAttributes: string[];
  };
  readonly state: JobState;
}

export interface AgentRunResult {
  readonly runId: string;
  readonly status: AgentRunStatus;
  readonly summary: string | null;
  readonly changes: readonly ReviewChange[];
  readonly observations: readonly Observation[];
  /** Agent 交回來的原樣，還沒有 id。要存進去之後的樣子看 `JobDetail.imageBriefs`。 */
  readonly imageBriefs: readonly ImageBriefDraft[];
  /** 這一趟做的是什麼。`images` 不會產生提案。 */
  readonly task: AgentTask;
  /**
   * 校稿結果存成提案，**文章一個字都還沒動**。沒有 `revision` 欄位是刻意的
   * （docs/specs/review-proposals.md）。`images` 那一趟是 null。
   */
  readonly review: ReviewProposal | null;
}

export interface PublishResult {
  readonly wordpressId: number;
  readonly status: string;
  readonly link: string;
  readonly created: boolean;
  /** 對不上既有分類項目的名稱。不自動建立，交給使用者處理（D-004）。 */
  readonly unknownTerms: string[];
  /** 落到 wp:html 逃生門的區塊數，大於 0 值得提醒使用者。 */
  readonly fallbackBlocks: number;
}

// --- WordPress ----------------------------------------------------------------

/** WordPress 的 term。名字叫 tag 的分類法也可能是階層式的。 */
export interface Term {
  readonly id: number;
  readonly name: string;
  readonly slug: string;
  readonly count?: number;
  readonly parent?: number;
}

/** `GET /api/wordpress` 列出的發布目標。設定檔沒有秘密，但只給 UI 需要的欄位。 */
export interface PublishTargetSummary extends JobTarget {
  readonly postType: string;
  readonly templateId: string;
}

// --- 請求 --------------------------------------------------------------------

export interface CreateJobRequest {
  readonly targetKey: string;
  readonly sourceText: string;
  readonly title?: string;
  /** 已經有結構化資料就直接給；沒給就由 sourceText 決定性地轉成段落。 */
  readonly templateData?: Record<string, unknown>;
}

export interface CreateRevisionRequest {
  readonly origin?: RevisionOrigin;
  /** 整份取代目前的 templateData；沒給就沿用上一版。 */
  readonly templateData?: Record<string, unknown>;
  readonly sourceText?: string;
  /** `null` 代表清除精選圖片；不給代表沿用。 */
  readonly featuredMediaId?: number | null;
  /** 稽核用的說明，也會寫進核准撤銷的理由。 */
  readonly reason?: string;
}

export interface AgentRunRequest {
  readonly provider: AgentProvider;
  /** 預設 `review`。 */
  readonly task?: AgentTask;
  readonly model?: string;
  /** 使用者在聊天框打的字。不受信任內容，會被明確標示邊界。 */
  readonly instruction?: string;
  readonly timeoutMs?: number;
}

/** 圖片走 base64 JSON 而不是 multipart，理由見 src/server/routes/jobs.ts。 */
export interface MediaUploadRequest {
  readonly filename: string;
  readonly mimeType: string;
  readonly dataBase64: string;
  readonly altText?: string;
  readonly caption?: string;
  readonly briefKey?: string;
}

export interface PlaceMediaRequest {
  readonly afterBlockIndex: number;
}

export interface ResolveReviewRequest {
  readonly itemIds: number[];
  readonly decision: 'apply' | 'skip';
}

/** 整份操作要指名是哪一份提案，理由見 ReviewProposal 的說明。 */
export interface ProposalRefRequest {
  readonly proposalId?: number;
}

export interface DiscardReviewRequest {
  readonly reason?: string;
  readonly proposalId?: number;
}

export interface ApproveRequest {
  readonly contentHash: string;
}

export interface RevokeApprovalRequest {
  readonly reason?: string;
}

export interface PublishRequest {
  readonly status: PublishStatus;
  /** requireSecondConfirmation 的 target 需要 UI 再確認一次。 */
  readonly confirm?: boolean;
}

export interface CreateTermRequest {
  readonly taxonomy: string;
  readonly name: string;
}

// --- 回應信封 ----------------------------------------------------------------
// 沒列在這裡的路由直接回傳本體（例如 GET /api/jobs/:uuid 回 JobDetail）。

export interface ListJobsResponse {
  readonly jobs: JobSummary[];
}
export interface JobResponse {
  readonly job: Job;
}
export interface RevisionResponse {
  readonly revision: Revision;
}
export interface RevisionsResponse {
  readonly revisions: Revision[];
}
export interface MarksResponse {
  readonly marks: ProofMark[];
}
export interface ReviewResponse {
  readonly review: ReviewProposal | null;
}
export interface MediaResponse {
  readonly media: MediaAsset;
}
export interface ApprovalResponse {
  readonly approval: Approval;
}
export interface PublishResponse {
  readonly result: PublishResult;
}
export interface TermsResponse {
  readonly terms: Term[];
}
export interface CancelledResponse {
  readonly cancelled: true;
}
export interface DiscardedResponse {
  readonly discarded: true;
}
export interface DismissedResponse {
  readonly dismissed: true;
}
export interface RemovedResponse {
  readonly removed: true;
}
export interface RevokedResponse {
  readonly revoked: true;
}
