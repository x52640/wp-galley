---
id: P5-T007
phase: 5
status: in_progress
depends_on: [P5-T006]
specs: [design-system.md, state-machine.md, security.md, templates.md]
write_paths: ["src/ui/", "tests/", "docs/specs/design-system.md"]
contract_change: none
expected_commit: "feat(P5-T007): 發布面板（B2）"
---

# UI 改版為 B 版（三）：B2 發布面板

## 目標
D-013。發布從右側滑出；最上面寫「發到哪裡」，列出還沒處理的，選「公開」要勾「我知道」。

## 範圍
### 包含
- 發到哪裡（類型 → target）、還沒處理的（可跳回）、分類／標籤、封面、發布方式、外部副作用警告
- 「核准並發布」：打開面板時主區切到成品，看過（PREVIEWED）才准核准，核准綁畫面上那一份的 hash
### 不包含
- 排程（後端沒有）、摘要（後端沒有欄位）

## 中斷／接手紀錄
- 最後完成：尚未開始
- 已通過驗證：—
- 下一步：發布抽屜骨架
- Blocker：無

## 完成結果
