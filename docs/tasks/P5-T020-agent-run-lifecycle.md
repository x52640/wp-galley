---
id: P5-T020
phase: 5
status: done
depends_on: []
specs: [agent-cli.md, core-service.md, state-machine.md]
write_paths: ["src/agents/", "src/core/", "src/db/", "tests/", "docs/specs/agent-cli.md", "docs/specs/core-service.md", "docs/tasks/P5-T020-agent-run-lifecycle.md", "docs/CURRENT_TASK.md"]
contract_change: none
expected_commit: "fix(P5-T020): 重啟後不再卡在看稿中、取消排隊的校稿不再執行"
---

# 重啟後不再卡在「看稿中」、取消排隊的校稿不再執行

## 目標
D-023。審查 #12、#11。

## 範圍
### 包含
- #12：CoreService 啟動時把 DB 裡所有 `running` 的 agent run 結束成失敗，原因寫「後端重啟，這次沒有完成」。
  `cancelAgentRun` 查不到記憶體中的 run、但 DB 仍是 running 時，也把 DB 那筆結掉。
- #11：`runStructured` 輪到時先檢查是否已取消（照生圖那條的寫法），已取消就不呼叫 adapter。
### 不包含
- 前端輪詢邏輯（後端狀態正確後輪詢自然停止；若驗證發現沒停，停下回報）。

## 實作要求
- 不需要新 migration；若需要，先在 DB 複本驗證才註冊，並停下回報。
- 啟動清理只動 agent_runs 的 running 紀錄，不動 job 狀態以外的東西；清理要寫事件紀錄。

## 完成定義
- [x] `npm run verify` 綠
- [x] 擁有這些行為的 spec 已更新
- [x] CURRENT_TASK 已更新

## 中斷／接手紀錄
- 最後完成：#11、#12 實作＋測試＋spec 更新（2026-09-24）
- 已通過驗證：`npm run verify` 綠，54 檔 / 955 測試（審查修正後）
- 下一步：無。清理時機（第二個後端啟動失敗前會先清掉第一個的 running 工作）使用者裁定先記進已知殘餘，另開 Task。
- Blocker：無

## 完成結果
- #12：`CoreService` 建構時把 DB 所有 `running` 的 agent run（校稿、配圖、生圖）結成 `failed`，
  原因「後端重啟，這次沒有完成」，每筆記 `agent_interrupted` 事件（actor `system`）。只改那幾筆。
  `cancelAgentRun` 記憶體查不到時改查 DB 的 running，結成 `cancelled`、記 `agent_cancelled`。
- #11：`AgentRegistry.runStructured` 輪到時先看 `cancelledRuns`，已取消就回 `cancelled`，不叫 adapter。
- 前端輪詢：`Workspace.tsx` 只在 `agentRun.status === 'running'`（或 PUBLISHING）時輪詢，`agentRun` 取最新一筆；
  重啟後那筆變 `failed` → 輪詢停止、校稿按鈕解除停用。重啟期間 `getJob` 失敗不會清掉 job，輪詢會一直重試到後端回來。
- 審查修正：Agent 回 `!ok` 時只有紀錄仍是 running 才寫結果，已被取消／清理的原因與結束時間不被改寫（校稿、生圖兩處）。
- 新增 `tests/agent-run-lifecycle.test.ts`（7 個，順序用 promise 控制，不靠計時）。spec：`core-service.md`（啟動清理、cancelAgentRun）、`agent-cli.md`（佇列取消）。
- 前提：一個 DB 只有一個 CoreService 行程；MCP 若另起行程共用 DB 要重看（寫在 core-service.md）。
