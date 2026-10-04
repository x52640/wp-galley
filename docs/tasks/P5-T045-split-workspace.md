---
id: P5-T045
phase: 5
status: done
depends_on: [P5-T040]
specs: [architecture.md, design-system.md]
write_paths: ["src/ui/components/Workspace.tsx", "src/ui/components/RestoreBar.tsx", "src/ui/components/CancelButton.tsx", "src/ui/lib/", "tests/", "docs/specs/architecture.md", "docs/tasks/P5-T045-split-workspace.md"]
contract_change: none
expected_commit: "refactor(P5-T045): 拆分工作區"
---

# 拆分工作區 Workspace

## 目標
D-040（使用者 2026-10-04：「不要把功能都擠在同一個檔案，要模組化，之後比較好更新跟維護」；2026-10-05 要求拆成 Task）。
`Workspace.tsx` 903 行。這幾輪 Codex 審查的問題（換篇串畫面、重讀序號、待同步）都集中在它的「讀稿件與同步」邏輯，跟畫面組裝混在一起很難審。

## 範圍
### 包含
- 抽成 `useJobWorkspace`（hook）：讀稿件／查證結果、generation 與 UUID 守衛、待同步重試、`onThisJob` 綁定、存檔基準；`RestoreBar.tsx`、`CancelButton.tsx` 各自一檔。
- Workspace 只留版面組裝與把 hook 的結果傳給子元件。
- 守衛與同步規則照 `check-while-writing.ts`／`selection-image-view.ts` 現行，不改。
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
打開稿件、換篇、AI 跑的時候停止、恢復已取消的稿件、打字中存檔後離開；換篇時頂端錯誤不串到另一篇。

## 完成定義
- [x] `npm run verify` 綠，測試數不減
- [x] 改動前後截圖逐張相同
- [x] `docs/specs/architecture.md` 功能地圖對應欄已更新
- [ ] CURRENT_TASK 已更新（主 session 統一更新）

## 中斷／接手紀錄
- 最後完成：抽出 `lib/use-job-workspace.ts`（讀稿件與查證結果、世代與篇別守衛、重讀排程與輪詢、待同步、`onThisJob`、存檔基準，effect 順序照舊）、`lib/workspace-view.ts`（純函式）、`RestoreBar.tsx`、`CancelButton.tsx`；`tests/workspace-view.test.ts`；Workspace 989 → 714 行；功能地圖已更新（2026-10-05）
- 已通過驗證：`npm run verify` 94 檔／2093（改動前 93／2079）；`?fixtures=1` 13 張改動前後截圖逐張比對，像素相同（只有轉圈圖示、進度條動畫的影格差，重截即相同）
- 下一步：PR C 的 Codex 審查
- Blocker：無

## 完成結果
- 獨立審查一輪：無行為差異（effect 順序、依賴、守衛、存檔基準逐項對過）；修正一處註解（hook 之前還有 `useConfirm`）。
- 刻意留在 Workspace：`startFactCheck`、`startEdit`、`highlights`、`onSaveEdit`、`latestRunId`／`editBlockedRef`（綁 UI 狀態或要用 `SuggestionColumn` 的 `reviewKey`）。
