---
id: P6-T004
phase: 6
status: done
depends_on: [P6-T002, P6-T003]
specs: [factcheck.md, security.md, architecture.md, core-service.md, http-api.md, review-proposals.md]
write_paths: ["src/core/factcheck.ts", "src/core/service/factcheck.ts", "src/core/service/context.ts", "src/core/service/agent.ts", "src/core/service/content.ts", "src/core/service/media.ts", "src/core/service/jobs.ts", "src/core/service/types.ts", "src/core/service.ts", "src/core/repository.ts", "src/db/migrations/009-factcheck.ts", "src/db/migrations/index.ts", "src/contract/api-factcheck.ts", "src/contract/factcheck.ts", "src/contract/api.ts", "src/contract/api-enums.ts", "src/contract/api-job.ts", "src/contract/api-requests.ts", "src/server/routes/jobs.ts", "src/server/app.ts", "tests/factcheck-service.test.ts", "tests/factcheck-api.test.ts", "tests/factcheck-verify.test.ts", "tests/migrate.test.ts", "tests/helpers/fake-fetcher.ts", "tests/helpers/core-fixture.ts", "docs/specs/factcheck.md", "docs/specs/core-service.md", "docs/specs/http-api.md", "docs/tasks/P6-T004-factcheck-service.md"]
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
- 跑的期間鎖住內容（跟校稿一致）：`src/contract/agent-run.ts` 的 `taskLocksContent` 對 `factcheck` 預設就回傳會鎖（例外只有 `generate-image`、`suggest-slug`），
  **不需要改那個檔**，但要有測試證明查證跑中時改文章、放圖、套用建議被擋。
- 抓網頁與核對階段沒有 CLI 在跑、`agent_runs` 沒有 running 的那一筆；`jobs.ts` 目前從 `agent_runs` 讀 `agentRun`，要自己組出 running 的
  `agentRun`（`task: 'factcheck'`＋階段），鎖與「另一個 Agent 動作在跑」的互斥在這些階段也要成立。
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
- 密碼：選字或組好的 prompt 含密碼 → 400 `INVALID_INPUT`、假 adapter 沒被呼叫；第一趟回的候選網址任一含密碼 → 整次查證失敗、假取回器一次都沒被呼叫、有稽核事件，錯誤訊息與事件不含密碼。
- 查證跑中（含抓網頁階段）改文章、放圖、套用建議、發起校驗都被擋。
- 後端重啟清理把跑中的查證紀錄結掉。
- migration 009：從 008 升上來、重跑不重複套用（`tests/migrate.test.ts`）。
- API：跨站 403、scope 錯誤 400、選字找不到 400、觀察卡片種類不對 400。
### 手動驗證
無（P6-T005 一起做）。

## 完成定義
- [x] `npm run verify` 綠
- [x] 擁有這些行為的 spec 已更新（http-api.md、core-service.md；factcheck.md 若實作時發現跟規格不同）
- [x] 留下的殘餘寫進完成結果（由主 session 併入 `docs/known-issues.md`）
- [x] CURRENT_TASK 已更新（由主 session；migration head 改 009）

## 中斷／接手紀錄
- 最後完成：流程、儲存、API、測試、spec 更新（2026-10-01，subagent）；migration 009 已在副本驗過並註冊
- 已通過驗證：`npx vitest run` 1812/1813（83 檔；唯一失敗是 `tests/jobs-api.test.ts` 的 JobDetail 欄位清單）；`tsc` 只剩 `src/ui/components/AgentProgress.tsx` 一個錯
- 下一步：主 session 決定兩處範圍外的一行修改（見完成結果「範圍外」），之後 `npm run verify` 應全綠；審查 → commit
- Blocker：兩個範圍外檔案（`src/ui/components/AgentProgress.tsx`、`tests/jobs-api.test.ts`）不在 write_paths

## 完成結果

### 範圍外（需要主 session 裁定，未動）
Task 要求的兩個新增欄位會碰到 write_paths 以外的既有檔，各一行：
- `src/ui/components/AgentProgress.tsx` 的 `TASK_VERB: Record<AgentRun['task'], string>`：`AgentRunTask` 加了 `factcheck`，要補 `factcheck: '正在查證',`（否則 typecheck 失敗）。
- `tests/jobs-api.test.ts`「job 詳情一次給齊前端要的欄位」的欄位清單：補 `'openFactCheckContradictions'`。

