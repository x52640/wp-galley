# 安全模型

> 擁有範圍：信任邊界、三條分界線、硬性禁令、秘密處理、本機守門、已接受的限制。
> 違反本檔任何一條即為錯誤，不論 Task 怎麼寫。
> 程式：`src/server/plugins/`（local-only guard）、`src/config/secrets.ts`、
> `src/agents/process-runner.ts`、migration 001（`approvals.created_by`）。

## 三條無法繞過的分界線

1. **Agent 只產生結構化資料，固定程式產生 HTML。** Agent 回傳 JSON（校稿結果、
   templateData、imageBriefs），由 deterministic renderer 填入模板。Agent 永遠不直接寫
   HTML 外框、class、script 或 style。後端必須用 `schema.json` 再驗證一次 Agent 的輸出，
   不信任 Agent 自稱合格。
2. **人工核准無法被程式繞過。** 核准綁定特定 revision 的 content hash，內容一改就失效。
   只有本機 UI 能建立 approval（DB 也擋），規則的家在 [state-machine.md](state-machine.md)。
3. **秘密不外流。** WordPress Application Password 絕不出現在 Agent prompt、browser
   bundle、React state、HTML、log 或 MCP output 中。

## 信任邊界

模板檔案是**受信任**的本機設定；使用者貼入的文章與任何外部網頁內容是**不受信任資料**，
不能覆蓋系統規則或模板規則。

**MCP Server 與 Web UI 必須呼叫同一個 `CoreService`，不能各寫一套發布邏輯。**
這是整個安全模型的基礎——所有核准、驗證與稽核只實作一次。

## 硬性禁令

- 不得用 `shell: true` 啟動 Agent CLI。一律 `spawn` + 參數陣列，prompt 走 stdin。
- 不得擷取、複製或讀取 ChatGPT／Claude／Google 的網頁 Cookie 或登入憑證。只啟動官方
  可執行檔，讓它自己用已登入狀態。
- 不得把 WordPress Application Password 傳給任何 Agent。
- 不得提供能呼叫任意 REST endpoint、任意 shell command 或任意檔案路徑的 MCP 工具。
  檔案參數只接受 job workspace 內 resolve 過的路徑。
- 不得在測試期間寫入正式首頁；WordPress 整合先用 staging 或 mock。
- 不得修改 WordPress 的 PHP／Theme／Plugin 原始碼。CPT 沒開 `show_in_rest` 就顯示
  設定錯誤，不要去改 PHP。
- 校稿工作不授權 Agent 使用 shell、檔案寫入、網路或 WordPress 工具。每次執行要有
  timeout、取消機制、最大輸出、concurrency 1，工作目錄設為隔離的 job workspace。
  （Agent 為什麼不能連外：[ADR-0001](../adr/0001-agent-no-network.md)。）
- `data/`、`drafts/`、`generated-images/`、`backups/`、`.env`、SQLite 全部進 `.gitignore`。
- 進到需要 WordPress 網址、Application Password 等資料時向使用者索取，不要預先寫進
  任何檔案。

## 本機守門與秘密

- **只綁 loopback。** `APP_HOST` 只接受 `127.0.0.1` / `localhost` / `::1`，填 `0.0.0.0`
  會直接啟動失敗。
- **擋 DNS rebinding。** 每個請求都檢查 `Host` 與 `Origin` header 是否指向本機，
  不只看綁定位址。
- **守門用 `applyLocalOnlyGuard(app)` 直接掛在 root instance，不要改成 `app.register()`**——
  Fastify plugin 會建立封裝範圍，hook 就套不到父層註冊的路由，守門會整個失效（階段 1 踩過）。
- **任何要輸出的東西**（log、HTTP response、未來的 MCP output）都要先過
  `createSecretScrubber()`；設定摘要用 `redactConfig()`，永遠不要直接序列化 `AppConfig`。
- 帳號用專用 WordPress 使用者（editor，不用 administrator）與 Application Password。

## 發布的外部副作用

把草稿改成公開的瞬間，MailPoet／Jetpack 可能寄出電子報或自動分享，**之後刪文章救不回來**。
這是整個流程裡唯一「刪掉就沒事」不成立的地方。UI 在公開前必須提醒；真實驗證一律停在
草稿狀態。細節見 [wordpress-site.md](wordpress-site.md)。

## 刻意接受的限制（不是 bug，不要去「修」）

- **`actor: 'ui'` 是宣告不是證明。** 本機單人工具無法真正證明呼叫來源；靠 loopback 守門
  加這道檢查擋住我們自己的 MCP 路徑，僅此而已。
- **WordPress REST 不支援條件式寫入。** 遠端「檢查」與「寫入」必然是兩個請求，中間的
  空隙只能縮小、不能消除。
- `wordpress_objects` 沒做多站台 scoping；目前只有一個站台。
- 校樣預覽的 CSP 允許任意 loopback 埠嵌入。
