---
id: P5-T003
phase: 5
status: done
depends_on: [P5-T002]
specs: [design-system.md, review-proposals.md, agent-tasks.md, templates.md]
write_paths: ["src/ui/", "tests/", "docs/specs/design-system.md"]
contract_change: additive
expected_commit: "feat(P5-T003): B 版配色與稿件總覽"
---

# UI 改版為 B 版（一）：配色與 B0 稿件總覽

## 目標
D-013。設計稿：https://claude.ai/artifact/1D5TrmCQESR3icmD6TVnC6 （B0、B1、B2 三張）。

## 範圍
### 包含
- 新配色（暖灰桌面、紙白、單一墨綠強調色，含深色版）
- B0 稿件總覽、新稿件畫面（類型決定發到哪裡、拖放／貼上開新稿）
- 契約 `JobSummary.pendingReviewCount`（additive），讓列表說得出「還有 N 項建議」
- B1、B2 拆到 P5-T006、P5-T007
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
- 最後完成：全部
- 已通過驗證：`npm run verify` 32 檔／522 測試；無頭 Chrome 截圖 B0、新稿件（淺色、深色）
- 下一步：P5-T006
- Blocker：無

## 完成結果

B0 依設計稿：新長文／新日記兩顆按鈕、拖放與 ⌘V 開新稿、類型篩選、每篇一句狀態加一顆「打開」、
已發出去與已結束分開。環境診斷的入口從左下角浮動連結移到總覽右上角。
與設計稿的差異：拖放只收 .txt／.md（.docx 要多裝解析套件）。
