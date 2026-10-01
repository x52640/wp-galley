# CoreService

> 擁有範圍：CoreService 的對外方法。狀態與核准規則在 [state-machine.md](state-machine.md)，
> HTTP 對應在 [http-api.md](http-api.md)。
> 程式：`src/core/service.ts`（門面）、`src/core/service/*.ts`（各領域）、`src/core/repository.ts`。
> MCP 與 UI 共用同一個實例（規則見 [security.md](security.md)）。
> 方法的回傳型別定義在 `src/contract/api.ts`；`service.ts` 以舊名字（`ApprovalView` 等）轉出，
> 輸入型別（`CreateJobInput` 等）在 `service/types.ts`，也由 `service.ts` 轉出。

## 哪個檔負責什麼（P5-T004）

`CoreService`（`src/core/service.ts`）只是**薄門面**：每個公開方法一行轉給對應的領域模組，外部一律 import 它。
共用狀態只有一份，放在 `service/context.ts` 的 `CoreContext`；門面建構時建一個，把各領域模組掛上去（`ctx.content`、`ctx.media`…），
模組之間透過 `this.ctx.<領域>.方法` 互相呼叫。下表的路徑都在 `src/core/service/` 底下。

| 檔 | 負責 | 公開方法（門面轉出） | 給別的模組用的 |
| --- | --- | --- | --- |
| `context.ts` | 共用狀態（repo、目前的站、`activeRuns`、`publishing`、`mediaUploads`、設定精靈旗標）、啟動清理、內部小工具（`requireJob`、`payloadOf`、`renderPayload`、`toMedia`、`trackWordPress`、`assertNoAppPassword`…） | — | 全部 |
| `types.ts` | 方法的輸入型別（`CreateJobInput`、`CreateRevisionInput`、`AddMediaInput`、`PublishInput`…）與 `CoreServiceOptions` | — | — |
| `setup.ts` | 設定精靈要問的事、換連線與發布目標 | `isPublishing`、`tryBeginReconfigure`、`endReconfigure`、`currentSiteUsage`、`openJobCountsByTarget`、`reconfigure` | — |
| `jobs.ts` | 建立與讀取稿件、取消與恢復、發布前的 blocker、稽核紀錄 | `createJob`、`getJob`、`listJobs`、`cancelJob`、`restoreJob`、`listEvents` | `getJob` |
| `content.ts` | 建新版本（**所有內容改動的入口**）、渲染、校樣、校對符號 | `createRevision`、`listRevisions`、`render`、`getPreviewDocument`、`getMarks` | `createRevision` |
| `agent.ts` | 校稿與一鍵配圖、建議英文網址、取消 Agent；system／user prompt | `runAgentReview`、`suggestSlugs`、`cancelAgentRun` | — |
| `review.ts` | 待處理清單：逐項處理、整份採用、丟棄、對照 | `getReview`、`resolveReviewItems`、`acceptWholeProposal`、`discardReview`、`getComparison` | `getReview`、`openProposal`、`closeProposalIfDone`、`reviewView`、`pendingReviewCount` |
| `briefs.ts` | 配圖需求：存 Agent 給的需求、卡片上改描述、不要了 | `dismissImageBrief`、`updateImageBrief` | `storeImageBriefs`、`imageBriefViews`、`requireOpenBrief`、`toCandidate` |
| `images.ts` | 用 Codex 生候選圖、用這張、在文章上請 AI 配一張 | `imageGenerationStatus`、`generateBriefImage`、`imageCandidateFile`、`useImageCandidate`、`requestImageAtPosition` | — |
| `media.ts` | 上傳、換圖、移除、放位置、精選圖片；上傳後自動放位置／設精選 | `addMedia`、`addMediaWithOutcome`、`replaceMedia`、`removeMedia`、`setFeaturedMedia`、`placeMedia` | `addMediaWithOutcome` |
| `approval.ts` | 核准、撤銷；**核准失效的唯一入口 `invalidateApproval`** | `approve`、`revokeApproval` | `invalidateApproval`、`assertApprovalUnchanged` |
| `publish.ts` | 發布：前置檢查、讀遠端比對、建立或更新文章、分類對名稱 | `publish` | `rejectPublish` |
| `authors.ts` | 作者清單、預設作者檢查、發布時送哪位 | `listAuthors`、`assertAuthorChoosable` | `resolvePublishAuthor` |

