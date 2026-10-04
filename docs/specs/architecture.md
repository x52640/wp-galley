# 架構與程式慣例

> 擁有範圍：技術選型、模組邊界、依賴方向、跨模組的程式慣例、資料存放、功能地圖。
> 各模組的行為規格在各自的 spec，這裡只管「東西放哪、誰可以 import 誰」。

## 內容管線

系統是一條**單向的內容管線**，兩個入口共用同一個核心：

```
本機瀏覽器 → Fastify → CoreService ┐
外部 Agent → MCP Server (stdio) ───┘→ Agent Adapter / Template Engine / WP REST Client / SQLite
```

MCP 與 UI 共用同一個 `CoreService`（見 [security.md](security.md)）。

## 技術選型

Node ≥22.5 + TypeScript（ESM、`verbatimModuleSyntax`，import 要寫 `.js` 副檔名）、
Fastify 5、React 19 + Vite 8、Zod 4、Vitest 4。

SQLite 用 **Node 內建的 `node:sqlite`**（`DatabaseSync`），不是 better-sqlite3——免原生編譯。
API 是同步的：`db.prepare(...).run()/get()/all()`，`.all()` 回傳
`Record<string, SQLOutputValue>[]`，要轉型得先過 `as unknown as`。

已安裝：Nunjucks、`sanitize-html`、`parse5`。diff 是自己寫的（`src/core/diff.ts`，LCS，
未加依賴）。尚未安裝：官方 TypeScript MCP SDK、Playwright。UI 沒有用任何元件庫，
圖示是手抄的 Lucide SVG。

## 模組

| 目錄 | 負責 | 規格 |
| --- | --- | --- |
| `src/contract` | 前後端共用的 HTTP 型別（`api.ts` 轉出同資料夾的 `api-*.ts`），以及兩邊必須同一套規則的純函式（`text-match.ts`、`media-marker.ts`、`position-anchor.ts`、`auto-place.ts`、`review-state.ts`、`job-states.ts`、`agent-run.ts`…；後端與示範資料都用，P5-T033）；**只 import 同資料夾的檔** | [http-api.md](http-api.md) |
| `src/config` | 環境變數、路徑、秘密遮蔽、`.env` 改寫（設定精靈） | [security.md](security.md) |
| `src/db` | SQLite 與 migration | 本檔 |
| `src/core` | CoreService（`service.ts` 門面＋`service/` 各領域，見 core-service.md）、狀態機、revision、diff、提案套用 | [core-service.md](core-service.md)、[state-machine.md](state-machine.md)、[review-proposals.md](review-proposals.md) |
| `src/templates` | 模板 registry、渲染、sanitize、結構驗證 | [templates.md](templates.md) |
| `src/preview` | 校樣 HTML 文件 | [templates.md](templates.md) |
| `src/agents` | CLI 適配器、輸出契約與解析 | [agent-cli.md](agent-cli.md)、[agent-tasks.md](agent-tasks.md) |
| `src/wordpress` | REST client、區塊序列化、分類項目 | [wordpress-site.md](wordpress-site.md) |
| `src/fetch` | AI 查證的取回器：安全抓取（DNS 前檢查、在連線用的解析裡查位址、跳轉、不經代理、大小與逾時）、外洩檢查、這次查證的額度、維基百科、抽文字（P6-T002；P6-T004 已接進流程，`server/app.ts` 的 `realFactCheckFetcher`） | [security.md](security.md)「取回器」、[factcheck.md](factcheck.md) |
| `src/media` | 圖片驗證（`validate.ts`，上傳與生圖候選圖共用）與上傳 | [agent-tasks.md](agent-tasks.md) |
| `src/server` | Fastify、路由、守門；設定換掉後就地生效（`reconfigure.ts`） | [http-api.md](http-api.md)、[security.md](security.md) |
| `src/ui` | React 發布台；示範資料（`?fixtures=1`）在 `service/fixtures/`，照後端 `service/` 的領域拆檔、同名對應，只放假資料、規則用 `src/contract`（D-033，P5-T033） | [design-system.md](design-system.md) |
| `src/mcp` | 空（MCP 尚未實作） | [mcp.md](mcp.md) |

## 依賴方向

`server → preview → templates → core → contract`，`ui → contract`。

- `db/templates/core/preview` 全部不得 import Fastify 或 HTTP。
- `src/contract` 只准 import 同資料夾的檔（`./xxx.js`；`api.ts` 拆成 `api-*.ts` 後互相引用型別，P5-T004），
  其他模組一律不准（`tests/contract.test.ts` 守著），否則會把後端拖進瀏覽器 bundle。`ui` 只能從 `contract` 拿後端的型別，不得 import `src/core`。
