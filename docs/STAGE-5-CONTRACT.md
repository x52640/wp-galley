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

## 七、階段 5.5 的增補：待處理清單與左右對照

2026-08-28 實作。這一節推翻了前面幾節的一個假設，先講那個。

### 校稿不再直接產生版本

**原本**：`runAgentReview` 一拿到結果就 `createRevision`，Agent 的改動整份落地。

**現在**：Agent 的輸出存成**提案**（`review_proposals` / `review_items`），
內容一個字都不動，使用者逐項決定要不要套用。

為什麼改：整份落地代表 Agent 改了九個地方、八個對、一個把原意改掉了，使用者只能
全收或全退。計畫 §358 要的是「逐項接受、拒絕或全部接受」，而 `meaningChanged`
為真的項目**預設不套用**——直接落地就違反了這一條。

連帶的兩個變化：

- **校稿不再讓核准失效。** 內容沒改，失效就不該發生；套用任何一項時才失效，
  而且是走一般的 `createRevision`，跟手動編輯同一條路。
- **`AgentRunResult` 沒有 `revision` 欄位了**，換成 `review`。

### 逐項套用怎麼定位

`ReviewChange` 是**描述**（把 A 改成 B），不是套用的機制。所以套用是在目前的
內容上做定位與替換（`src/core/review-apply.ts`）：

1. **從目前的內容出發，只套上被勾選的那幾項。** 反過來做（拿 Agent 的整份輸出
   再還原沒勾的）會把它沒申報的改動一起帶進來。
2. **依序定位、帶著游標往前走。** 沒勾的項目也要參與定位，否則第二個「的」
   會被套到第一個「的」的位置上。已套用過的項目找 `after`。
3. **只在標籤外面找。** 正文是 HTML 字串，`class="wp-block-paragraph"` 也是字串的
   一部分。純用 `indexOf` 的話，`before` 撞上屬性就會改到**標記**而不是文章，
   而且改出來的 HTML 仍可能通過模板 schema，沒有人會發現。
   跨過標籤邊界的（`今天<em>讀完`）也不算——換掉會把標籤吃掉。
4. **`after` 不准帶標籤。** 那是 Agent 在直接寫 HTML，那條線不開（計畫 §4.1）。
5. **欄位照長度排，長的先找。** 照 key 順序的話 `title` 永遠排在 `body` 前面，
   一個要改正文的建議會去改標題——長文的標題本身就是一句話，撞上的機率不低。
6. **找不到就標成 `unappliable`**，明講「這一項要自己改」。猜一個位置替換下去，
   使用者不會知道文章被改到哪裡。`unappliable` 算「還沒處理」，提案不會因此結案。

「全部接受」是**另一條路**：直接採用 Agent 交回來的整份 `templateData`，包含它
沒列進清單的調整。提案之後內容被改過（`stale`）就擋下來——那是整份覆蓋，中間的
修改會無聲消失。逐項套用不受 `stale` 影響，找不到就誠實回報。

### 新增的 API

| 方法 | 路徑 | 用途 |
| --- | --- | --- |
| `GET` | `/api/jobs/:uuid/review` | 待處理清單（也在 `GET /api/jobs/:uuid` 的 `review` 欄位裡） |
| `POST` | `/api/jobs/:uuid/review/resolve` | `{ itemIds, decision: 'apply' \| 'skip' }` |
| `POST` | `/api/jobs/:uuid/review/accept-all` | 採用整份稿 |
| `DELETE` | `/api/jobs/:uuid/review` | 丟棄提案 |
| `GET` | `/api/jobs/:uuid/compare` | 左右對照，`?against=proposal\|previous` |

`ReviewItemView.blockIndex` **每次讀取時重算**，不是存下來的：內容改過之後，
存下來的索引會指到別的段落，使用者按了跳轉會跳到錯的地方。定位不到就是 null，
那一項沒有跳轉按鈕——**包括 observation**，它自帶的 `blockIndex` 是 Agent 看它
那一版時算的，不拿來充數。

`review/accept-all` 與 `DELETE /review` 要帶 `proposalId`：這兩個是整份操作，
只認「目前那一份」的話，確認對話框開著的時候如果又跑了一次校稿，按下去就會
作用在使用者沒看過的那一份上。逐項處理不需要——`itemIds` 本身就只屬於某一份提案。

**校稿只會把 `SOURCE` 推進 `REVIEWED`。** 轉移表允許 `RENDERED → REVIEWED`，
但那條邊是給「內容真的改了」用的；提案制之下拿來用會把一篇已經渲染好的稿子推回
「還沒渲染」，多出一條假的 blocker，而校樣其實一點都沒失效。

### 中文 diff

Git 那種靠空格切詞的 diff 套到中文會退化成逐字比對，產出一堆碎片
（`今[天]讀完[了]這本書`）。所以先用 `Intl.Segmenter`（`granularity: 'word'`，
Node 內建、有完整 ICU）斷詞，再對「詞」做 LCS——`src/core/word-diff.ts`。
**這是不特別處理就會默默產出垃圾的地方。**