### 新檔
`src/core/service/factcheck.ts`（流程、停止、鎖、讀取與結案）、`src/core/factcheck.ts`（純函式：挑主張、候選規劃、輪流分配、核對與降級、`sameExcerpt`）、
`src/contract/api-factcheck.ts`（型別）、`src/contract/factcheck.ts`（共用規則：選字長度、觀察卡片種類、`isExcerptGone`、`countOpenContradictions`）、
`src/db/migrations/009-factcheck.ts`、`tests/factcheck-{service,api,verify}.test.ts`、`tests/helpers/fake-fetcher.ts`。

### 資料表（migration 009）
- `factcheck_runs`：稿件、發起時的 revision、scope、provider、hosted_search、status（running／succeeded／failed／cancelled）、stage（find／fetch／judge／verify）、
  四個計數、judged（第二趟有沒有跑）、兩趟各自的 `agent_runs` id、開始／結束時間、失敗原因。
- `factcheck_findings`：run、稿件、序號、excerpt、claim、verdict、agent_verdict、evidence、correction、sources_json（給畫面的來源清單，不存全文）、
  status（open／dismissed／resolved-by-edit／superseded）、resolved_revision_id、建立／結案時間。blockIndex 與「原句已經改了」讀取時算。

### migration 驗證
1. 先寫 `tests/migrate.test.ts` 的 009 測試（從 008 升上來、重跑不重複、CHECK、刪稿件連帶刪），用 `migrations.slice(0, 8)` 加 `migration009` 在暫存 DB 跑，綠。
2. 唯讀複製 `data/publisher.sqlite`（沒有 -wal／-shm）到系統暫存目錄，對副本套 001–009：之前 001–008，之後 001–009；jobs 15、revisions 83、agent_runs 21、
   review_items 186、image_briefs 11、publish_events 279 前後一樣；重跑不重複套用；`foreign_key_check` 空、`integrity_check` ok。
3. SQL 定稿後才註冊到 `index.ts`；註冊後再拿新的副本用正式清單跑一次，結果相同。`data/publisher.sqlite` 的 sha256 前後不變（72d40c41…）；dev server 全程沒開。
4. **主 session：真的 DB 下次啟動會套 009（migration head 改 009）。**

### 流程與失敗處理
- 派工前（400 `INVALID_INPUT`，不建任何紀錄）：稿件不能改、正文空、選字長度／找不到、觀察卡片不存在／不屬於這篇／種類不對／引的句子已不在文章裡、選字或第一趟 prompt 含密碼。另一個 Agent 動作在跑 502；沒有取回器 503。
- ① 找來源：做得到的帶 `hostedSearch`。回來後先對 AI 給的**全部**候選網址整批查密碼：命中就整次 failed、一個都不抓、記 `factcheck_secret_in_urls`（rejected，不含網址）、502。
  excerpt 拿 `articleTextForAgent` 的輸出比，找不到的丟掉並計數；先丟再截到範圍上限。
- ② 抓：候選＝段落裡的連結 → Agent 網址 → 維基百科；輪流分配（8／3）；每次抓完更新計數。全部沒抓到不跑第二趟。
- ③ 判斷：截斷後編 S1…；第二趟 prompt 再查密碼；`strictNoTools`。
- ④ 核對：拿 `sourceTextForAgent(截短後)` 比；8 字以下不算；降級留 agentVerdict、拿掉 correction。
- 存：同一句的舊 open 結果標 superseded；結果不碰 `review_items`、不建版本、不動核准；事件 `factcheck_completed`。
- 停止：`DELETE /agent` → 停 CLI（有在跑的話）、abort 取回器的 signal（正式的取回器把 signal 接進傳輸層）、兩邊紀錄結成 cancelled；等著的請求拿到 502「查證已停止，沒有留下任何結果」。
- 任何其他失敗：查證紀錄 failed＋`factcheck_failed` 事件。啟動清理：running 的查證紀錄結成 failed＋`factcheck_interrupted`。
- 鎖：查證佔 `activeRuns` 全程（抓網頁時指向第一趟那筆 `agent_runs`，purpose `factcheck`），`createRevision` 一律 502；`JobDetail.agentRun` 由查證紀錄組出來（running、`factCheck.stage`）。

