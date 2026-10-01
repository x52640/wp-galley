---
id: P0-T002
phase: 0
status: ready
depends_on: []
specs: [architecture.md, core-service.md]
write_paths: ["plan.md", "docs/README.md", "docs/CURRENT_TASK.md", "docs/known-issues.md", "docs/specs/architecture.md", "docs/specs/README.md", "docs/tasks/_TEMPLATE.md", "docs/tasks/P0-T002-slim-docs.md", "CLAUDE.md"]
contract_change: none
expected_commit: "docs(P0-T002): 冷啟動文件瘦身、加功能地圖"
---

# 冷啟動文件瘦身、加功能地圖

## 目標
D-033。冷啟動必讀的 `plan.md` 一半以上是逐段的決策記錄，每個功能多一段；`CURRENT_TASK.md` 的「進行中」其實都是待手動驗證；
找功能要靠搜畫面上的字。目標：冷啟動讀得少、定位快，且不丟資訊。

## 範圍
### 包含
- **`plan.md` 決策記錄改成一行一條**：`D-編號 日期 裁定者｜一句話結論｜→ Task 或 ADR 連結`。
  原本段落裡的理由：Task 檔「目標」已經有的就不搬；沒有的搬進對應 Task 的「目標」（或 ADR，若是跨 Task 的原則）。
  **不得遺失任何決定或限制**——特別是「不做 X 因為 Y」這類，結論那一句要保留關鍵限制。格式說明同步改。
  沒有 Task 的早期決策（階段制時期）理由放 `docs/adr/` 或保留兩行以內。
- **`CURRENT_TASK.md`**：「進行中」只放真的在做的；待手動驗證改成一張表（Task｜驗什麼｜一行）；「已知殘餘」整節搬到新檔
  `docs/known-issues.md`（CURRENT_TASK 留一行連結）。收官段落保持精簡。
- **功能地圖**：`docs/specs/architecture.md` 加一節「功能地圖」，一列一個使用者看得到的功能（建稿、在文章上改、校稿提案／待處理、
  一鍵配圖／生圖、媒體與插圖、核准、發布、作者、網址建議、分類、恢復取消、設定精靈與停用類型、對照、診斷…）：
  畫面元件 → API 路由 → 後端（目前是 `service.ts` 的哪一區）→ 規格 → 主要測試檔。要用實際程式查證，不憑記憶。
  註明 P5-T004 拆完後要把後端欄更新成檔名。
- `CLAUDE.md` 的地圖表加「功能在哪個檔 → architecture.md 功能地圖」「已知問題 → docs/known-issues.md」。
- `docs/README.md`、`_TEMPLATE.md`：若決策格式或 Task 規則的說法因此要改，同步改（例如完成時要在 plan.md 加一行決策、理由寫在 Task）。

### 不包含
- 改 spec 的內容（`architecture.md` 只加功能地圖一節）。
- 改程式。
- 動 `docs/archive/`、已完成 Task 的內容（只有在搬決策理由時才在「目標」補字）。

## 實作要求
- 冷啟動必讀四檔（CLAUDE.md、plan.md、docs/README.md、docs/CURRENT_TASK.md）改前改後各量一次字元數（`wc -m`），寫進完成結果。
- 每條決策搬動後，自己核對一次：舊段落的每個限制都能在新的一行或被連到的檔案裡找到。

## 驗證
### 自動驗證
`npm run verify` 綠（文件改動不影響，但要跑）。
### 手動驗證
使用者看一眼 plan.md 決策記錄是否還讀得懂。

## 完成定義
- [ ] `npm run verify` 綠
- [ ] 冷啟動四檔字元數前後對照
- [ ] CURRENT_TASK 已更新

## 中斷／接手紀錄
- 最後完成：開 Task（2026-10-01）
- 已通過驗證：—
- 下一步：派 subagent 實作
- Blocker：無

## 完成結果
