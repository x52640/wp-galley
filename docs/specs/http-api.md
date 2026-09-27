# HTTP API

> 擁有範圍：`/api` 下的路由清單與各路由的語意。
> **請求與回應的形狀不寫在這裡**：唯一定義是 `src/contract/api.ts`（D-015），前後端
> import 同一份，對不上就編譯失敗。本檔只說「哪條路由、做什麼、回哪個型別」。
> 程式：`src/server/routes/`、`src/ui/service/client.ts`。

## 通則

- 全部在 `/api` 底下。錯誤一律 `{ error: { code, message, details?, requestId } }`。
- 請求 body 由路由裡的 zod schema 驗證；`src/server/routes/jobs.ts` 的
  `REQUEST_CONTRACT_CHECK` 在編譯期確認 schema 與契約的欄位一模一樣——zod 會默默丟掉
  不認得的欄位，前端多送的欄位不會報錯，只會「以為有效」。
- 只有「做完沒有資料可回」的路由回 `{ <動作>: true }`，其餘都回資料。
- **跨站一律 403**（P5-T023）：`/api` 下任何方法（GET、HEAD 也算），瀏覽器帶 `Sec-Fetch-Site: cross-site`
  或 `same-site` 就回 403 `CROSS_ORIGIN_BLOCKED`；`same-origin`、`none`、沒帶的照舊。規則見
  [security.md](security.md)「本機守門與秘密」。
- **所有回應送出前過遮蔽器**（P5-T023）：JSON 與校樣 HTML 裡若出現已知的 WordPress 密碼，換成 `[REDACTED]`；
  圖檔原樣。
- **內容裡有 WordPress 應用程式密碼就拒絕**（P5-T023，D-023）：建立 job、建 revision、上傳／換圖／用這張的
  替代文字與說明、派校稿、請 AI 配一張、生圖、核准，回 400 `INVALID_INPUT`「內容裡有你的 WordPress 應用程式密碼，
  請刪掉再存」，什麼都不寫、不派工、不上傳；發布回 `PUBLISH_BLOCKED`（同一句），一個請求都不送。
- `GET /api/agents/:id/models`：30 秒快取（跟 `GET /api/agents` 一樣），同時進來的請求共用同一趟；
  `POST /api/setup/agents` 會清掉。

## 路由

