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
- [x] 擁有這些行為的 spec 已更新（factcheck.md 的 SavedAhead 由主 session 補）
- [x] 留下的殘餘已寫進 `docs/known-issues.md`
- [ ] CURRENT_TASK 已更新（主 session 統一更新）

## 中斷／接手紀錄
- 最後完成：三條實作＋測試＋spec／known-issues 同步（2026-10-05，未 commit）
- 已通過驗證：`npm run verify` 92 檔／2065 測試綠；`?fixtures=1` 截圖：發布面板打網址不存 → × 關掉、點遮罩關掉再開 → 字還在、「網址改了還沒存」擋發布；按取消再關再開 → 清掉
- 下一步：主 session 審查、`docs/specs/factcheck.md`「打字中存的那一版不重載」段補一句 `SavedAhead`（不在本 Task write_paths）、Codex 審查、commit
- Blocker：無

## 完成結果
1. 自動存後重讀失敗：`check-while-writing.ts` 加 `SavedAhead`（`carrySavedAhead`／`settleSavedAhead`／`savedAheadHash`／`seedHold`）。
   `Workspace` 離開打字模式（含一般儲存）時，最後存成功但工作區還沒讀到的那一版記成 savedAhead 並立刻重讀；再進打字模式時當成
   `lastSavedHash` 起點（存檔基準不再用舊快照）；`ProofView` 進打字模式時用 `seedHold` 讓 hold 一開始就認它。快照換了或換篇就放掉。
2. 發布面板沒存的網址：`slug-save-store.ts` 加 `slugDraftFor`／`keepSlugDraft`／`clearSlugDraft`（模組層級、以稿件為 key）；
   `PublishSheet` 開面板時還原、框或已存值變了就同步（跟已存的一樣就清，涵蓋取消與存成功）。
3. 「標題與網址」存檔中擋發布：`slug-save-store.ts` 加 `sourceSaveTouchesSlug`、`runSourceSave`；`SourcePanel` 的「儲存」「渲染」改到網址時
   整段（存＋重讀／渲染）登記成「存網址進行中」，失敗也放開、錯誤照樣顯示；發布面板那邊在存時不默默跳過，按鈕反灰、硬按會講。
- 測試：`tests/check-while-writing.test.ts`（#1 四條）、`tests/publish-slug.test.ts`（#2 三條、#3 四條）。
