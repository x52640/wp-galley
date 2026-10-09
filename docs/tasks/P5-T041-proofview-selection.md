---
id: P5-T041
phase: 5
status: done
depends_on: [P5-T040]
specs: [architecture.md, design-system.md]
write_paths: ["src/ui/components/ProofView.tsx", "src/ui/components/SelectionActions.tsx", "src/ui/components/SelectionImagePanel.tsx", "src/ui/lib/", "tests/", "docs/specs/architecture.md", "docs/tasks/P5-T041-proofview-selection.md"]
contract_change: none
expected_commit: "refactor(P5-T041): 抽出 ProofView 的選字動作"
---

# 抽出 ProofView 的選字動作（查證這句、用此段配圖）

## 目標
D-040（使用者 2026-10-04：「不要把功能都擠在同一個檔案，要模組化，之後比較好更新跟維護」；2026-10-05 要求拆成 Task）。
`ProofView.tsx` 現在 1560 行（P5-T035 拆完是 1079），這兩天的查證、配圖都長在它身上。最常被新功能碰的是**選字之後浮出的那排按鈕**
（查證這句、用此段配圖，P6-T005／P6-T006／P5-T038），之後很可能再加按鈕，先把它拆出去。

D-040 原本附的細節（2026-10-09 P0-T003 從 plan.md 搬來）：PR 分組是 2026-10-05 修正原「一個 Task 一個 PR」；都等 P5-T040 合併後開工；`repository.ts`、`rich-text.ts`、`SetupWizard.tsx`、`routes/jobs.ts` 暫不拆是因為大但少改；`service.ts` 已是轉接總機（P5-T004），不用拆。

## 範圍
### 包含
- 把「選字 → 浮出膠囊 → 查證這句／用此段配圖（含打字模式先存再做 `actWhileWriting`、查位置、請求編號、面板開關與過期判斷、提示文字）」
  抽成 `useSelectionActions`（hook，放 `src/ui/lib/` 或元件旁）＋ `SelectionActions.tsx`（膠囊與面板的畫面）。ProofView 只負責把 iframe 的選取事件交給它。
- 已經是純函式的（`selection-image-view.ts`、`check-while-writing.ts` 的相關部分）照舊，必要時再細分。
- `docs/specs/architecture.md` 功能地圖對應欄更新。

### 不包含
- 改任何行為或畫面。
- 本 Task write_paths 以外的檔案；需要動到就停下來回報。

## 工作區與 Context
### 必讀入口
`docs/specs/architecture.md`（程式慣例、功能地圖）、本 Task 要拆的檔案、`docs/tasks/P5-T035-proofview-edit-logic.md`（上一次拆 ProofView 的做法）。
### 不應載入
後端、`docs/archive/`。
### 驗證命令
`npm run verify`；`node scripts/ui-drive.mjs` 搭 `?fixtures=1`。

## 實作要求
- **重構不改行為**（D-033、D-040）：畫面、文案、互動、API 呼叫順序都不變；props 介面盡量不變，要變就只在本 Task 範圍內的檔案間調整。
- 前後端都要的規則照舊放 `src/contract`；這次抽出的是 UI 層，放 `src/ui/components/`（元件）與 `src/ui/lib/`（hook、純函式）。
- 抽出的純函式補單元測試；`npm run verify` 測試數不減。
- 動手前用 `node scripts/ui-drive.mjs` 搭 `?fixtures=1` 把「驗證」列的流程各截一張「改動前」，完成後同流程截「改動後」逐張比對，回報差異（應為零）。
- 不呼叫真實 Agent CLI、不連 WordPress、不啟動或重啟主目錄 dev server、不設 `GALLEY_DATA_DIR`、不 commit、不 `git stash`。
- 截圖前確認 9333 埠沒人用；Vite 只在 worktree、非 3000／5173 埠，快取放 scratchpad，用完關掉。

## 驗證
### 自動驗證
`npm run verify` 綠，測試數不減。
### 畫面比對（`?fixtures=1`，改動前後各一次）
選一句按查證這句；選一大段按用此段配圖、選位置、送出；打字模式下兩者各一次；選超過 300 字時查證反灰；關掉面板再重開。

## 完成定義
- [x] `npm run verify` 綠，測試數不減
- [x] 改動前後截圖逐張相同
- [x] `docs/specs/architecture.md` 功能地圖對應欄已更新
- [ ] CURRENT_TASK 已更新（主 session 統一更新）

## 中斷／接手紀錄
- 最後完成：抽出 `components/SelectionActions.tsx`（`useSelectionActions` hook＋膠囊與面板 `SelectionActions`＋頂端提示 `SelectionNotice`）與 `lib/selection-actions.ts`（`pickSelection`、`capsuleView`、膠囊／面板位置，純函式）；`tests/selection-actions.test.ts`（15）；功能地圖兩列已更新；ProofView 1560 → 1343 行。`actWhileWriting` 跟「儲存」共用存檔狀態與「照樣存」，刻意留在 ProofView，由 hook 呼叫（2026-10-05）
- 已通過驗證：`npm run verify` 93 → 94 檔、2079 → 2094 測試；`?fixtures=1` 18 張改動前後逐張像素比對：15 張相同，3 張（13、15、16，打字模式存檔後）只差版本 hash 小標與計時器——示範資料的 hash 是亂數、計時器看時間，改動前跑兩次也一樣不同
- 下一步：P5-T042（同一個 PR A）
- Blocker：無

## 完成結果
- 獨立審查一輪：無行為差異；修正一處檔頭註解（「用此段配圖」一段補上實作已搬到 `SelectionActions.tsx`）。
- 殘餘：`useSelectionActions` 每次 render 回傳新物件，只有 `attach`／`clearPick` 身分不變；之後別把整個物件放進 effect 依賴。
- 截圖比對的 3 張差異來自示範資料亂數 hash 與計時器，不是本次改動。