### API
`POST /api/jobs/:uuid/factchecks`（等跑完）、`GET /api/jobs/:uuid/factchecks`、`DELETE /api/jobs/:uuid/factchecks/:id`；`POST /revisions` 多 `resolveFactCheckId`。
契約新增：`AgentRunTask` 多 `factcheck`、`AgentRun.factCheck?`、`JobDetail.openFactCheckContradictions?`（選填，舊的示範資料不用改）。

### 給功能地圖（architecture.md，主 session 加一列）
| AI 查證（選字、觀察卡片、一鍵查證；停止；知道了；去原文改） | （P6-T005） | `POST`／`GET …/factchecks`、`DELETE …/factchecks/:id`、`DELETE …/agent`、`POST …/revisions`（`resolveFactCheckId`） | `factcheck.ts`（純函式 `src/core/factcheck.ts`、取回器 `src/fetch/`） | factcheck、security（取回器） | factcheck-service、factcheck-api、factcheck-verify、factcheck-prompts、factcheck-schema、safe-fetch |
模組表 `src/fetch` 那列的「P6-T004 接進流程」可改成已接上（`server/app.ts` 的 `realFactCheckFetcher`）。

### 給 known-issues
- ~~查證跑的時候「換一張圖」會先把新圖傳上 WordPress，建版本時才被鎖擋下~~ → 已修（見「PR 審查修正：查證與換圖」）。
  剩下：換圖上傳失敗（或上傳回來時工作已不能改）時，核准在上傳前就已撤銷，不會還原（既有行為，跟查證無關）。
- 網頁來源的標題用 Agent 給的（或連結文字、網域）：取回器沒有回頁面 `<title>`。
- 停止時抽文字的 worker 不會被中止（上限 10 秒，結果丟掉）。
- 查證跑的期間取消稿件（`cancelJob`）不會停掉查證，跑完照樣存結果（無害，但會用掉額度）。

### 偏離與不確定
- 被降級的結果不留 `correction`（spec 沒講；已寫進 factcheck.md）。
- 觀察卡片引的句子已不在文章裡 → 400（spec 沒講；已寫進 factcheck.md）。
- 同一網址出現在好幾條主張只給前面那條（spec 只說「只抓一次」）。
- 維基百科搜尋沒找到也列成 fetch-failed 來源，網址記成搜尋頁。
- 鎖內容的錯誤用 502 `AGENT_ERROR`（跟「另一個 Agent 動作在跑」同一類），不是 409。

### 獨立審查修正
- **（medium）定位與存在性改用處理後的文字比**：excerpt 是 AI 照 `articleTextForAgent` 處理後的文字抄的，原文含 ❤️（VS16）或零寬字時拿原文比會對不上。
  `src/core/service/factcheck.ts` 的 `linksNear`（該段連結候選）、`findingView` 的 `blockIndex`／`excerptGone`、`openContradictionCount`，
  一律把區塊、標題、正文與 excerpt 先過 `articleTextForAgent` 再比（`blocksForMatch`：只換 `text`、順序不變，index 照用）。
  `isExcerptGone`（contract）規則不變，註解寫明兩邊都要先過同一套前處理。
  測試：含 VS16 與零寬字的段落 → `excerptGone=false`、`blockIndex` 正確、該段連結列為 article-link 候選、說法不同算進 `openFactCheckContradictions`。
- **（low）抓取前的整批密碼檢查加上搜尋字串**：每條主張（含會被丟掉的）的 `queries[].q` 跟候選網址一起過 `anyUrlContainsSecret`；命中整次失敗、零抓取、
  記 `factcheck_secret_in_urls`（只記 `urlCount`／`queryCount`）。訊息改成「AI 給的網址或搜尋字串裡有你的 WordPress 應用程式密碼，這次查證停止」
  （factcheck.md、http-api.md、core-service.md 同步）。測試：被丟掉的主張的搜尋字串含密碼 → 失敗、取回器零呼叫、事件不含密碼。
