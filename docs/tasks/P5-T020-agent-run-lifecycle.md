---
id: P5-T020
phase: 5
status: ready
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
- [ ] `npm run verify` 綠
- [ ] 擁有這些行為的 spec 已更新
- [ ] CURRENT_TASK 已更新

## 中斷／接手紀錄
- 最後完成：尚未開始
- 已通過驗證：—
- 下一步：先寫失敗的測試
- Blocker：無

## 完成結果
