# Agent 工作類型：一鍵動作、配圖需求、執行中回饋

> 擁有範圍：`AgentTask`（review / images）、三顆一鍵按鈕、`image_briefs`、執行中的回饋。
> 程式：`src/agents/output-contract.ts`（`buildSystemPrompt`、`TASK_BRIEF`）、
> migration 004、`src/ui/components/AgentProgress.tsx`、`panels/AgentPanel.tsx`、
> `panels/MediaPanel.tsx`（`BriefCard`）。

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

## 配圖需求：只做前半段，但不讓人離開發布台

**這裡不生圖。** 三個 CLI 都不能產生圖片（用它們自己的 `--help` 確認過），
圖片生成 API 也還沒選。能自動化的只有前半段：Agent 說出「哪一段該放什麼圖、
prompt 長怎樣、比例多少、alt 寫什麼」，使用者按「複製 prompt」拿去生圖，
回來在**同一張卡片**上傳。

存在 `image_briefs`（migration 004），不是 `review_items`——配圖需求不是
「接受或拒絕」的東西，它是一份採買清單，一條 brief 的下場是「圖片上傳好了」
或「不要了」。`brief_key` 對得上 `media_assets.brief_key`（那一欄 001 就有了，
一直沒有東西去填它），`fulfilled` 就是這樣算出來的。

配圖需求的 API 見 [http-api.md](http-api.md)。

生圖 API 選定之後，接的位置是這張卡片上再多一顆按鈕，資料結構不用動。

## 執行中的回饋

一趟要幾十秒到幾分鐘。那段時間只有一個轉圈圈的話，使用者分不出「還在想」與
「卡死了」。所以：

- **每秒跳一次的計時器**（mm:ss）。動的東西才代表活著。
- **講出它在做什麼**，用 `agentRun.task` 決定講法——「校稿」跟「想配圖」是兩件事。
- **講出大概要多久**（30 秒到 3 分鐘），超過 90 秒換一句話安撫。
- **頂端長條在工作區任何畫面都看得到**。使用者在看校樣或左右對照時不會把右面板
  打開，「還在跑」這件事必須自己找上門。

**沒有百分比進度條**，因為我們真的不知道進度——子行程只在結束時回話。畫一個假的
進度條比誠實的不確定更糟。減少動態時那條長條換成靜止的滿版，進度由計時器的文字負責。

`agent_runs.purpose` 存的就是 task，`AgentRunView.task` 直接讀它，沒有多開欄位。
