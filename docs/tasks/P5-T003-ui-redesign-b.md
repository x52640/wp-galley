---
id: P5-T003
phase: 5
status: blocked
depends_on: [P5-T002]
specs: [design-system.md, review-proposals.md, agent-tasks.md, templates.md]
write_paths: ["src/ui/", "tests/", "docs/specs/design-system.md"]
contract_change: none
expected_commit: "feat(P5-T003): 發布台改為文件式版面"
---

# UI 改版為 B 版（文件式）

## 目標
D-013。設計稿：https://claude.ai/artifact/1D5TrmCQESR3icmD6TVnC6 （B0、B1、B2 三張）。

## 範圍
### 包含
- B0 稿件總覽、B1 編輯與建議並排、B2 發布面板
- design-system.md 的「版面」一節改寫成新版面
### 不包含
- 後端行為變更；需要新 API 的另開 Task
- 首頁（D-001）
- A 版「一次看一項」模式（Q-7 未裁定）

## 工作區與 Context
### 必讀入口
design-system.md、review-proposals.md（「畫面」一節）、agent-tasks.md、templates.md（發到哪裡）
### 驗證命令
`npm run verify`；`npm run dev` 開 `?fixtures=1` 走完 B0→B1→B2

## 實作要求
- 發布面板最上方顯示「發到哪裡」與原因（類型 → target），選「公開」要求勾選「我知道」。
- 動工前再開一次拆分：這個 Task 可能要拆成 B0／B1／B2 三個。

## 完成定義
- [ ] 設計稿三張的每個編號操作都做到
- [ ] `npm run verify` 綠
- [ ] design-system.md 更新

## 中斷／接手紀錄
- 最後完成：尚未開始
- 已通過驗證：—
- 下一步：等 P5-T002 完成後拆分
- Blocker：P5-T002

## 完成結果
