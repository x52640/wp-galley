/** 前後端共用的 HTTP 契約：稿件、版本、媒體、核准、發布結果、作者、WordPress 分類。規則見 api.ts 開頭；前端與後端一律從 `api.ts` import。 */

import type { ProofMark } from './api-compare.js';
import type { AgentRunStatus, AgentRunTask, AgentTask, JobState, RevisionOrigin } from './api-enums.js';
import type { ImageBrief, ImageBriefDraft, Observation, ReviewChange, ReviewProposal } from './api-review.js';

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
  /**
   * 標題最多幾個字（schema 的 `title.maxLength`；null＝不限）。在文章上改標題、「標題與網址」抽屜照它擋（P5-T029 審查 #2）。
   * 後端 createRevision 從模板 schema 自己讀，不信這個值。
   */
  readonly titleMaxLength: number | null;
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
  /**
   * 使用者在設定精靈停用了這個類型（D-032，P5-T032）：新稿件選單、拖放／貼上建稿不出現，建稿被拒；
   * 已經用它的舊稿件照常。停用的**照樣列出來**，總覽靠它顯示舊稿件的類型名稱。
   */
  readonly disabled: boolean;
}
