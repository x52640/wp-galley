---
id: P5-T052
phase: 5
status: done
depends_on: []
specs: [wordpress-site.md, http-api.md, security.md, state-machine.md, core-service.md, design-system.md, architecture.md]
write_paths: ["src/server/", "src/core/", "src/wordpress/", "src/contract/", "src/ui/", "tests/", "docs/specs/wordpress-site.md", "docs/specs/http-api.md", "docs/specs/security.md", "docs/specs/state-machine.md", "docs/specs/core-service.md", "docs/specs/design-system.md", "docs/specs/architecture.md", "docs/known-issues.md", "docs/tasks/P5-T052-schedule-publish.md", "docs/CURRENT_TASK.md"]
contract_change: additive
expected_commit: "feat(P5-T052): 發布面板可排程發布、可取消排程"
---

# 排程發布

## 目標
D-051。使用者 2026-10-30：發布只有「存成草稿」「馬上公開」，想選一個時間讓它自己發。

WordPress 原生支援：REST 送 `status: 'future'`＋未來的 `date_gmt`，時間到由 WordPress（wp-cron）自己改成公開，發布台不必開著。
代價跟「馬上公開」一樣收不回來（到時一樣寄電子報、自動分享，security.md「發布的外部副作用」），只是延後；
而且 wp-cron 要有人逛網站才觸發，流量低時可能晚發，極端會「錯過排程」——要在 UI 講明，不另外處理。

排程後想改：現在遠端不是草稿就拒絕更新（`nonDraftUpdateMessage`，Q-5）。取消排程需要發布台內的入口，
所以發布台要能「取消排程」（`future` → `draft`，這一步只會讓內容更不公開）。排程中**不能**直接改內容：發布台可先取消排程，目前內容編輯仍須到 WordPress 後台（既有缺口，待另外裁定）。

## 範圍
### 包含
- **契約**：`PublishStatus` 加 `'future'`（或等價設計），`PublishRequest` 加排程時間（ISO 8601 UTC 字串）。前後端共用的檢查（是不是未來、至少晚現在 5 分鐘）寫成 `src/contract` 純函式（D-033 規矩）。
- **WordPress 層**（`src/wordpress/posts.ts`）：排程跟 `setStatus('publish')` 一樣是獨立、一眼數得出來的寫入（送 `status: 'future'`＋`date_gmt`），寫入前 `assertUnchanged`＋`beforeWrite`。WordPress 回來的狀態若不是 `future`（例如時間已過被直接公開）要如實回報，不假裝排程成功。
- **CoreService 發布路徑**（`src/core/service/publish.ts`）：選排程時，先照舊寫成草稿，再改成排程（同「公開」那段，核准被撤銷就停在草稿）。後端前置檢查再驗時間：缺時間、格式錯、過去或 5 分鐘內一律拒絕、零寫入；開始發布後，每次寫入前保留至少 1 分鐘，容許網路等待。事件記錄帶排程時間。
- **取消排程**：新的本機 UI 路由（照既有來源／CSRF 防護，寫測試）＋ CoreService 方法：確認這篇對應的遠端文章目前是 `future`、遠端沒被別人改過（沿用 `assertUnchanged` 那套快照比對），送 `status: 'draft'`；更新本機 `wordpress_objects` 的狀態與快照。不需要核准（只降低曝光）。遠端已經不是 `future`（已經公開、被後台改過）就拒絕並講清楚現況。
  - ⚠️ **取消後的日期**：WordPress 的草稿若留著排程時填的日期，之後「馬上公開」會被 WordPress 自動轉成排程（日期仍在未來）或變成回溯日期（日期已過）。取消時要把日期重設成「浮動」（REST 送 `date_gmt: null`／`date: null` 的行為**請先查 WordPress 核心 `class-wp-rest-posts-controller.php` 的實際處理**，查不到就在 Task 寫明假設並列入手動驗證）。另外：發布路徑選「馬上公開」時，若 WordPress 回來的狀態是 `future`，要如實講出來，不能說成已公開。
  - 取消之後，原 job 維持 PUBLISHED；目前要改內容必須到 WordPress 後台。發布台內沒有接續編輯同一篇草稿的入口（既有缺口，待另外裁定），本 Task 不改狀態機、不新增此流程。
