---
id: P5-T042
phase: 5
status: ready
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
- [ ] `npm run verify` 綠，測試數不減
- [ ] 改動前後截圖逐張相同
- [ ] `docs/specs/architecture.md` 功能地圖對應欄已更新
- [ ] CURRENT_TASK 已更新（主 session 統一更新）

## 中斷／接手紀錄
- 最後完成：Task 開立
- 已通過驗證：—
- 下一步：等 P5-T040（PR #28）合併後派實作 subagent
- Blocker：P5-T040 也在改 `ProofView.tsx`／`Workspace.tsx`

## 完成結果
