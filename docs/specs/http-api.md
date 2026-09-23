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
| `GET` | `/api/jobs/:uuid/review` | 待處理清單 | → `ReviewResponse` |
| `POST` | `/api/jobs/:uuid/review/resolve` | 逐項套用或略過 | `ResolveReviewRequest` → `ReviewResolveResult` |
| `POST` | `/api/jobs/:uuid/review/accept-all` | 採用整份稿 | `ProposalRefRequest` → `ReviewResolveResult` |
| `DELETE` | `/api/jobs/:uuid/review` | 丟棄提案 | `DiscardReviewRequest` → `DiscardedResponse` |
| `GET` | `/api/jobs/:uuid/compare` | 左右對照，`?against=proposal\|previous` | → `Comparison` |
| `DELETE` | `/api/jobs/:uuid/briefs/:id` | 配圖需求標成不要了（不刪列） | → `DismissedResponse` |
| `POST` | `/api/jobs/:uuid/media` | 上傳圖片（base64 JSON） | `MediaUploadRequest` → `MediaResponse`（201） |
| `PUT` | `/api/jobs/:uuid/media/:id` | 換圖 | `MediaUploadRequest` → `MediaResponse` |
| `DELETE` | `/api/jobs/:uuid/media/:id` | 移除 | → `RemovedResponse` |
| `POST` | `/api/jobs/:uuid/media/:id/place` | 插進正文 | `PlaceMediaRequest` → `RevisionResponse` |
| `POST` | `/api/jobs/:uuid/media/:id/featured` | 設為精選圖片 | → `RevisionResponse` |
| `DELETE` | `/api/jobs/:uuid/featured` | 取消精選圖片 | → `RevisionResponse` |
| `POST` | `/api/jobs/:uuid/approve` | 核准（actor 寫死 `ui`） | `ApproveRequest` → `ApprovalResponse`（201） |
| `DELETE` | `/api/jobs/:uuid/approve` | 撤銷核准 | `RevokeApprovalRequest` → `RevokedResponse` |
| `POST` | `/api/jobs/:uuid/publish` | 發布 | `PublishRequest` → `PublishResponse` |
| `GET` | `/api/wordpress` | 站台探查與發布目標 | → 探查結果＋`publishTargets: PublishTargetSummary[]` |
| `GET` | `/api/wordpress/terms` | 分類項目，`?taxonomy=` | → `TermsResponse` |
| `POST` | `/api/wordpress/terms` | 建立分類項目（target 須 `allowCreateTerms`） | `CreateTermRequest` → `Term` |

`/api/health`、`/api/agents`、`/api/templates` 只給診斷頁用，形狀尚未納入契約。

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
- 校對符號（`ProofMark`）是版面的簽名元素：改動不用紅綠色塊，用頁邊的符號標示；
  說明文字由 diff 產生，不是 Agent 寫的。
- 配圖需求與待處理清單的行為見 [agent-tasks.md](agent-tasks.md)、
  [review-proposals.md](review-proposals.md)。`blockIndex` 的語意見 review-proposals.md。