- **錯誤訊息**：`nonDraftUpdateMessage` 遇到 `future` 時改講「這篇已排程，要改先按『取消排程』」。
- **UI**（`PublishSheet.tsx` 等）：
  - 「存成草稿」「馬上公開」旁加第三個「排程發布」。選了出現日期時間選擇（瀏覽器原生 `datetime-local` 即可），用這台電腦的時區，旁邊寫出時區名稱；預設值給一個合理的未來時間（例如明天早上 8:00），不要空白要求先打字（memory：常做的事一鍵）。
  - 跟「馬上公開」同樣顯示警告並要勾「我知道」才能按；警告多一句「時間到才發，網站流量少時可能晚一點」。
  - 時間是過去或 5 分鐘內，按鈕反灰並講原因（`p-why`）。
  - 按鈕文字「（核准並）排程在 M月D日 HH:mm 發布」；跟本機目前年份不同時加年份，所有排程時間顯示共用此規則。
  - 發布完成畫面：狀態是排程時寫「已排程，會在 …（本機時間）公開」，並有「取消排程」按鈕；取消成功改顯示草稿；原排程已過或剩不到 2 分鐘，即使回草稿也提示可能已公開、電子報／分享可能已送出，請到網站確認。失敗講原因，後續重讀錯誤不可蓋掉取消的原因。
  - 其他顯示發布狀態的地方（稿件清單、已發布資訊）看到 `future` 要寫「已排程」＋時間，不要顯示英文 `future`。
- fixtures（`?fixtures=1`）跟著支援排程與取消，方便截圖。
- spec：wordpress-site.md（狀態、外部副作用、只更新草稿那段）、security.md（外部副作用加「排程」）、http-api.md（publish 欄位、取消排程路由）、state-machine.md／core-service.md（若前置檢查或方法清單有變）、design-system.md（發布面板）、architecture.md 功能地圖；known-issues（可能晚發、錯過排程）。

### 不包含
- 重複排程、批次排程、日曆檢視。
- 排程中直接改內容或改時間；取消後在發布台內接續編輯（目前要到 WordPress 後台改，待另外裁定）。
- MCP 排程（MCP 本來就沒有發布）。
- 發布台自己計時發布（一律交給 WordPress）。
- 偵測「錯過排程」並補發。

## 工作區與 Context
### 必讀入口
`src/core/service/publish.ts`（`publish` 與 `preflightPublish`）、`src/wordpress/posts.ts`（`setStatus`、`nonDraftUpdateMessage`、`updateDraft`）、`src/contract/api-enums.ts`、`src/contract/api-requests.ts`（`PublishRequest`）、`src/server/routes/jobs.ts`（約 865 行 publish 路由）、`src/ui/components/PublishSheet.tsx`、`src/ui/service/fixtures/publish.ts`、`docs/specs/wordpress-site.md` 約 80～90 行與文末外部副作用。
### 不應載入
agent、factcheck、templates spec。
### 驗證命令
`npm run verify`；`node scripts/ui-drive.mjs` 搭 `?fixtures=1` 截圖（選排程、時間太近被擋、勾我知道、排程完成畫面、取消排程後）。

## 實作要求
- 先寫測試：契約時間檢查（過去、4 分鐘後、6 分鐘後、格式錯）；發布路徑排程成功送出的請求 body（先草稿再 `future`＋`date_gmt`）；後端拒絕過去時間零寫入；核准中途撤銷停在草稿；WordPress 回非 `future` 時如實回報；取消排程（成功、遠端已公開拒絕、遠端被改過拒絕、送出的日期重設）；路由來源防護；`nonDraftUpdateMessage('future')` 新文案。
- 測試絕不呼叫真實 Agent CLI、絕不連真實 WordPress（用既有的假 client）。不啟動或重啟 dev server、不碰 `~/Library/Application Support/Galley/`。不 commit。
- 需要 migration 的話先停下回報（預期不需要：`wordpress_objects.status` 是字串）。
- 文字一律繁體中文、白話。

## 驗證
### 自動驗證
`npm run verify` 綠。
### 手動驗證（使用者）
發布面板選「排程發布」→ 時間改成 2099 年某天 → 勾我知道 → 核准並排程 → 完成畫面寫已排程與時間 → 後台看到「已排程」→ 回發布台按「取消排程」→ 後台變草稿、日期不再是 2099。（**不要排近的時間**：時間到真的會公開。）

## 完成定義
- [x] `npm run verify` 綠
- [x] 擁有這些行為的 spec 已更新（architecture.md 功能地圖）
- [x] 留下的殘餘已寫進 `docs/known-issues.md`
- [x] CURRENT_TASK 已更新

