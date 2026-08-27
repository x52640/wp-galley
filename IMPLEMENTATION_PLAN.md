# 本機 AI WordPress 發布台：實作計畫

## 1. 專案目標

建立一套只在使用者本機執行的 WordPress 內容發布台。使用者可以貼上文章、選擇發布位置與內容版型、選擇已訂閱並登入的 Codex／Claude Code／Google Agent，完成校稿、內容編排、圖片準備、預覽、對話修改與人工確認，最後透過 WordPress REST API 發布。

本專案的核心原則：

1. AI Agent 只負責文字、結構化資料、圖片提示詞與修改建議。
2. 固定程式負責驗證、套用模板、HTML 清理、WordPress API 呼叫與發布。
3. Agent 不持有 WordPress 密碼，也不能繞過人工發布核准。
4. 首頁、長文、日記使用不同自由度，不能用同一套提示詞處理。
5. MCP 是提供給外部 Agent 的工具入口；發布台本身直接呼叫共用核心服務，不依賴 MCP 才能運作。
6. 第一版使用訂閱登入的官方本機 Agent，不要求 AI API Key。

## 2. 明確範圍

### MVP 必須完成

- 僅監聽 `127.0.0.1` 的本機網頁發布台。
- 支援一個 WordPress 網站，資料模型預留多站支援。
- 支援三種內容類型：首頁、長文、日記。
- 偵測本機 Codex、Claude Code、Google Agent 是否安裝及登入。
- 讓使用者選擇可用的文字 Agent。
- 貼上純文字、Markdown 或 HTML 原稿。
- 校正錯字及語句，顯示修改前後差異，不得默默改變原意。
- 依內容類型套用本機 HTML 模板。
- 產生配圖需求、圖片提示詞、alt text 與建議插入位置。
- 第一版支援使用者把圖片拖入發布台；圖片自動生成列為擴充功能。
- 上傳圖片到 WordPress Media Library。
- 建立或更新 WordPress 草稿。
- 提供本機 HTML 預覽及 WordPress 草稿預覽。
- 支援對話式修改；每次修改產生新版本。
- 只有使用者按下明確的「確認發布」按鈕後才能發布。
- 保存發布前快照、WordPress ID、媒體 ID、版本與稽核紀錄。
- 提供 MCP Server，讓 Codex／Claude Code 等外部 Agent 呼叫同一套安全工具。

### MVP 不處理

- 不修改 WordPress PHP、Theme 或 Plugin 原始碼。
- 不把整個 WordPress 搬到 GitHub 或改變 Zeabur 部署方式。
- 不擷取 ChatGPT、Claude 或 Google 網頁 Cookie。
- 不把訂閱登入憑證轉換成自製 API Token。
- 不在未核准狀態下自動發布。
- 不承諾透過所有訂閱型 CLI 自動生圖。
- 不做多人、雲端或公開網路服務。

## 3. 建議技術架構

使用 Node.js／TypeScript，先做單一 repository，避免過度拆分。

建議技術：

- 前端：React + Vite。
- 後端：Fastify。
- 共用驗證：Zod。
- 本機資料庫：SQLite。
- 模板引擎：Nunjucks 或 Handlebars，必須啟用 strict mode。
- HTML 清理：`sanitize-html`。
- HTML 解析與結構驗證：`parse5` 或等效套件。
- 內容差異：`diff-match-patch` 或等效套件。
- MCP：官方 TypeScript MCP SDK。
- 測試：Vitest；瀏覽器流程使用 Playwright。

建議目錄：

```text
wordpress-publisher/
├── src/
│   ├── server/                 # Fastify 路由、本機服務與 SSE
│   ├── ui/                     # React 發布台
│   ├── core/                   # 工作狀態、核准、版本與稽核
│   ├── agents/                 # Codex／Claude／Google 適配器
│   ├── templates/              # 模板載入、驗證、渲染
│   ├── wordpress/              # REST API client
│   ├── media/                  # 圖片處理與上傳
│   ├── preview/                # 本機與 WP 預覽
│   └── mcp/                    # MCP Server 與工具 schema
├── templates/
│   ├── homepage/
│   ├── longform/
│   └── diary/
├── data/                       # SQLite；不得加入 Git
├── drafts/                     # 原稿與各版本；不得加入 Git
├── generated-images/           # 本機圖片；不得加入 Git
├── backups/                    # 發布前快照；不得加入 Git
├── tests/
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

資料流：

```text
本機瀏覽器
  -> 本機 Fastify 後端
      -> Agent Adapter -> 官方 Codex／Claude／Google 本機程式
      -> Template Engine -> 經驗證的 HTML
      -> WordPress REST Client -> Zeabur WordPress
      -> SQLite/File Store -> 版本、核准、媒體與稽核紀錄

