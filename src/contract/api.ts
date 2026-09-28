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

/**
 * `agent_runs` 裡記的一趟是在做什麼：`AgentTask` 之外多兩種——`generate-image`
 * （用 Codex 訂閱生圖，D-017）與 `suggest-slug`（AI 建議英文網址，D-026）。
 * 兩者都不走 `POST /agent`，所以不放進 `AgentTask`。
 */
export type AgentRunTask = AgentTask | 'generate-image' | 'suggest-slug';

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
  /** 建議插入的位置描述，例如「第三段之後」。給人看的，不拿來定位。 */
  readonly placement?: string;
  /**
   * 錨點：這張圖要跟在後面的那一段裡的一小段**原文**（P5-T016）。後端拿它在目前這一版裡
   * 定位，不存段落編號。封面沒有錨點。
   */
  readonly anchor?: string;
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
  /** 使用者從這張卡片進去直接改文章、存檔時一起結案的（P5-T012）。畫面寫「自己改了」，不是「保留原文」。 */
  readonly resolvedByEdit: boolean;
  /**
   * 已經改好了（P5-T017）：原句在目前的內容裡找不到，但要改成的字已經在了。這時 `state` 是 `skipped`、
   * `resolvedAt` 是 null，畫面寫「已經改好了」。**每次讀取時照目前的內容算**，不存進資料庫：
   * 內容再被改回去（after 不見了），這一項就回到它原本的狀態。規則見 `isAlreadyDone`（review-apply.ts）。
   * 重判的對象是還沒處理的與按過「保留原文」的；已接受、「自己改了」不重判。
   */
  readonly alreadyDone: boolean;
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
  /** 還沒有下場的項目數：`pending` 加上 `unappliable`（已經改好了的不算）。 */
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
  /** 想套用，但文章裡已經是改好的樣子（P5-T017）。不建版本，清單上顯示「已經改好了」。 */
  readonly alreadyDone: number[];
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
  /**
   * 錨點：圖要跟在後面的那一段的原文片段（P5-T016）。上傳後後端用它自動放進正文。
   * 封面、舊的配圖需求是 null。
   */
  readonly anchor: string | null;
  /** 已經有圖對上這條需求了。 */
  readonly fulfilled: boolean;
  readonly dismissed: boolean;
  readonly createdAt: string;
  /**
   * 這條是精選圖片（封面）的需求。判斷規則在後端（templateData 的
   * `featuredImageBriefKey`、key 以 `featured`／`cover` 開頭、placement 寫「精選」「封面」）。
   * 對上這條的圖上傳之後會自動設成精選。
   */
  readonly isFeatured: boolean;
  /** 最新一張還沒用掉的生成候選圖；沒有就是 null。**還沒上傳到 WordPress。** */
  readonly candidate: ImageCandidate | null;
  /**
   * 誰發起的（P5-T018）：`agent`＝一鍵配圖／校稿給的建議；`user`＝使用者在文章上「在這裡插圖」→
   * 「請 AI 配一張」。`user` 那條的 key 以 `user-` 開頭、永遠不是封面，`prompt` 是系統組好的整份生圖指令。
   */
  readonly origin: 'agent' | 'user';
  /** 圖放在錨點那段之後（`after`）或之前（`before`，只有文章最前面那個位置會用到）。 */
  readonly anchorPosition: 'after' | 'before';
  /** 使用者那句「想要什麼樣的圖」（選填）；Agent 的建議是 null。 */
  readonly note: string | null;
  /**
   * 使用者在卡片上改過這條的畫面描述（D-027，P5-T027）。之後任何一趟 Agent 回同一個 key，描述都保留使用者的版本。
   * 只有 Agent 那條（`origin = 'agent'`）可能是 true；使用者那條改的是 `note`，永遠是 false。
   */
  readonly promptEdited: boolean;
}