| 方法 | 路徑 | 用途 | 請求 → 回應（契約型別） |
| --- | --- | --- | --- |
| `GET` | `/api/jobs` | 列出 job，`?state=A,B` 篩選 | → `ListJobsResponse` |
| `POST` | `/api/jobs` | 建立 job（貼原稿＋選 target） | `CreateJobRequest` → `JobResponse`（201） |
| `GET` | `/api/jobs/:uuid` | 工作區需要的一切 | → `JobDetail` |
| `DELETE` | `/api/jobs/:uuid` | 取消 | → `JobResponse` |
| `GET` | `/api/jobs/:uuid/revisions` | 版本列表 | → `RevisionsResponse` |
| `POST` | `/api/jobs/:uuid/revisions` | 手動建立 revision | `CreateRevisionRequest` → `RevisionResponse`（201） |
| `POST` | `/api/jobs/:uuid/render` | 重新渲染 | → `RenderOutcome` |
| `GET` | `/api/jobs/:uuid/preview` | 校樣 HTML（`text/html`，`ETag` 是 content hash） | → HTML |
| `GET` | `/api/jobs/:uuid/diff` | 相對上一版的校對符號，`?revision=n` | → `MarksResponse` |
| `POST` | `/api/jobs/:uuid/agent` | 派工給 Agent（`task: review \| images`） | `AgentRunRequest` → `AgentRunResult` |
| `DELETE` | `/api/jobs/:uuid/agent` | 取消執行中的 Agent | → `CancelledResponse` |
| `POST` | `/api/jobs/:uuid/slug-suggestions` | AI 建議英文網址（D-026，等它跑完才回；不動文章） | `SlugSuggestionRequest` → `SlugSuggestionResponse` |
| `GET` | `/api/jobs/:uuid/review` | 待處理清單 | → `ReviewResponse` |
| `POST` | `/api/jobs/:uuid/review/resolve` | 逐項套用或略過 | `ResolveReviewRequest` → `ReviewResolveResult` |
| `POST` | `/api/jobs/:uuid/review/accept-all` | 採用整份稿 | `ProposalRefRequest` → `ReviewResolveResult` |
| `DELETE` | `/api/jobs/:uuid/review` | 丟棄提案 | `DiscardReviewRequest` → `DiscardedResponse` |
| `GET` | `/api/jobs/:uuid/compare` | 對照（逐段差異＋正文以外的欄位差異），`?against=proposal\|previous` | → `Comparison` |
| `POST` | `/api/jobs/:uuid/briefs` | 在文章上「請 AI 配一張」：建使用者發起的配圖需求並開始生圖（**不等畫完**） | `ImageAtPositionRequest` → `ImageBriefResponse`（202） |
| `PATCH` | `/api/jobs/:uuid/briefs/:id` | 在卡片上改配圖需求：Agent 那條改 `prompt`、使用者那條改 `note`（D-025） | `UpdateImageBriefRequest` → `UpdateImageBriefResponse` |
| `DELETE` | `/api/jobs/:uuid/briefs/:id` | 配圖需求標成不要了（不刪列） | → `DismissedResponse` |
| `POST` | `/api/jobs/:uuid/briefs/:id/generate` | 用 Codex 照這條需求生一張候選圖（等它畫完才回） | → `ImageCandidateResponse` |
| `GET` | `/api/jobs/:uuid/candidates/:id` | 候選圖本體（`image/*`，`no-store`），只在本機 | → 圖檔 |
| `POST` | `/api/jobs/:uuid/candidates/:id/use` | 「用這張」：上傳到 WordPress 媒體庫 | `UseCandidateRequest`（可省略）→ `MediaResponse`（201，含 `autoFeature`、`autoPlace`） |
| `POST` | `/api/jobs/:uuid/media` | 上傳圖片（base64 JSON） | `MediaUploadRequest` → `MediaResponse`（201，含 `autoFeature`、`autoPlace`） |
| `PUT` | `/api/jobs/:uuid/media/:id` | 換圖 | `MediaUploadRequest` → `MediaResponse` |
| `DELETE` | `/api/jobs/:uuid/media/:id` | 移除 | → `RemovedResponse` |
| `POST` | `/api/jobs/:uuid/media/:id/place` | 插進正文 | `PlaceMediaRequest` → `RevisionResponse` |
| `POST` | `/api/jobs/:uuid/media/:id/featured` | 設為精選圖片 | → `RevisionResponse` |
| `DELETE` | `/api/jobs/:uuid/featured` | 取消精選圖片 | → `RevisionResponse` |
| `POST` | `/api/jobs/:uuid/approve` | 核准（actor 寫死 `ui`） | `ApproveRequest` → `ApprovalResponse`（201） |
| `DELETE` | `/api/jobs/:uuid/approve` | 撤銷核准 | `RevokeApprovalRequest` → `RevokedResponse` |
| `POST` | `/api/jobs/:uuid/publish` | 發布 | `PublishRequest` → `PublishResponse` |
| `GET` | `/api/wordpress` | 站台探查與發布目標；檢查的內容類型＝設定檔裡 target 的 `postType`（沒有站台設定時 `publishTargets` 是空陣列） | → 探查結果＋`publishTargets: PublishTargetSummary[]` |
| `GET` | `/api/wordpress/terms` | 分類項目，`?taxonomy=` 帶分類法 **slug**（跟 `taxonomy` 欄位一樣）；後端換成 REST 名稱去查（`category` → `/wp/v2/categories`） | → `TermsResponse` |
| `POST` | `/api/wordpress/terms` | 建立分類項目（target 須 `allowCreateTerms`） | `CreateTermRequest` → `Term` |
| `GET` | `/api/wordpress/authors` | 站上可以當作者的人、發布台的帳號、預設作者（P5-T024） | → `AuthorsResponse` |
| `POST` | `/api/setup/default-author` | 設這個站的預設作者（寫站台設定檔，當場生效）；`null` 清掉 | `SetDefaultAuthorRequest` → `AuthorsResponse` |
| `GET` | `/api/image-generation` | 能不能生圖（只有 Codex 能） | → `ImageGenerationStatus` |

