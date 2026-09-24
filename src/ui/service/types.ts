/**
 * 前端認定的資料形狀。
 *
 * 會過網路的形狀一律來自 `src/contract/api.ts`，跟後端是**同一份**定義——以前這裡
 * 是照後端手抄的，抄漏了沒有人知道。這個檔只放前端才有的東西：Blob 形式的上傳
 * 輸入、`LoadedJob`，以及畫面認得的 `PublisherApi` 介面。
 *
 * 幾個容易踩到的實情：
 * - `target` 與 `template` 可能是 `null`（設定檔把發布目標拿掉了）。
 * - `MediaAsset.url` 是 **WordPress 的公開網址**，還沒上傳成功時是 `null`，
 *   不是本機縮圖。
 * - `JobSummary` 只有 `targetKey`，沒有顯示名稱，列表要自己對照發布目標。
 */

import type {
  AgentRunRequest,
  AuthorsResponse,
  Approval,
  AgentRunResult,
  Comparison,
  CreateJobRequest,
  CreateRevisionRequest,
  JobDetail,
  JobState,
  JobSummary,
  JobTarget,
  JobTemplate,
  AutoFeatureResult,
  AutoPlaceResult,
  ImageAtPositionRequest,
  ImageBrief,
  ImageCandidate,
  ImageGenerationStatus,
  MediaAsset,
  PublishRequest,
  PublishResult,
  PublishTargetSummary,
  RenderOutcome,
  Revision,
  ReviewResolveResult,
  SetupAgent,
  SetupConnectionRequest,
  SetupConnectionResult,
  SetupDestinationsRequest,
  SetupDestinationsResponse,
  SetupSaveResponse,
  SetupStatus,
  Term,
} from '../../contract/api.js';

export type {
  AgentProvider,
  AgentRun,
  AgentRunResult,
  AgentRunStatus,
  AgentRunTask,
  AgentTask,
  Approval,
  AuthorOption,
  AuthorsResponse,
  AutoFeatureResult,
  AutoPlaceResult,
  CompareRow,
  Comparison,
  DiffSegment,
  FieldChange,
  ImageBrief,
  ImageBriefDraft,
  ImageCandidate,
  ImageGenerationStatus,
  JobDetail,
  JobState,
  JobSummary,
  JobTarget,
  JobTemplate,
  MediaAsset,
  Observation,
  ProofGlyph,
  ProofMark,
  ProofMarkKind,
  PublishedRef,
  PublishResult,
  PublishStatus,
  PublishTargetSummary,
  RenderOutcome,
  Revision,
  RevisionOrigin,
  ReviewChange,
  ReviewItem,
  ReviewItemState,
  ReviewItemType,
  ReviewProposal,
  ReviewResolveResult,
  SegmentOp,
  SetupAgent,
  SetupCheck,
  SetupConnectionResult,
  SetupDestinationKey,
  SetupDestinationOption,
  SetupDestinationsResponse,
  SetupProblem,
  SetupProblemKind,
  SetupSaveResponse,
  SetupStatus,
  Term,
} from '../../contract/api.js';

// --- 請求 -------------------------------------------------------------------

export type CreateJobInput = CreateJobRequest;
export type AgentReviewInput = AgentRunRequest;
export type PublishInput = PublishRequest;

export type CreateRevisionInput = CreateRevisionRequest;

/** 前端拿到的是 Blob；轉成 base64（MediaUploadRequest）是 client.ts 的事。 */
export interface AddMediaInput {
  file: Blob;
  filename: string;
  mimeType: string;
  altText?: string;
  caption?: string;
  briefKey?: string;
}

/**
 * 上傳的結果：圖，加上封面有沒有自動設成精選（沒對上封面是 null），以及內文圖有沒有照錨點
 * 自動放進正文（沒對上內文圖是 null，P5-T016）。
 */
export interface MediaUploadResult {
  media: MediaAsset;
  autoFeature: AutoFeatureResult | null;
  autoPlace: AutoPlaceResult | null;
}

// --- 前端才有的衍生型別 --------------------------------------------------------

/** target 與 template 都在的 job。工作區在進去之前先確認過。 */
export type LoadedJob = JobDetail & { target: JobTarget; template: JobTemplate };

export function isLoaded(job: JobDetail): job is LoadedJob {
  return job.target !== null && job.template !== null;
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

  /** 能不能生圖（只有 Codex 能，D-017）。不能的話 `reason` 講為什麼。 */
  getImageGenerationStatus(): Promise<ImageGenerationStatus>;
  /**
   * 用 Codex 照這條配圖需求生一張候選圖。要等它畫完才回（約一分鐘）；跑的期間
   * `agentRun` 是 running（task `generate-image`），取消用 `cancelAgent`。
   * 候選圖**只在本機**，不上傳、不動內容。
   */
  generateBriefImage(uuid: string, briefId: number): Promise<ImageCandidate>;
  /**
   * 在文章上「請 AI 配一張」（P5-T018）：建一條使用者發起的配圖需求，同一趟開始用 Codex 生圖。
   * **不等畫完**就回來（回的是那條需求）；進度看 `agentRun`（task `generate-image`、briefId），
   * 生好的候選圖出現在那條需求上，之後照一般的「用這張／再生一張」。
   */
  requestImageAtPosition(uuid: string, input: ImageAtPositionRequest): Promise<ImageBrief>;
  /**
   * 「用這張」：上傳到 WordPress 媒體庫。封面那條會自動設成精選。`altText`：卡片上填的替代文字
   * （P5-T018），不給就用需求上的。
   */
  useImageCandidate(uuid: string, candidateId: number, altText?: string): Promise<MediaUploadResult>;

  /** 帶封面那條的 briefKey 時，後端會在沒有別的封面時自動設精選，結果在 `autoFeature`。 */
  addMedia(uuid: string, input: AddMediaInput): Promise<MediaUploadResult>;
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

  listTargets(): Promise<PublishTargetSummary[]>;

  /**
   * 站上可以當作者的人與預設作者（P5-T024）。只有 id 與顯示名稱。
   * 帳號只能用自己時 `canChooseOthers` 是 false，`notice` 講怎麼改。
   */
  listAuthors(): Promise<AuthorsResponse>;
  /** 「設為預設」：寫進這個站的站台設定檔，之後每篇不用再選。null＝清掉。 */
  setDefaultAuthor(authorId: number | null): Promise<AuthorsResponse>;

  // --- 首次設定精靈（P8-T002）---------------------------------------------
  /** 要不要跑精靈、目前設定了什麼。不含密碼。 */
  getSetupStatus(): Promise<SetupStatus>;
  /** 測試連線（只讀）。密碼只在這一次送出；通過才有 testId。 */
  testWordPressConnection(input: SetupConnectionRequest): Promise<SetupConnectionResult>;
  /** 存進 .env 並當場套用。只送 testId；測試結果帶 siteChange 時要帶 confirmSiteChange: true。 */
  saveWordPressConnection(testId: string, confirmSiteChange?: boolean): Promise<SetupSaveResponse>;
  /** 重新偵測三個 CLI，附安裝與登入指令。 */
  getSetupAgents(): Promise<SetupAgent[]>;
  getSetupDestinations(): Promise<SetupDestinationsResponse>;
  saveSetupDestinations(input: SetupDestinationsRequest): Promise<SetupSaveResponse>;
}
