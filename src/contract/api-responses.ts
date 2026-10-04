/** 前後端共用的 HTTP 契約：HTTP 回應信封。規則見 api.ts 開頭；前端與後端一律從 `api.ts` import。 */

import type { ProofMark } from './api-compare.js';
import type { Approval, Job, JobSummary, MediaAsset, PublishResult, Revision, Term } from './api-job.js';
import type { ImageBrief, ImageCandidate, ReviewProposal } from './api-review.js';

// --- 回應信封 ----------------------------------------------------------------
// 沒列在這裡的路由直接回傳本體（例如 GET /api/jobs/:uuid 回 JobDetail）。

export interface ListJobsResponse {
  readonly jobs: JobSummary[];
}
/** `POST /api/jobs`、`DELETE /api/jobs/:uuid`（取消）、`POST /api/jobs/:uuid/restore`（恢復，D-031）。 */
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

/**
 * 「用此段配圖」的位置選項（P5-T038 第二輪審查）。後端在 `contentHash` 那一版上算；送出時帶回 `spot` 與這個 `contentHash`。
 * `label` 照抄（「這段開頭」「第 N 段之後：『…』」「第 N 段（圖片）之後」「這段結尾」）。`basis` 是卡片上也會出現的依據。
 */
export interface SelectionSpotsResponse {
  readonly contentHash: string;
  readonly spots: readonly { readonly spot: number; readonly kind: 'start' | 'between' | 'end'; readonly label: string }[];
  readonly basis: string;
}