**內容修改造成的核准失效**只走 `approval.ts` 的 `invalidateApproval`（`content.ts` 的 `createRevision` 與 `media.ts` 的換圖呼叫它），
規則見 [state-machine.md](state-machine.md)「核准失效的實作點」。其他模組不准為了內容修改自己撤銷核准。

兩個刻意的例外直接撤銷核准、不經過 `invalidateApproval`（拆分前就如此，不是內容修改）：
`approval.ts` 的 `approve` 建新核准前撤掉舊的（理由「重新核准」），`jobs.ts` 的 `cancelJob` 取消稿件時撤掉（理由「工作項目已取消」）。

測試要攔模組之間的呼叫（例如媒體模組裡呼叫的 `setFeaturedMedia`）時，spy `coreInternals(core).media`
（`tests/helpers/core-fixture.ts`）；spy 門面攔不到，因為門面只是轉呼叫。

**啟動清理（P5-T020）**：建構時把 `agent_runs` 裡所有 `running` 的紀錄（校稿、配圖、生圖、建議網址都算）結成
`failed`，原因「後端重啟，這次沒有完成」，每筆記一條 `agent_interrupted` 事件（actor `system`）。
進行中的執行只記在記憶體（`activeRuns`），子行程也隨舊行程結束，所以這些不可能再完成。只動那幾筆，
不刪資料、不動其他表。前提：**一個 DB 只有一個 CoreService 行程**；將來若 MCP 另起行程共用同一個 DB，
這條要改（否則後啟動的會把前一個正在跑的結掉）。

## 方法的規則

下面是有特別規則的方法（完整清單見上表）；註解寫在 `service/` 各檔的方法上。

