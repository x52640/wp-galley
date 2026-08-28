# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 目前狀態

**階段 1–5／7 已完成。下一步是階段 5.5（小）或階段 6（大）。**

| 階段 | 內容 | 狀態 |
| --- | --- | --- |
| 1 | 安全本機骨架 | ✅ |
| 2 | 模板 registry 與決定性渲染器 | ✅ |
| 3 | 訂閱式 Agent 適配器 | ✅ 三家實測端到端通過 |
| 4 | WordPress REST 與媒體流程 | ✅ 正式站實測建立過兩篇草稿 |
| 5 | 發布台端到端 UI | ✅ 436 個測試，Codex review 後已修 |
| 5.5 | observations、左右對照檢視 | ⬜ 小，接著做 |
| 6 | AI 查證（需連外，動到信任邊界） | ⬜ 大，獨立做 |
| 7 | 測試、文件與交付 | ⬜ |

已實作：`src/config` `src/db` `src/server` `src/templates` `src/preview`
`src/core` `src/agents` `src/wordpress` `src/media` `src/ui`。
還是空目錄：`src/mcp`（階段 6 之後）。

### 一定要先讀的文件

| 檔案 | 內容 |
| --- | --- |
| `docs/SITE-FINDINGS.md` | 站台實況。**與 IMPLEMENTATION_PLAN.md 衝突時以此為準** |
| `docs/STAGE-5-CONTRACT.md` | 前後端共用契約 + 設計系統。改 UI 前必讀第五節 |
| `docs/STAGE-6-FACTCHECK.md` | 5.5 與 6 的規格，含為什麼 Agent 不能握有連外能力 |
| `docs/AGENT-CLI-PROBE.md` | 三個 CLI 的實際參數與踩過的坑 |

`IMPLEMENTATION_PLAN.md`（繁中）是原始計畫，**已有多處被實測推翻**。

### 這個專案的定位

**本機 AI 當編輯，使用者當總編。** Agent 進不了 WordPress 是賣點不是限制——
市面上每個 AI 外掛都在講「裝上去、給權限、它幫你寫」，這個專案是反過來的。
寫對外文案時不要為了好聽把這點丟掉。

設計準則：**任何會讓使用者離開發布台的功能都算 bug。**

### 接手時要知道的已知限制

這些是刻意接受的，不要當成 bug 去「修」：

- **`actor: 'ui'` 是宣告不是證明。** 本機單人工具無法真正證明呼叫來源；靠 loopback
  守門加這道檢查擋住我們自己的 MCP 路徑，僅此而已。
- **WordPress REST 不支援條件式寫入。** 遠端「檢查」與「寫入」必然是兩個請求，
  中間的空隙只能縮小、不能消除。
- **沒有「修改已發布文章」的路徑。** `PUBLISHED` 之後只能到 `SUPERSEDED`，
  發出去才發現錯字只能去 WordPress 後台改。要不要補由使用者決定。
- `wordpress_objects` 沒做多站台 scoping；目前只有一個站台。
- 校樣預覽的 CSP 允許任意 loopback 埠嵌入。

### ⚠️ 發布會觸發無法回收的動作

站台裝了 MailPoet 與 Jetpack。**把草稿改成公開的瞬間可能寄出電子報或自動分享，
之後刪文章救不回來。** 這是整個流程裡唯一「刪掉就沒事」不成立的地方。
階段 4 的真實驗證因此全部停在草稿狀態。

### 還沒決定的事

**要接哪一家圖片生成 API。** 接口留著，使用者找到後會把金鑰貼進 `.env`。
三個 CLI 都不能生圖（用它們自己的 `--help` 確認過，`codex -i/--image` 是把圖片
當**輸入**附加，不是產出）。

## 指令