- `src/fetch` 只准 import Node 內建、`parse5` 與同資料夾的檔：文章文字、`containsSecret`、User-Agent 版本由呼叫方傳入，
  不 import `src/config`、`src/core`、`src/agents`、`src/server`（`tests/safe-fetch.test.ts`「依賴方向」守著）。DNS 解析與傳輸可注入，預設實作只在正式啟動時用。
- 改動前先跑一次依賴檢查。

## 程式慣例

- 新增 API 錯誤一律 `throw new AppError(code, message, status)`，回應格式固定是
  `{ error: { code, message, details?, requestId } }`；5xx 對外只給通用訊息。
- migration 只能往 `src/db/migrations/` 加新檔並註冊到 `index.ts`；改動已套用的
  migration 會因 checksum 不符而啟動失敗。
- 要改 CHECK 之類只能重建表的 migration，照 `007-article-content-type.ts` 的做法：migration 在交易裡跑，
  `PRAGMA foreign_keys = OFF` 無效，`DROP TABLE` 會觸發子表的 `ON DELETE SET NULL`——先把子表欄位抄到
  暫存表、重建後寫回去。先在記憶體 DB 與 `data/publisher.sqlite` 的**副本**上驗過再註冊：
  dev server 一重載就會套到真的 DB。
- 單純 `ADD COLUMN` 的 migration 也一樣：`index.ts` 一存檔，`tsx watch` 就重載並套到真的 DB，之後 SQL 一個字都
  不能再改（checksum）。所以**先寫測試、在副本上驗完、SQL 定稿，最後才註冊**（P5-T018 踩過：註冊當下就套上去了）。
- Agent 各家怪癖的放置規則見 [agent-cli.md](agent-cli.md)。

## 本機資料

使用者資料放在程式資料夾**外**的**資料目錄**（D-035，P8-T003），升級換掉程式資料夾也不會動到。所有路徑的家是
`src/config/paths.ts`；啟動（`npm start`、`npm run dev`、`npm run migrate`）都先走 `src/config/user-data.ts` 的 `prepareUserData`。

- **資料目錄在哪**：macOS `~/Library/Application Support/Galley/`；其他平台 `$XDG_DATA_HOME/galley`，沒設就
  `~/.local/share/galley`。環境變數 `GALLEY_DATA_DIR`（絕對路徑，相對的啟動失敗）可覆寫。新建時權限 0700。
  程式資料夾是 **git worktree**（`.git` 是檔案）且沒設 `GALLEY_DATA_DIR` 時，預設改用 `<程式資料夾>/.galley-data`（進 `.gitignore`）：
  並行開發的 worktree 不共用全機那一個（不讀到真的 `.env`／DB，也不會搶先建出資料目錄）。主 checkout（`.git` 是資料夾）照舊。
  啟動時終端機印一行「資料目錄：…」。
- **DB 存相對路徑**：`jobs.workspace_path`、`media_assets.local_path`、`image_candidates.local_path` 存相對資料目錄
  （`drafts/<uuid>`），讀時以資料目錄解析；讀到絕對路徑（舊資料、使用者自己設過別處）照舊能用。
  絕對路徑不在資料目錄底下時另有容錯：取路徑裡最後一個 `/drafts/` 或 `/generated-images/` 段，資料目錄的同一個相對位置
  **真的有檔**才改用它（重 clone 後把舊資料複製過來、010 沒轉到的情況；`fromStoredPath`）。migration 010
  把「舊程式資料夾＋`/`」開頭的舊值改成相對（舊根目錄由 `runMigrations` 的 `legacyRoot` 傳入）。
  **媒體路徑**（`media_assets.local_path`、`image_candidates.local_path`）另走 `fromStoredMediaPath`（P8-T004）：有 `..` 段就不解析；
  解析後（含上面的容錯，容錯只認 `/generated-images/` 段）必須在媒體資料夾裡；媒體資料夾以下每一段（含檔案本身）都不能是符號連結、
  實體路徑也要在裡面，解析不了一律不合格（fail closed）；媒體資料夾本身的實際位置也要通過 `isSafeStoreRoot`
  （不是資料目錄或其上層、不包含 `.env`／`data/` 等其他存放位置、不跟它們重疊）。實際位置一律取檔案系統上的真正拼法
  （`realLocation`＝`realpathSync.native`），不分大小寫的檔案系統上拼法不同也比得出是同一處。不合格就當成檔案不見了——
  讀候選圖回「檔案不見了」、刪媒體不動任何檔（`CoreContext.mediaFile`／`requireMediaFile`）。
  Agent 工作目錄解析後一定在 `drafts/` 裡，**字面與實體路徑都是**：逃出去（含路徑上有符號連結指到外面）就改用 `drafts/<uuid>`；
  連 `drafts/<uuid>` 的實體路徑都在外面就不跑 Agent。`drafts/` 本身也要通過 `isSafeStoreRoot`；建資料夾前先確認已存在的祖先
  （懸空的符號連結也算存在）在 `drafts/` 裡；任何錯誤都當成不合格（`CoreContext.jobWorkspace`）。
