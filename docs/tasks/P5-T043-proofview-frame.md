---
id: P5-T043
phase: 5
status: done
depends_on: [P5-T042]
specs: [architecture.md, design-system.md]
write_paths: ["src/ui/components/ProofView.tsx", "src/ui/components/MarkPin.tsx", "src/ui/components/InsertSlots.tsx", "src/ui/lib/", "tests/", "docs/specs/architecture.md", "docs/tasks/P5-T043-proofview-frame.md"]
contract_change: none
expected_commit: "refactor(P5-T043): 抽出 ProofView 的校樣載入、量測與標記"
---

# 抽出 ProofView 的校樣載入、量測與標記

## 目標
D-040（使用者 2026-10-04：「不要把功能都擠在同一個檔案，要模組化，之後比較好更新跟維護」；2026-10-05 要求拆成 Task）。
拆完選字與打字之後，ProofView 剩下的是校樣本體：iframe 載入（srcDoc、ETag、重載）、量測段落位置與高度、字上標記（校稿／查證）與點擊對應、
左側標記針（`MarkPin`）、段落之間「在這裡插圖」。目標是 ProofView 降到約 400 行以內、只做組裝。

## 範圍
### 包含
- `useProofFrame`（hook）：載入、量測、ResizeObserver、捲動對齊；`MarkPin.tsx`、`InsertSlots.tsx` 各自一檔；標記的套用與點擊對應抽成純函式（能測的部分補測試）。
- 若拆完 ProofView 仍超過 500 行，回報剩下什麼、建議怎麼再拆，不要硬拆。
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
打開稿件看校樣；點右欄卡片捲到字、點字上標記亮卡片；顯示／隱藏校對符號；段落之間「在這裡插圖」；對照上一版。

## 完成定義
- [x] `npm run verify` 綠，測試數不減
- [x] 改動前後截圖逐張相同
- [x] `docs/specs/architecture.md` 功能地圖對應欄已更新
- [ ] CURRENT_TASK 已更新（主 session 統一更新）

## 中斷／接手紀錄
- 最後完成：抽出 `lib/use-proof-frame.ts`（`useProofMeasure`：渲染世代與量測；`useProofFrame`：示範資料載入、換版本清空、ETag、ResizeObserver、`handleLoad`、捲到清單點的段落、字上標記、捲到點的標記）、`lib/proof-frame.ts`（`contentHeight`／`settleHeight`、`blockSnippet`、`insertSlots`、`groupMarks`）、`lib/proof-highlights.ts`（`ProofHighlight`、`wrapFirst`、`applyHighlights`、`highlightStyle`、`highlightKey`、`clickedMarkKey`）、`components/MarkPin.tsx`（`MarkGutter`＋`MarkPin`）、`components/InsertSlots.tsx`（`useInsertSlots`＋`InsertSlots`）；`tests/proof-frame.test.ts`（26，含三個 hook 的 effect 順序守門）、`tests/proof-editing.test.ts` 守門改成看 hook 呼叫位置；功能地圖三列已更新；ProofView 896 → 360 行。effect 順序不變：ProofView 依序呼叫 useProofMeasure → useProofEditing → useProofFrame → 進出編輯 effect → useSelectionActions → useInsertSlots，展開後跟抽出前逐一相同；後建立的選字膠囊與插圖用 ProofView 傳進去的函式（只在 effect 與 iframe 事件裡呼叫）（2026-10-05）
- 已通過驗證：`npm run verify` 95 → 96 檔、2110 → 2136 測試；`?fixtures=1` 22 張（打開稿件、顯示／隱藏校對符號、釘住符號、在這裡插圖、對照上一版、點卡片捲到字、點字亮卡片、巢狀標記換外層、跳到該段）改動前兩次、改動後三次逐張像素比對，各步 DOM 狀態（捲動、高度、符號與插圖位置、標記樣式、亮著的卡片）全部逐字相同；改動後第三次 22 張全相同，前兩次只有 17（從對照回到文章）右欄卡片圓角 17px ±1，單獨重跑新舊程式都相同、與改動無關
- 下一步：PR A 的 Codex 審查
- Blocker：無

## 完成結果
- ProofView 1560 → 360 行（P5-T041～P5-T043 累計）。獨立審查一輪：無行為差異（effect 展開順序、依賴、換版本呼叫順序、ref 更新時機、標記樣式、DOM 位置逐項對過）。
- 殘餘：`handleLoad` 依賴陣列沒列 `attachSelection`／`clearSelection`／`edit`（原碼就沒列，跑 `react-hooks/exhaustive-deps` 會警告；verify 不跑 eslint）；`SelectionActions.tsx` 檔頭「ProofView 把選取事件交給它」實際呼叫點已在 `useProofFrame` 的 `handleLoad`（該檔不在本 Task write_paths）。
