# Agent 工作類型：一鍵動作、配圖需求、執行中回饋

> 擁有範圍：`AgentTask`（review / images）、三顆一鍵按鈕、`image_briefs`、用 Codex 生圖（D-017）、
> 執行中的回饋。
> 程式：`src/agents/output-contract.ts`（`buildSystemPrompt`、`TASK_BRIEF`）、
> migration 004／005、`src/core/image-generation.ts`、`src/ui/components/AgentProgress.tsx`、
> `AgentButton.tsx`、`panels/MediaPanel.tsx`（`BriefCard`）。

三件事都來自實際用起來的問題（2026-08-28，D-010）。

## 一鍵動作：常做的事不該要打字

發文絕大多數是**針對內容**發的，校對只是順手做一次。原本要先想一句話打進框裡
才按得下去，等於把最常做的事變成最麻煩的事。所以校稿面板改成三顆直接送出的按鈕：

| 按鈕 | task | 給什麼 |
| --- | --- | --- |
| **一鍵校驗**（主要） | `review` | `changes` ＋ `observations` 一起 |
| 只找錯字 | `review` | 只有 `changes`，不動語意也不提疑點 |
| 一鍵配圖 | `images` | 只有 `imageBriefs` |

打字那條路留給「要它針對內容做別的事」的時候。

三趟**共用同一份 output schema**（多一份 schema 就多一個要維護的東西），差別靠
`buildSystemPrompt(template, task)` 裡的 `TASK_BRIEF`。用不到的欄位明講「給空陣列」，
模型才不會為了填滿欄位硬擠內容。

## `AgentTask` 決定結果怎麼落地

`images` 那一趟**不建立提案，也不驗 templateData**。兩個理由：

1. `runAgentReview` 每跑一次就會把舊提案結掉。共用容器的話，按一次「一鍵配圖」
   就會把還沒清完的校稿清單洗掉。
2. 那一趟根本沒有要改文章，為了一份用不到的 templateData 讓整趟失敗只是找麻煩。

## 配圖需求：一份採買清單

「一鍵配圖」讓 Agent 說出「哪一段該放什麼圖、prompt 長怎樣、比例多少、alt 寫什麼」。
每張卡片之後可以直接「用 Codex 生圖」（下一節），也可以「複製 prompt」拿去別處生、
回來在**同一張卡片**上傳。

存在 `image_briefs`（migration 004），不是 `review_items`——配圖需求不是
「接受或拒絕」的東西，它是一份採買清單，一條 brief 的下場是「圖片上傳好了」
或「不要了」。`brief_key` 對得上 `media_assets.brief_key`（那一欄 001 就有了，
一直沒有東西去填它），`fulfilled` 就是這樣算出來的。

配圖需求的 API 見 [http-api.md](http-api.md)。

### 封面那一條

判斷在 `src/core/image-generation.ts` 的 `isFeaturedBrief`：

1. 目前這一版 templateData 有字串 `featuredImageBriefKey`（longform-v1 的正式做法）時**只認它**，
   其他訊號一律不看。
2. 沒有的話（「一鍵配圖」不動 templateData，這是常態），任一成立就算：key 以 `featured` 或 `cover`
   開頭（實際資料裡 Agent 就這樣取名，`TASK_BRIEF.images` 也明講）；placement **開頭**是「精選圖片」或
   「封面」（只看開頭：「放在『精選書單』那段之後」不算）。

`ImageBrief.isFeatured` 就是這個結果。對上封面那條的圖上傳之後，**在沒有別的封面時**自動設成精選——
不論是「用這張」還是手動「上傳這張」，都在 `CoreService.addMediaWithOutcome` 裡做（`autoFeature`）：

| 目前的精選圖片 | 結果（`AutoFeatureResult.outcome`） |
| --- | --- |
| 沒有 | `set`：設成這張 |
| 就是這條需求的圖（封面「換一張」） | `set`：換成新的 |
| 使用者選的別張 | `kept-existing`：**不覆蓋**，卡片上講「已經有封面了；要換成這張，按圖片上的『設為精選』」 |
| 設的時候失敗 | `failed`：上傳照樣成功，卡片上講原因，另記一筆 `auto_featured` 失敗事件 |

設精選是內容改動，照 [state-machine.md](state-machine.md) 撤銷核准；封面卡片上（生圖與手動上傳兩條路）
在目前有有效核准時會先提醒「換封面會讓目前的核准失效」。

## 用 Codex 生圖（D-017，P5-T013）

