---
id: P5-T033
phase: 5
status: done
depends_on: [P5-T004]
specs: [architecture.md, design-system.md]
write_paths: ["src/ui/service/", "src/contract/", "src/core/", "tests/", "docs/specs/architecture.md", "docs/tasks/P5-T033-split-fixtures.md", "docs/CURRENT_TASK.md"]
contract_change: none
expected_commit: "refactor(P5-T033): 拆分示範資料，規則改用 contract 共用函式"
---

# 拆分示範資料，規則改用 contract 共用函式

## 目標
D-033。`src/ui/service/fixtures.ts`（2233 行）是 `?fixtures=1` 的假後端，把後端規則再寫一遍，已多次跟後端不一致（P5-T031 Codex 審查）。

## 範圍
### 包含
- 照 P5-T004 拆完的後端領域拆成 `src/ui/service/fixtures/` 底下多個檔（資料、各領域 handler），對外 `api` 介面不變。
- 盤點 fixtures 裡**重寫的後端規則**（狀態判斷、blocker、驗證、結案判斷…），能抽成純函式的搬進 `src/contract`，前後端共用；
  抽不了的（依賴 DB）列成清單寫進 Task 完成結果。一次只抽確定行為相同的，不改後端行為。
- 更新 architecture.md 功能地圖的 fixtures 欄（若有）。

### 不包含
- 改任何使用者看得到的行為（示範資料內容可以不動）。

## 實作要求
- 重構不改行為：`npm run verify` 測試數不減；抽到 contract 的函式補單元測試。
- `src/contract` 不得 import 外部模組（`tests/contract.test.ts` 守著；P5-T004 若放寬為允許同資料夾相對路徑，照放寬後的規則）。
- `?fixtures=1` 用 `scripts/ui-drive.mjs` 走過主要流程（總覽、文章、校稿、配圖、發布面板、精靈）無錯誤。

## 完成定義
- [x] `npm run verify` 綠，測試數不減
- [x] 抽到 contract 的規則與抽不了的清單寫進完成結果
- [x] CURRENT_TASK 已更新

## 中斷／接手紀錄
- 最後完成：拆檔、抽 contract、後端改用、`?fixtures=1` 走查、文件收尾（2026-10-01）；未 commit
- 已通過驗證：`npm run verify` typecheck 通過、Vitest 71 檔 / 1472 測試（基準 70 / 1449）；ui-drive 走查八條流程無例外
- 下一步：主 session 審查 → commit → PR；這個分支疊在 `fd5f473`，P5-T004 之後又加了 `be10916`、`217ed4f`（contract 守門改 AST），開 PR 前要 rebase 並重跑 verify
- Blocker：無

## 完成結果

### 拆檔（`src/ui/service/fixtures.ts` 2233 行 → 48 行＋`fixtures/` 15 檔）
對外不變：`fixtures.ts` 仍是入口，轉出 `fixtureApi`、`FIXTURE_SETUP_SCENARIOS`、`setFixtureSetupScenario`、`FixtureSetupScenario`。
各領域用 `Pick<PublisherApi, …>` 宣告，入口用展開拼回 `PublisherApi`（漏方法 typecheck 會擋）；領域之間互相呼叫改成直接叫對方的物件（`mediaApi.placeMedia`、`reviewApi.resolveReview`），不經 `this`。

| 檔 | 行 | 內容 |
| --- | --- | --- |
| `data.ts` | 424 | 發布目標、正文、校對符號、待處理清單、配圖需求、`revision()` |
| `store.ts` | 219 | `FixtureJob`、`base*`、每篇示範稿件的初始狀態 |
| `context.ts` | 99 | 讀稿件、拆正文、換一版正文、撕核准、`delay`／`clone` |
| `jobs.ts` | 103 | listJobs、createJob、getJob、cancelJob、restoreJob |
| `content.ts` | 157 | createRevision、listRevisions、render、fetchPreview(Hash)、校樣文件 |
| `agent.ts` | 149 | runAgent、suggestSlugs、cancelAgent |
| `review.ts` | 218 | resolveReview、acceptWholeReview、discardReview、fetchComparison（含對照示範資料） |
| `briefs.ts` | 44 | dismissImageBrief、updateImageBrief |
| `images.ts` | 132 | 生圖狀態、generateBriefImage、requestImageAtPosition、useImageCandidate |
| `media.ts` | 154 | addMedia（自動放位置／設精選）、replaceMedia、removeMedia、placeMedia、setFeaturedMedia |
| `approval.ts` | 31 | approve、revokeApproval |
| `publish.ts` | 36 | publish |
| `terms.ts` | 32 | listTerms、createTerm |
| `authors.ts` | 82 | 作者情境、listAuthors、setDefaultAuthor |
| `setup.ts` | 368 | 設定精靈情境與 listTargets／setup 方法 |