外部 Codex／Claude Code
  -> MCP Server
      -> 同一個 Core Service
```

## 4. 內容類型與模板契約

### 4.1 共用模板結構

每個模板資料夾至少包含：

```text
templates/<template-id>/
├── manifest.json
├── template.html
├── schema.json
├── rules.md
└── preview.css
```

`manifest.json` 至少定義：

```json
{
  "id": "homepage-v1",
  "version": 1,
  "contentType": "homepage",
  "strictness": "strict",
  "wordpressTargetId": null,
  "allowedTags": [],
  "allowedAttributes": {},
  "requiredSlots": [],
  "optionalSlots": [],
  "previewStrategy": "local"
}
```

`schema.json` 是 Agent 回傳資料的 JSON Schema。Agent 不直接決定是否合格，後端必須使用 schema 再驗證一次。

`rules.md` 放寫作規則、固定用詞、圖片需求、不可更動區域與該版型的 Agent 指令。模板檔案是受信任的本機設定；使用者貼入的文章與外部網頁內容一律視為不受信任資料，不能覆蓋系統規則。

所有模板保存 version 與 SHA-256 hash。每個草稿版本記錄使用的模板版本與 hash，避免模板改動後無法重現舊版本。

### 4.2 首頁：Strict 模式

- 對應固定 WordPress Page ID，不建立新首頁。
- Agent 只能回傳 schema 規定的欄位，例如姓名、標語、自我介紹、作品清單、圖片說明。
- Agent 不得直接改外層 HTML、CSS class、區塊順序、script 或 style。
- HTML 只能由固定 renderer 將已驗證資料填入 `template.html`。
- 發布前比較現行首頁和新首頁，保存完整舊內容、標題、slug、featured media 與自訂欄位快照。
- 不可為了預覽把正式首頁改成 draft，否則可能使首頁下線。
- MVP 使用本機預覽；若需要與正式 Theme 完全一致，使用 staging site 或專用預覽頁，不能直接覆寫正式首頁。

### 4.3 長文：Hybrid 模式

固定外框包括標題、導讀、封面圖、正文、重點摘要、作者資訊及延伸閱讀。Agent 可以在正文 slot 中安排：

- `h2`／`h3` 標題。
- 一般段落、清單、引用與重點框。
- 圖片位置、caption 與 alt text。
- 內部連結與延伸閱讀。

Agent 不能修改外框、網站 class、全域 CSS、script 或 style。正文仍須通過 tag／attribute allowlist。

### 4.4 日記：Flexible 模式

保留日期、標題、正文、圖片與標籤等簡單欄位。Agent 可以產生較自由的正文 HTML，但仍必須清理危險標籤、事件屬性、iframe、script、style 與未允許 URL scheme。

## 5. 工作狀態與人工核准

使用明確的狀態機：

```text
SOURCE
  -> REVIEWED
  -> MEDIA_READY
  -> RENDERED
  -> PREVIEWED
  -> APPROVED
  -> PUBLISHING
  -> PUBLISHED
