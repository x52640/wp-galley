# 架構與程式慣例

> 擁有範圍：技術選型、模組邊界、依賴方向、跨模組的程式慣例、資料存放。
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
| `src/contract` | 前後端共用的 HTTP 型別，以及兩邊必須同一套規則的純函式（`text-match.ts`、`media-marker.ts`）；**不 import 任何東西** | [http-api.md](http-api.md) |
| `src/config` | 環境變數、路徑、秘密遮蔽、`.env` 改寫（設定精靈） | [security.md](security.md) |
| `src/db` | SQLite 與 migration | 本檔 |
| `src/core` | CoreService、狀態機、revision、diff、提案套用 | [core-service.md](core-service.md)、[state-machine.md](state-machine.md)、[review-proposals.md](review-proposals.md) |
| `src/templates` | 模板 registry、渲染、sanitize、結構驗證 | [templates.md](templates.md) |
| `src/preview` | 校樣 HTML 文件 | [templates.md](templates.md) |
| `src/agents` | CLI 適配器、輸出契約與解析 | [agent-cli.md](agent-cli.md)、[agent-tasks.md](agent-tasks.md) |
| `src/wordpress` | REST client、區塊序列化、分類項目 | [wordpress-site.md](wordpress-site.md) |
| `src/media` | 圖片驗證（`validate.ts`，上傳與生圖候選圖共用）與上傳 | [agent-tasks.md](agent-tasks.md) |
| `src/server` | Fastify、路由、守門；設定換掉後就地生效（`reconfigure.ts`） | [http-api.md](http-api.md)、[security.md](security.md) |
| `src/ui` | React 發布台 | [design-system.md](design-system.md) |
| `src/mcp` | 空（MCP 尚未實作） | [mcp.md](mcp.md) |

## 依賴方向

`server → preview → templates → core → contract`，`ui → contract`。

- `db/templates/core/preview` 全部不得 import Fastify 或 HTTP。
- `src/contract` 不得 import 任何模組（`tests/contract.test.ts` 守著），否則會把後端
  拖進瀏覽器 bundle。`ui` 只能從 `contract` 拿後端的型別，不得 import `src/core`。
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
- Agent 各家怪癖的放置規則見 [agent-cli.md](agent-cli.md)。

## 本機資料

| 位置 | 內容 | 進 Git |
| --- | --- | --- |
| `data/` | SQLite | 否 |
| `drafts/` | 原稿與測試素材 | 否 |
| `generated-images/` | 本機圖片：上傳過的副本（`<job>/<sha256>.<ext>`）、Codex 生圖候選圖（`<job>/candidates/`） | 否 |
| `backups/` | 發布前快照；設定精靈覆寫站台設定檔前的備份（`publish-targets-<時間到毫秒>-<亂數>.json`） | 否 |
| `.env` | WordPress 連線（手動填或設定精靈寫入，權限 0600） | 否 |
| `config/publish-targets.json` | 本機站台設定（發布目標），一次一個站（D-016） | 否 |
| `config/publish-targets.example.json`、`config/examples/` | 站台設定範例（通用、作者站台）；測試用 `config/examples/remusplus.json`，不讀本機檔 | 是 |
| `templates/` | 模板 | 是 |