| `GET` | `/api/setup` | 設定精靈：要不要跑、目前設定了什麼（不含密碼） | → `SetupStatus` |
| `POST` | `/api/setup/wordpress/test` | 測試連線（只讀）；通過回 `testId` | `SetupConnectionRequest` → `SetupConnectionResult` |
| `POST` | `/api/setup/wordpress` | 把通過測試的那組存進 `.env` 並當場套用 | `SetupSaveWordPressRequest` → `SetupSaveResponse` |
| `POST` | `/api/setup/agents` | 重新偵測三個 CLI（會啟動子行程），附安裝／登入指令；body `{}` | → `SetupAgentsResponse` |
| `POST` | `/api/setup/destinations/check` | 文章／頁面能不能選（會打真的站）、設定檔裡已有什麼；body `{}` | → `SetupDestinationsResponse` |
| `POST` | `/api/setup/destinations` | 寫站台設定檔並當場套用 | `SetupDestinationsRequest` → `SetupSaveResponse` |

`/api/health`、`/api/agents`、`/api/templates` 只給診斷頁用，形狀尚未納入契約。
`GET /api/agents` 只回快取（30 秒內不重跑偵測）；原本的 `?refresh=1` 拿掉了（P8-T002：會啟動 CLI 的讀取
改走 `POST /api/setup/agents`）。

## 語意備註

- `review/accept-all` 與 `DELETE /review` 要帶 `proposalId`：這兩個是整份操作，只認
  「目前那一份」的話，確認對話框開著的時候如果又跑了一次校稿，按下去就會作用在使用者
  沒看過的那一份上。逐項處理不需要——`itemIds` 本身就只屬於某一份提案。
- `AgentRunResult.imageBriefs` 是 Agent 交回來的原樣（`ImageBriefDraft`，沒有 id）；
  存進去之後的樣子在 `JobDetail.imageBriefs`（`ImageBrief`）。
- `POST /revisions` 的 `editedBody` 與 `templateData` 互斥：`editedBody` 是「直接在文章上改」送回來的正文，
  只換正文、其他欄位沿用上一版；後端先整理瀏覽器編輯器的雜訊（`b`→`strong`、拆 `span` 等，
  `src/core/html-blocks.ts` 的 `normalizeEditedBody`），再照常走 schema、sanitize、結構驗證。
  它不是信任來源。沒改內容時前端不送；整理後跟目前這一版相同（例如只多按一個 Enter）時後端不建新版本、
  不撤銷核准，回傳目前那一版。
  `resolveItemId`（只能配 `editedBody`）：從哪張建議卡片進去改的，存成新版本時那一項標成 `skipped` 並記下
  `revision_id`，`ReviewItem.resolvedByEdit` 因此為真（P5-T012）。項目不屬於目前提案就整個拒絕。
  `expectedContentHash`（選填，64 位十六進位，格式不對 400）：這次編輯是根據哪一版算出來的。目前 revision 的
  `content_hash` 不是它就回 409 `CONTENT_CHANGED`，不建版本、不撤銷核准、不寫事件；訊息請使用者重新讀取再改。
  不給就不檢查（照舊）。前端送整份 `templateData` 或 `editedBody` 時都帶它，免得晚到的一份把先到的修改蓋掉
  （P5-T005）。比對與寫入在同一段同步程式裡，中間不會被別的請求插隊。
- `ReviewItem.alreadyDone`（P5-T017）：原句找不到、要改成的字已經在文章裡，讀取時算出來的，此時 `state` 回
  `skipped`；`review/resolve` 的回應多 `alreadyDone`（這次按接受時碰到的這種項目，不建版本）。
  規則見 [review-proposals.md](review-proposals.md)「已經改好了」。都是新增欄位。
- 校對符號（`ProofMark`）是版面的簽名元素：改動不用紅綠色塊，用頁邊的符號標示；
  說明文字由 diff 產生，不是 Agent 寫的。