- **第一次啟動自動搬家**：有沒有搬過看資料目錄的**標記檔** `.galley-data.json`（`createdAt`、`state`、`migratedFrom`＝舊根目錄或 null＝全新、
  `databaseCreated`＝這裡有過資料庫），
  不看 DB 在不在。沒有標記（或標記停在 `migrating`）、且程式資料夾的舊位置有任何一項（下表「資料目錄」那幾列；git 佔位檔不算）時，
  **複製**過去、舊的不刪；舊位置沒東西就只建目錄（標 `done`）。開始複製前先標 `state: 'migrating'`，全部做完最後一步才改成 `done`；
  停在 `migrating` 的下次啟動整份重搬（覆蓋新位置的半成品）。讀不到的舊資料（權限、I/O 錯誤）停止搬家，不當成沒有。
  順序是**先快照 DB、再複製資料夾**、最後 `.env`（先用 0600 建暫存檔再改名）與站台設定檔。
  SQLite 用 `VACUUM INTO` 寫成帶 pid＋亂數的暫存檔，唯讀開啟做 `integrity_check`、確認有 `schema_migrations`，通過才改名成 `publisher.sqlite`。
  整段在鎖檔 `.migrating.lock`（記 pid）裡做：鎖檔存在就停止啟動並說明（pid、建立時間、確定沒在跑時要刪哪個檔），
  **不自動接手**、不猜是不是過期的（P8-T004）；放鎖只刪內容是自己 pid 的。
  失敗就停止啟動、講卡在哪；成功就印出資料搬到哪、舊資料在哪、可以自己刪哪些（提醒 `.env` 有密碼）。
  **沒有**標記但資料目錄已經有 DB（手動放的）：不覆蓋，補上標記。
- **有過資料庫、現在不見了**（P8-T004）：標記 `done` 且 `databaseCreated`，`data/publisher.sqlite` 卻不存在或是空檔 → 停止啟動並說明
  （資料庫應該在哪、可能被移走、找不回來要重新開始就把資料目錄整個移走再啟動），不建新 DB、不套 migration（`assertDatabasePresent`）。
  `databaseCreated` 的來源：搬家時搬了 DB、手動放的 DB、或啟動建好 DB 套完 migration 後（`markDatabaseCreated`，`main.ts`／`cli-migrate.ts`；
  標記還沒記的也在這時補上，寫不進去只警告、不擋啟動）。`assertDatabasePresent` 只讀不寫。沒有這個欄位的舊標記：`migratedFrom` 有值的當成有過，全新的當成沒有。
  全新安裝（還沒建過 DB）照常建立。
- **已經搬過、但舊位置還有沒搬過去的 DB**（`data/publisher.sqlite` 存在、且標記的 `migratedFrom` 不是這個程式資料夾，例如別的 checkout
  先建了資料目錄）：不搬、不擋啟動，終端機大聲警告兩邊路徑與怎麼處理。`migratedFrom` 就是這個程式資料夾的不探舊位置；
  探舊位置出任何錯（權限、I/O）只略過警告，不擋啟動（P8-T004）。

| 位置 | 內容 | 進 Git |
| --- | --- | --- |
| 資料目錄 `data/` | SQLite | 否（不在 repo） |
| 資料目錄 `drafts/` | 每個 job 的隔離工作區（Agent 的 cwd） | 否 |
| 資料目錄 `generated-images/` | 本機圖片：上傳過的副本（`<job>/<sha256>.<ext>`）、Codex 生圖候選圖（`<job>/candidates/`） | 否 |
| 資料目錄 `backups/` | 發布前快照；設定精靈覆寫站台設定檔前的備份（`publish-targets-<時間到毫秒>-<亂數>.json`） | 否 |
| 資料目錄 `.env` | WordPress 連線（手動填或設定精靈寫入，權限 0600） | 否 |
| 資料目錄 `publish-targets.json` | 本機站台設定（發布目標），一次一個站（D-016） | 否 |
| 程式資料夾 `.env.example` | 手動設定與精靈產生 `.env` 的底稿 | 是 |
| 程式資料夾 `config/publish-targets.example.json`、`config/examples/` | 站台設定範例（通用、作者站台）；測試用 `config/examples/remusplus.json`，不讀本機檔 | 是 |
| 程式資料夾 `templates/` | 模板 | 是 |