/**
 * Codex 生出來、只存在本機的候選圖（D-017）。按「用這張」才會上傳到 WordPress
 * 媒體庫；不用它就一直留在本機。**不是內容改動，不會讓核准失效。**
 */
export interface ImageCandidate {
  readonly id: number;
  readonly briefId: number;
  /** 本機 API 的網址（`/api/jobs/:uuid/candidates/:id`），不是 WordPress 的網址。 */
  readonly url: string;
  readonly mimeType: string;
  readonly byteSize: number;
  readonly width: number | null;
  readonly height: number | null;
  readonly createdAt: string;
}

/** 現在能不能生圖。只有 Codex 能生圖；沒裝、沒登入就是 false，`reason` 講為什麼。 */
export interface ImageGenerationStatus {
  readonly available: boolean;
  /** 負責生圖的 Agent；一家都不支援時是 null。 */
  readonly provider: AgentProvider | null;
  readonly reason: string | null;
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
  /** 未結案的校稿提案還剩幾項沒處理；沒有提案就是 0。列表靠它說「還有 N 項建議」。 */
  readonly pendingReviewCount: number;
}

export interface JobTarget {
  readonly key: string;
  readonly displayName: string;
  readonly contentType: string;
  /** WordPress 裡的內容類型（read-think、diary）。發布面板用它講清楚「發到哪裡」。 */
  readonly postType: string;
  readonly taxonomy: string | null;
  readonly requireFeaturedImage: boolean;
  /** 設定檔有沒有允許從發布台建立新的分類項目（D-004：預設不允許）。 */
  readonly allowCreateTerms: boolean;
}

export interface JobTemplate {
  readonly id: string;
  readonly hash: string;
  readonly strictness: string;
  /**
   * 模板允許的正文標籤（manifest 的 allowedTags）。直接在文章上改的格式工具列靠它決定出現哪些按鈕，
   * 貼上也只保留這些（P5-T028）。後端 sanitize 仍用 manifest 原始規則再驗一次。
   */
  readonly allowedTags: readonly string[];
  /** 連結可用的 scheme（manifest 的 allowedSchemes）。連結輸入框只收這些。 */
  readonly allowedSchemes: readonly string[];
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
  /** 這一趟做的是什麼。畫面靠它決定要說「校稿」、「想配圖」還是「生圖」。 */
  readonly task: AgentRunTask;
  /** `generate-image` 那一趟在畫哪一條配圖需求；其他趟是 null。 */
  readonly briefId: number | null;
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
  /**
   * 目前這一版的正文是空的（P5-T029：可以先建稿再寫；`contract/empty-body.ts`）。
   * 空的時候 AI 校稿／配圖不給跑、不能核准與發布；畫面靠它停用按鈕並說明。
   */
  readonly bodyEmpty: boolean;
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
  /**
   * 這次實際送出的作者（P5-T024）。null＝沒送 author，WordPress 用發布台登入的帳號
   * （沒設預設作者、或帳號只能用自己）。
   */
  readonly author: AuthorOption | null;
}

// --- 作者（P5-T024，D-024）------------------------------------------------------

/** 站上一個可以當作者的人。只有 id 與顯示名稱，不帶 email、帳號名稱等個資。 */
export interface AuthorOption {
  readonly id: number;
  readonly name: string;
}

/** `GET /api/wordpress/authors`、`POST /api/setup/default-author` 的回應。 */
export interface AuthorsResponse {
  /** 可以選的人。`canChooseOthers` 是 false 時只有發布台自己的帳號。 */
  readonly authors: AuthorOption[];
  /** 發布台登入的帳號（沒送 author 時 WordPress 用它）。 */
  readonly currentUser: AuthorOption;
  /** 這個帳號能不能指定別人當作者（WordPress 的 edit_others_posts；Author 角色沒有）。 */
  readonly canChooseOthers: boolean;
  /** 站台設定檔的預設作者 id；沒設是 null。 */
  readonly defaultAuthorId: number | null;
  /**
   * 預設作者在可選名單裡時是那個人；沒設、或不在名單（換過站）是 null。
   * 帳號只能用自己時，預設是別人也是 null（發布時不會送）。
   */
  readonly defaultAuthor: AuthorOption | null;
  /** 要讓使用者知道的事（只能用自己當作者、預設作者不在這個站…）；沒有是 null。 */
  readonly notice: string | null;
  /**
   * 讀不到站上的作者清單（使用者端點被擋、限流、連不上）。這時 `authors` 只有發布台的帳號、不能選；
   * 有預設作者或指定作者的發布會在送出前被擋下（不會靜默變成發布台的帳號），`notice` 講原因。
   */
  readonly listUnavailable: boolean;
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
  readonly templateId: string;
}

