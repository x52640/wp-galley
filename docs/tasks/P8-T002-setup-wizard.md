---
id: P8-T002
phase: 8
status: done
depends_on: [P8-T001]
specs: [security.md, wordpress-site.md, agent-cli.md, http-api.md, design-system.md]
write_paths: ["docs/images/", "src/config/", "src/wordpress/", "src/agents/", "src/server/", "src/core/", "src/contract/api.ts", "src/ui/", "tests/", "docs/specs/", "docs/tasks/", "docs/CURRENT_TASK.md", "README.md", ".env.example", "config/publish-targets.example.json"]
contract_change: additive
expected_commit: "feat(P8-T002): 首次設定精靈"
---

# 首次設定精靈

## 目標
D-016：別人裝好之後第一眼看到的畫面。README 只能叫人改設定檔；精靈可以**當場測試並說出卡在哪裡**。

## 範圍
### 包含
四步，每步失敗都要講出原因並附下一步該做什麼（D-008：不讓使用者猜）：

| 步驟 | 內容 | 要能分辨的失敗 |
| --- | --- | --- |
| 1 連線 WordPress | 網址、帳號、應用程式密碼 → 測試連線 | 不是 HTTPS、REST API 被擋（安全外掛／主機商）、帳密錯、權限不夠發文 |
| 2 選 Agent | 偵測 Codex／Claude Code／agy 有沒有裝、有沒有登入；講清楚只有 Codex 能生圖（D-017） | 沒裝附安裝指令、沒登入附登入指令（使用者自己在終端機執行） |
| 3 發到哪裡 | 文章或頁面，寫入 P8-T001 的本機站台設定檔（`config/publish-targets.json`，格式照 `config/publish-targets.example.json`；post 的分類要帶 `taxonomyRestBase`，照連線診斷從 `/wp/v2/taxonomies` 讀到的 rest_base） | 站上沒開放這個類型的 REST |
| 4 完成 | 進稿件總覽；設定頁可重跑精靈 | — |

- 沒有設定時自動進精靈；已有設定時不打擾。
- README：安裝、啟動、精靈截圖、「應用程式密碼怎麼申請」。

### 不包含
- API Key、CPT（D-016）
- 多站台切換
- 自動幫使用者安裝或登入 CLI

## 工作區與 Context
### 必讀入口
`docs/specs/security.md`（秘密的規則）、`src/config/env.ts`、`src/wordpress/client.ts`、
`src/agents/` 的偵測邏輯
### 不應載入
`docs/archive/`、校稿與配圖相關 spec
### 驗證命令
`npm run verify`

## 實作要求
- **動工前先更新 security.md**：密碼由精靈寫入時存在哪裡。建議沿用 `.env`（已進
  `.gitignore`），檔案權限 0600；要換別的做法先回報。
- 密碼只從前端送到本機後端一次，之後任何 API 回應、log、錯誤訊息都不得帶回（遮蔽器要涵蓋）。
- 測試連線只做讀取（`/wp-json/`、`/users/me`），**不建立任何文章**。
- 連線診斷用 fixture 模擬各種失敗；測試不連真實 WordPress、不呼叫真實 Agent CLI。

## 驗證
### 自動驗證
每一種失敗都有對應測試，訊息是中文、講得出下一步。
### 手動驗證
用作者本人的站跑一次完整精靈；故意填錯密碼、填 http 網址各一次。

## 完成定義
- [x] `npm run verify` 綠（49 檔／808 測試）
- [x] security.md、http-api.md、design-system.md 已更新（另更新 wordpress-site.md、agent-cli.md、architecture.md、templates.md）
- [x] README 能讓陌生人從零跑起來（附三張精靈截圖，`docs/images/`）
- [x] CURRENT_TASK 已更新

## 中斷／接手紀錄
- 最後完成：安全審查的十項修正＋README 截圖（2026-09-24，subagent）
- 已通過驗證：`npm run verify` 50 檔／835 測試；示範資料模式無頭截圖（含換站警告）；dev server 經 Vite proxy 的同源 POST 實測通過、跨埠 403
- 下一步：使用者用自己的站跑一次完整精靈（故意填錯密碼、填 http 網址各一次）
- Blocker：無
- Blocker：無