程式資料夾裡的 `data/`、`drafts/`、`generated-images/`、`backups/`、`.env`、`config/publish-targets.json` 是 P8-T003 之前的舊位置：
搬家後不再讀寫，使用者確認沒問題後自己刪；`.gitignore` 仍保留它們。

## 功能地圖

一列一個使用者看得到的功能：從畫面一路查到測試。2026-10-01 對著程式查證（P0-T002）。
畫面元件在 `src/ui/components/`；路由在 `src/server/routes/`，沒寫檔名的是 `jobs.ts`（前綴 `/api/jobs/:uuid`，表中寫成 `…`）；
後端欄是 `src/core/service/` 底下的檔（P5-T004；`service.ts` 是門面，只轉呼叫）。
測試在 `tests/`，省略 `.test.ts`。示範資料（`?fixtures=1`）的對應實作在 `src/ui/service/fixtures/` 下跟後端欄同名的檔，例外：分類（查詢、建立）在 `fixtures/terms.ts`，
發布目標清單與精靈（含連線測試）在 `fixtures/setup.ts`；假資料本身在 `data.ts`、`store.ts`；
前後端共用規則的單元測試在 `contract-rules`。

| 功能 | 畫面 | API 路由 | 後端 | 規格 | 主要測試 |
| --- | --- | --- | --- | --- | --- |
| 稿件總覽、拖放／⌘V 貼上建稿 | `JobList` | `GET /api/jobs`、`POST /api/jobs`、`GET /api/wordpress`（`wordpress.ts`，類型清單） | `jobs.ts` | core-service、design-system | jobs-api、core-service |
| 新稿件（只問類型與標題，直接進打字模式） | `NewJob`、`lib/write-in-place.ts` | `POST /api/jobs` | `jobs.ts`（`createJob`） | design-system、core-service | write-in-place、disable-targets |
| 在文章上改（含標題、格式工具列、貼上整理） | `ProofView`、`FormatBar`、`Workspace`、`lib/rich-*.ts`、`lib/edit-target.ts`、`lib/proof-edit.ts`、`lib/proof-edit-dom.ts` | `POST …/revisions`（`editedBody`／`editedTitle`、`expectedContentHash`） | `content.ts`（`createRevision`） | design-system、security（貼上、連結） | edited-body、rich-text、rich-format、edit-jump-to-title、expected-content-hash、proof-edit |
| 校樣預覽 | `ProofView`（iframe） | `POST …/render`、`GET …/preview`、`GET …/diff`（標記） | `content.ts` | templates、review-proposals | preview、render |
| 一鍵動作（校驗、只找錯字、一鍵配圖）、停止 | `AgentButton`、`AgentProgress`、`lib/agent-tasks.ts` | `POST …/agent`、`DELETE …/agent` | `agent.ts`（`runAgentReview`） | agent-tasks、agent-cli | agent-output、agent-run-lifecycle、review-schema |
| 校稿提案／待處理（逐項接受、略過、整份採用、丟棄、已經改好了） | `SuggestionColumn` | `GET …/review`、`POST …/review/resolve`、`POST …/review/accept-all`、`DELETE …/review` | `review.ts` | review-proposals | review-proposal、review-apply、text-match |
| 對照（git diff 式，跟上一版或 AI 提案） | `CompareView`、`lib/diff-view.ts` | `GET …/compare` | `review.ts`（`getComparison`） | review-proposals | diff、diff-view、field-diff、word-diff |
| 配圖需求卡片（改描述、不要了） | `panels/MediaPanel`（BriefCard） | `PATCH …/briefs/:id`、`DELETE …/briefs/:id` | `briefs.ts` | agent-tasks | edit-image-brief、keep-edited-brief |
| 用 Codex 生圖、用這張 | `panels/MediaPanel` | `GET /api/image-generation`（`agents.ts`）、`POST …/briefs/:id/generate`、`GET …/candidates/:id`、`POST …/candidates/:id/use` | `images.ts` | agent-tasks、agent-cli | codex-image、image-generation、image-generation-api、image-anchor |
| 在這裡插圖、請 AI 配一張 | `InsertImagePanel`、`ProofView` | `POST …/media`、`POST …/media/:id/place`、`POST …/briefs` | `media.ts`、`images.ts`（`requestImageAtPosition`） | agent-tasks、design-system | image-at-position、image-anchor |
| 媒體（上傳、換圖、移除、放位置、精選圖片） | `panels/MediaPanel` | `POST …/media`、`PUT …/media/:id`、`DELETE …/media/:id`、`POST …/media/:id/place`、`POST …/media/:id/featured`、`DELETE …/featured` | `media.ts` | core-service、agent-tasks | media-upload、media-validate、image-inline-text |
| 標題與網址、建議網址（抽屜與發布面板兩個入口） | `panels/SourcePanel`、`SlugSuggest`（共用）、`PublishSheet`（網址列）、`lib/slug-suggest-store.ts`、`lib/publish-slug.ts` | `POST …/revisions`、`POST …/slug-suggestions` | `content.ts`、`agent.ts`（`suggestSlugs`） | agent-tasks、design-system | slug-suggestion、slug-suggest-store、publish-slug、clear-template-fields |
| 分類 | `panels/TaxonomyPanel`（在發布面板裡） | `POST …/revisions`、`GET`／`POST /api/wordpress/terms`（`wordpress.ts`，不經 CoreService） | `content.ts`；發布時對名稱在 `publish.ts` | wordpress-site、templates | wordpress-terms、clear-template-fields |
| 核准 | `PublishSheet` | `POST …/approve`、`DELETE …/approve` | `approval.ts`（失效的唯一入口 `invalidateApproval`） | state-machine | state-machine、content-hash、core-service |
| 發布（草稿／公開，顯示發到哪裡、網址） | `PublishSheet` | `POST …/publish` | `publish.ts` | state-machine、wordpress-site | publish-path-guards、wordpress-posts、blocks、core-service |
| 作者 | `AuthorPicker`（在發布面板裡） | `GET /api/wordpress/authors`（`wordpress.ts`）、`POST /api/setup/default-author`（`setup.ts`） | `authors.ts` | wordpress-site、state-machine（發布選項） | publish-author |
| 取消、恢復已取消的稿件 | `Workspace` | `DELETE …`、`POST …/restore` | `jobs.ts`（`cancelJob`、`restoreJob`） | state-machine | restore-cancelled |
| 設定精靈、停用類型 | `SetupWizard` | `/api/setup/*`（`setup.ts`） | `setup.ts`（另有 `server/reconfigure.ts`、`config/env-file.ts`、`wordpress/setup.ts`） | wordpress-site、security | setup-api、setup-diagnose、setup-env-file、site-switch、disable-targets、ui-target-toggle |
| AI 查證（選字、觀察卡片、一鍵查證；分段進度、停止；卡片、看原文、知道了、去原文改；發布面板提醒） | `FactcheckCard`、`FactcheckIcon`、`SuggestionColumn`（混排）、`ProofView`（選字膠囊含打字模式先存再查、虛線標記）、`AgentButton`（一鍵查證）、`AgentProgress`（分段進度）、`PublishSheet`、`Workspace`、`lib/factcheck-view.ts`、`lib/check-while-writing.ts`（打字中存了不重載、能不能進打字模式） | `POST`／`GET …/factchecks`、`DELETE …/factchecks/:id`、`DELETE …/agent`、`POST …/revisions`（`resolveFactCheckId`） | `factcheck.ts`（純函式 `src/core/factcheck.ts`、取回器 `src/fetch/`） | factcheck、security、design-system | factcheck-service、factcheck-api、factcheck-verify、factcheck-prompts、factcheck-schema、safe-fetch、factcheck-view、stage-view、agent-progress、check-while-writing |
| 資料目錄、第一次啟動自動搬家（啟動時，沒有畫面） | 終端機訊息 | — | `src/config/paths.ts`、`src/config/user-data.ts`、`server/main.ts`、`db/cli-migrate.ts`；DB 路徑在 `context.ts`（`storedPath`、`localFile`、`mediaFile`、`jobWorkspace`）；migration 010 | architecture（本機資料）、security | user-data-dir、user-data-paths-core、data-dir-hardening、migrate |
| 診斷 | `Diagnostics`（總覽進入） | `GET /api/health`（`health.ts`）、`GET /api/wordpress`（`wordpress.ts`） | 不經 CoreService（`wordpress/site.ts`） | wordpress-site | health、wordpress-api |
