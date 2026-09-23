# HTTP API

> 擁有範圍：`/api` 下所有路由、請求與回應形狀。
> ⚠️ 下方 `JobDetail` 是階段 5 當時的形狀，**已過時**（缺 `review`、`imageBriefs`、
> `agentRun.task` 等）。P5-T002 會以 `src/contract/` 取代這一節，在那之前以程式為準。
> 程式：`src/server/routes/`；前端鏡像型別 `src/ui/service/types.ts`（目前是手抄，
> 見 CURRENT_TASK 的已知殘餘）。

全部在 `/api` 底下，回應格式沿用既有的 `{ error: { code, message, details?, requestId } }`。

| 方法 | 路徑 | 用途 |
| --- | --- | --- |
| `GET` | `/api/jobs` | 列出 job，可用 `?state=` 篩選 |
| `POST` | `/api/jobs` | 建立 job（貼原稿 + 選 target） |
| `GET` | `/api/jobs/:uuid` | job 詳情，含最新 revision、預覽、媒體、核准狀態 |
| `DELETE` | `/api/jobs/:uuid` | 取消 |
| `POST` | `/api/jobs/:uuid/revisions` | 手動建立 revision（直接編輯欄位） |
| `GET` | `/api/jobs/:uuid/revisions` | 版本列表 |
| `POST` | `/api/jobs/:uuid/render` | 重新渲染 |
| `GET` | `/api/jobs/:uuid/preview` | 預覽 HTML（`text/html`，給 iframe 用） |
| `GET` | `/api/jobs/:uuid/diff` | 兩個 revision 的差異，產生下方的 ProofMark |
| `POST` | `/api/jobs/:uuid/agent` | 派工給 Agent（校稿或提修） |
| `DELETE` | `/api/jobs/:uuid/agent` | 取消執行中的 Agent |
| `POST` | `/api/jobs/:uuid/media` | 上傳圖片 |
| `PUT` | `/api/jobs/:uuid/media/:id` | 換圖 |
| `DELETE` | `/api/jobs/:uuid/media/:id` | 移除 |
| `POST` | `/api/jobs/:uuid/media/:id/place` | 指定插入位置 |
| `POST` | `/api/jobs/:uuid/approve` | 核准（帶 contentHash） |
| `DELETE` | `/api/jobs/:uuid/approve` | 撤銷核准 |
| `POST` | `/api/jobs/:uuid/publish` | 發布（`{ status: 'draft' \| 'publish' }`） |

## GET /api/jobs/:uuid 的回應

前端整個工作區靠這一個回應渲染，欄位要一次給齊：

```ts
interface JobDetail {
  uuid: string;
  state: JobState;
  title: string | null;
  target: { key: string; displayName: string; contentType: string;
            taxonomy: string | null; requireFeaturedImage: boolean };
  template: { id: string; hash: string; strictness: string };

  currentRevision: {
    id: number;
    number: number;
    origin: RevisionOrigin;
    contentHash: string;
    templateData: Record<string, unknown>;
    createdAt: string;
  } | null;

  /** 預覽用 HTML 的網址，不是內容本身——內容走 iframe 載入。 */
  previewUrl: string;

  /** 相對於上一個 revision 的改動，給頁邊校對符號用。 */
  marks: ProofMark[];

  media: MediaAsset[];
  featuredMediaId: number | null;

  approval: { id: number; contentHash: string; createdAt: string;
              valid: boolean } | null;

  /** 目前狀態下還缺什麼才能發布。空陣列代表可以發。 */
  blockers: string[];

  published: { wordpressId: number; status: string; link: string } | null;

  agentRun: { status: 'running' | 'succeeded' | 'failed' | 'cancelled' | 'timeout';
              provider: string; startedAt: string } | null;
}
```

## 校對符號 ProofMark

這是版面的簽名元素：改動不用紅綠色塊，用頁邊的校對符號標示。

```ts
interface ProofMark {
  /** 對應正文第幾個頂層區塊，前端據此把符號定位到那一段的頁邊。 */
  blockIndex: number;
  kind: 'inserted' | 'deleted' | 'replaced' | 'moved';
  /** 頁邊顯示的符號。用文字不用圖檔，才能跟著字級縮放。 */
  glyph: '＋' | '－' | '～' | '⇄';
  /** 滑過去顯示的說明，例如「補上標點」。由 diff 產生，不是 Agent 寫的。 */
  summary: string;
  before: string | null;
  after: string | null;
}
```

## 校稿提案（階段 5.5）

| 方法 | 路徑 | 用途 |
| --- | --- | --- |
| `GET` | `/api/jobs/:uuid/review` | 待處理清單（也在 `GET /api/jobs/:uuid` 的 `review` 欄位裡） |
| `POST` | `/api/jobs/:uuid/review/resolve` | `{ itemIds, decision: 'apply' \| 'skip' }` |
| `POST` | `/api/jobs/:uuid/review/accept-all` | 採用整份稿 |
| `DELETE` | `/api/jobs/:uuid/review` | 丟棄提案 |
| `GET` | `/api/jobs/:uuid/compare` | 左右對照，`?against=proposal\|previous` |

`review/accept-all` 與 `DELETE /review` 要帶 `proposalId`：這兩個是整份操作，
只認「目前那一份」的話，確認對話框開著的時候如果又跑了一次校稿，按下去就會
作用在使用者沒看過的那一份上。逐項處理不需要——`itemIds` 本身就只屬於某一份提案。

`ReviewItemView.blockIndex` 的語意見 [review-proposals.md](review-proposals.md)。

## 配圖需求

| 方法 | 路徑 |
| --- | --- |
| `DELETE` | `/api/jobs/:uuid/briefs/:id`（標記不要了，不刪列） |

配圖需求的語意見 [agent-tasks.md](agent-tasks.md)。
