---
id: P5-T002
phase: 5
status: ready
depends_on: []
specs: [http-api.md, architecture.md]
write_paths: ["src/contract/", "src/ui/service/", "src/server/routes/", "src/core/", "tests/", "docs/specs/http-api.md", "docs/specs/architecture.md"]
contract_change: none
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
- 改變任何 API 行為或欄位（`contract_change: none`）
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
- [ ] `npm run verify` 綠，測試數不少於基準
- [ ] 故意改一個後端欄位名，前端編譯會失敗（手動驗證後還原）
- [ ] architecture.md、http-api.md 更新

## 中斷／接手紀錄
- 最後完成：尚未開始
- 已通過驗證：—
- 下一步：盤點 types.ts 每個型別對應後端哪個定義
- Blocker：無

## 完成結果