- 生圖（D-017）：`generate` 跑的期間 `JobDetail.agentRun` 是 running（`task: 'generate-image'`、
  `briefId`），取消走 `DELETE /agent`；沒有能用的 Codex 回 503。候選圖不是內容改動，不撤銷核准。
  候選圖的檔案路徑只由資料庫決定，路由只收編號。`use` 與 `POST /media` 對上封面那條時回
  `autoFeature`（`set`／`kept-existing`／`failed`，沒對上是 null）：已經有使用者選的封面就不覆蓋。
  細節見 [agent-tasks.md](agent-tasks.md)「用 Codex 生圖」。
- 內文圖自動放位置（P5-T016）：`ImageBrief.anchor`（錨點原文，封面是 null）；`use` 與 `POST /media` 對上內文圖
  那條時回 `autoPlace`（`placed`／`replaced`＋`afterBlockIndex`、`not-found`、`ambiguous`、`agent-running`、`failed`，
  沒對上或是封面是 null）。`placed` 時回應裡的 `media` 已經是放好之後的樣子（`placed`、`placedAfterBlockIndex`）。
  `autoFeature` 另多一個 `agent-running`（校稿或一鍵配圖正在跑時先不設精選）。
  規則見 [agent-tasks.md](agent-tasks.md)「內文圖的錨點」。都是新增欄位，舊前端不受影響。
- `compare`（D-019）：`rows` 是正文逐段差異，每列的 `segments` 是單欄畫面用的完整序列；
  `fieldChanges` 是正文以外的改動（標題、網址片段、分類／標籤等 templateData 欄位，跟上一版比時另有精選圖片），
  名稱與顯示值由後端決定，畫面照抄。跟提案比時不比精選圖片（提案不動它）。畫面見
  [review-proposals.md](review-proposals.md)「對照畫面長什麼樣」。
- 配圖需求與待處理清單的行為見 [agent-tasks.md](agent-tasks.md)、
  [review-proposals.md](review-proposals.md)。`blockIndex` 的語意見 review-proposals.md。
- 在文章上請 AI 配一張（D-022，P5-T018）：`POST /briefs` 只收位置（`afterBlockIndex`，跟 `place` 同一套索引）、
  畫面上那一版的 `contentHash` 與選填的 `note`（上限 200 字，摺疊空白後數 code point，跟畫面計數同一套）；body 是 `.strict()`，多送欄位（例如 `prompt`）回 400——
  prompt 只能由後端組。建好就回 202，生圖在背後跑，進度看 `JobDetail.agentRun`（`generate-image`、`briefId`），
  取消走 `DELETE /agent`。擋下來時不建需求：沒有能用的 Codex（沒裝或沒登入）503、另一個 Agent 動作在跑 502
  （跟 `generate` 一樣是 `AGENT_ERROR`）、`contentHash` 不是目前這一版 409、位置超出範圍 400。
  `candidates/:id/use` 可以帶 `{ altText }`（`.strict()`，上限 300）：卡片上填的替代文字，沒帶就用需求上的。
  `ImageBrief` 多三個欄位：`origin`（`agent`／`user`）、`anchorPosition`（`after`／`before`）、`note`。
  規則見 [agent-tasks.md](agent-tasks.md)「在文章上直接請 AI 配一張」。都是新增的，舊前端不受影響。
- 在卡片上改配圖需求（D-025，P5-T025）：`PATCH /briefs/:id` 的 body 是 `.strict()`，`prompt`／`note` **只能送一個**
  （都送、都不送、多送欄位例如 `aspectRatio` 都是 400）；長度跟畫面計數同一套（`prompt` 去頭尾後數 code point、上限 2000，
  `contract/brief-prompt.ts`；`note` 同 `POST /briefs`）。哪一種需求該送哪一個由 CoreService 判斷（送錯 400）。
  回 200 `{ brief, notice }`：`notice` 不是 null 時畫面要照講（使用者那條的前後段落沿用當初的）。
  需求已標成不要了 400、沒有這篇 404、有 WordPress 密碼 400、Codex 正在畫這張 502（`AGENT_ERROR`，跟「另一個 Agent 動作在跑」
  同一類）。走跟其他改東西的路由同一套守門（跨站 403）。規則見 [agent-tasks.md](agent-tasks.md)「在卡片上改描述」。
