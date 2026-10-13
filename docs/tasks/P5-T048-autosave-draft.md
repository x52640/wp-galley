---
id: P5-T048
phase: 5
status: in_progress
depends_on: []
specs: [design-system.md, architecture.md, security.md]
write_paths: ["src/ui/", "src/contract/", "vite.config.ts", "tests/", "docs/specs/design-system.md", "docs/specs/architecture.md", "docs/known-issues.md", "docs/tasks/P5-T048-autosave-draft.md", "docs/CURRENT_TASK.md"]
contract_change: none
expected_commit: "feat(P5-T048): 打字模式沒存的內容自動留底，重新整理也不會不見"
---

# 打字模式沒存的內容自動留底，重新整理也不會不見

## 目標
D-047。使用者 2026-10-13：在打字模式寫了一篇新文章（稿件「AI未來已來 – 3」，DB 裡內文是空的），闔上螢幕休眠、打開後整篇不見，救不回來。

查到的原因：
- 服務從 14:40 一路沒重啟，伺服器沒問題；21:08:25～32 記錄檔有一串頁面初次載入的請求＝**頁面自己重新整理了**。
- 使用者是用 Galley.app（P8-T006）跑 `npm run dev`，UI 由 Vite dev server 提供。Vite 用戶端跟 dev server 的 WebSocket 斷線後會輪詢、連回來就 `location.reload()`（`node_modules/vite/dist/client/client.mjs` 的 "server connection lost. Polling for restart..."）。休眠會讓連線斷掉。
- 打字模式只有手動「儲存」，沒存的字只在 iframe 的 DOM 裡，重新整理就沒了。

裁定（使用者 2026-10-13「開始做吧」）：兩件都做——
1. **留底（根本解）**：打字模式邊打邊把沒存的標題與內文存一份到瀏覽器儲存區（localStorage）；不管什麼原因重新整理、分頁當掉、休眠醒來，再打開同一篇就恢復。
2. **擋觸發點**：Vite 斷線重連不准自己重新整理頁面。

選瀏覽器儲存區、不自動寫成新版本的理由：自動存成 revision 會每幾秒多一個版本（每個都存整份 rendered_html），還會讓核准失效、打斷 AI 提案定位；這次要解的是「沒存的字被刷掉」，在本機留一份就夠，而且即時、不經後端。存不存成正式版本照舊由使用者按「儲存」決定。

## 範圍
### 包含
- **留底**（前端；規則寫成純函式，D-033）：
  - 打字模式中，標題或內文有變動 → 節流（約 0.5～1 秒）寫進 localStorage，以稿件 uuid 為鍵，內容含：標題、內文 HTML、寫下時間、**開始編輯時的基準 contentHash**（`expectedContentHash` 那個）。
  - 分頁被藏起來／關掉（`visibilitychange` 變 hidden、`pagehide`）時立刻再寫一次，不等節流。
  - 按「儲存」成功、或使用者明確「取消」放棄修改 → 刪掉留底。存檔失敗不刪。
  - 打開一篇稿件時有留底、且內容跟目前存好的不同：
    - 基準 hash 等於目前版本 → **直接進打字模式並填回留底內容**，編輯區上方（沿用 `EditToolbar` 提示列的位置與樣式）明講「已恢復 HH:MM 沒存的內容，還沒儲存」＋「捨棄」按鈕。不另外跳對話框（D-010：常做的事一鍵、別讓使用者先選）。
    - 基準 hash 不等於目前版本（之後有別的存檔、AI 套用、換模板）→ 不自動蓋掉，提示列講「有 HH:MM 沒存的內容，但這篇之後又改過」，給「恢復」「捨棄」。恢復後照一般存檔流程（`expectedContentHash` 衝突規則照舊）。
    - 留底跟目前內容相同 → 默默刪掉。
  - 填回內文前照貼上的同一套 allowlist 整理（`lib/rich-*.ts`），不直接塞 innerHTML。
  - localStorage 不能用（無痕、被擋、滿了）→ 不壞、不吵；提示列輕輕講一次「這個視窗沒辦法自動留底，記得常按儲存」。
  - 只留未取消／未發布中的稿件；超過 30 天的留底在載入時清掉，避免無限累積。
  - 換篇（同一分頁切到別篇）時本篇的留底照留，切回來照上面規則恢復。
