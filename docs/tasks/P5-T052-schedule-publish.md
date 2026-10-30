---
id: P5-T052
phase: 5
status: in_progress
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

排程後想改：現在遠端不是草稿就拒絕更新（`nonDraftUpdateMessage`，Q-5）。只能去後台取消就違反「不准離開發布台」，
所以發布台要能「取消排程」（`future` → `draft`，這一步只會讓內容更不公開）。排程中**不能**直接改內容：先取消、改完再排。

## 範圍
### 包含
- **契約**：`PublishStatus` 加 `'future'`（或等價設計），`PublishRequest` 加排程時間（ISO 8601 UTC 字串）。前後端共用的檢查（是不是未來、至少晚現在 5 分鐘）寫成 `src/contract` 純函式（D-033 規矩）。
- **WordPress 層**（`src/wordpress/posts.ts`）：排程跟 `setStatus('publish')` 一樣是獨立、一眼數得出來的寫入（送 `status: 'future'`＋`date_gmt`），寫入前 `assertUnchanged`＋`beforeWrite`。WordPress 回來的狀態若不是 `future`（例如時間已過被直接公開）要如實回報，不假裝排程成功。
- **CoreService 發布路徑**（`src/core/service/publish.ts`）：選排程時，先照舊寫成草稿，再改成排程（同「公開」那段，核准被撤銷就停在草稿）。後端用原始 schema 再驗時間：缺時間、格式錯、過去或 5 分鐘內一律拒絕、零寫入。事件記錄帶排程時間。
- **取消排程**：新的本機 UI 路由（照既有來源／CSRF 防護，寫測試）＋ CoreService 方法：確認這篇對應的遠端文章目前是 `future`、遠端沒被別人改過（沿用 `assertUnchanged` 那套快照比對），送 `status: 'draft'`；更新本機 `wordpress_objects` 的狀態與快照。不需要核准（只降低曝光）。遠端已經不是 `future`（已經公開、被後台改過）就拒絕並講清楚現況。
  - ⚠️ **取消後的日期**：WordPress 的草稿若留著排程時填的日期，之後「馬上公開」會被 WordPress 自動轉成排程（日期仍在未來）或變成回溯日期（日期已過）。取消時要把日期重設成「浮動」（REST 送 `date_gmt: null`／`date: null` 的行為**請先查 WordPress 核心 `class-wp-rest-posts-controller.php` 的實際處理**，查不到就在 Task 寫明假設並列入手動驗證）。另外：發布路徑選「馬上公開」時，若 WordPress 回來的狀態是 `future`，要如實講出來，不能說成已公開。
  - 取消之後要改內容走既有「已發布的 job 再改＝另開 job、更新那篇草稿」那條路（state-machine.md），不改狀態機。
- **錯誤訊息**：`nonDraftUpdateMessage` 遇到 `future` 時改講「這篇已排程，要改先按『取消排程』」。
- **UI**（`PublishSheet.tsx` 等）：
  - 「存成草稿」「馬上公開」旁加第三個「排程發布」。選了出現日期時間選擇（瀏覽器原生 `datetime-local` 即可），用這台電腦的時區，旁邊寫出時區名稱；預設值給一個合理的未來時間（例如明天早上 8:00），不要空白要求先打字（memory：常做的事一鍵）。
  - 跟「馬上公開」同樣顯示警告並要勾「我知道」才能按；警告多一句「時間到才發，網站流量少時可能晚一點」。
  - 時間是過去或 5 分鐘內，按鈕反灰並講原因（`p-why`）。
  - 按鈕文字「（核准並）排程在 M月D日 HH:mm 發布」。
  - 發布完成畫面：狀態是排程時寫「已排程，會在 …（本機時間）公開」，並有「取消排程」按鈕；取消成功改顯示草稿，失敗講原因。
  - 其他顯示發布狀態的地方（稿件清單、已發布資訊）看到 `future` 要寫「已排程」＋時間，不要顯示英文 `future`。
- fixtures（`?fixtures=1`）跟著支援排程與取消，方便截圖。
- spec：wordpress-site.md（狀態、外部副作用、只更新草稿那段）、security.md（外部副作用加「排程」）、http-api.md（publish 欄位、取消排程路由）、state-machine.md／core-service.md（若前置檢查或方法清單有變）、design-system.md（發布面板）、architecture.md 功能地圖；known-issues（可能晚發、錯過排程）。

### 不包含
- 重複排程、批次排程、日曆檢視。
- 排程中直接改內容或改時間（先取消再排）。
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
- [ ] `npm run verify` 綠
- [ ] 擁有這些行為的 spec 已更新（architecture.md 功能地圖）
- [ ] 留下的殘餘已寫進 `docs/known-issues.md`
- [ ] CURRENT_TASK 已更新

## 中斷／接手紀錄
- 最後完成：開 Task（2026-10-30）
- 已通過驗證：—
- 下一步：交 Codex 實作
- Blocker：無

## 完成結果