```ts
interface CoreService {
  // --- 建立與讀取（jobs.ts；openJobCountsByTarget 在 setup.ts）---
  /**
   * 本機站台設定檔不存在（targets.setupRequired）時一律拒絕，訊息就是那句「還沒有站台設定…」。
   * target 停用（`disabled: true`，D-032，P5-T032）時拒絕（InvalidInputError），講怎麼到精靈打開；
   * 已經用它的舊稿件不受影響（其他方法都不看 disabled）。「可用的是…」只列啟用的。
   * 原稿可以是空的（D-030，P5-T029）：正文存成一個空段落 `<p class="wp-block-paragraph"></p>`（`contract/empty-body.ts`）。
   * 模板 schema 的 `body.minLength` 與渲染的「清理後不能是空字串」都不放寬；擋「不能發布空文章」的是 approve 與發布前置檢查。
   */
  createJob(input: CreateJobInput): Job;
  /** 每個 target key 有幾篇進行中的稿件（不含 PUBLISHED、CANCELLED、SUPERSEDED）；設定精靈停用時提醒用（P5-T032）。 */
  openJobCountsByTarget(): Record<string, number>;
  getJob(uuid: string): JobDetail;
  listJobs(filter?: { state?: JobState[] }): JobSummary[];
  /** 撤銷核准、改成 CANCELLED；`job_cancelled` 事件記下取消前的狀態（`fromState`，D-031）。 */
  cancelJob(uuid: string): Job;
  /**
   * 恢復已取消的稿件（D-031，P5-T030）：回到取消前的狀態，APPROVED 回 RENDERED，記不到回 SOURCE；
   * 不建立、不恢復核准。只接受 CANCELLED，其他丟 InvalidTransitionError。只給本機 UI，MCP 不開。
   * 規則見 state-machine.md「恢復已取消的稿件」。
   */
  restoreJob(uuid: string): Job;

  // --- 內容（content.ts）---
  /** 建立新 revision。任何內容改動都走這裡，因此核准失效也只在這裡處理。 */
  /**
   * `editedBody`：直接在文章上改，只換正文，先經 normalizeEditedBody 整理（P5-T010）。
   * 整理規則跟前端存檔前同一份（`contract/rich-text.ts`，P5-T028），並帶模板的 allowedSchemes：不收的連結拆成純文字。
   * 帶基準＝上一版正文經 sanitize 與補段落後實際會發布的樣子（跟前端校樣同一份）：沒改的頂層區塊輸出基準的 HTML，只整理改過的。
   * 整理完是空字串（字全刪了）存成空段落（P5-T029）。
   * `editedTitle`（P5-T029）：在文章上直接改的標題，只換 `title`；可單獨給或跟 `editedBody` 一起給（同一個新版本）。
   * 規則 `contract/plain-title.ts`：不能換行、不能有控制字元、修掉前後空白後不能是空的、長度不超過**該篇模板 schema 的 `title.maxLength`**
   * （日記、長文 120，通用文章 200；不寫死），不合就 InvalidInputError、什麼都不寫。中間的空白原樣保留。
   * 不能跟 `templateData` 同時給。標題跟正文整理後都跟目前這一版一樣就不建新版本、不撤銷核准。
   * 標題跟目前的只差在空白（連續空格、NBSP、全形空格，`sameTitle`）算沒改，沿用目前的標題（P5-T031）。
   * `resolveItemId`（P5-T012）：從哪張卡片進去改的，存成新版本時那一項一起結案；只能跟 `editedBody` 或 `editedTitle`
   * 一起給（講標題的建議只改標題也算，P5-T031）。沒有實質改動（沒建新版本）就不結案。
   */
  createRevision(uuid: string, input: CreateRevisionInput): Revision;
  listRevisions(uuid: string): Revision[];
  /** 渲染最新 revision，產生預覽 HTML 與 content hash。 */
  render(uuid: string): RenderOutcome;

  // --- Agent（agent.ts）---
  /** 正文是空的（`isBlankBody`）就 InvalidInputError「正文是空的，先寫點內容再請 AI 看」，不跑、不花額度（P5-T029）。 */
  runAgentReview(uuid: string, input: AgentReviewInput): Promise<AgentRunResult>;
  /**
   * AI 建議英文網址（D-026，P5-T026）：讀目前這一版的標題＋內文開頭跑一趟 Agent，回最多三個合格的 slug。
   * 日記、標題與內文都空、有 WordPress 密碼（InvalidInputError）、已有 Agent 在跑、一個合格的都沒有（AgentError）都拒絕。
   * 不建提案、不改 templateData、不建版本、不動核准。規則見 agent-tasks.md「建議英文網址」。
   */
  suggestSlugs(
    uuid: string,
    input: { provider: AgentId; model?: string; timeoutMs?: number },
  ): Promise<SlugSuggestionResponse>;
  /**
   * 取消這篇稿件正在跑的 Agent 動作（校稿、建議網址或生圖）。記憶體裡沒有、DB 卻還是 running（上一個行程留下的）
   * 也把 DB 那筆結成 cancelled（P5-T020）。
   */
  cancelAgentRun(uuid: string): void;

  // --- 生圖（images.ts；updateImageBrief 在 briefs.ts。D-017，見 agent-tasks.md）---
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
  /**
   * 在卡片上改配圖需求（D-025，P5-T025）：Agent 那條送 `prompt`（非空、≤ 2000 字）、使用者那條送 `note`
   * （≤ 200 字，可以清空；prompt 用目前這一版重組）。有 WordPress 密碼、稿件不能改、需求已標成不要了、
   * Codex 正在畫這張（AgentError）都拒絕。不是內容改動；候選圖留著。規則見 agent-tasks.md「在卡片上改描述」。
   */
  updateImageBrief(
    uuid: string,
    briefId: number,
    input: { prompt?: string; note?: string | null },
  ): { brief: ImageBrief; notice: string | null };
  /** 「用這張」：先同步搶下候選圖，再走 addMediaWithOutcome 上傳。 */
  /** `altText`：卡片上填的替代文字（P5-T018），沒給就用需求上的。使用者那條的檔名用文章 slug／標題（userImageFilename）。 */
  useImageCandidate(uuid: string, candidateId: number, input?: { altText?: string }): Promise<MediaUploadOutcome>;

  // --- 媒體（media.ts）---
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

  // --- 核准（approval.ts；只有 UI 能呼叫）---
  approve(uuid: string, input: { contentHash: string; actor: 'ui' }): Approval;
  revokeApproval(uuid: string, reason: string): void;

  // --- 發布（publish.ts）---
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

  // --- 作者（authors.ts。P5-T024，D-024；站台規則見 wordpress-site.md「作者」）---
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
