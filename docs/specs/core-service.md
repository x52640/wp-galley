# CoreService

> 擁有範圍：CoreService 的對外方法。狀態與核准規則在 [state-machine.md](state-machine.md)，
> HTTP 對應在 [http-api.md](http-api.md)。
> 程式：`src/core/service.ts`、`src/core/repository.ts`。
> MCP 與 UI 共用同一個實例（規則見 [security.md](security.md)）。
> 方法的回傳型別定義在 `src/contract/api.ts`；`service.ts` 以舊名字（`ApprovalView` 等）轉出。

**啟動清理（P5-T020）**：建構時把 `agent_runs` 裡所有 `running` 的紀錄（校稿、配圖、生圖都算）結成
`failed`，原因「後端重啟，這次沒有完成」，每筆記一條 `agent_interrupted` 事件（actor `system`）。
進行中的執行只記在記憶體（`activeRuns`），子行程也隨舊行程結束，所以這些不可能再完成。只動那幾筆，
不刪資料、不動其他表。前提：**一個 DB 只有一個 CoreService 行程**；將來若 MCP 另起行程共用同一個 DB，
這條要改（否則後啟動的會把前一個正在跑的結掉）。

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
  /**
   * 取消這篇稿件正在跑的 Agent 動作（校稿或生圖）。記憶體裡沒有、DB 卻還是 running（上一個行程留下的）
   * 也把 DB 那筆結成 cancelled（P5-T020）。
   */
  cancelAgentRun(uuid: string): void;

  // --- 生圖（D-017，見 agent-tasks.md） ---
  imageGenerationStatus(): Promise<ImageGenerationStatus>;
  /** 生一張候選圖，只存本機。跟校稿共用「一次一個」；不是內容改動。 */
  generateBriefImage(uuid: string, briefId: number, input?: { timeoutMs?: number }): Promise<ImageCandidate>;
  imageCandidateFile(uuid: string, candidateId: number): { path: string; mimeType: string };
  /**
   * 在文章上「請 AI 配一張」（D-022，P5-T018）：先擋（稿件、Agent 在跑、Codex 沒裝或沒登入、contentHash、
   * 位置、note 長度），再建一條 origin='user' 的配圖需求，同步開始 generateBriefImage，不等它畫完。
   * `generation` 已由 service 接住，呼叫端不 await 也不會變成沒人接的 rejection。
   */
  requestImageAtPosition(
    uuid: string,
    input: { afterBlockIndex: number; contentHash: string; note?: string | null; timeoutMs?: number },
  ): Promise<{ brief: ImageBrief; generation: Promise<ImageCandidate> }>;
  /** 「用這張」：先同步搶下候選圖，再走 addMediaWithOutcome 上傳。 */
  /** `altText`：卡片上填的替代文字（P5-T018），沒給就用需求上的。使用者那條的檔名用文章 slug／標題（userImageFilename）。 */
  useImageCandidate(uuid: string, candidateId: number, input?: { altText?: string }): Promise<MediaUploadOutcome>;

  // --- 媒體 ---
  /** 帶的 briefKey 對上封面那條、且沒有別的封面時，上傳後自動 setFeaturedMedia（D-017）。 */
  addMedia(uuid: string, input: AddMediaInput): Promise<MediaAsset>;
  /**
   * 同上，另外回報自動設精選（見 agent-tasks.md「封面那一條」）與內文圖照錨點自動放進正文
   * （`autoPlace`，見「內文圖的錨點」，P5-T016）的結果。MediaUploadOutcome = { media, autoFeature, autoPlace }。
   */
  addMediaWithOutcome(uuid: string, input: AddMediaInput): Promise<MediaUploadOutcome>;
  /** 正文裡的舊圖換成新圖，規則見下方「正文裡的圖只動圖片節點」。 */
  /**
   * 上傳與換圖（P5-T022，審查 #3）：上傳等回來後、寫任何本機紀錄前，重新讀 job 確認還能改內容；
   * 不能改（發布了、取消了）就不寫、記一筆 `media_added`／`media_replaced` 的 failed 事件，
   * 丟錯說明「圖已經在 WordPress 媒體庫第 N 號，發布台不自動刪」。上傳或換圖進行中，同一篇的 `publish` 一律拒絕。
   */
  replaceMedia(uuid: string, assetId: number, input: AddMediaInput): Promise<MediaAsset>;
  /** 從正文拿掉那張圖（只動圖片節點，見下方）；不刪 WordPress 媒體庫的檔案。 */
  removeMedia(uuid: string, assetId: number): void;
  setFeaturedMedia(uuid: string, assetId: number | null): Revision;
  /**
   * 把圖片插進正文的第 n 個頂層區塊後面（-1＝最前面）。右欄下拉、「在這裡插圖」、自動放位置都走這裡。
   * 已經在正文裡就是搬家：先拿掉舊的（只動圖片節點，見下方），整塊被拿掉的區塊排在目標前面時位置往前挪。
   */
  placeMedia(uuid: string, assetId: number, afterBlockIndex: number): Revision;

  // --- 核准（只有 UI 能呼叫） ---
  approve(uuid: string, input: { contentHash: string; actor: 'ui' }): Approval;
  revokeApproval(uuid: string, reason: string): void;

  // --- 發布 ---
  /**
   * 正文轉 Gutenberg 區塊時用**模板的** `blockDefaults`（見 templates.md）；分類項目的查詢、
   * 寫入欄位與遠端快照一律用分類法的 REST 名稱（`taxonomyRestBaseOf(target)`）。
   */
  /** 前置檢查與 PUBLISHING 期間的核准再確認見 state-machine.md；更新既有文章送哪些欄位見 wordpress-site.md。 */
  /**
   * `input.authorId`（P5-T024）是發布選項，不影響核准；沒給用站台設定的預設作者，都沒有就不送。
   * 規則見 state-machine.md「發布選項」。
   */
  publish(uuid: string, input: PublishInput): Promise<PublishResult>;

  // --- 作者（P5-T024，D-024；站台規則見 wordpress-site.md「作者」） ---
  /** 站上可以當作者的人（只有 id、名字）、發布台的帳號、預設作者與要提醒的事。 */
  listAuthors(): Promise<AuthorsResponse>;
  /** 設預設作者前的檢查：不在可選名單丟 InvalidInputError。寫檔在路由（writeDefaultAuthor）。 */
  assertAuthorChoosable(authorId: number): Promise<void>;
}
```

### 正文裡的圖只動圖片節點（P5-T019，審查 #9）

移動（`placeMedia`）、移除（`removeMedia`）、換圖（`replaceMedia`、「換一張」）找正文裡的圖，
認的是 `<img>` 的 class 有 `wp-image-N` 這個 token（`src/core/html-blocks.ts` 的
`removeImageFromBody`／`replaceImageInBody`），**不是整個頂層區塊**。「圖在不在正文、在第幾塊」
（圖片清單的 `placed`、「換一張」找舊圖、發布前擋別站的圖）也用同一套規則（`containsImage`／
`findImageBlockIndex`）：正文文字裡寫著「wp-image-N」不算。

- 拿掉的是圖片節點；圖在 `<figure>` 裡就連同最近的那個 figure（圖說跟著走）。
  最近的 figure 是**圖庫**（class 有 `wp-block-gallery`，或裝著不只一張圖）時不拿 figure，只拿那張
  （圖庫裡每張各自包了 figure 就拿那張自己的 figure），其他張留著。
- 拿掉之後包它的東西空了（只剩空白、`<br>`）就一起拿掉，一層一層往上：行內包裝（如 `<a>`）、
  段落、群組、figure／圖庫、引用、清單與清單項目、標題等容器。表格、影片、嵌入、`<hr>` 等算內容，不拿。
  頂層區塊整個空了才整塊拿掉。
- 同一塊還有文字或別的節點（`<p>前文<img class="wp-image-N">後文</p>`，整份採用 Agent 稿或
  在文章上直接改合併段落時會出現）就留著剩下的內容。
- 換圖：整塊都是那張圖就原地換成新圖的 figure；那塊還有別的內容就留著它，新圖接在那塊後面。
  「換一張」實際一張都沒換到就丟錯（上傳結果回 `failed`），不建版本、不回報 `replaced`。
- 搬家時同一張圖出現在好幾塊：整塊拿掉的、排在目標位置（含）之前的才讓位置往前挪；留下文字的那塊不挪。

以前是整塊刪掉含圖的頂層區塊，前文與後文會一起消失。

`getComparison(uuid, against?)`：有未結案提案就跟提案比，沒有就跟上一版比；回傳 `Comparison`，
除了逐段的 `rows`，還有正文以外的 `fieldChanges`（`src/core/field-diff.ts`，D-019）。
跟上一版比不需要模板（發布目標被拿掉的舊稿件正文欄位當成 `body`）。

提案制（階段 5.5）之後 `runAgentReview` 不再直接產生 revision，見
[review-proposals.md](review-proposals.md)。