// --- 請求 --------------------------------------------------------------------

export interface CreateJobRequest {
  readonly targetKey: string;
  /** 可以是空的（P5-T029）：正文存成一個空段落，建立後直接在文章上寫。 */
  readonly sourceText: string;
  readonly title?: string;
  /** 已經有結構化資料就直接給；沒給就由 sourceText 決定性地轉成段落。 */
  readonly templateData?: Record<string, unknown>;
}

export interface CreateRevisionRequest {
  readonly origin?: RevisionOrigin;
  /** 整份取代目前的 templateData；沒給就沿用上一版。 */
  readonly templateData?: Record<string, unknown>;
  /**
   * 直接在文章上改（P5-T010）：只換正文，其他欄位沿用上一版。後端先整理瀏覽器
   * 編輯器產生的雜訊再渲染。不能跟 `templateData` 同時給。
   */
  readonly editedBody?: string;
  /**
   * 從哪張建議卡片進去改的（P5-T012）。存成新版本時那一項一起標成已處理（`resolvedByEdit`）；
   * 沒有實質改動就不動它。只能跟 `editedBody` 一起用。
   */
  readonly resolveItemId?: number;
  /**
   * 在文章上直接改的標題（P5-T029）：只換 `title`，其他欄位沿用上一版；可以單獨給，也可以跟
   * `editedBody` 一起給（存成同一個新版本）。純文字、一行、不能是空的（`contract/plain-title.ts`）。
   * 不能跟 `templateData` 同時給。
   */
  readonly editedTitle?: string;
  readonly sourceText?: string;
  /** `null` 代表清除精選圖片；不給代表沿用。 */
  readonly featuredMediaId?: number | null;
  /** 稽核用的說明，也會寫進核准撤銷的理由。 */
  readonly reason?: string;
  /**
   * 這次編輯是根據哪一版算出來的（那一版的 `contentHash`，P5-T005）。
   *
   * `templateData` 是整份取代，兩個面板各自送出時，晚到的那一份會把先到的欄位蓋掉。
   * 帶上這個值，目前版本不是它就回 409 `CONTENT_CHANGED`，什麼都不寫。不給就不檢查。
   */
  readonly expectedContentHash?: string;
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

/**
 * AI 建議英文網址（D-026，P5-T026，`POST /api/jobs/:uuid/slug-suggestions`）。
 *
 * 只收「交給哪一家」：輸入一律是後端**目前這一版**的標題＋內文開頭，前端給不了別的內容。
 */
export interface SlugSuggestionRequest {
  readonly provider: AgentProvider;
  readonly model?: string;
  readonly timeoutMs?: number;
}

/**
 * 建議的網址。`slugs` 已經過後端篩選（`contract/slug.ts`：小寫英數與單個連字號、上限 60），
 * 最多三個、至少一個（一個都不合格時回 502，不會是空陣列）。`dropped` 是格式不合格被丟掉的個數。
 * **不會自動填進文章**：使用者點了才填進網址欄，照原本的「儲存」存。
 */
export interface SlugSuggestionResponse {
  readonly slugs: string[];
  readonly dropped: number;
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

/**
 * 在文章上「請 AI 配一張」（P5-T018，`POST /api/jobs/:uuid/briefs`）。
 *
 * 只收位置與使用者那句話；prompt 由後端用固定程式組（前後段落＋那句話＋固定約束），前端給不了。
 * `contentHash` 是畫面上那一版：位置是照它數的，後端的目前版本不是它就拒絕（409），不然會指到別段。
 */
export interface ImageAtPositionRequest {
  /** 插在第幾個頂層區塊之後；-1＝最前面。跟 `PlaceMediaRequest` 同一套索引。 */
  readonly afterBlockIndex: number;
  readonly contentHash: string;
  /** 想要什麼樣的圖，一句話，選填。上限 200 字：摺疊空白之後數 code point（`contract/user-note.ts`）。 */
  readonly note?: string;
}

/**
 * 在卡片上改配圖需求（D-025，P5-T025，`PATCH /api/jobs/:uuid/briefs/:id`）。**只能送其中一個**：
 * - `prompt`：Agent 建議的那條（`origin = 'agent'`，含封面）的畫面描述。去頭尾後不能是空的，
 *   上限 2000 字（code point，`contract/brief-prompt.ts`）。
 * - `note`：使用者發起的那條（`origin = 'user'`）的「想要：…」那句；空的＝沒有特別要求。上限 200 字
 *   （`contract/user-note.ts`）。整份生圖指令由後端用目前的內容重組，前端給不了。
 */
export interface UpdateImageBriefRequest {
  readonly prompt?: string;
  readonly note?: string;
}

/**
 * `PATCH /api/jobs/:uuid/briefs/:id`：更新後的那條需求。
 * `notice`：存了，但有一件事要讓使用者知道（使用者那條的錨點在目前的文章裡對不上，前後段落沿用當初的）；
 * 沒事是 null。
 */
export interface UpdateImageBriefResponse {
  readonly brief: ImageBrief;
  readonly notice: string | null;
}

/**
 * 「用這張」（`POST /api/jobs/:uuid/candidates/:id/use`）可以帶的東西。body 可以整個不給（舊前端）。
 * `altText`：卡片上填的替代文字（P5-T018，使用者在文章上請 AI 配的那條預設是空的），沒給就用需求上的。
 */
export interface UseCandidateRequest {
  readonly altText?: string;
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
  /**
   * 這一篇的作者（P5-T024）。跟 status 一樣是**發布選項**，不是核准的內容：改它不讓核准失效。
   * 不給就用站台設定的預設作者，都沒有就不送。後端驗證它在站上可當作者的名單裡。
   */
  readonly authorId?: number;
}

/** `POST /api/setup/default-author`：把這個站的預設作者寫進站台設定檔。null＝清掉。 */
export interface SetDefaultAuthorRequest {
  readonly authorId: number | null;
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
  /**
   * 上傳對上封面那條配圖需求時，自動設精選的結果（D-017）。沒對上封面就是 null；
   * 換圖（PUT）不給。
   */
  readonly autoFeature?: AutoFeatureResult | null;
  /**
   * 上傳對上內文圖的配圖需求時，照錨點自動放進正文的結果（P5-T016）。沒對上配圖需求、
   * 或對上的是封面就是 null；換圖（PUT）不給。
   */
  readonly autoPlace?: AutoPlaceResult | null;
}

/**
 * 內文圖上傳之後，有沒有照錨點自動放進正文（P5-T016）。
 *
 * - `placed`：放在 `afterBlockIndex` 那一段之後了（建了新版本，核准照規則失效）。
 * - `not-found`：錨點在目前這一版裡找不到（或這條需求根本沒有錨點）。沒有放。
 * - `ambiguous`：不只一段對得上，不猜。沒有放。
 * - `replaced`：「換一張」——這條需求之前的圖在正文裡，新圖接替它的位置（舊圖拿出正文，留在媒體庫）。
 * - `agent-running`：校稿或一鍵配圖正在跑，先不放（放了那一趟的結果會作廢）。
 * - `failed`：想放但失敗了，`message` 講原因；圖已經在媒體庫。
 */
export interface AutoPlaceResult {
  readonly outcome: 'placed' | 'replaced' | 'not-found' | 'ambiguous' | 'agent-running' | 'failed';
  readonly message: string;
  /** `placed`／`replaced` 時是放在第幾個頂層區塊之後（跟 `placeMedia` 同一套索引），其他是 null。 */
  readonly afterBlockIndex: number | null;
}

/**
 * 封面那條配圖需求的圖上傳之後，有沒有自動設成精選。
 *
 * - `set`：設好了（核准照規則失效）。
 * - `kept-existing`：已經有使用者選的別張封面，**不覆蓋**。
 * - `failed`：想設但失敗了，`message` 講原因；圖已經在媒體庫。
 * - `agent-running`：校稿或一鍵配圖正在跑，先不設（設精選會建新版本，那一趟的結果會作廢，P5-T016）。
 */
export interface AutoFeatureResult {
  readonly outcome: 'set' | 'kept-existing' | 'failed' | 'agent-running';
  readonly message: string;
}
export interface ImageCandidateResponse {
  readonly candidate: ImageCandidate;
}
/** `POST /api/jobs/:uuid/briefs`（202）：建好的那條需求；生圖在背後跑，進度看 `JobDetail.agentRun`。 */
export interface ImageBriefResponse {
  readonly brief: ImageBrief;
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

// --- 首次設定精靈（P8-T002，D-016）---------------------------------------------
//
// 規則在 docs/specs/security.md「設定精靈寫入的秘密」與 wordpress-site.md「設定精靈」。
// **任何回應都不含 Application Password**，連長度與遮蔽過的樣子都沒有。

/** `GET /api/setup`：要不要跑精靈、目前設定了什麼。 */
export interface SetupStatus {
  /** 沒有 WordPress 連線或沒有站台設定檔：畫面自動進精靈。 */
  readonly needsSetup: boolean;
  /** 已設定的連線（只有網址與帳號）。 */
  readonly wordpress: { readonly url: string; readonly username: string } | null;
  /** 本機站台設定檔（`config/publish-targets.json`）目前的內容。 */
  readonly siteConfig: { readonly exists: boolean; readonly targets: PublishTargetSummary[] };
  /** 這個後端能不能寫設定（測試或特殊啟動方式沒給檔案路徑時是 false）。 */
  readonly canWrite: boolean;
}

export interface SetupConnectionRequest {
  readonly url: string;
  readonly username: string;
  /** 只在這一個請求出現。有沒有空白都可以。 */
  readonly appPassword: string;
}

/**
 * 連線失敗的種類。畫面照它挑圖示與排版；文字（title／detail／next）一律由後端給，照抄。
 */
export type SetupProblemKind =
  | 'invalid-url'
  | 'not-https'
  | 'password-format'
  | 'unreachable'
  | 'redirect'
  | 'not-wordpress'
  | 'rest-blocked'
  | 'app-passwords-disabled'
  | 'auth-header-stripped'
  | 'wrong-username'
  | 'wrong-password'
  | 'no-permission'
  | 'types-missing'
  | 'server-error';

export interface SetupProblem {
  readonly kind: SetupProblemKind;
  /** 一句話：發生什麼事。 */
  readonly title: string;
  /** 為什麼會這樣（白話）。 */
  readonly detail: string;
  /** 下一步該做什麼。 */
  readonly next: string;
}

/** 檢查清單的一列：畫面照順序列出「過了哪幾關、卡在哪一關」。 */
export interface SetupCheck {
  readonly key: 'https' | 'reachable' | 'rest' | 'auth' | 'permission' | 'types';
  readonly label: string;
  readonly state: 'ok' | 'fail' | 'warn' | 'skipped';
}

export interface SetupConnectionResult {
  readonly ok: boolean;
  /** 整理過的網址（補 https、去掉結尾的 /wp-admin 等）；網址本身不合法時是 null。 */
  readonly url: string | null;
  readonly checks: SetupCheck[];
  readonly problem: SetupProblem | null;
  /** 不擋存檔的提醒，例如 administrator 權限過大、不能上傳圖片。 */
  readonly warnings: string[];
  readonly identity: { readonly name: string; readonly slug: string; readonly roles: string[] } | null;
  /** 測試通過才有；「儲存」只送這個，密碼不再過網路。10 分鐘內有效。 */
  readonly testId: string | null;
  /**
   * 測試的是**另一個站**，而目前這個站上已經發過文或傳過圖：存之前要讓使用者知道哪些不會跟過去。
   * 沒換站、或舊站上什麼都沒有時是 null。
   */
  readonly siteChange: SetupSiteChange | null;
}

export interface SetupSiteChange {
  readonly from: string;
  readonly to: string;
  /** 發布到舊站的稿件數。換過去之後不能再從發布台更新它們。 */
  readonly publishedJobs: number;
  /** 傳到舊站媒體庫的圖片數。新站用不到，要重新上傳。 */
  readonly uploadedMedia: number;
}

export interface SetupSaveWordPressRequest {
  readonly testId: string;
  /** 測試結果帶 `siteChange` 時必須是 true，否則 409。 */
  readonly confirmSiteChange?: boolean | undefined;
}

export interface SetupSaveResponse {
  readonly saved: true;
  /**
   * 需不需要重新啟動發布台才生效。目前一律 false：連線、發布目標與遮蔽器都當場換掉。
   * 留著欄位是讓畫面照後端講的做，不自己猜。
   */
  readonly restartRequired: boolean;
  /** 改寫站台設定檔前留的備份（相對專案根目錄）；沒有覆寫既有檔就是 null。 */
  readonly backupFile: string | null;
  readonly status: SetupStatus;
}

/** 精靈第二步的一列。安裝與登入指令由後端給，使用者自己到終端機執行。 */
export interface SetupAgent {
  readonly id: AgentProvider;
  readonly displayName: string;
  readonly installed: boolean;
  readonly version: string | null;
  readonly loginState: 'logged-in' | 'logged-out' | 'unknown';
  readonly available: boolean;
  readonly unavailableReason: string | null;
  /** 只有 Codex 能生圖（D-017）。 */
  readonly canGenerateImages: boolean;
  readonly installCommand: string;
  readonly loginCommand: string;
  /** 安裝說明的補充（例如要先裝什麼）；沒有是 null。 */
  readonly installNote: string | null;
}

export interface SetupAgentsResponse {
  readonly agents: SetupAgent[];
}

/** 精靈第三步能選的目的地。第一版只有核心的文章與頁面（D-016）。 */
export type SetupDestinationKey = 'post' | 'page';

export interface SetupDestinationOption {
  readonly key: SetupDestinationKey;
  readonly displayName: string;
  readonly postType: string;
  /** 站上有沒有開放這個類型的 REST，帳號能不能發。 */
  readonly available: boolean;
  /** 不能選的原因與下一步。 */
  readonly reason: string | null;
  readonly restBase: string | null;
  readonly taxonomy: string | null;
  /** 站上 `/wp/v2/taxonomies` 回報的 rest_base（核心 category 是 categories）。 */
  readonly taxonomyRestBase: string | null;
  /** 設定檔裡已經有同一個 key 的目標：要取代得明確勾選。 */
  readonly existing: PublishTargetSummary | null;
}

export interface SetupDestinationsResponse {
  readonly options: SetupDestinationOption[];
  /** 設定檔裡現有的全部目標（例如作者站台的長文與日記）。精靈不會刪它們。 */
  readonly existing: PublishTargetSummary[];
}

export interface SetupDestinationsRequest {
  readonly include: SetupDestinationKey[];
  /** 已經存在、要被取代的 key。沒列在這裡又已經存在的，整個請求拒絕。 */
  readonly replace: SetupDestinationKey[];
}
