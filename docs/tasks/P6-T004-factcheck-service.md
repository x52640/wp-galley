---
id: P6-T004
phase: 6
status: ready
depends_on: [P6-T002, P6-T003]
specs: [factcheck.md, security.md, architecture.md, core-service.md, http-api.md, review-proposals.md]
write_paths: ["src/core/factcheck.ts", "src/core/service/factcheck.ts", "src/core/service/context.ts", "src/core/service/agent.ts", "src/core/service/content.ts", "src/core/service/jobs.ts", "src/core/service/types.ts", "src/core/service.ts", "src/core/repository.ts", "src/db/migrations/009-factcheck.ts", "src/db/migrations/index.ts", "src/contract/api-factcheck.ts", "src/contract/factcheck.ts", "src/contract/api.ts", "src/contract/api-enums.ts", "src/contract/api-job.ts", "src/contract/api-requests.ts", "src/server/routes/jobs.ts", "src/server/app.ts", "tests/factcheck-service.test.ts", "tests/factcheck-api.test.ts", "tests/factcheck-verify.test.ts", "tests/migrate.test.ts", "tests/helpers/fake-fetcher.ts", "tests/helpers/core-fixture.ts", "docs/specs/factcheck.md", "docs/specs/core-service.md", "docs/specs/http-api.md", "docs/tasks/P6-T004-factcheck-service.md"]
contract_change: additive
expected_commit: "feat(P6-T004): 查證流程、儲存與 API"
---

# 查證流程、儲存與 API

## 目標
D-034。把 P6-T002 的取回器與 P6-T003 的兩趟 Agent 串成一次查證（找來源 → 抓 → 判斷 → 核對），存起來、給 API。
做完後端完整可用，畫面還沒有（P6-T005）。

## 範圍
### 包含
- `src/core/service/factcheck.ts`：整條流程、佔用 Agent 名額、分段進度、啟動清理；停止接進既有的 `cancelAgentRun`（`agent.ts`），要能中止正在抓的請求。
- `src/core/factcheck.ts`（純函式，好測）：來源挑選與分配、引文核對、降級、`superseded` 判斷。
  前後端都要的規則（例如「原句已經改了」的判斷）放 `src/contract/factcheck.ts`（D-033：示範資料不重寫規則）。
- migration 009：查證紀錄與查證結果兩張表（欄位照 factcheck.md「存下來的結果」）。
- API：發起查證（`scope: selection | observation | article`）、讀取這篇的查證結果、結案（`dismissed`）；
  停止沿用 `DELETE …/agent`。存檔時從查證卡片進去改的，跟 `resolveItemId` 同樣的方式結案（`resolved-by-edit`）。
- 契約：`api-factcheck.ts`；`AgentRunTask` 加 `factcheck`；`JobDetail.agentRun` 帶查證階段與計數；
  `JobDetail` 帶「說法不同且未結案」的條數給發布面板提醒（不是 blocker）。都是新增欄位。
- `app.ts` 接上真的取回器；測試用假的。
- `http-api.md`、`core-service.md` 補上新路由與方法。
### 不包含
- 畫面、示範資料（P6-T005）。
- MCP（未裁定）。
- 改校稿提案的任何行為；查證不讓核准失效。

## 工作區與 Context
### 必讀入口
`docs/specs/factcheck.md`（整份）、`docs/specs/security.md`「取回器」「本機守門與秘密」（`assertNoAppPassword`）、
`docs/specs/architecture.md`「程式慣例」（migration 規矩）、`docs/specs/core-service.md`、`docs/specs/http-api.md`、
`docs/specs/review-proposals.md`「`blockIndex` 每次讀取時重算」；做法參考 `src/core/service/agent.ts`（`suggestSlugs`、取消、名額）。
### 不應載入
`src/ui/`、`docs/archive/`、adapter 內部（只透過 P6-T003 的介面用）。
### 驗證命令
`npx vitest run tests/factcheck-service.test.ts tests/factcheck-api.test.ts tests/factcheck-verify.test.ts tests/migrate.test.ts`、`npm run verify`

## 實作要求
- **測試絕不呼叫真實 CLI、絕不連真實網路**：用假 adapter（P6-T003 的）＋假取回器（`tests/helpers/fake-fetcher.ts`，注入假 DNS／假回應）。
- **migration 規矩**（architecture.md「程式慣例」）：先寫測試，**先在記憶體 DB 與 `data/publisher.sqlite` 的副本上驗過、SQL 定稿，最後才註冊到 `index.ts`**——
  dev server 的 `tsx watch` 一重載就套到真的 DB，之後 SQL 一個字都不能改。不要在 dev server 開著時註冊。
- 兩趟組好的 prompt、選字、每個要抓的網址都過 `assertNoAppPassword`，在派工與抓取之前。
- 查證結果不寫進 `review_items`；跑校驗、丟棄提案都不能動到查證結果（有測試）。
- 先寫測試再實作。

## 驗證
### 自動驗證
`npm run verify` 綠。至少：
- 降級：`supported`／`contradicted` 沒有 `found` 引文 → `unverifiable` 且 `agentVerdict` 保留；少於 8 字的引文不算。
- 引文用不存在或不屬於這條主張的 `ref` 被丟；漏回的主張記 `unverifiable`。
- 某條沒抓到 → 那條 `unverifiable`；全部沒抓到 → 不跑第二趟（假 adapter 斷言只被呼叫一次）。
- 停止：第一趟中、抓取中、第二趟中各停一次，都不存結果。
- 互斥：另一個 Agent 動作在跑時發起被拒；查證在跑時校驗被拒。
- 跑校驗、丟棄提案後查證結果還在；excerpt 重算 blockIndex；內容改掉後讀取時算成「原句已經改了」；同一句再查，舊的變 `superseded`。
- 密碼在選字、prompt、網址裡被擋（`INVALID_INPUT`），一個請求都沒發。
- 後端重啟清理把跑中的查證紀錄結掉。
- migration 009：從 008 升上來、重跑不重複套用（`tests/migrate.test.ts`）。
- API：跨站 403、scope 錯誤 400、選字找不到 400、觀察卡片種類不對 400。
### 手動驗證
無（P6-T005 一起做）。

## 完成定義
- [ ] `npm run verify` 綠
- [ ] 擁有這些行為的 spec 已更新（http-api.md、core-service.md；factcheck.md 若實作時發現跟規格不同）
- [ ] 留下的殘餘寫進完成結果（由主 session 併入 `docs/known-issues.md`）
- [ ] CURRENT_TASK 已更新（由主 session；migration head 改 009）

## 中斷／接手紀錄
- 最後完成：開 Task（2026-10-01，P6-T001）
- 已通過驗證：—
- 下一步：等 P6-T002、P6-T003 合併後派 subagent 實作
- Blocker：P6-T002、P6-T003 未完成

## 完成結果
