# 階段 5 契約：發布台端到端

這份文件是後端與前端的**共用規格**。兩邊都照這份做，不要各自發明。
改動這份文件要同時通知兩邊。

## 一、不可妥協的規則

這三條來自 CLAUDE.md 的架構要點，實作時不得繞過：

1. **Agent 只產生結構化資料，HTML 由固定程式產生。** 聊天框送出的訊息會變成
   Agent 的 prompt，Agent 回傳 `templateData`（JSON），由 `renderRevision`
   渲染。Agent 永遠碰不到 HTML 外框、class 或 style。
2. **核准綁定 revision 的 `content_hash`，內容一改就失效。** 建立 approval 時記下
   當時的 hash；任何會改變內容的操作都要把現有 approval 撤銷（`revoked_at`），
   並把 job 退回 `RENDERED`。這件事在 **CoreService 裡做**，不是在路由或 UI。
3. **只有本機 UI 能建立 approval。** DB 的 `approvals.created_by` 有
   `CHECK (created_by = 'ui')`，CoreService 也要再擋一次。階段 6 的 MCP 呼叫
   同一個 CoreService，但不得呼叫核准相關的方法。

## 二、狀態機

```
SOURCE → REVIEWED → MEDIA_READY → RENDERED → PREVIEWED → APPROVED → PUBLISHING → PUBLISHED
                                     ↑                        │
                                     └────────────────────────┘
                                     內容一改，核准失效，退回 RENDERED
```

另外三個終止狀態：`FAILED`、`CANCELLED`、`SUPERSEDED`。

允許的轉移寫在 `src/core/state-machine.ts`，用表格定義，不要散在各處的 if。
不在表格裡的轉移一律丟 `InvalidTransitionError`。

| 目前狀態 | 允許轉移到 |
| --- | --- |
| `SOURCE` | `REVIEWED`、`RENDERED`、`CANCELLED`、`FAILED` |
| `REVIEWED` | `MEDIA_READY`、`RENDERED`、`CANCELLED`、`FAILED` |
| `MEDIA_READY` | `RENDERED`、`CANCELLED`、`FAILED` |
| `RENDERED` | `PREVIEWED`、`REVIEWED`、`MEDIA_READY`、`CANCELLED`、`FAILED` |
| `PREVIEWED` | `APPROVED`、`RENDERED`、`CANCELLED`、`FAILED` |
| `APPROVED` | `PUBLISHING`、`RENDERED`（核准失效）、`CANCELLED` |
| `PUBLISHING` | `PUBLISHED`、`FAILED` |
| `PUBLISHED` | `SUPERSEDED` |

**`SOURCE → RENDERED` 是刻意留的**：使用者可以完全不用 Agent，貼完稿直接渲染發布。

## 三、CoreService

`src/core/service.ts`。**MCP 與 UI 共用同一個實例**，所有核准、驗證與稽核只實作一次。

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

### 核准失效的實作點

`createRevision`、`placeMedia`、`setFeaturedMedia`、`replaceMedia` 這些會改變
`content_hash` 的方法，**在寫入前**一律：

1. 找出這個 job 尚未撤銷的 approval
2. 若存在，設 `revoked_at` 與 `revoke_reason`
3. 若 job 狀態是 `APPROVED`，退回 `RENDERED`
4. 寫一筆 `publish_events`（`event_type: 'approval_revoked'`）

**不要靠呼叫端記得做這件事。**

### publish 的前置檢查

`publish` 必須依序檢查，任一項失敗就丟出對應錯誤且**不送任何請求**：

1. job 狀態是 `APPROVED`
2. 有未撤銷的 approval，且 `approval.content_hash === 目前 revision 的 content_hash`
3. target 的 `allowCreate` / `allowUpdate` 允許這次操作
4. `requireFeaturedImage` 的 target 有設精選圖片
5. 更新既有文章時，遠端沒被改過（`assertUnchanged`）

## 四、HTTP API

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
| `GET` | `/api/jobs/:uuid/diff` | 兩個 revision 的差異，格式見下 |
| `POST` | `/api/jobs/:uuid/agent` | 派工給 Agent（校稿或提修） |
| `DELETE` | `/api/jobs/:uuid/agent` | 取消執行中的 Agent |
| `POST` | `/api/jobs/:uuid/media` | 上傳圖片 |
| `PUT` | `/api/jobs/:uuid/media/:id` | 換圖 |
| `DELETE` | `/api/jobs/:uuid/media/:id` | 移除 |
| `POST` | `/api/jobs/:uuid/media/:id/place` | 指定插入位置 |
| `POST` | `/api/jobs/:uuid/approve` | 核准（帶 contentHash） |
| `DELETE` | `/api/jobs/:uuid/approve` | 撤銷核准 |
| `POST` | `/api/jobs/:uuid/publish` | 發布（`{ status: 'draft' \| 'publish' }`） |

### GET /api/jobs/:uuid 的回應

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

