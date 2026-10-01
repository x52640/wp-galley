---
id: P5-T004
phase: 5
status: in_progress
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
- `src/contract/api.ts`（1000 行）同樣照領域拆檔。`tests/contract.test.ts` 目前禁止 contract 裡任何 `import`／`export … from`：
  若要由 `api.ts` 重新匯出，守門測試改成**只允許同資料夾的相對路徑**（`./xxx.js`），仍禁止任何外部模組，並同步 architecture.md「依賴方向」的說法；
  或不重新匯出、把各處 import 一次改齊。兩者擇一，寫進 Task 再動手。
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
- [ ] `npm run verify` 綠，測試數不減、既有測試全保留（contract 守門測試每檔一條，拆檔會變多）
- [ ] core-service.md 改成各檔負責什麼、功能地圖後端欄改成檔名
- [ ] CURRENT_TASK 已更新

## 選定做法（動手前寫下，2026-10-01）
- **CoreService 保留為薄門面**：`src/core/service.ts` 只剩建構與一行轉呼叫的公開方法，外部 import 路徑與方法簽名不變。
- **共用狀態放 `src/core/service/context.ts` 的 `CoreContext`**：repo、templates、targets、wordpress、siteId、activeRuns、publishing、
  mediaUploads 等欄位，加上各領域都要的內部小工具（requireJob、payloadOf、renderPayload、toMedia…）。整個行程只有一個 context，
  門面建構時建一個、把各領域模組掛上去（`ctx.content`、`ctx.media`…），模組之間透過 `this.ctx.<領域>.方法` 互相呼叫。
- **各領域是一個 class，建構時拿到 context**（`src/core/service/<領域>.ts`）：setup、jobs、content、agent、review、briefs、images、
  media、approval、publish、authors。方法本體照搬，只把 `this.X` 改成 `this.ctx.X` 或 `this.ctx.<領域>.X`。
  選 class 而不是純函式：測試 spy 的是實例方法（`autoPlace`、`autoFeature`），模組內部仍走 `this.` 呼叫，spy 照樣攔得到；
  測試只需把 spy 對象從 `core` 改成 `core.ctx.media`。
- **核准失效只有一個入口**：`invalidateApproval` 放 `approval.ts`，其他模組一律呼叫 `this.ctx.approval.invalidateApproval`。
- **`api.ts` 拆檔：選「守門測試放寬為同資料夾相對路徑」**。拆成同資料夾的 `api-*.ts`，`api.ts` 只剩 `export * from './api-*.js'`，
  前後端所有 import 都不用改。`tests/contract.test.ts` 改成：import／export-from 只准 `./xxx.js`，其他一律禁止；architecture.md 依賴方向同步改。

## 中斷／接手紀錄
- 最後完成：service.ts 拆成門面（336 行）＋ `src/core/service/` 13 檔；api.ts 拆成 7 個 `api-*.ts`；守門測試放寬；core-service.md、architecture.md 已改
- 已通過驗證：`npm run verify` 綠，70 檔 / 1449（基準 1441；contract 守門每檔一條 +7、守門規則自測 +1）。方法本體逐一比對原檔，只差 `this.` → `this.ctx.` 的改寫
- 下一步：審查 → commit；CURRENT_TASK 由主 session 更新。範圍外待修：state-machine.md 第 4 行、wordpress-site.md 第 32、48 行仍指向 `src/core/service.ts`
- Blocker：無

## 完成結果
- 獨立審查（2026-10-01）：用 TypeScript 解析器自動比對 134 個方法、門面 43 個公開方法、contract 97 個匯出，全部一致，行為不變。
  low 已修：contract 守門測試改用 `ts.preProcessFile`（regex 擋不住同一行兩個敘述）；core-service.md 補 `getReview`。
  low 待使用者：`state-machine.md`、`wordpress-site.md` 三處舊路徑 `src/core/service.ts`（不在 write_paths）。