## 中斷／接手紀錄
- 最後完成：實作＋獨立審查一輪（2 中 3 低，L2 時鐘差記 known-issues，其餘已修）（2026-10-30）
- 已通過驗證：主 session 在可開 loopback 的環境跑 `npm run verify`：111 檔／2597 測試全綠；`?fixtures=1` 截圖（選排程、5 分鐘內被擋、勾我知道、跨年顯示年份、已排程完成畫面、取消排程回草稿）
- 下一步：PR、Codex 審查；使用者手動驗證
- Blocker：無。取消後改內容要到 WordPress 後台：既有缺口（存草稿也一樣），使用者 2026-10-30 同意先合併、另開 Task（Q-5）

## 完成結果

Codex 實作（沙盒不能 listen 127.0.0.1，完整 verify 與截圖由主 session 補跑，見上）。

- 排程：共用 UTC／五分鐘門檻驗證；先草稿再獨立寫入 `future`＋`date_gmt`；前置要求超過五分鐘，每次寫入前重驗核准與至少一分鐘餘裕，事件記錄排程時間。
- 取消：本機 UI 路由沿用來源／CSRF 防護，確認目前站台、遠端仍為排程且快照未變，送草稿並清日期；不需核准，更新本機狀態／快照，異常回應不謊報成功。job 維持 PUBLISHED，沒有 migration。
- UI：三種發布方式、明天早上八點預設、本機時區、時間太近反灰與原因、我知道、實際回應狀態與時間、完成畫面取消鈕；重新打開稿件也能查看／取消排程。fixtures 同步支援。
- **日期重設依據與驗證程度**：2026-10-30 讀取 [WordPress 7.1 核心 `prepare_item_for_database`](https://github.com/WordPress/wordpress-develop/blob/7.1/src/wp-includes/rest-api/endpoints/class-wp-rest-posts-controller.php#L1276-L1286)，明確傳入 `date` 或 `date_gmt: null` 會清除兩個日期欄位。本次送兩者 null。已由核心原始碼確認處理分支、由假 client 測試確認請求 body；**未連任何真站、未以 PHP 執行核心、未驗證作者站台外掛行為**。REST 可能為浮動草稿補出顯示日期，不以回傳 null 判定成功；後台日期與之後馬上公開是否不再排程仍待使用者手動驗證。
- **既有缺口**：取消後原 job 保留 PUBLISHED，目前要改內容必須到 WordPress 後台。發布台沒有接續編輯同一篇草稿的入口，待另外裁定；本次沒有改狀態機。

驗證紀錄：

- 測試先行：新增契約、發布／撤銷／異常回應、取消／遠端衝突／清日期與路由來源測試後才實作；第一次因新模組尚未存在與 loopback 禁令失敗；補充的異常取消測試先紅，再修到綠。
- `npm run typecheck`：通過。
- `npx vitest run --configLoader native --no-cache tests/schedule-publish.test.ts tests/schedule-view.test.ts tests/jobs-api.test.ts tests/docs-governance.test.ts -t '排程|docs-governance'`：**4 檔／60 項通過，32 項未選取**（其中新增排程相關 44 項＋既有文件治理 16 項）。新測試用既有 `defaultWordPressHandler`，經 WordPressClient 的 `fetchImpl` 注入，不開 socket，HTTP 整合測試的原本傳輸模式沒有更動。
- `npm run verify -- -- --configLoader native --no-cache`：typecheck 通過；當次收集 **110 檔／2577 項**，**66 檔／1797 項通過、44 檔／780 項失敗，760 個 listen EPERM 衍生錯誤**，耗時 498 秒。假站台與服務測試無法 `listen(127.0.0.1)`；另有既有 `launcher-app.test.ts` 產生 app 的 AppleScript 編譯錯誤（`Expected end of line but found identifier (-2741)`），未歸因為排程改動、未修改範圍外的 launcher 腳本；沒有放寬、跳過全套測試或改成假綠。當次收集後才加的 schedule-view 7 項另在上述定向驗證通過；最後 `vitest list` 為 **111 檔／2584 項**。扣新增 44 項，現有測試收集為 2540，與 CURRENT_TASK 主樹紀錄 2539 差 1；HEAD 相對主樹基準 23998b7 的 tests 沒有差異，保留原基準，不冒稱全套綠。
- 一般啟動會試寫 symlink `node_modules/.vite-temp` 而被拒；改用 `--configLoader native --no-cache` 避免寫共用套件目錄，不改根目錄設定。
- UI production build：**132 modules** 通過。程式化 Vite build 使用 `configFile: false`、`cacheDir: /tmp/p5-t052-vite-cache`、`outDir: /tmp/p5-t052-ui-build`；未啟動／重啟 3000 或 5173。
- `git diff --check`：通過。
- **截圖路徑：無**。環境禁止 loopback listen，ui-drive 所需 Vite 與 Chrome 9333 不可用，因此沒有假稱完成五張 fixtures 截圖。未連任何真實 WordPress 或 setup 路由。
- 沒有呼叫真實 Agent CLI、沒有 migration、沒有 commit／stash／push、沒有碰使用者資料或設定檔。

### 追修結果（同一工作區，測試先行）

- 新增 `checkInFlightSchedule`：前置檢查仍要求晚超過五分鐘，三個 WordPress 寫入前的檢查改用至少一分鐘；測試四分鐘前置被擋、三分鐘進行中通過、三十秒被擋，以及查分類／建立草稿變慢後仍能完成排程。
- `cancelPostSchedule` 回傳文章與 `publicationWarning`，CoreService／HTTP／fixtures 都帶出；以取消回應完成時的本機時間判斷原排程，已過、剩不到兩分鐘或無法確認日期都提醒可能已公開、電子報／分享可能已送出，請到網站確認。遠端已公開也提醒副作用。測試過期／近一分鐘／遠於兩分鐘與寫入等待跨門檻。
- `Published` 以警告樣式顯示上述訊息，重讀成功後仍保留取消回應的警告。取消與重讀使用 `cancelThenRefresh`；測試確認兩者都失敗時保留取消的原始 error，只有重讀失敗時才回報重讀原因。
- 排程時間共用 `scheduleTime`：不同本機年份加「YYYY年」，同年份省略；發布按鈕、完成畫面、頂列、清單都沿用。測試固定本機年份，避免時間流逝改變測試結果。
- 介面改為「要改內容：先取消排程，目前要到 WordPress 後台改」；本檔明確修正既有缺口，沒有聲稱存在另開 job 更新同篇草稿的流程。known-issues 加 L2：本機時鐘慢於 WordPress 可能提早公開。
- 追修先紅再綠：新增測試先出現缺 helper／警告欄位與舊門檻的失敗，再實作修正。最後定向指令同上，**4 檔／73 項通過、32 項未選取**（排程相關 57 項＋文件治理 16 項）；`npm run typecheck` 通過、`git diff --check` 通過。依使用者指示，本輪未跑完整 verify（sandbox 禁止 loopback），沒有新增全套綠的宣稱。

變更檔案（含初次實作，全部在 write_paths）：

- `docs/CURRENT_TASK.md`
- `docs/known-issues.md`
- `docs/specs/architecture.md`
- `docs/specs/core-service.md`
- `docs/specs/design-system.md`
- `docs/specs/http-api.md`
- `docs/specs/security.md`
- `docs/specs/state-machine.md`
- `docs/specs/wordpress-site.md`
- `docs/tasks/P5-T052-schedule-publish.md`
- `src/contract/api-enums.ts`
- `src/contract/api-job.ts`
- `src/contract/api-requests.ts`
- `src/contract/api-responses.ts`
- `src/contract/schedule.ts`
- `src/core/service.ts`
- `src/core/service/jobs.ts`
- `src/core/service/publish.ts`
- `src/core/service/types.ts`
- `src/server/routes/jobs.ts`
- `src/ui/components/JobList.tsx`
- `src/ui/components/PublishSheet.tsx`
- `src/ui/components/Workspace.tsx`
- `src/ui/lib/cancel-schedule.ts`
- `src/ui/lib/schedule.ts`
- `src/ui/service/client.ts`
- `src/ui/service/fixtures/jobs.ts`
- `src/ui/service/fixtures/publish.ts`
- `src/ui/service/types.ts`
- `src/ui/styles/20-publish.css`
- `src/wordpress/posts.ts`
- `tests/helpers/core-fixture.ts`
- `tests/jobs-api.test.ts`
- `tests/publish-path-guards.test.ts`
- `tests/schedule-publish.test.ts`
- `tests/schedule-view.test.ts`
