---
id: P0-T002
phase: 0
status: done
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
- [x] `npm run verify` 綠
- [x] 冷啟動四檔字元數前後對照
- [x] CURRENT_TASK 已更新

## 中斷／接手紀錄
- 最後完成：plan.md 決策記錄改一行一條、CURRENT_TASK 瘦身、新增 `docs/known-issues.md`、architecture.md 功能地圖、CLAUDE.md 地圖、README／_TEMPLATE 規則（2026-10-01）
- 已通過驗證：`npm run verify` 綠（70 檔 / 1441 測試）
- 下一步：獨立審查 → 使用者看一眼 plan.md 決策記錄 → commit／PR
- Blocker：無。偏離：write_paths 不含其他 Task 檔與 `docs/adr/`，所以 Task「目標」沒寫到的理由改成短句留在 plan.md 那一行，沒有搬出去

## 完成結果
- 冷啟動四檔 `wc -m`：CLAUDE.md 1449→1580、plan.md 9249→7188、docs/README.md 1341→1495、docs/CURRENT_TASK.md 4808→2596；
  合計 **16847→12859**（−24%）。
- 決策記錄：124 行（33 條段落）→ 42 行（33 條，一條一行；D-029 多一行背景）。
- 舊段落 → 去向核對（「Task」＝該 Task 的目標／範圍已寫；「行內」＝留在 plan.md 那一行）：

| 決策 | 限制／理由去向 | 刻意丟掉的 |
| --- | --- | --- |
| D-001、D-002、D-007、D-009 | 行內結論；理由 → ADR-0003／0004／0002／0001 | — |
| D-003～D-006、D-008、D-010～D-012 | 全部行內（沒有 Task 的早期決策） | — |
| D-013 | 行內（版面、首頁不出現、設計稿連結）；發到哪裡、B0 → P5-T003 | — |
| D-014 | 行內（含「多 agent 流程與 checksum 暫緩」及理由） | — |
| D-015 | 理由 → P5-T002 | — |
| D-016 | 行內（不提供支援、一次一站、不做 API Key＋理由、不支援 CPT、條款未查證）；CPT 理由 → wordpress-site.md；精靈理由 → P8-T002 | 「排在 P5-T001 之後」（已完成的排程） |
| D-017 | 行內（不接 API、先看再上傳、封面自動精選、只有 Codex）；Q-6 → P5-T013 | 「實作交給 subagent」（工作方式已在 CURRENT_TASK） |
| D-018 | 行內（含「編輯」名字誤導）；實測理由 → P5-T014 | — |
| D-019、D-020、D-021 | 結論行內；細節與實測 → P5-T015／P5-T016／P5-T017 | — |
| D-022 | 行內（一趟、省額度、用這張才上傳、沒 Codex 停用）；選填一句 → P5-T018 | — |
| D-023 | 行內（16 條、五個 Task、密碼直接拒絕＋理由）；報告連結 | — |
| D-024 | 行內（預設作者、可改、Author 先講）；實測理由 → P5-T024；Editor 權限事實 → wordpress-site.md「作者」 | — |
| D-025、D-027 | 行內；違反 D-008／審查發現 → P5-T025／P5-T027 | — |
| D-026 | 行內（不自動填＋理由、不用拼音＋理由、日記不用＋理由、計時器） | slug 範例 `a-distant-cry-from-spring-review`（P5-T026 手動驗證有片名例子） |
| D-028 | 行內（格式範圍、不引入套件＋理由、貼上、b/i、後端再驗、補充兩條）；細節 → P5-T028 實作紀錄、security.md | — |
| D-029 | 行內＋一行背景（名稱由來、被佔用的名稱、repo 連結） | — |
| D-030、D-031、D-032 | 行內（含「不做複製成新稿」「不做真刪」及理由）；實測理由 → P5-T029／P5-T030／P5-T032 | — |
| D-033 | 行內（順序、不改行為、一 Task 一 PR、contract 規矩）；行數 → P5-T004、P5-T033～P5-T035 | — |

- CURRENT_TASK：「進行中」只剩 P0-T002；待手動驗證改成表（P5-T024～P5-T032＋P8-T002 精靈真站實跑）；
  已知殘餘整節原樣搬到 `docs/known-issues.md`，收官段落裡零散的殘餘也搬過去（另一節）。丟掉的只有歷史基準數字（P5-T026／T027 時的測試數）與各 Task 的審查輪數（Task 檔裡都有）。
- 功能地圖：19 列，對著 `src/ui/service/client.ts` 的呼叫、`src/server/routes/*.ts` 的路由、`service.ts` 的區段註解與方法位置、`tests/` 檔名查證。
- 獨立審查（2026-10-01）：逐條比對舊決策記錄與 CURRENT_TASK，無資訊遺失；功能地圖 19 列全查過。low 兩條已修：三條路由補檔名、範本完成定義加「殘餘寫進 known-issues.md」。
