---
id: P5-T027
phase: 5
status: done
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
- 最後完成：實作＋測試＋spec（2026-09-27），未 commit
- 已通過驗證：`npm run verify` 63 檔 / 1153 測試全綠；`?fixtures=1` 截圖（改描述 → 一鍵配圖 → 描述保留、標「你改過」）
- 下一步：主 session 審查 → commit；使用者手動驗證（改封面描述 → 按「校驗」→ 描述仍是自己的）
- Blocker：無

## 實作紀錄
- 「改過」＝這條有 `image_brief_edited` 事件且 `detail.field = 'prompt'`（`repo.promptEditedBriefIds(jobId)`，用 `json_extract`
  查 `publish_events`，限同一篇稿件）。沒加欄位、沒加 migration。改過一次就一直算改過：改回跟 AI 原本一字不差也算
  （事件不記內容，也沒存 AI 原版可比）；沒有「交還給 AI」。使用者那條改的是 `note`，不算。
- `storeImageBriefs`：同 key 且上一條是 Agent 那條、改過 → `prompt` 用資料庫裡的（使用者的）；其他欄位照常換成 Agent 的。
  判斷：用途、比例、alt、說明、位置、錨點使用者在卡片上改不了，Agent 對著新稿給的比較準，所以照常更新。
- 比例沒變時連 `agent_run_id` 都不換：生圖只看描述＋比例（`buildImagePrompt`），照使用者描述生好的候選圖仍然對，不讓它過時；
  比例變了照常過時。沒改過的那條行為不變（重提就過時）。
- `image_briefs_proposed` 事件多 `keptUserPrompt`（只記 key）。
- 契約：`ImageBrief.promptEdited: boolean`（additive）。UI：卡片頭上灰色小膠囊「你改過」（鉛筆）；編輯說明加「之後 AI 再給建議也不會蓋掉」。
- `?fixtures=1`：一鍵配圖改成跟後端同一套合併（同 key 保留 id、fulfilled；改過的保留描述、比例沒變留候選圖；沒提到的需求留著）。
  以前示範資料是整份換掉。「請 AI 看一遍」在示範資料本來就不回配圖需求，沒動。
- 既有行為不改（另案）：按過「不要了」的，Agent 再提同 key 會復活；改過描述的那條復活後描述仍是使用者的版本（有測試鎖住）。
- 新增 `tests/keep-edited-brief.test.ts` 12 條。

## 完成結果