```

另有 `FAILED`、`CANCELLED`、`SUPERSEDED`。

規則：

- 每次校稿、圖片替換、模板切換或對話修改都建立不可變 revision。
- 每個 revision 以 canonical content 計算 hash。
- 使用者按「確認發布」時，核准的是特定 revision hash。
- 核准後只要任何內容改動，立即撤銷核准並回到 `RENDERED` 或 `PREVIEWED`。
- 聊天訊息中的「OK」只能讓 UI 顯示發布確認畫面，不能直接發布。
- 真正發布必須由本機 UI 建立 approval record。
- MCP Client 或 Agent 不能自行建立 approval record。

## 6. 訂閱式本機 Agent 適配器

不要擷取或複製官方工具保存的登入憑證。後端只啟動官方可執行檔，讓官方程式自行使用已登入狀態。

### 6.1 開發前探查

Claude Code 開始實作時先執行只讀檢查：

- 找出 `codex`、`claude`、`agy` 的實際位置。
- 記錄各自 `--version` 和 `--help` 支援的參數。
- 確認登入流程，不輸出、讀取或記錄任何 credential。
- 驗證非互動模式與 machine-readable output。
- 對無法穩定提供 JSON 的 Agent 標示 `experimental`。

不要把目前文件中的 CLI 參數視為永久不變；以本機安裝版本的官方 `--help` 為準，並為每個 adapter 寫 capability detection。

### 6.2 統一 Adapter 介面

```ts
interface AgentAdapter {
  id: "codex" | "claude" | "google";
  detect(): Promise<AgentStatus>;
  listModels(): Promise<ModelOption[]>;
  runStructured<T>(request: AgentRequest, schema: JsonSchema): Promise<AgentResult<T>>;
  cancel(runId: string): Promise<void>;
}
```

`AgentStatus` 至少包含：已安裝、版本、登入狀態是否可確認、支援的輸出格式與目前是否可用。不要在 UI 顯示登入 token。

執行規則：

- Node.js 使用 `spawn` 與參數陣列，不使用 `shell: true`。
- Prompt 透過 stdin 傳入，避免 shell injection 與命令列長度限制。
- 為每次執行設定 timeout、取消機制、最大輸出與 concurrency 1。
- Agent 的工作目錄設為隔離的 job workspace，不是使用者家目錄。
- 校稿工作不授權 shell、檔案寫入、網路或 WordPress 工具。
- Agent 只能回傳結構化內容；所有發布動作由後端執行。
- stdout 與 stderr 分開處理，log 必須移除可能的敏感資料。

建議基準：

- Codex：優先使用官方 App Server；若 MVP 時間不足，使用穩定的非互動 `codex exec` 及 JSONL 輸出。
- Claude：使用 Claude Code print mode 及 JSON／stream-json 輸出。
- Google：個人訂閱使用當前官方 Antigravity CLI；先以本機 `agy --help` 驗證非互動及輸出能力。

### 6.3 Agent 輸出契約

校稿必須回傳：

```json
{
  "title": "",
  "summary": "",
  "correctedSource": "",
  "changes": [
    {
      "type": "typo|grammar|clarity|style",
      "before": "",
      "after": "",
      "reason": "",
      "meaningChanged": false
    }
  ],
  "templateData": {},
  "imageBriefs": []
}
```

若 Agent 輸出不是合法 JSON、schema 不合格、漏掉必要欄位或嘗試加入不允許 HTML，後端拒絕該結果並允許重試，不得直接發布。

## 7. 圖片流程

MVP 不假設訂閱型 CLI 都能提供穩定的圖片檔案輸出。

第一版流程：

1. 文字 Agent 產生 image brief、prompt、建議比例、alt text、caption 及插入 slot。
2. 使用者在官方應用程式產生圖片，或自行準備圖片。
3. 使用者拖入發布台並選擇對應的 image brief。
4. 後端驗證 MIME、大小、尺寸及檔名，建立本機副本。
5. 預覽核准後上傳 WordPress，或依 target 設定在建立草稿時上傳。

後續擴充以相同 `ImageProvider` 介面加入：

- OpenAI Image API。
- Gemini Image API。
- 本機 ComfyUI／FLUX／Stable Diffusion。
- 任何官方 Agent 未來提供的穩定圖片介面。

圖片上傳後記錄 WordPress media ID。若使用者替換圖片，系統列出可能的 orphan media，由使用者明確確認後才刪除；不得自動刪除媒體庫檔案。

## 8. WordPress REST API

### 8.1 認證與祕密

- 建立專用 WordPress 使用者，權限以 Author 或 Editor 為原則，不使用 Administrator。
- 使用 WordPress Application Password，不使用主要登入密碼。
- 正式版本優先存入 macOS Keychain；開發階段可使用 `.env`。
- `.env`、SQLite、草稿、圖片及備份全部列入 `.gitignore`。
- Browser bundle、React state、HTML source、log、MCP response 都不得出現 Application Password。

`.env.example` 只放空值：

```env
APP_HOST=127.0.0.1
APP_PORT=3000
WORDPRESS_URL=
WORDPRESS_USERNAME=
WORDPRESS_APP_PASSWORD=
```

### 8.2 REST Client 功能

實作下列操作，並為每項操作建立 typed request／response：

- 測試連線及取得目前使用者能力。
- 列出 REST-enabled post types。
- 列出或搜尋 pages、categories、tags。
- 上傳 media，更新 alt text、caption、description。
- 建立 post／page／Custom Post Type draft。
- 更新指定 draft。
- 設定 featured media、分類、標籤與 slug。
- 取得草稿 preview URL。
- 發布已核准 revision。
- 發布前讀取現行內容並建立本機快照。
- 使用快照還原內容，但還原也必須人工確認。

Custom Post Type 必須已啟用 `show_in_rest`；未啟用時發布台顯示可理解的設定錯誤，不嘗試修改 PHP。

### 8.3 發布 Target 設定

`config/publish-targets.json` 的每個 target 包含：

- 顯示名稱。
- WordPress site ID。
- endpoint／post type。
- 固定 Page ID（首頁必填）。
- template ID。
- 預設 category／tags。
- preview strategy。
- 是否允許建立新內容。
- 是否允許更新既有內容。
- 是否需要第二次首頁警告。

### 8.4 首頁特殊保護

- 未設定正確 Page ID 時禁止更新。
- 更新前重新讀取遠端內容並比對上次載入的 ETag、modified time 或內容 hash，避免覆蓋別人剛做的修改。
- 若遠端內容已改變，停止發布並要求重新載入、比較、再核准。
- 發布請求只送出允許變更的欄位，不能順便覆蓋未知 meta。

## 9. 發布台 UI

單頁工作區至少包含：

1. Target 選擇：網站、首頁／長文／日記、分類、標籤、template。
2. Agent 選擇：已安裝／已登入狀態、模型、可用性。
3. 原稿區：貼上文字、Markdown 或 HTML。
4. 校稿差異區：逐項接受、拒絕或全部接受。
5. 圖片區：image brief、prompt、拖入、替換與插入位置。
6. Preview 區：sandboxed iframe 本機預覽及 WordPress 草稿預覽連結。
7. 對話修改區：只針對目前 revision 提出修改。
8. 發布確認區：target、WordPress ID、revision、差異、媒體與風險摘要。

首頁如果要求更動區塊順序、class 或 template 結構，UI 必須將其辨識成「修改版型」，離開一般內容模式。MVP 可以拒絕版型變更並提示使用者直接修改模板檔案，不要讓內容 Agent 自動改模板。

## 10. MCP Server

MCP 與網頁 UI 共用 `CoreService`，不得另寫一套發布邏輯。

第一版 MCP tools：

- `publisher_status`：回傳本機服務、Agent、WordPress 連線狀態，不回傳秘密。
- `list_publish_targets`：列出可發布位置及限制。
- `list_templates`：列出模板版本、內容類型與 schema 摘要。
- `create_draft_job`：建立本機工作項目並保存原稿。
- `review_article`：使用指定可用 Agent 產生結構化校稿結果。
- `render_revision`：驗證並渲染指定 revision。
- `prepare_media`：建立圖片需求；不自動刪除或發布。
- `upload_media`：只上傳使用者已提供並核准的本機檔案。
- `create_wordpress_draft`：建立 draft，不可 publish。
- `get_preview`：取得本機或 WordPress 預覽資訊。
- `prepare_publish`：產生發布摘要與待人工核准狀態。
- `publish_approved_revision`：只有 UI 已存在匹配 revision hash 的 approval record 才能執行。
- `restore_snapshot`：只有 UI 已建立還原核准才能執行。

MCP 安全規則：

- Tool description 明確標示讀取、寫入、發布與還原的影響。
- 所有輸入使用 Zod／JSON Schema 驗證。
- 檔案參數只接受 job workspace 內的 resolved path，防止 path traversal。
- MCP Client 不能取得 Application Password。
- MCP Client 不能製造、修改或猜測 approval token。
- Tool output 對遠端 HTML、文章及 log 做大小限制。
- 預設所有 WordPress 寫入都使用 draft。
- 不提供任意 HTTP request、任意 shell 或任意 WordPress endpoint 工具。

## 11. 本機資料與稽核

SQLite 建議資料表：

- `sites`
- `publish_targets`
- `templates`
- `jobs`
- `revisions`
- `agent_runs`
- `media_assets`
- `wordpress_objects`
- `approvals`
- `publish_events`
- `snapshots`

每次 Agent 執行至少記錄 provider、model、開始／結束時間、狀態、輸入內容 hash、輸出內容 hash與錯誤；不要記錄登入憑證。若官方 Agent 回傳 usage，可保存 usage，但不要假設能換算成 API 金額。

## 12. 七階段實作順序

### 階段 1：建立安全的本機骨架

交付成果：

- 初始化 TypeScript、Vite、React、Fastify、SQLite、Vitest。
- 服務只監聽 `127.0.0.1`。
- 建立 `.env.example`、`.gitignore`、設定載入與秘密遮蔽。
- 建立 health endpoint、錯誤格式及結構化 log。
- 建立基礎 SQLite migration。

驗收：瀏覽器能開啟本機頁面；非本機介面無法連線；repository 不包含秘密。

### 階段 2：完成模板 Registry 與 deterministic renderer

交付成果：

- 建立 homepage、longform、diary 範例模板及 schema。
- 實作 strict／hybrid／flexible 三種策略。
- 實作 schema 驗證、HTML sanitize、class／slot 結構驗證。
- 實作 template version／hash 與本機預覽。

驗收：相同資料與模板必須產出可重現 HTML；首頁模板結構遭更動時驗證失敗。

### 階段 3：完成訂閱式 Agent 適配器

交付成果：

- capability detection 與登入狀態顯示。
- Codex、Claude、Google adapter；不可用者優雅降級。
- stdin prompt、timeout、取消、輸出大小限制與 schema parsing。
- 校稿、版型資料、image briefs 的共用輸出格式。
- 使用 fixture 建立不需消耗訂閱額度的 adapter 測試。

驗收：至少一個已登入 Agent 能完成校稿並產生合法結構化資料；失敗輸出不會污染目前草稿。

### 階段 4：完成 WordPress REST 與媒體流程

交付成果：

- Application Password 連線測試。
- posts、pages、REST-enabled CPT、taxonomy、media client。
- 上傳圖片、alt text、caption、featured media。
- 建立／更新 draft、取得 preview、發布及快照還原。
- remote-change conflict protection。

驗收：在測試或 staging WordPress 完成「圖片上傳 -> 草稿 -> 預覽 -> 人工核准 -> 發布 -> 還原」完整流程。

### 階段 5：完成發布台端到端體驗

交付成果：

- Target、模板、Agent 選擇。
- 原稿、diff 接受／拒絕、圖片拖入、雙預覽與對話修改。
- revision history、狀態顯示與錯誤復原。
- approval dialog、首頁第二次警告與發布結果。

驗收：非技術使用者不需要終端機即可完成一篇日記與一篇長文；首頁未經雙重確認絕不更新。

### 階段 6：完成 MCP 與共用核心

交付成果：

- MCP Server 使用 stdio，工具全部呼叫同一個 CoreService。
- 實作前述 tools、schema、路徑限制與 approval gate。
- 提供 Codex／Claude Code 的 MCP 設定範例，但不包含秘密。
- 加入工具級稽核事件。

驗收：外部 Agent 可以建立工作、校稿、渲染、建 draft；沒有 UI approval record 時，MCP 發布必定被拒絕。

### 階段 7：測試、文件與交付

交付成果：

- Unit tests：schema、renderer、sanitize、狀態機、approval invalidation。
- Integration tests：CLI fixture、WordPress mock、失敗重試、conflict。
- Playwright E2E：日記、長文、首頁保護、修改後撤銷核准。
- README：安裝、登入官方 Agent、WordPress Application Password、模板新增方式、備份與還原。
- 啟動 script 與診斷頁面。

驗收：全套測試通過；重新安裝後只需依 README 即可啟動；不需要 AI API Key。

## 13. MVP 完成定義

只有下列項目全部成立才算完成：

- 一個指令能啟動發布台並自動開啟或顯示本機網址。
- UI 能辨認至少 Codex、Claude、Google Agent 的可用狀態。
- 使用者能選 Agent、內容類型和模板。
- 校稿結果有可檢視的 diff，且可拒絕部分修改。
- 三種內容類型都通過各自模板與 HTML 安全驗證。
- 圖片能拖入、預覽、上傳並設定 alt text。
- 日記與長文能建立 WordPress 草稿、預覽並發布。
- 首頁不會因預覽而下線，也不會被未核准 revision 覆蓋。
- 修改內容後舊 approval 立即失效。
- WordPress 秘密從未送入 Agent prompt、前端或 MCP output。
- MCP 無法跳過 UI 人工核准發布。
- 發布前快照可以用人工確認的方式還原。

## 14. Claude Code 執行規則

Claude Code 開始後應遵循：

1. 先讀完整份計畫，再檢查目前資料夾，不要直接生成全部程式。
2. 先建立 7 階段 task list，一次只進行一個可驗收階段。
3. 每個階段先寫或更新測試，再完成實作與驗證。
4. 不得使用或要求 ChatGPT／Claude／Google 網頁 Cookie。
5. 不得把 WordPress Application Password 傳給任何 Agent。
6. 不得在測試期間寫入正式首頁；WordPress 整合先使用 staging 或 mock。
7. 不得使用 `shell: true` 啟動 Agent CLI。
8. 不得提供能呼叫任意 REST endpoint、shell command 或任意檔案路徑的 MCP 工具。
9. 發現本機 CLI 與本計畫假設不同時，先記錄差異並調整 adapter，不要繞過官方登入。
10. 保留使用者既有檔案與變更；每完成一個階段，回報檔案、測試與尚存風險。

## 15. 交給 Claude Code 的啟動提示

在此資料夾啟動 Claude Code，貼上以下內容：

```text
請完整閱讀 IMPLEMENTATION_PLAN.md，依照其中的範圍、安全規則、七階段順序與驗收條件，建立本機 AI WordPress 發布台。