### 抽到 `src/contract` 的規則（後端改用，行為不變；單元測試 `tests/contract-rules.test.ts`）
| 規則 | 檔 | 後端改用處 | 示範資料原本 |
| --- | --- | --- | --- |
| 請 AI 配一張的錨點 `positionAnchor` | `position-anchor.ts`（新） | `core/image-generation.ts` 改成轉出 | `fixtureAnchor` 抄一份 |
| 照錨點自動放的決定與說法 `placeByAnchor`、換一張 `replacedResult`、AI 在跑／已有封面／已設精選的固定結果 | `auto-place.ts`（新） | `service/media.ts` autoPlace／replaceInBody／autoFeature | 整段抄一份 |
| Agent 動作鎖不鎖內容 `taskLocksContent`／`runLocksContent` | `agent-run.ts`（新） | `service/media.ts` contentRunActive | 借 `ui/lib/agent-tasks.ts` |
| 待處理清單沒處理完 `isOpenReviewState`／`countOpenReviewItems`、blocker 文字 `pendingReviewBlocker` | `review-state.ts`（新） | `service/review.ts` 四處、`service/jobs.ts` blockersFor | 兩處自己數、自己組字 |
| 恢復回到哪裡 `restoreStateFor`、能回的清單 `RESTORABLE_STATES`、進行中的稿件 `isOpenJobState` | `job-states.ts`（新） | `service/jobs.ts` restoreTargetOf、`state-machine.ts` 的 `CANCELLED` 列、`service/setup.ts` openJobCountsByTarget | 自己寫 |
| 卡片能改哪一欄 `briefEditFieldError`、描述檢查 `checkBriefPrompt` | `brief-prompt.ts`（加） | `service/briefs.ts` | 自己寫 |
| 想要什麼樣的圖檢查 `checkUserNote` | `user-note.ts`（加） | `service/briefs.ts`、`service/images.ts` | 兩處自己寫 |

審查修正（low）：示範資料的取消改用 `job-states.ts` 的 `canCancel`／`cancelRejectedMessage`（後端仍用轉移表；`tests/state-machine.test.ts` 逐一比對兩者與 `InvalidTransitionError` 的訊息），PUBLISHED／PUBLISHING／FAILED 等不能取消，訊息跟後端一字不差。

示範資料因此唯一的行為差異：恢復「取消前是 PUBLISHED／PUBLISHING／FAILED」的稿件改回 SOURCE（跟後端一樣）；後端本來就不准從這些狀態取消，只有示範資料湊得出來。

### 抽不了（或這次不抽）的清單
| 規則 | 原因 |
| --- | --- |
| blockers（`blockersFor`） | 示範資料每篇手寫、跟後端不同（例如 RENDERED 後端是「還沒看過校樣」、示範是「還沒核准」；不模擬 WordPress 未設定）。共用會改示範畫面，Task 不包含 |
| 核准失效 `invalidateApproval` | 依賴 DB 與事件；示範資料只撕印章 |
| 拆頂層區塊、區塊純文字 | 後端用 parse5，contract 不能 import；示範資料用 DOMParser |
| 逐項套用、已經改好了（`applyChanges`、`isAlreadyDone`） | 後端在標籤外定位、檢查長度與刪字；示範資料是簡化的字串取代，不相同 |
| 配圖需求覆蓋（P5-T027 upsert） | 後端在 DB 裡依事件判斷 promptEdited、比對 agent_run；示範資料是簡化版 |
| 放位置的索引換算（`placeMedia`） | 後端在 `html-blocks.ts` 用 parse5 操作；示範資料操作字串陣列 |
| 停用類型（`applyDisabledTargets`／`mergeSiteTargets`） | 在 `src/wordpress/setup.ts`（write_paths 外），且後端另驗未知 key，示範資料沒有 |
| 發布時選作者（`resolvePublishAuthor`） | 行為不同：預設作者不在名單時後端拒絕、示範資料默默不送 |
| createRevision 的整理與「沒改就不建版本」 | 示範資料不跑 `normalizeEditedBody`（需要 sanitize） |
| 改配圖需求的檢查順序 | 示範資料先擋「Codex 正在畫」、後端先擋欄位；各段規則已共用，順序照舊 |
| 各種錯誤訊息（停用類型、已有 Agent 在跑、版本換了、超出範圍） | 只是字串、不是規則；示範資料的超出範圍訊息也比後端短 |

### 走查（`?fixtures=1`，ui-drive，無例外）
總覽 12 篇；新日記「建立並打開」進打字模式；f-reviewed 接受一項（6→5）、講標題的卡片「去原文改」游標進標題；f-media 生圖→用這張自動設封面、內文圖「已放進正文第 4 段之後」；f-reviewed「用這張」錨點對不上→「找不到建議的位置…」；f-rendered 在第 1 段之後請 AI 配一張→用這張「已放進正文第 1 段之後」；f-previewed 發布面板正常；f-cancelled 恢復成功；精靈第三步停用日記（顯示「還有 4 篇」）→存→新稿件選單沒有日記。

### 留給之後（write_paths 外）
- `src/ui/lib/agent-tasks.ts` 的 `runLocksContent` 應改成轉出 `contract/agent-run.ts`；`docs/specs/agent-tasks.md:293` 那句「示範資料共用」要改成指向 contract。
- 獨立審查（2026-10-01）：後端被換掉的片段逐一比對，條件、順序、訊息一字不差，無 high／medium。low 已修：示範資料取消規則對齊後端。
  low 待使用者：`src/ui/lib/agent-tasks.ts` 的 `runLocksContent` 與 contract 各一份（不在 write_paths）。
