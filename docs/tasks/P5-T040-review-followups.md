---
id: P5-T040
phase: 5
status: done
depends_on: [P6-T006, P5-T039, P5-T038]
specs: [design-system.md, state-machine.md]
write_paths: ["src/ui/", "src/contract/", "tests/", "docs/specs/design-system.md", "docs/specs/architecture.md", "docs/known-issues.md", "docs/tasks/P5-T040-review-followups.md"]
contract_change: none
expected_commit: "fix(P5-T040): 補審剩下三條：自動存後重讀失敗的存檔基準、關面板不丟沒存的網址、標題與網址存檔中擋發布"
---

# 補審剩下三條

## 目標
D-039。已合併的 #24（P6-T006）、#25（P5-T039）補跑 Codex 審查，跨稿件串畫面那類已在 P5-T038 一次修掉，剩下三條在這裡修。

## 範圍
### 包含
1. **自動存後重讀失敗，再進打字模式存檔 409、新打的字可能被蓋掉**（#24 補審）。`Workspace.tsx` 離開打字模式時清掉 `lastSavedHash`，
   但若最後一次自動存成功（H1）而重讀失敗、畫面的 `job` 還停在 H0：取消、再進打字模式、存檔會用 H0 當基準 → 409；
   之後輪詢讀到 H1，放掉 hold 時又把自己存的那版當成外部改動、蓋掉新打的字。
   修：離開打字模式時，若有「存成功但還沒被重讀確認」的版本，先把它併進畫面狀態（或立刻重讀到它）再清基準；
   重讀確認前再進打字模式時，存檔基準用那個已存成功的版本，hold 也把它視為自己的版本。
2. **發布面板打了網址沒存，按 × 或點遮罩關掉，再打開時「沒存」的擋發布不見了**（#25 補審）。
   修：沒存的網址草稿依稿件保留（跟 `slug-save-store` 同一層，模組層級、以稿件為 key），重開面板時還原並照樣擋發布；
   按「取消」或存成功才清掉。換篇不帶到別篇。
3. **「標題與網址」抽屜裡改網址、存檔進行中，關抽屜去開發布面板，發布沒被擋**（#25 補審）。
   修：`SourcePanel` 的存檔若改到網址，也登記進 `slug-save-store`（同一個「存網址進行中」狀態），存完（含重讀完成）才放開；
   失敗也要放開並照樣顯示錯誤。
- 每條補測試（純函式為主）；design-system.md（發布面板規則）與 known-issues 同步，P5-T039 那幾條殘餘若已解決就拿掉。

### 不包含
- 兩個分頁同時改同一篇的競態（D-039 裁定不修）。
- 發布面板以外改網址的其他入口（目前只有「標題與網址」）。

## 工作區與 Context
### 必讀入口
`src/ui/components/Workspace.tsx`（`lastSavedHash`、`onSaveEdit`、hold）、`src/ui/lib/check-while-writing.ts`、`src/ui/components/PublishSheet.tsx`、
`src/ui/lib/publish-slug.ts`、`src/ui/lib/slug-save-store.ts`、`src/ui/components/panels/SourcePanel.tsx`、`docs/known-issues.md` P6-T006／P5-T039 段。
### 不應載入
後端、`docs/archive/`。
### 驗證命令
`npm run verify`；畫面用 `node scripts/ui-drive.mjs` 搭 `?fixtures=1`。

## 實作要求
- 先寫測試再實作（Vitest 沒有 DOM，邏輯抽純函式）。
- 不呼叫真實 Agent CLI、不連 WordPress、不啟動或重啟主目錄 dev server、不 commit、不 `git stash`、不設 `GALLEY_DATA_DIR`。
- 截圖前確認 9333 埠沒人用，Vite 只在 worktree、非 3000／5173 埠、`--cacheDir` 指 scratchpad，用完關掉。

## 驗證
### 自動驗證
`npm run verify` 綠。
### 手動驗證（使用者）
發布面板打網址不存 → 按 × 關掉再開 → 仍顯示沒存並擋發布。只在本機，不發布。

## 完成定義
- [x] `npm run verify` 綠
- [x] 擁有這些行為的 spec 已更新（factcheck.md 的待同步段由主 session 改）
- [x] 留下的殘餘已寫進 `docs/known-issues.md`
- [ ] CURRENT_TASK 已更新（主 session 統一更新）

## 中斷／接手紀錄
- 最後完成：PR #28 Codex 第三輪三條 P2（2026-10-05，未 commit）：待同步重讀改成一次只跑一個（`lib/serial-poll.ts`）；
  網址草稿只有 store 一份（面板用 `useSyncExternalStore` 讀、`setSlugDraft` 寫）；工作區 `syncJob` 回傳 applied／failed／gone，
  存網址（`runSlugSave`／`runSourceSave` 改成 save＋sync 兩步）要重讀套用才清草稿、放開，沒套用每 3 秒重試
- 已通過驗證：`npm run verify` 93 檔／2074 測試綠（第三輪修正後）；`?fixtures=1`：發布面板打字、關掉再開仍在且擋發布、存網址後顯示新值且不再擋
- 下一步：Codex 第四輪審查；`docs/specs/factcheck.md` 待同步段的「每 3 秒」改成「一次只跑一個、上一次結束 3 秒後再讀」（不在 write_paths，待主 session）
- Blocker：無

## 完成結果
1. 自動存後重讀失敗：「待同步」（PR #28 第二輪改設計，取代 SavedAhead）。`Workspace` 記「最近一次成功重讀的序號」與「打字中最後存成功時已送出的重讀序號」，
   `check-while-writing.ts` 的 `syncPending` 判斷：不在打字模式、存過、而且之後沒有序號更大的重讀成功 → 擋所有進打字模式的入口（「正在同步最新版本…」）、
   每 3 秒重讀；任何一次重讀成功就解除，之後基準就是工作區版本（伺服器的真實版本）。打字中的 hold 與 `lastSavedHash` 照 P6-T006 不動；
   `lastSaved` 另有 state，render 時算畫面知道的目前版本（`selectionImageContentHash`），`currentHash` 與查位置請求同一個值（第一輪 #2）。
2. 發布面板沒存的網址：`slug-save-store.ts` 加 `slugDraftFor`／`keepSlugDraft`／`clearSlugDraft`（模組層級、以稿件為 key）；
   草稿只有 store 一份：`PublishSheet` 用 `useSyncExternalStore` 讀、打字寫回 store（跟已存的一樣就清，涵蓋取消；已存的值跟上草稿就作廢）；
   `runSlugSave` 存好且重讀套用後一律清掉該篇草稿（面板開著或關著都一樣，第二、三輪）。
3. 「標題與網址」存檔中擋發布：`slug-save-store.ts` 加 `sourceSaveTouchesSlug`、`runSourceSave`；`SourcePanel` 的「儲存」「渲染」改到網址時
   整段（存＋渲染＋重讀到套用）登記成「存網址進行中」，存失敗也放開、錯誤照樣顯示；重讀沒套用就每 3 秒再讀（第三輪）；發布面板那邊在存時不默默跳過，按鈕反灰、硬按會講。
- 測試：`tests/check-while-writing.test.ts`（#1 待同步四條）、`tests/serial-poll.test.ts`（三條）、`tests/publish-slug.test.ts`（#2、#3 與第三輪共十三條）。
