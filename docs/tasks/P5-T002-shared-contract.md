---
id: P5-T002
phase: 5
status: done
depends_on: []
specs: [http-api.md, architecture.md]
write_paths: ["src/contract/", "src/ui/service/", "src/server/routes/", "src/core/", "tests/", "docs/specs/http-api.md", "docs/specs/architecture.md"]
contract_change: additive
expected_commit: "refactor(P5-T002): 前後端共用同一份 API 型別"
---

# 前後端共用 API 契約

## 目標
D-015。`src/ui/service/types.ts`（471 行）是照後端手抄的，後端改欄位前端不會知道。
UI 要照 D-013 大改之前先把這條縫補起來，否則改版時兩邊一起動，漂移更難抓。

## 範圍
### 包含
- 新增 `src/contract/`：HTTP 回應形狀的唯一定義，前後端都 import 它
- `src/ui/service/types.ts` 改成從 `src/contract/` 轉出，刪掉手抄部分
- 路由回應在編譯期對齊契約（型別層面即可，是否加 runtime 驗證於實作時提案）
### 不包含
- 改變任何 API 行為或欄位（`contract_change: additive`）
- UI 畫面變更

## 工作區與 Context
### 必讀入口
`docs/specs/http-api.md`、`docs/specs/architecture.md`（依賴方向）
### 不應載入
design-system.md、factcheck.md、mcp.md
### 驗證命令
`npm run verify`

## 實作要求
- `src/contract/` 不得 import Fastify、React、`node:*`，前後端都要能用。
- 依賴方向要寫進 architecture.md。
- `fixtures.ts` 也要吃同一份型別，fixtures 對不上契約要編譯失敗。

## 完成定義
- [x] `npm run verify` 綠，測試數不少於基準
- [x] 故意改一個後端欄位名，前端編譯會失敗（手動驗證後還原）
- [x] architecture.md、http-api.md 更新

## 中斷／接手紀錄
- 最後完成：全部
- 已通過驗證：`npm run verify` 32 檔 / 522 測試；`npm run build` 通過；故意改欄位名與多送欄位兩種漂移都會編譯失敗
- 下一步：無（已收官）
- Blocker：無

## 完成結果

- 新增 `src/contract/api.ts`：線上形狀的唯一定義，不 import 任何東西。
- 後端：`service.ts` 的對外型別、`JOB_STATES`、ProofMark／CompareRow／DiffSegment、
  Agent 輸出的 ReviewChange／Observation／ImageBrief 全部改從契約來；路由每個 handler
  標註回應型別；`REQUEST_CONTRACT_CHECK` 在編譯期比對 zod schema 與契約欄位。
- 前端：`types.ts` 改成轉出契約，只留 Blob 上傳、`LoadedJob`、`PublisherApi`；
  `client.ts` 用契約的回應信封；fixtures 用 `Writable<>` 扮演後端。
- 新增 `tests/contract.test.ts`：契約不得 import、狀態機用的是契約那份狀態清單。

**比對時抓到的三個漂移：**
1. 前端送 `expectedContentHash`，後端 zod 默默丟掉，保護不存在 → 開 P5-T005。
2. `JobDetail.target.allowCreateTerms` 前端在讀、後端從沒送，分類面板永遠當成「關閉」→
   本 Task 補上（additive，加了測試）。
3. `AgentRunResult.imageBriefs` 後端回的是沒有 id 的草稿，前端型別與 fixtures 當成存好的
   樣子 → 契約分成 `ImageBriefDraft` 與 `ImageBrief`，fixtures 已修。