- **未做（待主 session 裁定）**：把前處理搬進 `src/contract/`，讓前端示範資料（P6-T005）與 prompt 共用同一份。前處理在
  `src/core/factcheck-prompts.ts`（`textForAgent`，還依賴 `src/core/image-generation.ts` 的 `neutralize`），兩個檔都不在 write_paths。
  目前後端已正確；P6-T005 的示範資料若要自己算 `excerptGone`／`blockIndex`，需要先把這套前處理搬進 contract。

### PR 審查修正（Codex）
- **（HIGH）密碼不進查證資料表**：抓之前在排好候選後再整批檢查**所有**候選（含文章原有連結的網址與文字），命中整次失敗、一個都不抓
  （`SECRET_IN_CANDIDATES_MESSAGE`，事件 `factcheck_secret_in_urls`）。存結果前對每筆要存的文字欄位（excerpt、claim、evidence、correction、
  來源清單的網址／標題／引文／前後文）再檢查一次，命中整次失敗、不存任何結果、記 `factcheck_secret_in_result`（只記筆數）。
  檢查一律用 `anyUrlContainsSecret`（原字串＋網址的解碼形式）。測試：文章連結、無來源時的 claim、evidence、correction 各一案，掃描整個 DB 確認含密碼的列跟查證前一樣。
- **（MEDIUM）儲存是一個交易**：`Repository.transaction`（SAVEPOINT，可巢狀）包住 supersede、寫入全部結果、結成 succeeded、完成事件；
  中途失敗全部回滾，外層把查證紀錄結成 failed。測試：第二筆寫入失敗 → 舊結果仍 open、沒有新結果、紀錄 failed、只有第一次的完成事件。
- 2026-10-01 使用者同意擴大 write_paths 加 `src/core/service/media.ts`：查證中換圖會先改媒體紀錄才被鎖擋下（Codex 審查 medium）。

### PR 審查修正：查證與換圖（Codex，write_paths 加 `src/core/service/media.ts`）
- **換圖**：`replaceMedia` 在撤銷核准、上傳之前先做跟 `createRevision` 同一個內容鎖判斷（`factcheck.assertNotRunning`），鎖住就 502 `AGENT_ERROR`
  「查證正在跑，內容先鎖住…」，什麼都不動。上傳回來後在改本機紀錄、建版本前再查一次（防禦）：鎖住就不改媒體紀錄、不建版本、
  記 `media_replaced` failed、錯誤講清楚新圖留在 WordPress 媒體庫（不自動刪）。
- **反方向**：`runFactCheck` 在 `mediaUploads` 有紀錄（上傳或換圖進行中）時拒絕開始（502「圖片正在上傳或換圖，等它完成再查證」）。
  兩邊從檢查到登記（`mediaUploads`／`activeRuns`）之間都沒有 await，不會交錯，所以上面的防禦分支正常流程到不了。
- **media.ts 其他會建版本的路徑逐一看過**：`placeMedia`、`setFeaturedMedia`、`removeMedia`（要動正文或封面時）第一個寫入就是 `createRevision`，
  鎖在任何副作用之前；`removeMedia` 不動正文時只移掉本機圖片清單，不算內容改動。`addMedia` 上傳本身不改內容；
  自動設精選／自動放圖靠 `contentRunActive`（查證的 purpose 也算鎖內容），回「AI 還在跑」不建版本。
- **沒照指示做的一點**：防禦分支裡核准**仍會被撤銷**——撤銷核准仍在上傳之前（既有順序）。要改成上傳回來才撤銷，
  `tests/publish-path-guards.test.ts`「換圖上傳期間重新核准再發布」要改寫（它在上傳途中重新核准，順序改了之後核准還有效、重新核准會丟錯），
  那個檔不在 write_paths。正常流程到不了防禦分支，所以實際影響只剩「上傳失敗時核准已撤銷」這個既有行為。
- 測試（`tests/factcheck-service.test.ts`「查證與換圖互斥」）：查證中換圖 → 拒絕、零上傳、媒體紀錄／正文／版本數／核准都不變；
  換圖上傳途中開始查證 → 被拒、adapter 零呼叫、沒有查證紀錄，換圖照常完成；防禦分支 → 媒體紀錄、正文、版本不變，事件 failed、訊息提到媒體庫。
