---
id: P5-T042
phase: 5
status: done
depends_on: [P5-T041]
specs: [architecture.md, design-system.md]
write_paths: ["src/ui/components/ProofView.tsx", "src/ui/components/EditToolbar.tsx", "src/ui/lib/", "tests/", "docs/specs/architecture.md", "docs/tasks/P5-T042-proofview-editing.md"]
contract_change: none
expected_commit: "refactor(P5-T042): 抽出 ProofView 的打字模式"
---

# 抽出 ProofView 的打字模式

## 目標
D-040（使用者 2026-10-04：「不要把功能都擠在同一個檔案，要模組化，之後比較好更新跟維護」；2026-10-05 要求拆成 Task）。
P5-T041 之後 ProofView 剩下最大的一塊是**打字模式**：進出編輯、原文快照、存檔（含照樣存、整理後換回畫面）、hold（打字中不重載）、
格式工具列、連結編輯、丟格式警告。P5-T035 只抽了不需要 React 狀態的規則，狀態與流程還在元件裡。

## 範圍
### 包含
- 抽成 `useProofEditing`（hook）：編輯狀態、原文快照、存檔流程、hold、錯誤；`EditToolbar.tsx`：格式工具列與連結編輯的畫面。
- ProofView 只組裝：把 iframe 文件與 hook 接起來。
- hold／存檔基準的規則照 `check-while-writing.ts` 現行，不改。
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
改原文 → 打字 → 儲存；格式工具列（粗體、H2、清單、連結）；改標題；貼上網頁格式出現丟格式警告 → 照樣存；取消；卡片「自己改／去原文改」。

## 完成定義
- [x] `npm run verify` 綠，測試數不減
- [x] 改動前後截圖逐張相同
- [x] `docs/specs/architecture.md` 功能地圖對應欄已更新
- [ ] CURRENT_TASK 已更新（主 session 統一更新）

## 中斷／接手紀錄
- 最後完成：抽出 `lib/use-proof-editing.ts`（`useProofEditing`：編輯狀態、原文快照、存檔含照樣存與整理後換回畫面、hold、錯誤、格式與連結狀態、`actWhileWriting`）、`lib/proof-editing.ts`（`decideEditSave`、`editBarNote`、`replaceWithSavedBody`，純函式）、`components/EditToolbar.tsx`（`EditBar` 提示列與取消／儲存、`EditToolbar` 格式工具列與連結、`DropWarning`）；`tests/proof-editing.test.ts`（16）；功能地圖三列已更新；ProofView 1343 → 896 行。effect 順序不變：hook 只有一個 effect、呼叫在它抽出前的位置；進出編輯（`syncEditing`）與版本被換掉（`abandonOnNewVersion`）的 effect 留在 ProofView 原位、只呼叫 hook 給的函式；`useSelectionActions` 改呼叫 `edit.actWhileWriting`（2026-10-05）
- 已通過驗證：`npm run verify` 94 → 95 檔、2094 → 2110 測試；`?fixtures=1` 29 張改動前（跑兩次）／改動後（跑兩次）逐張像素比對：DOM 狀態（正文 HTML、狀態列、焦點、選取）四次逐字相同；21 張像素相同，8 張差異都是改動前兩次之間也會變的東西（版本 hash 小標、查證進度條與計時器、捲軸淡出時機、圓角反鋸齒 ±1）
- 下一步：P5-T043（同一個 PR A）
- Blocker：無

## 完成結果
- 獨立審查一輪：無行為差異（effect 順序與依賴、閉包讀值、ref 更新時機、存檔流程、工具列 DOM 逐項對過）。
- 殘餘：`tests/proof-editing.test.ts` 的守門測試靠找原始碼字串判斷 hook 順序，改名會誤報、換寫法防不了；`SelectionActions.tsx` 兩處註解仍寫 `actWhileWriting` 在 ProofView（該檔不在本 Task write_paths，待使用者決定）。
