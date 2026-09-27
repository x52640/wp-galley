---
id: P5-T027
phase: 5
status: in_progress
depends_on: [P5-T025]
specs: [agent-tasks.md, core-service.md, design-system.md]
write_paths: ["src/core/", "src/contract/", "src/ui/", "tests/", "docs/specs/", "docs/tasks/P5-T027-keep-edited-brief.md", "docs/CURRENT_TASK.md"]
contract_change: additive
expected_commit: "fix(P5-T027): 使用者改過的配圖描述不再被 AI 蓋掉"
---

# 使用者改過的配圖描述不再被 AI 蓋掉

## 目標
D-027。`storeImageBriefs`（`src/core/service.ts`，校稿與一鍵配圖兩條路都會呼叫）→ `repository.ts` 的 upsert 會整列覆蓋 `prompt`。
P5-T025 讓使用者能改描述之後，這等於默默丟掉使用者的編輯。

## 範圍
### 包含
- Agent 回來的配圖需求對上一條**使用者改過描述**的需求（同 job、同 key）時，`prompt` 保留使用者的版本。
  判斷「改過」優先用既有資料（例如 P5-T025 記的 `image_brief_edited` 事件），**不加 migration**；若真的做不到，停下回報。
- 其他欄位（alt、比例、錨點、placement、purpose 等）照現行行為更新；實作者若判斷某欄位保留使用者版本才合理，寫進實作紀錄。
- 卡片上讓使用者看得出這條描述是自己改過的（例如一個小標記「你改過」），文案照 design-system.md。
- `?fixtures=1` 同步。
- spec：`agent-tasks.md` 把 P5-T025 記的「已知行為，待使用者裁定」改成新規則。

### 不包含
- 按過「不要了」的需求被 Agent 再提時會復活（upsert 清掉 `dismissed_at`）：另一個議題，這裡不改，但在 spec 維持記錄。
- 使用者發起的那條（origin=user）：本來就碰不到。

## 實作要求
- 先寫測試：改過→校稿回同 key→描述保留；沒改過→照常更新；改過後又被 Agent 更新其他欄位；多條需求混合。
- 不影響核准、不建新版本。
- 測試不呼叫真實 CLI、不連真實 WordPress。

## 驗證
### 自動驗證
`npm run verify`
### 手動驗證
使用者改封面描述 → 按「校驗」→ 描述仍是自己改的版本。

## 完成定義
- [ ] `npm run verify` 綠
- [ ] 擁有這些行為的 spec 已更新
- [ ] CURRENT_TASK 已更新

## 中斷／接手紀錄
- 最後完成：Task 開立（2026-09-27）
- 已通過驗證：—
- 下一步：派實作 subagent
- Blocker：無

## 完成結果