## 完成結果
2026-09-24（subagent）。

**做了什麼**
- 後端：`src/wordpress/setup.ts`（連線診斷、目的地、合併與寫站台設定檔）、`src/config/env-file.ts`（改寫 `.env`）、
  `src/server/routes/setup.ts`（六條路由）、`src/server/reconfigure.ts`（就地套用）、`CoreService.reconfigure()`、
  `createMutableScrubber`、`src/agents/setup-hints.ts`。契約在 `src/contract/api.ts` 最後一段（純新增）。
- 前端：`SetupWizard.tsx`、`#/setup` 路由、沒設定時自動進來、稿件總覽右上角齒輪、診斷頁「重跑設定精靈」、
  示範資料的每一種失敗。
- 全域守門多擋一種：會改東西的請求帶 `Origin: null` 或非同源的 `Sec-Fetch-Site`（原本沙箱 iframe 可以發無 body 的 POST）。

**決定（Claude 提案，可推翻）**
- 密碼存 `.env`（0600，只換三行、其他行保留，檔不在以 `.env.example` 為底，不備份 `.env`）。
- 「只送一次」做成 testId：測試通過後憑證留在後端記憶體 10 分鐘，儲存只送 testId。
- 已有站台設定檔：原樣保留、只加 post／page；同 key 要明確勾「取代」，否則 409；覆寫前備份到 `backups/`。
- http 只准 loopback；應用程式密碼格式（24 英數字）在前端送出後、連線前就擋。
- 全部就地生效，不需要重新啟動。

**安全審查後的修正（同日，coordinator 轉達；write_paths 追加 `docs/images/`）**
1. 全域遮蔽器只收去掉空白後是 24 個英數字的值（格式不對的多半是貼錯欄位的網址，不能讓它永遠變成 [REDACTED]）。
2. 換站：發布只認目前連的站上的那篇；發到過別站的稿件擋下並講清楚；舊站的圖不能當封面、不能放進正文、
   發布前會擋。用既有的 `wordpress_objects.site_id`，**不用新 migration**。精靈測到另一個站而舊站上有東西時帶
   `siteChange`，畫面警告、要勾確認，後端要 `confirmSiteChange: true`。
3. CoreService 加「換設定中」旗子與「正在跟 WordPress 講話」計數：有發布或上傳在跑就不准存；存的期間
   發布、上傳、換圖、放圖、設封面一律拒絕；`reconfigure()` 本身再檢查一次。
4. 回應本體的逾時涵蓋到讀完，`/wp-json/` 上限 8 MB、`WordPressClient` 32 MB。
5. 寫壞的 `Location` 當成「會轉址、不知道去哪」，不再 500。
6. 備份檔名到毫秒＋亂數，`COPYFILE_EXCL`。
7. CSRF 測試改用假站台自己的網址；新增 pino 輸出全收、確認沒有密碼的測試。
8. 修改請求有 Origin 時要跟 Host 同源（其他本機埠擋掉）；Vite proxy 不改 Host，所以不用例外。
9. 會打真站、會跑 CLI 的讀取改成 POST＋JSON（`/api/setup/destinations/check`、`/api/setup/agents`）；
   `GET /api/agents` 拿掉 `?refresh=1`。
10. security.md：`.env` 值的引號規則照實寫、符號連結會被換成一般檔、shell 環境變數優先。

**沒做的／殘餘**
- 手動驗證（作者的站）沒跑：規則禁止 subagent 連真實站台。
- Antigravity 的安裝／登入指令未查證（agent-cli.md「設定精靈給的指令」）。
- 精靈不會刪換站之後留下的舊 target；使用者 shell 裡 export 的 `WORDPRESS_*` 會在下次啟動蓋掉 `.env`（wordpress-site.md 有寫）。
- 作者現在的 `.env` 是 0644；跑一次精靈會變 0600。
