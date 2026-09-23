# CoreService

> 擁有範圍：CoreService 的對外方法。狀態與核准規則在 [state-machine.md](state-machine.md)，
> HTTP 對應在 [http-api.md](http-api.md)。
> 程式：`src/core/service.ts`、`src/core/repository.ts`。
> MCP 與 UI 共用同一個實例（規則見 [security.md](security.md)）。
> 方法的回傳型別定義在 `src/contract/api.ts`；`service.ts` 以舊名字（`ApprovalView` 等）轉出。

下面是**節錄**，列出核心流程的方法。提案制與配圖需求另有 `getReview`、
`resolveReviewItems`、`acceptWholeProposal`、`discardReview`、`getComparison`、
`dismissImageBrief`，以及 `getPreviewDocument`、`getMarks`、`listEvents`；完整清單以
`src/core/service.ts` 為準，P5-T004 拆檔時補齊本檔。

```ts
interface CoreService {
  // --- 建立與讀取 ---
  /** 本機站台設定檔不存在（targets.setupRequired）時一律拒絕，訊息就是那句「還沒有站台設定…」。 */
  createJob(input: CreateJobInput): Job;
  getJob(uuid: string): JobDetail;
  listJobs(filter?: { state?: JobState[] }): JobSummary[];
  cancelJob(uuid: string): Job;

  // --- 內容 ---
  /** 建立新 revision。任何內容改動都走這裡，因此核准失效也只在這裡處理。 */
  /** `editedBody`：直接在文章上改，只換正文，先經 normalizeEditedBody 整理（P5-T010）。 */
  createRevision(uuid: string, input: CreateRevisionInput): Revision;
  listRevisions(uuid: string): Revision[];
  /** 渲染最新 revision，產生預覽 HTML 與 content hash。 */
  render(uuid: string): RenderOutcome;

  // --- Agent ---
  runAgentReview(uuid: string, input: AgentReviewInput): Promise<AgentRunResult>;
  /** 取消這篇稿件正在跑的 Agent 動作（校稿或生圖）。 */
  cancelAgentRun(uuid: string): void;

  // --- 生圖（D-017，見 agent-tasks.md） ---
  imageGenerationStatus(): Promise<ImageGenerationStatus>;
  /** 生一張候選圖，只存本機。跟校稿共用「一次一個」；不是內容改動。 */
  generateBriefImage(uuid: string, briefId: number, input?: { timeoutMs?: number }): Promise<ImageCandidate>;
  imageCandidateFile(uuid: string, candidateId: number): { path: string; mimeType: string };
  /** 「用這張」：先同步搶下候選圖，再走 addMediaWithOutcome 上傳。 */
  useImageCandidate(uuid: string, candidateId: number): Promise<MediaUploadOutcome>;

  // --- 媒體 ---
  /** 帶的 briefKey 對上封面那條、且沒有別的封面時，上傳後自動 setFeaturedMedia（D-017）。 */
  addMedia(uuid: string, input: AddMediaInput): Promise<MediaAsset>;
  /**
   * 同上，另外回報自動設精選（見 agent-tasks.md「封面那一條」）與內文圖照錨點自動放進正文
   * （`autoPlace`，見「內文圖的錨點」，P5-T016）的結果。MediaUploadOutcome = { media, autoFeature, autoPlace }。
   */
  addMediaWithOutcome(uuid: string, input: AddMediaInput): Promise<MediaUploadOutcome>;
  replaceMedia(uuid: string, assetId: number, input: AddMediaInput): Promise<MediaAsset>;
  removeMedia(uuid: string, assetId: number): void;
  setFeaturedMedia(uuid: string, assetId: number | null): Revision;
  /** 把圖片插進正文的第 n 個頂層區塊後面（-1＝最前面）。右欄下拉、「在這裡插圖」、自動放位置都走這裡。 */
  placeMedia(uuid: string, assetId: number, afterBlockIndex: number): Revision;

  // --- 核准（只有 UI 能呼叫） ---
  approve(uuid: string, input: { contentHash: string; actor: 'ui' }): Approval;
  revokeApproval(uuid: string, reason: string): void;

  // --- 發布 ---
  /**
   * 正文轉 Gutenberg 區塊時用**模板的** `blockDefaults`（見 templates.md）；分類項目的查詢、
   * 寫入欄位與遠端快照一律用分類法的 REST 名稱（`taxonomyRestBaseOf(target)`）。
   */
  publish(uuid: string, input: PublishInput): Promise<PublishResult>;
}
```

`getComparison(uuid, against?)`：有未結案提案就跟提案比，沒有就跟上一版比；回傳 `Comparison`，
除了逐段的 `rows`，還有正文以外的 `fieldChanges`（`src/core/field-diff.ts`，D-019）。
跟上一版比不需要模板（發布目標被拿掉的舊稿件正文欄位當成 `body`）。

提案制（階段 5.5）之後 `runAgentReview` 不再直接產生 revision，見
[review-proposals.md](review-proposals.md)。
