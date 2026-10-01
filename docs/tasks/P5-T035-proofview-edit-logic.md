---
id: P5-T035
phase: 5
status: ready
depends_on: [P5-T034]
specs: [design-system.md, architecture.md]
write_paths: ["src/ui/", "tests/", "docs/specs/architecture.md", "docs/tasks/P5-T035-proofview-edit-logic.md", "docs/CURRENT_TASK.md"]
contract_change: none
expected_commit: "refactor(P5-T035): 抽出 ProofView 的編輯邏輯"
---

# 抽出 ProofView 的編輯邏輯

## 目標
D-033。`src/ui/components/ProofView.tsx`（1240 行）同時負責校樣顯示與「在文章上直接改」（contenteditable、游標定位、格式指令、
標題編輯、貼上／拖放／Enter 攔截、存檔前整理）。

## 範圍
### 包含
- 把編輯相關、不需要 React 狀態的邏輯抽到 `src/ui/lib/`（延續 P5-T031 的 `edit-target.ts` 做法），可以拆成一兩個 hook 或純函式檔；
  ProofView 只留組裝與狀態。
- 抽出的純函式補單元測試（node 環境能測的部分）。
- 功能地圖對應欄更新。

### 不包含
- 改任何行為。

## 實作要求
- `npm run verify` 測試數不減。
- `?fixtures=1` 用 `scripts/ui-drive.mjs` 走過：改原文、格式工具列、改標題、卡片「自己改／去原文改」、取消、儲存、Enter／貼上在標題裡。

## 完成定義
- [ ] `npm run verify` 綠，測試數不減
- [ ] CURRENT_TASK 已更新

## 中斷／接手紀錄
- 最後完成：開 Task（2026-10-01）
- 已通過驗證：—
- 下一步：等 P5-T034
- Blocker：無

## 完成結果