比對一律在**後端**算：斷詞與區塊拆解後端都做了而且有測試，前端再寫一份只會得到
兩套不一樣的「第 n 段」。左右兩欄共用同一串差異序列（左欄畫 same + removed，
右欄畫 same + added），所以天然對齊，不必同步捲軸。

### 畫面

主區只有**兩個**檢視：校樣（預設）與左右對照，一個切換鍵。階段 6 的查證發現
**不會**再開第三個檢視——它跟校稿改動一起掛在右邊的待處理清單上。

切到左右對照時，校樣**不卸載**，只是 `visibility: hidden` 被蓋住。用
`display: none` 會讓 iframe 的版面歸零，`ResizeObserver` 隨即把量到的段落位置
全部洗成 0，右面板的「把圖片插在第 n 段後面」就會指到錯的地方。

待處理清單是右面板的一張卡片，有未處理項目時自動攤開（`primaryPanel` 在畫面這一層
決定，狀態機不知道清單的存在）。預設只勾選 `meaningChanged` 為 false 的改動。

`blockers` 會多一條「還有 N 項校稿建議沒處理」。那是**提醒不是禁令**——`blockers`
只餵給畫面，發布的硬性前置檢查仍然只在 `preflightPublish`。

畫面上「套用」與「略過」**共用同一個 busy 旗標**：各自一個的話兩個請求會疊在
同一項上。後端也擋了（已套用的項目不接受「略過」，否則文字還在但清單說沒套用），
兩層都要有——畫面那層是不讓它發生，後端那層是它還是發生了的時候不說謊。

## 八、一鍵動作、配圖需求與執行中的回饋

2026-08-28 追加。三件事，都來自實際用起來的問題。

### 一鍵動作：常做的事不該要打字

發文絕大多數是**針對內容**發的，校對只是順手做一次。原本要先想一句話打進框裡
才按得下去，等於把最常做的事變成最麻煩的事。所以校稿面板改成三顆直接送出的按鈕：

| 按鈕 | task | 給什麼 |
| --- | --- | --- |
| **一鍵校驗**（主要） | `review` | `changes` ＋ `observations` 一起 |
| 只找錯字 | `review` | 只有 `changes`，不動語意也不提疑點 |
| 一鍵配圖 | `images` | 只有 `imageBriefs` |

打字那條路留給「要它針對內容做別的事」的時候。

三趟**共用同一份 output schema**（多一份 schema 就多一個要維護的東西），差別靠
`buildSystemPrompt(template, task)` 裡的 `TASK_BRIEF`。用不到的欄位明講「給空陣列」，
模型才不會為了填滿欄位硬擠內容。

### `AgentTask` 決定結果怎麼落地

`images` 那一趟**不建立提案，也不驗 templateData**。兩個理由：

1. `runAgentReview` 每跑一次就會把舊提案結掉。共用容器的話，按一次「一鍵配圖」
   就會把還沒清完的校稿清單洗掉。
2. 那一趟根本沒有要改文章，為了一份用不到的 templateData 讓整趟失敗只是找麻煩。

### 配圖需求：只做前半段，但不讓人離開發布台

**這裡不生圖。** 三個 CLI 都不能產生圖片（用它們自己的 `--help` 確認過），
圖片生成 API 也還沒選。能自動化的只有前半段：Agent 說出「哪一段該放什麼圖、
prompt 長怎樣、比例多少、alt 寫什麼」，使用者按「複製 prompt」拿去生圖，
回來在**同一張卡片**上傳。

存在 `image_briefs`（migration 004），不是 `review_items`——配圖需求不是
「接受或拒絕」的東西，它是一份採買清單，一條 brief 的下場是「圖片上傳好了」
或「不要了」。`brief_key` 對得上 `media_assets.brief_key`（那一欄 001 就有了，
一直沒有東西去填它），`fulfilled` 就是這樣算出來的。

| 方法 | 路徑 |
| --- | --- |
| `DELETE` | `/api/jobs/:uuid/briefs/:id`（標記不要了，不刪列） |

生圖 API 選定之後，接的位置是這張卡片上再多一顆按鈕，資料結構不用動。

### 執行中的回饋

一趟要幾十秒到幾分鐘。那段時間只有一個轉圈圈的話，使用者分不出「還在想」與
「卡死了」。所以：

- **每秒跳一次的計時器**（mm:ss）。動的東西才代表活著。
- **講出它在做什麼**，用 `agentRun.task` 決定講法——「校稿」跟「想配圖」是兩件事。
- **講出大概要多久**（30 秒到 3 分鐘），超過 90 秒換一句話安撫。
- **頂端長條在工作區任何畫面都看得到**。使用者在看校樣或左右對照時不會把右面板
  打開，「還在跑」這件事必須自己找上門。

**沒有百分比進度條**，因為我們真的不知道進度——子行程只在結束時回話。畫一個假的
進度條比誠實的不確定更糟。減少動態時那條長條換成靜止的滿版，進度由計時器的文字負責。

`agent_runs.purpose` 存的就是 task，`AgentRunView.task` 直接讀它，沒有多開欄位。