### 校對符號 ProofMark

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

## 五、設計系統

### 定位

不是儀表板，是**校樣台**。介面外殼要跟內容看起來明顯不同，使用者永遠不會把
「軟體的東西」跟「文章的東西」搞混。

### 顏色

介面外殼用冷色低彩度（印刷版材的灰藍），校樣區用真正的紙白。強調色只用在
**需要人做決定的地方**——核准按鈕、未核准警示、改動符號。其他一律安靜。

```css
:root {
  /* 外殼：印刷版材 */
  --shell-bg:        #1B1F24;   /* 工作台底色 */
  --shell-panel:     #23282F;   /* 面板 */
  --shell-line:      #333A43;   /* 分隔線 */
  --shell-text:      #C7CED6;   /* 主要文字 */
  --shell-text-dim:  #7C8794;   /* 次要文字 */

  /* 校樣：紙 */
  --proof-bg:        #FFFFFF;
  --proof-text:      #1A1A1A;
  --proof-rule:      #E2E0DA;

  /* 只用在需要決定的地方 */
  --mark:            #C2410C;   /* 校對符號、改動 */
  --seal:            #15803D;   /* 已核准 */
  --warn:            #B45309;   /* 核准失效、未完成 */
  --danger:          #B91C1C;   /* 發布失敗、遠端衝突 */
}
```

淺色模式用 `prefers-color-scheme` 提供對應的一組，外殼轉為淺灰，校樣維持紙白。

### 字體

**中文正文只能用黑體**——有個性的西文字體對中文一個字都套不上，硬配只會讓中文
掉回系統預設，變成兩套字體打架。

個性放在**數字與標籤**上：日記標題本身就是數字（20260828）、版本號、文章 ID、
狀態編號。用一套有個性的等寬數字撐起結構感，中文保持安靜。

```css
--font-cjk:  'PingFang TC', 'Noto Sans TC', system-ui, sans-serif;
--font-num:  'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
--font-ui:   var(--font-cjk);
```

校樣區的正文字級要**貼近正式站的實際觀感**（段落預設 `medium`），不要用介面的
小字級去顯示文章。

### 版面

使用者已選定：**左狀態軌 + 大校樣 + 右操作面板**。

```
┌───────┬──────────────────────────────┬──────────────┐
│ 01 ●  │  校樣                         │ 這一步        │
│ 原稿  │  ┌───────────────────────┐   │               │
│ 02 ●  │  │                       │   │ ── Agent ───  │
│ 校稿  │  │  20260828             │   │ 「第二段太長，  │
│ 03 ●  │  │  ─────                │   │   拆成兩段」   │
│ 配圖  │  │                       │   │ [送出]        │
│ 04 ○  │  │  今天讀完這本書，想到   │   │               │
│ 渲染  │ ⌈│  很多事。不是書裡寫的   │   │ ── 發布 ───── │
│ 05 ○  │  │  那些，而是…           │   │ 分類  隨筆 ▾  │
│ 預覽  │  │                       │   │ 封面  [換圖]  │
│ ────  │  └───────────────────────┘   │               │
│ ⚠未核 │   ⌈ = 頁邊的校對符號           │ [核准後發布]  │
│ 准    │     滑過去看改了什麼           │               │
└───────┴──────────────────────────────┴──────────────┘
```

- **左軌是簽名元素。** 狀態走過的亮、還沒到的暗。核准那一格視覺上跟其他不同，
  像一個蓋章的位置——核准失效時要看得出「印章被撕掉了」，而不只是顏色變灰。
- **右面板隨狀態改變內容**，永遠只顯示「這一步該做的事」。
- 校樣用 iframe 載入，套模板自己的 `preview.css`，跟介面的 CSS 完全隔離。

### 品質底線

- 對比至少 4.5:1；鍵盤焦點看得見，不要拿掉 focus ring
- 過場 150–300ms；`prefers-reduced-motion` 要respect
- 圖示用 SVG（Lucide），**不要用 emoji 當圖示**
- 不要只靠顏色傳達狀態，要有文字或符號
- 桌面優先（這是本機工具），但 1024px 不能爆版
- 破壞性操作（取消 job、移除圖片、撤銷核准）要二次確認

### 文案

- 動詞用主動式，按鈕寫「發布」不寫「送出」
- 同一個動作全程同名：按鈕寫「發布」，成功訊息就寫「已發布」
- 錯誤要說**發生什麼事**與**怎麼修**，不要道歉也不要含糊
- 空狀態是邀請動作，不是裝飾

## 六、測試守則

- 測試**絕不呼叫真實 Agent CLI**（會消耗訂閱額度），一律用
  `tests/helpers/fake-adapter.ts`
- 測試**絕不連真實 WordPress**，用 `tests/helpers/mock-wordpress.ts`
- 核准失效的每一條路徑都要有測試：改內容、換圖、移動圖片、換封面
- 狀態機的每一個非法轉移都要有測試
