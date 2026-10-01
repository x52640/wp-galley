---
id: P5-T033
phase: 5
status: ready
depends_on: [P5-T004]
specs: [architecture.md, design-system.md]
write_paths: ["src/ui/service/", "src/contract/", "src/core/", "tests/", "docs/specs/architecture.md", "docs/tasks/P5-T033-split-fixtures.md", "docs/CURRENT_TASK.md"]
contract_change: none
expected_commit: "refactor(P5-T033): 拆分示範資料，規則改用 contract 共用函式"
---

# 拆分示範資料，規則改用 contract 共用函式

## 目標
D-033。`src/ui/service/fixtures.ts`（2233 行）是 `?fixtures=1` 的假後端，把後端規則再寫一遍，已多次跟後端不一致（P5-T031 Codex 審查）。

## 範圍
### 包含
- 照 P5-T004 拆完的後端領域拆成 `src/ui/service/fixtures/` 底下多個檔（資料、各領域 handler），對外 `api` 介面不變。
- 盤點 fixtures 裡**重寫的後端規則**（狀態判斷、blocker、驗證、結案判斷…），能抽成純函式的搬進 `src/contract`，前後端共用；
  抽不了的（依賴 DB）列成清單寫進 Task 完成結果。一次只抽確定行為相同的，不改後端行為。
- 更新 architecture.md 功能地圖的 fixtures 欄（若有）。

### 不包含
- 改任何使用者看得到的行為（示範資料內容可以不動）。

## 實作要求
- 重構不改行為：`npm run verify` 測試數不減；抽到 contract 的函式補單元測試。
- `src/contract` 不得 import 任何模組（`tests/contract.test.ts` 守著）。
- `?fixtures=1` 用 `scripts/ui-drive.mjs` 走過主要流程（總覽、文章、校稿、配圖、發布面板、精靈）無錯誤。

## 完成定義
- [ ] `npm run verify` 綠，測試數不減
- [ ] 抽到 contract 的規則與抽不了的清單寫進完成結果
- [ ] CURRENT_TASK 已更新

## 中斷／接手紀錄
- 最後完成：開 Task（2026-10-01）
- 已通過驗證：—
- 下一步：等 P5-T004
- Blocker：無

## 完成結果