- 建議英文網址（D-026，P5-T026）：`POST /slug-suggestions` 的 body 是 `.strict()`，只收 `provider`（＋選填 `model`、`timeoutMs`）；
  多送欄位（例如 `title`）400——輸入一律是後端目前這一版的標題與內文開頭。回 200 `{ slugs, dropped }`：`slugs` 已篩過、
  1 到 3 個；`dropped` 是格式不合格被丟掉的個數。跑的期間 `JobDetail.agentRun` 是 running（`task: 'suggest-slug'`），
  取消走 `DELETE /agent`。日記 400、有 WordPress 密碼 400、另一個 Agent 動作在跑 502、一個合格的都沒有 502（`AGENT_ERROR`，
  訊息「AI 沒給出能用的網址…」）、Agent 不能用 503。**不改 templateData、不建版本、核准不失效**。
  `AgentRunTask` 多一個 `suggest-slug`（新增的值，舊前端只是講不出這一趟在做什麼）。規則見 [agent-tasks.md](agent-tasks.md)「建議英文網址」。
- 作者（P5-T024，D-024）：`PublishRequest.authorId`（選填正整數）是發布選項，不影響核准；不在站上可當作者的名單
  回 409 `PUBLISH_BLOCKED`，一個寫入都不送。`PublishResult.author` 是實際送出的作者（沒送是 null）。
  `GET /api/wordpress/authors` 只回 `id`、`name`；帳號只能用自己時 `authors` 只有自己、`canChooseOthers: false`、`notice` 講怎麼改。
  讀不到站上的作者清單時仍回 200，`listUnavailable: true`、`notice` 講原因與「有預設作者的話發布會被擋」；這時
  `POST /api/setup/default-author` 回 400。
  `POST /api/setup/default-author` 跟設定精靈的寫入路由同一套守門（JSON＋同源，不是 JSON 回 415；沒給檔案路徑 503；
  發布或上傳在跑 409）；id 不在名單 400、檔案不動。規則見 [state-machine.md](state-machine.md)「發布選項」、
  [wordpress-site.md](wordpress-site.md)「作者」。都是新增的。
- 設定精靈（P8-T002）：規則在 [security.md](security.md)「設定精靈寫入的秘密」與
  [wordpress-site.md](wordpress-site.md)「設定精靈」。
  - **任何回應都不含密碼**。密碼只出現在 `wordpress/test` 的請求裡；`wordpress` 只收 `testId`
    （10 分鐘、只留最新一組、用過就失效、重啟就沒了），對不上回 409 請使用者重測。
  - 連線失敗不是 HTTP 錯誤：`wordpress/test` 一律 200，`ok: false` 加 `problem`（`kind`／`title`／`detail`／`next`，
    文字由後端給，畫面照抄）與逐關的 `checks`。
  - 所有 `POST /api/setup/*` 要 `Content-Type: application/json`（否則 415）。全域守門對所有修改請求：
    `Sec-Fetch-Site` 有的話只能是 `same-origin`／`none`、`Origin` 不能是 `null`、有 Origin 時要跟 Host
    同源（否則 403 `CROSS_ORIGIN_BLOCKED`）；`/api` 的 GET 也擋 `cross-site`／`same-site`（P5-T023）。兩個有副作用的讀取（agents、destinations/check）也是 POST，
    吃同一套。
  - 換站：`wordpress/test` 通過、測的是另一個站、而目前的站上發過文或傳過圖時，回應帶 `siteChange`
    （from／to／publishedJobs／uploadedMedia）；這時 `POST /api/setup/wordpress` 要帶 `confirmSiteChange: true`，
    否則 409、`.env` 不動。
  - 後端沒拿到檔案路徑（`buildApp` 沒給 `setupFiles`）時兩個寫入路由回 503；`SetupStatus.canWrite` 是 false。
  - `destinations`：`include` 至少一個；已存在的 key 要列在 `replace` 才取代，否則 409 且檔案不動；
    選了站上沒有或帳號不能發的類型回 400。覆寫既有檔時 `backupFile` 是備份路徑。
  - 有發布或上傳正在進行（或另一個儲存還沒完成）時兩個寫入路由回 409；儲存期間發布、上傳、換圖、放圖、
    設封面回 503「設定精靈正在儲存…」。沒連上 WordPress 時 `destinations/check` 回 503。