```bash
npm run dev        # 後端 127.0.0.1:3000 + Vite UI 127.0.0.1:5173
npm test           # Vitest 全部
npx vitest run tests/health.test.ts   # 單一檔案
npx vitest run -t "遮蔽"               # 依名稱篩選
npm run typecheck  # tsc --noEmit
npm run migrate    # 套用 SQLite migration
npm run build && npm start            # 正式啟動
```

## 技術選型

Node ≥22.5 + TypeScript（ESM、`verbatimModuleSyntax`，import 要寫 `.js` 副檔名）、Fastify 5、React 19 + Vite 8、Zod 4、Vitest 4。

SQLite 用 **Node 內建的 `node:sqlite`**（`DatabaseSync`），不是 better-sqlite3——免原生編譯。API 是同步的：`db.prepare(...).run()/get()/all()`，`.all()` 回傳 `Record<string, SQLOutputValue>[]`，要轉型得先過 `as unknown as`。

已安裝：Nunjucks、`sanitize-html`、`parse5`。diff 是自己寫的（`src/core/diff.ts`，LCS，未加依賴）。

尚未安裝：官方 TypeScript MCP SDK、Playwright。UI 沒有用任何元件庫，圖示是手抄的 Lucide SVG。

## 既有程式碼的關鍵約定

- **守門用 `applyLocalOnlyGuard(app)` 直接掛在 root instance，不要改成 `app.register()`**——Fastify plugin 會建立封裝範圍，hook 就套不到父層註冊的路由，守門會整個失效（階段 1 踩過）。
- 新增 API 錯誤一律 `throw new AppError(code, message, status)`，回應格式固定是 `{ error: { code, message, details?, requestId } }`；5xx 對外只給通用訊息。
- 任何要輸出的東西（log、HTTP response、未來的 MCP output）都要先過 `createSecretScrubber()`；設定摘要用 `redactConfig()`，永遠不要直接序列化 `AppConfig`。
- migration 只能往 `src/db/migrations/` 加新檔並註冊到 `index.ts`；改動已套用的 migration 會因 checksum 不符而啟動失敗。
- **Agent 的各家怪癖只准寫在 `src/agents/adapters/<該家>.ts` 裡**，不要滲進 `process-runner`、`output-parser` 或 `output-contract`。要在驗證前修正輸出就用 `parseAndValidate` 的 `transform` 參數。
- 送給 CLI 的 schema 可以為相容性放寬，但**後端一定要用原始 schema 再驗一次**。放寬的只是給模型端的提示，不是驗證標準。
- 依賴方向是 `server → preview → templates → core`，`db/templates/core/preview` 全部不得 import Fastify 或 HTTP。改動前先跑一次依賴檢查。

## 測試守則

- 測試**絕不呼叫真實 Agent CLI**（會消耗使用者訂閱額度）。一律用 `tests/helpers/fake-adapter.ts`。
- 真實 CLI 只在每階段收尾時手動驗收一次，腳本放 scratchpad 不進 repo。
- 每階段除了單元測試，都要拿**真實資料**實跑一次（45 篇文章、真實 CLI）——階段 2 就是這樣抓到「h2 沒人用」是錯的結論。

## 架構要點

系統是一條**單向的內容管線**，兩個入口共用同一個核心：

```
本機瀏覽器 → Fastify → CoreService ┐
外部 Agent → MCP Server (stdio) ───┘→ Agent Adapter / Template Engine / WP REST Client / SQLite
```

**MCP Server 與 Web UI 必須呼叫同一個 `CoreService`，不能各寫一套發布邏輯。** 這是整個安全模型的基礎——所有核准、驗證與稽核只實作一次。

三條無法繞過的分界線：

