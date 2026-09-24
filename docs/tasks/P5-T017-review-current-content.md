---
id: P5-T017
phase: 5
status: in_progress
depends_on: []
specs: [review-proposals.md, agent-tasks.md, core-service.md, http-api.md, design-system.md, testing.md]
write_paths: ["src/core/", "src/agents/", "src/contract/api.ts", "src/server/routes/", "src/db/migrations/", "src/ui/", "tests/", "docs/specs/", "docs/tasks/", "docs/CURRENT_TASK.md"]
contract_change: additive
expected_commit: "fix(P5-T017): AI 校稿只看目前的文章"
---

# AI 校稿只看目前的文章

## 目標
D-021。使用者 2026-09-24 實測日記（job 2）：提案 6 的錯字「以封建制爲基礎→為」「吃得苦→吃的苦」「加頓號」
按接受都變成 unappliable（「再試一次」），「自己改」也標不出位置。原因：`buildUserPrompt`（service.ts）同時送
「原稿」（revision 的 `source_text`，8/28 貼上後沒再更新）與目前的 templateData；那些錯字 8/28 就改好了，
AI 從舊原稿又挑出來。CURRENT_TASK 早就記著這個殘餘。

## 範圍
### 包含
- 校稿與一鍵配圖（以及生圖若有用到）的 prompt 只給**目前這一版**的內容，不再送過期的 sourceText；
  system prompt／輸出契約裡提到「原稿」的說法一併改對。`correctedSource` 之類依賴原稿的輸出欄位要檢查還有沒有意義
- 逐項套用：`before` 找不到、但 `after` 已經在（那一段／整篇）目前內容裡 → 自動標成已處理（新的結案方式，
  畫面寫「已經改好了」，跟「已接受」「保留原文」「自己改了」分得開），不再給 unappliable
- 讀取清單時也套同一條規則（既有的舊提案，例如使用者 job 2 的提案 6，打開就看到正確狀態）——做在讀取時計算或
  一次性更新都可以，但不能動到使用者真實資料庫以外的東西；若要改 DB 結構用新 migration（dev server 會自動套用到真實 DB，先在複本驗證）
- 真的找不到的 unappliable 卡片：文案直接講「文章裡找不到『before』」，「再試一次」改成說得出用途的字或拿掉；
  「自己改」游標放文章開頭並說明找不到位置
### 不包含
- 更新 sourceText 的語意（它仍是「最早貼上的原稿」的紀錄）

## 實作要求
- 測試絕不呼叫真實 CLI、絕不連真實 WordPress
- 先寫測試：過期原稿不進 prompt；after 已存在自動結案；真的找不到仍是 unappliable 且文案正確
- 更新 review-proposals.md、agent-tasks.md 及相關 spec；CURRENT_TASK 刪掉「sourceText 與正文不一致」那條殘餘（或改寫成已處理）

## 驗證
`npm run verify`；真實後端**唯讀**打開 job 2，確認提案 6 那幾張卡片顯示「已經改好了」（不要按任何會寫入的按鈕，
不要跑 AI）；示範資料走一次真的找不到的卡片

## 完成定義
- [ ] `npm run verify` 綠
- [ ] job 2 的卡片狀態正確（唯讀檢查）
- [ ] 相關 spec 已更新
- [ ] CURRENT_TASK 已更新

## 中斷／接手紀錄
- 最後完成：開 Task
- 已通過驗證：—
- 下一步：交給 subagent
- Blocker：無

## 完成結果
