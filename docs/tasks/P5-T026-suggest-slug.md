---
id: P5-T026
phase: 5
status: done
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
- 最後完成：實作＋測試＋spec 更新，並修完獨立審查的三條（2026-09-27）
- 已通過驗證：審查修正後 `npm run verify` 62 檔 / 1141 測試全綠；`?fixtures=1` 截圖走過閒置、執行中、候選、點選、標題未存、日記
- 下一步：主 session 審查 → commit；之後使用者用真的 Agent 手動驗證（只存草稿）
- Blocker：無

## 完成結果

## 實作紀錄

- **另一份小 schema，不共用校稿那份**（`SLUG_OUTPUT_SCHEMA`，`{ slugs: string[] }`）。「共用同一份」的理由是
  review／images 兩趟本來就要讀整篇、帶回 templateData；這一趟只送標題＋內文開頭，校稿那份的 `templateData` 必填
  且嵌整份模板 schema，Agent 手上沒有它，只能編或把整篇再吐一次（慢、花額度）。這份小 schema 三家 CLI 都吃得下：
  只有一個必填欄位，Codex strict 不用轉 nullable，只濾掉 `maxItems`／`maxLength`；後端照原樣再驗。
- **單個候選不放進 schema 驗格式**（沒有 pattern）：放進去的話一個不合格整趟就失敗、要重跑。改由後端
  `pickSlugSuggestions`（`src/contract/slug.ts`，示範資料共用）逐個丟掉。
- **格式與長度上限**：小寫英數與單個連字號、不以連字號開頭結尾、最多 **60** 字元。比模板 schema（允許底線、上限 80）嚴：
  要短、好讀，而且一定存得進去。使用者自己打的網址照舊只受模板 schema 限制。
- **內文開頭送 600 字**（code point，`SLUG_EXCERPT_MAX`）：標題加前一兩段就看得出在講什麼。不帶模板的 rules.md。
- **用哪個 Agent**：使用者在「請 AI 看一遍」選單選的那家（`loadProvider`，存在 localStorage，沒選過是 Claude）。
- **API**：另開 `POST /api/jobs/:uuid/slug-suggestions`（body `.strict()`，只收 provider），不併進 `POST /agent`：
  回應形狀完全不同，也不想讓 `AgentTask`（會產生提案／配圖的兩種）多一種什麼都不落地的。`AgentRunTask` 多 `suggest-slug`。
- **全丟光**記成失敗（502），訊息「AI 沒給出能用的網址…」；不回空陣列，畫面只有一條錯誤路徑。
- **內容被改過不丟結果**（跟生圖一樣）：候選不落地。所以 `contentRunActive` 不算它，跑的時候上傳圖照常自動放位置。
- **標題改過還沒存時按鈕反灰**：後端讀的是已存的那一版，送出去只會拿到舊標題的建議。
- `neutralize` 從 `image-generation.ts` 匯出共用（標題、內文包進分隔區塊前先處理）。

### 不確定／沒做的

- 真實 CLI 沒跑過（照規定）。三家對這份小 schema 的實際反應、Agent 認不認得「遠山的呼喚」的官方英文片名，要使用者手動驗證。
- MCP（`src/mcp/`）沒有加這個工具：不在 write_paths，而且 Task 沒要求。
- 標題改過未存時，上一次的候選仍留在畫面上（在抽屜按了「儲存」才收起來）。

### 審查後修正（2026-09-27）

1. 密碼檢查改成截斷**前**對整份 templateData 查（原本只查截好的 prompt，密碼跨在第 600 字時前半段會送出）。補跨邊界測試。
2. 候選、失敗訊息、「已停止」與進行中的請求從抽屜元件搬到 `src/ui/lib/slug-suggest-store.ts`（模組層級、以 uuid 為 key）：
   跑的時候關掉抽屜，重開接得回來。在抽屜按「儲存」時收起、換篇時丟掉別篇已經結束的（Workspace）。補 store 測試與截圖。
3. 前端圖片的「放進正文／設精選」鎖定改用 `runLocksContent`（排除生圖與建議網址），`MediaPanel` 與示範資料共用，跟後端一致。