1. **Agent 只產生結構化資料，固定程式產生 HTML。** Agent 回傳 JSON（校稿結果、templateData、imageBriefs），由 deterministic renderer 填入模板。Agent 永遠不直接寫 HTML 外框、class、script 或 style。後端必須用 `schema.json` 再驗證一次 Agent 的輸出，不信任 Agent 自稱合格。
2. **人工核准無法被程式繞過。** 狀態機 `SOURCE → REVIEWED → MEDIA_READY → RENDERED → PREVIEWED → APPROVED → PUBLISHING → PUBLISHED`。每次修改建立不可變 revision 並以 canonical content 算 hash；approval record 綁定特定 revision hash，內容一改就立刻失效並退回 `RENDERED`／`PREVIEWED`。MCP client 不得建立、修改或猜測 approval record，只有本機 UI 能建立。
3. **秘密不外流。** WordPress Application Password 絕不出現在 Agent prompt、browser bundle、React state、HTML、log 或 MCP output 中。

### 內容類型的自由度不同（不能共用一套處理）

| 類型 | 模式 | Agent 可以動的範圍 |
|---|---|---|
| 首頁 homepage | strict | 只有 schema 欄位；對應固定 Page ID，不建新頁 |
| 長文 longform | hybrid | 只有正文 slot 內的 h2/h3、段落、清單、引用、圖片位置 |
| 日記 diary | flexible | 較自由的正文 HTML，仍過 sanitize |

模板放在 `templates/<template-id>/`，含 `manifest.json`、`template.html`、`schema.json`、`rules.md`、`preview.css`。模板保存 version 與 SHA-256 hash，每個 revision 記錄用了哪個模板版本與 hash，讓舊版本可重現。

**首頁保護**（最容易出事的地方）：發布前必須重讀遠端內容並比對上次載入的 hash／ETag／modified time，遠端有變就中止並要求重新核准；發布請求只送允許變更的欄位；絕不為了預覽把正式首頁改成 draft（會讓首頁下線）；發布前存完整快照。

### 信任邊界

模板檔案是**受信任**的本機設定；使用者貼入的文章與任何外部網頁內容是**不受信任資料**，不能覆蓋系統規則或模板規則。

## 硬性禁令（來自計畫第 14 節，違反即為錯誤）

- 不得用 `shell: true` 啟動 Agent CLI。一律 `spawn` + 參數陣列，prompt 走 stdin。
- 不得擷取、複製或讀取 ChatGPT／Claude／Google 的網頁 Cookie 或登入憑證。只啟動官方可執行檔，讓它自己用已登入狀態。
- 不得把 WordPress Application Password 傳給任何 Agent。
- 不得提供能呼叫任意 REST endpoint、任意 shell command 或任意檔案路徑的 MCP 工具。檔案參數只接受 job workspace 內 resolve 過的路徑。
- 不得在測試期間寫入正式首頁；WordPress 整合先用 staging 或 mock。
- 不得修改 WordPress 的 PHP／Theme／Plugin 原始碼。CPT 沒開 `show_in_rest` 就顯示設定錯誤，不要去改 PHP。
- 校稿工作不授權 Agent 使用 shell、檔案寫入、網路或 WordPress 工具。每次執行要有 timeout、取消機制、最大輸出、concurrency 1，工作目錄設為隔離的 job workspace。
- `data/`、`drafts/`、`generated-images/`、`backups/`、`.env`、SQLite 全部進 `.gitignore`。

## 工作方式

計畫第 12 節把工作切成七個階段（骨架 → 模板 renderer → Agent adapter → WordPress REST → UI 端到端 → MCP → 測試文件）。**一次只做一個階段**，每階段先寫或更新測試再實作，完成後回報改了哪些檔案、測試結果、發現的環境差異、以及進下一階段前需要使用者確認什麼。不要一口氣生成全部程式。

CLI 參數會變：計畫裡寫的 `codex` / `claude` / `agy` 參數不是永久的，實作 adapter 前先跑本機安裝版的 `--help` 做 capability detection，無法穩定輸出 JSON 的標成 `experimental`。發現本機 CLI 與計畫假設不同時，記錄差異並調整 adapter，不要繞過官方登入。

進到需要 WordPress 網址、Application Password、首頁 Page ID、post type／分類等資料的階段時，向使用者索取（計畫第 16 節有清單），不要預先寫進任何檔案。
