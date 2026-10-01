---
id: P5-T004
phase: 5
status: ready
depends_on: [P5-T002, P0-T002]
specs: [core-service.md, architecture.md]
write_paths: ["src/core/", "src/contract/", "src/server/", "src/ui/", "tests/", "docs/specs/core-service.md", "docs/specs/architecture.md", "docs/tasks/P5-T004-split-core-service.md", "docs/CURRENT_TASK.md"]
contract_change: none
expected_commit: "refactor(P5-T004): 拆分 CoreService"
---

# 拆分 CoreService

## 目標
D-033。`src/core/service.ts` 開 Task 時 2,474 行，2026-10-01 已 4,000 行，是每個功能的 subagent 都得整份讀進來的檔。拆成依領域的模組，
對外仍是同一個 CoreService（MCP 與 UI 共用同一實例的規則不變）。

## 範圍
### 包含
- 依檔內既有的區段註解拆檔（設定精靈、建立與讀取、內容、Agent、待處理清單、生圖、媒體、核准、發布、作者、內部共用），行為不變。
  做法由實作者選（例如 CoreService 保留為薄門面、各領域是接收共用 context 的模組），先在 Task 寫下選的方式再動手。
- `src/contract/api.ts`（1000 行）同樣照領域拆檔，由 `api.ts` 重新匯出，import 路徑不變或一次改齊。
- `core-service.md` 的方法清單改成「哪個檔負責什麼」；architecture.md 功能地圖的後端欄改成檔名。
### 不包含
- 任何行為或 API 變更

## 工作區與 Context
### 必讀入口
core-service.md、state-machine.md（核准失效必須仍集中在一處）
### 驗證命令
`npm run verify`

## 實作要求
- 核准失效的邏輯只能有一個入口，拆完不可以分散到各模組。
- 與 P5-T002 都動到 `src/core/`，序列化執行。

## 完成定義
- [ ] `npm run verify` 綠，測試數不變
- [ ] core-service.md 改成各檔負責什麼、功能地圖後端欄改成檔名
- [ ] CURRENT_TASK 已更新

## 中斷／接手紀錄
- 最後完成：尚未開始
- 已通過驗證：—
- 下一步：等 P0-T002；之後盤點 service.ts 的方法分群
- Blocker：無

## 完成結果