**只有 Codex 能生圖**（實測見 [agent-cli.md](agent-cli.md)「Codex 生圖」）。能不能生由 adapter
有沒有 `generateImage` 決定；Codex 沒裝、沒登入時 `GET /api/image-generation` 回
`available: false` 與原因，卡片上的按鈕不給按並把原因寫出來。

流程：

1. 卡片「用 Codex 生圖」→ `POST /api/jobs/:uuid/briefs/:id/generate`，要等 Codex 畫完才回。
2. 後端用固定程式組 prompt（`buildImagePrompt`：brief 的 prompt 包在分隔線裡當內容、比例、
   不要文字、只要一張、不要動檔案），交給 Codex。
3. 拿到的位元組**不信任**：類型看檔頭（`src/media/validate.ts` 的 `inspectImage`），再過跟上傳
   一樣的類型與大小檢查；過了才存成候選圖（`generated-images/<job>/candidates/<sha256>.<ext>`，
   `image_candidates` 表，migration 005）。
4. 候選圖顯示在卡片上（`GET /api/jobs/:uuid/candidates/:id`，本機送出，**沒有上傳**）。
   按鈕：「用這張」、「再生一張」；不滿意不用也沒關係，它只留在本機。
5. 「用這張」→ `POST /api/jobs/:uuid/candidates/:id/use` → 走 `addMediaWithOutcome`（帶 briefKey、alt、
   圖說）上傳到 WordPress 媒體庫；封面那條照上表自動設精選。第一個 await 之前就同步搶下這張候選圖
   （`UPDATE … WHERE used_at IS NULL`），兩個同時送來的請求只有一個會上傳；上傳失敗就放回去。
   需求被標成不要了、或候選圖已經過時（見下），都不能用。

規則：

- **候選圖不是內容改動**：不建 revision、不撤銷核准、不改 job 狀態。
- 生圖是 Agent 動作：跟校稿共用「同一篇稿件一次只跑一個」（`activeRuns`）與 AgentRegistry 的
  同一條佇列；取消走同一個 `DELETE /api/jobs/:uuid/agent`；逾時預設 5 分鐘（實測約 54 秒）。
- 記在 `agent_runs`：`purpose = 'generate-image'`、`image_brief_id` 指向那條需求。
  `AgentRun.task` 是 `generate-image`、`AgentRun.briefId` 是那條需求，畫面靠它把計時器掛到對的卡片上。
- 等待期間被取消、稿件變成不能改（發布中、已取消）、或那條需求被標成不要了，圖不收。
  內容被改過**不擋**：候選圖不是對著某一版文字做的。
- 卡片上只顯示每條需求**最新的**那張；最新那張用掉了就不再顯示候選圖（不會冒出更早那張沒選的）。
- 同一個 key 重新提過（upsert 保留 id、換掉 `agent_run_id`，描述與比例可能都變了），之前生的候選圖
  就過時了：不顯示也不能用。判斷是候選圖的 `agent_run_id` 要大於需求的 `agent_run_id`。
- 按「停止」（卡片上或頂端長條）之後，卡片講「已停止」，不當成錯誤。

## 執行中的回饋

一趟要幾十秒到幾分鐘。那段時間只有一個轉圈圈的話，使用者分不出「還在想」與
「卡死了」。所以：

- **每秒跳一次的計時器**（mm:ss）。動的東西才代表活著。
- **講出它在做什麼**，用 `agentRun.task` 決定講法——「校稿」、「想配圖」、「生圖」是三件事。
- **講出大概要多久**（校稿 30 秒到 3 分鐘，超過 90 秒換一句話安撫；生圖「一分鐘左右、生好會先
  放在卡片上給你看，不會自動上傳」，超過 2 分鐘換一句）。生圖時計時器同時出現在那張卡片上。
- **頂端長條在工作區任何畫面都看得到**。使用者在看校樣或左右對照時不會把右面板
  打開，「還在跑」這件事必須自己找上門。

**沒有百分比進度條**，因為我們真的不知道進度——子行程只在結束時回話。畫一個假的
進度條比誠實的不確定更糟。減少動態時那條長條換成靜止的滿版，進度由計時器的文字負責。

`agent_runs.purpose` 存的就是 task，`AgentRunView.task` 直接讀它，沒有多開欄位。

`agent_runs.started_at` 是 SQLite 的 `datetime('now')`（UTC，沒寫時區）。前端一律用
`AgentProgress.tsx` 的 `parseServerTime` 解析；直接 `new Date` 會被當成本地時間，台灣差 8 小時，
計時器停在 00:00（P5-T013 發現並修正）。
