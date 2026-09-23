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
  createJob(input: CreateJobInput): Job;
  getJob(uuid: string): JobDetail;
  listJobs(filter?: { state?: JobState[] }): JobSummary[];
  cancelJob(uuid: string): Job;

  // --- 內容 ---
  /** 建立新 revision。任何內容改動都走這裡，因此核准失效也只在這裡處理。 */
  createRevision(uuid: string, input: CreateRevisionInput): Revision;
  listRevisions(uuid: string): Revision[];
  /** 渲染最新 revision，產生預覽 HTML 與 content hash。 */
  render(uuid: string): RenderOutcome;

  // --- Agent ---
  runAgentReview(uuid: string, input: AgentReviewInput): Promise<AgentRunResult>;
  cancelAgentRun(uuid: string): void;

  // --- 媒體 ---
  addMedia(uuid: string, input: AddMediaInput): Promise<MediaAsset>;
  replaceMedia(uuid: string, assetId: number, input: AddMediaInput): Promise<MediaAsset>;
  removeMedia(uuid: string, assetId: number): void;
  setFeaturedMedia(uuid: string, assetId: number | null): Revision;
  /** 把圖片插進正文的第 n 個頂層區塊後面。 */
  placeMedia(uuid: string, assetId: number, afterBlockIndex: number): Revision;

  // --- 核准（只有 UI 能呼叫） ---
  approve(uuid: string, input: { contentHash: string; actor: 'ui' }): Approval;
  revokeApproval(uuid: string, reason: string): void;

  // --- 發布 ---
  publish(uuid: string, input: PublishInput): Promise<PublishResult>;
}
```

提案制（階段 5.5）之後 `runAgentReview` 不再直接產生 revision，見
[review-proposals.md](review-proposals.md)。
