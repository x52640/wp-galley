---
id: P5-T012
phase: 5
status: done
depends_on: [P5-T010]
specs: [http-api.md, review-proposals.md]
write_paths: ["src/contract/api.ts", "src/core/service.ts", "src/server/routes/jobs.ts", "src/ui/", "tests/", "docs/specs/", "docs/tasks/", "docs/CURRENT_TASK.md"]
contract_change: additive
expected_commit: "feat(P5-T012): 從卡片進去改完存檔，卡片一起結案"
---

# 從卡片進去改完存檔，卡片一起結案

## 目標
P5-T001 實測（使用者 2026-09-23 同意）：從卡片按「去原文改」、改完儲存之後，那張卡片還留在待處理，
要再按一次「不用改」。從卡片進去改，意思就是「這一項我處理了」。

## 範圍
### 包含
- 契約（additive）：`CreateRevisionRequest.resolveItemId?`（只能跟 `editedBody` 一起用）、
  `ReviewItem.resolvedByEdit`
- `createRevision` 寫入前先驗項目屬於目前提案（驗不過整個拒絕）；存成新版本後把那一項標成 `skipped`
  並記下 `revision_id`（這就是「自己改了」與「保留原文」的差別，不用加 migration）
- 沒有實質改動（不建版本）時卡片不動；已套用的項目不動
- 已處理清單顯示「自己改了」；從上方「改原文」進去不動任何卡片
### 不包含
- 新的 review item 狀態（用既有的 `skipped` ＋ `revision_id`）

## 驗證命令
`npm run verify`；`node scripts/ui-drive.mjs`

## 完成定義
- [x] 測試：結案且 resolvedByEdit、按「不用改」的不是 resolvedByEdit、沒改不動、不屬於提案整個拒絕、只能配 editedBody
- [x] 無頭 Chrome（示範資料）：去原文改 → 打字 → 儲存 → 卡片消失、已處理清單寫「自己改了」
- [x] http-api.md、review-proposals.md 已更新

## 中斷／接手紀錄
- 最後完成：全部
- 已通過驗證：npm run verify；無頭 Chrome（示範資料）。沒在使用者的實測稿上試（會改到它）
- 下一步：無
- Blocker：無

## 完成結果