- **擋觸發點**：改 `vite.config.ts`，讓休眠醒來（WebSocket 斷線再連上）**不會**整頁重新整理。先查 Vite 8 實際行為再選做法（例如 `server.hmr` 設定、或自訂 client 行為），在 Task 完成結果寫清楚：選了什麼、HMR 還在不在、改了 UI 檔案要不要手動重新整理。用 scratchpad 起一個獨立埠的 Vite 實測「斷線→恢復不重新整理」，不准碰 5173。
- 測試：純函式（何時寫、何時刪、恢復判斷、過期清理、儲存區失敗）＋ hook／元件層的恢復流程；`?fixtures=1` 截圖兩種提示列。
- 文件：`docs/specs/design-system.md` 補提示列的兩種文案；`docs/specs/architecture.md` 功能地圖「在文章上改」那列補新檔案；`docs/known-issues.md` 寫殘餘（例如：換瀏覽器或清掉網站資料就沒有留底、5173 與 3000 是不同來源互不相通）。

### 不包含
- 自動存成正式版本（revision）、自動送 WordPress。
- 打字模式以外的輸入框（配圖 prompt、網址、建稿對話框）。
- 後端或 DB 的任何改動；MCP。
- 正式模式（`npm start`）啟動方式的改變。

## 工作區與 Context
### 必讀入口
`docs/specs/architecture.md` 功能地圖「在文章上改」「新稿件」兩列及其列出的檔案（重點 `src/ui/lib/use-proof-editing.ts`、`src/ui/lib/proof-editing.ts`、`src/ui/lib/use-job-workspace.ts`、`src/ui/lib/workspace-view.ts`、`src/ui/components/EditToolbar.tsx`）、`docs/specs/design-system.md`、`docs/specs/security.md`（貼上 allowlist）、`vite.config.ts`。
### 不應載入
agent、wordpress、factcheck、mcp 相關 spec。
### 驗證命令
`npm run verify`；`node scripts/ui-drive.mjs` 搭 `?fixtures=1` 截圖（Vite 要在 worktree 另起埠、另指 cacheDir，見 CURRENT_TASK）。

## 實作要求
- 在 git worktree `../wp-galley-P5-T048` 做；**不准**碰主目錄、不准對 3000／5173 起或殺任何東西（使用者的發布台正在跑）。
- 不呼叫真實 Agent CLI、不連真實 WordPress、不讀 `.env`、不 commit、不用 `git stash`。
- 留底內容只進 localStorage，不進 log、不送後端（存檔照舊走既有 `POST …/revisions`）。
- 先寫測試。

## 驗證
### 自動驗證
`npm run verify` 綠；測試涵蓋上面「包含」每一條規則；Vite 斷線不重新整理有實測紀錄。
### 手動驗證
打字模式寫幾段不按儲存 → 重新整理頁面 → 同一篇直接回到打字模式、內容都在、提示列講已恢復 → 儲存 → 再重新整理不再提示；
另寫幾段 → 闔螢幕休眠幾分鐘再打開 → 頁面沒有自己重新整理。

## 完成定義
- [ ] `npm run verify` 綠
- [ ] 擁有這些行為的 spec 已更新（新增或搬動功能：architecture.md 功能地圖）
- [ ] 留下的殘餘已寫進 `docs/known-issues.md`
- [ ] CURRENT_TASK 已更新

## 中斷／接手紀錄
- 最後完成：開 Task
- 已通過驗證：無
- 下一步：派實作 subagent
- Blocker：無

## 完成結果