先只執行階段 1：檢查環境、建立專案骨架、設定本機監聽、秘密管理、SQLite migration、健康檢查與測試。不要連線或改動正式 WordPress，不要開始後續階段。

完成階段 1 後，執行測試並向我報告：
1. 建立或修改了哪些檔案；
2. 測試結果；
3. 發現的環境差異；
4. 進入階段 2 前需要我確認的事項。
```

建議逐階段請 Claude Code 繼續，不要第一個指令就要求一次做完七個階段。這能保留人工檢查點，尤其 WordPress 連線、首頁 Page ID、模板契約與發布權限都需要實際確認。

## 16. 開發時需要使用者提供的資料

不要現在把秘密寫進計畫。進行到相應階段再提供：

- WordPress 網址。
- 專用 WordPress 使用者名稱及 Application Password。
- 正式首頁 Page ID。
- 日記、長文對應的 post type、分類與標籤。
- 現有首頁 HTML。
- 日記與長文期望模板或範例文章。
- WordPress 是否有 staging site。
- 已訂閱並登入的 Codex／Claude／Google Agent 清單。

## 17. 官方參考

- WordPress REST API Handbook: https://developer.wordpress.org/rest-api/
- WordPress Posts API: https://developer.wordpress.org/rest-api/reference/posts/
- WordPress Pages API: https://developer.wordpress.org/rest-api/reference/pages/
- WordPress Media API: https://developer.wordpress.org/rest-api/reference/media/
- WordPress Application Passwords: https://developer.wordpress.org/advanced-administration/security/application-passwords/
- WordPress Custom Post Type REST support: https://developer.wordpress.org/rest-api/extending-the-rest-api/adding-rest-api-support-for-custom-content-types/
- OpenAI／Codex authentication: https://learn.chatgpt.com/docs/auth
- Codex developer commands: https://learn.chatgpt.com/docs/developer-commands?surface=cli
- Claude Code setup: https://docs.anthropic.com/en/docs/claude-code/getting-started
- Claude Code CLI reference: https://docs.anthropic.com/en/docs/claude-code/cli-usage
- Google Agent 的實際 CLI、訂閱登入及非互動參數應以安裝當下官方文件和 `--help` 為準。
