---
id: P5-T004
phase: 5
status: ready
depends_on: [P5-T002]
specs: [core-service.md, architecture.md]
write_paths: ["src/core/", "tests/", "docs/specs/core-service.md", "docs/specs/architecture.md"]
contract_change: none
expected_commit: "refactor(P5-T004): 拆分 CoreService"
---

# 拆分 CoreService

## 目標
`src/core/service.ts` 2,474 行，是專案變大後最先卡住的地方。拆成依領域的模組，
對外仍是同一個 CoreService（MCP 與 UI 共用同一實例的規則不變）。

## 範圍
### 包含
- 依領域拆檔（例如 jobs／review／media／publish），行為不變
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
- [ ] core-service.md 標註各方法在哪個檔

## 中斷／接手紀錄
- 最後完成：尚未開始
- 已通過驗證：—
- 下一步：盤點 service.ts 的方法分群
- Blocker：無

## 完成結果
