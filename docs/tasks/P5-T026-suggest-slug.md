---
id: P5-T026
phase: 5
status: ready
depends_on: [P5-T025]
specs: [agent-tasks.md, agent-cli.md, http-api.md, core-service.md, security.md, design-system.md, templates.md]
write_paths: ["src/agents/", "src/core/", "src/contract/", "src/server/routes/", "src/ui/", "tests/", "docs/specs/", "docs/tasks/P5-T026-suggest-slug.md", "docs/CURRENT_TASK.md"]
contract_change: additive
expected_commit: "feat(P5-T026): AI 依標題與內文建議英文網址"
---

# AI 依標題與內文建議英文網址

## 目標
D-026。中文文章取英文網址（slug）很難；目前「標題與網址」（`SourcePanel.tsx`）只有空白欄位。

## 範圍
### 包含
- 網址欄旁加「建議網址」按鈕（長文、一般文章；日記不顯示）。按下跑一趟本機 Agent（使用者目前選的那家），
  輸入是**目前這一版**的標題＋內文開頭（上限由實作者定、寫進 spec；不送整篇）。
- Agent 回 3 個候選 slug。知道作品／人物／地名的官方英文名就用它，不照字面翻、不用拼音（寫進 `TASK_BRIEF` 類的系統指令）。
- 候選顯示成可點的選項，點了才填進網址欄（尚未存，照欄位原本的存法）；**絕不自動填、不自動存**。
- 後端驗證每個候選：小寫英數與連字號、不以連字號開頭結尾、不連續連字號、長度上限（定一個並寫進 spec）；
  不合格的丟掉，全丟光就明講「AI 沒給出能用的網址」。
- 沿用現有 Agent 執行生命週期（計時器、可停止、AgentBanner、同一篇同時只能跑一趟），照 D-010 不畫假進度條。
- 這一趟**不建立校稿提案、不改 templateData、不動核准**。
- `?fixtures=1` 假資料服務同步支援。
- spec 更新：`agent-tasks.md`（新 task 類型與規則）、`http-api.md`、`core-service.md`；影響 output schema 的話更新擁有它的 spec。

### 不包含
- 檢查網址是否已被站上別篇使用（WordPress 會自己加 `-2`；之後需要再開）。
- 日記。
- 自動在建稿時就產生。

## 工作區與 Context
### 必讀入口
`src/ui/components/panels/SourcePanel.tsx`、`src/agents/output-contract.ts`、`src/core/service.ts`（runAgent 相關）、
`src/server/routes/jobs.ts`、`docs/specs/agent-tasks.md`、`docs/specs/agent-cli.md`（schema 限制：三家 CLI 對 JSON Schema 的支援不同）。
### 不應載入
`docs/archive/`。
### 驗證命令
`npm run verify`；UI 截圖 `node scripts/ui-drive.mjs`（`?fixtures=1`）。

## 實作要求
- 用共用 output schema 加欄位，還是另一份小 schema：實作者依 `agent-tasks.md`「共用同一份 output schema」的原則與
  `agent-cli.md` 的 CLI 限制判斷，理由寫進實作紀錄。
- 先寫測試：候選驗證（各種不合格格式）、日記不提供、不改 templateData／核准、生命週期（取消、同時一趟）。
- 送進 prompt 的內容照現有遮蔽規則；含 WordPress 密碼照 D-023 拒絕。
- 測試不呼叫真實 CLI、不連真實 WordPress。

## 驗證
### 自動驗證
`npm run verify`
### 手動驗證
使用者用「電影推薦「遠山的呼喚」」這類標題按「建議網址」，確認候選跟內容有關、點了會填入。只存草稿。

## 完成定義
- [ ] `npm run verify` 綠
- [ ] 擁有這些行為的 spec 已更新
- [ ] CURRENT_TASK 已更新

## 中斷／接手紀錄
- 最後完成：Task 開立（2026-09-27）
- 已通過驗證：—
- 下一步：等 P5-T025 commit 後派實作 subagent
- Blocker：無

## 完成結果
