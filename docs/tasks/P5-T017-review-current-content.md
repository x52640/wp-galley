---
id: P5-T017
phase: 5
status: done
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
- [x] `npm run verify` 綠（50 檔／870 測試）
- [x] job 2 的卡片狀態正確（唯讀檢查：`GET /api/jobs/<uuid>/review`）
- [x] 相關 spec 已更新
- [x] CURRENT_TASK 已更新

## 中斷／接手紀錄
- 最後完成：實作＋獨立審查的三個 bug 修正（2026-09-24，subagent）
- 已通過驗證：`npm run verify` 50 檔／870 測試（含審查修正）；dev server 唯讀讀 job 2 提案 6
- 下一步：使用者在畫面上看 job 2 與示範資料（`?fixtures=1` 的 f-reviewed），沒問題就 commit
- Blocker：無

## 完成結果

2026-09-24（subagent）。

**prompt**：`buildUserPrompt` 只送目前這一版的 templateData（「目前的文章」）＋使用者要求，不再送 sourceText；
校稿與一鍵配圖同一個函式。系統指令多一條「before 必須一字不差地引用 templateData 裡目前的文字」，
輸出契約的 `before`／`after` 加了說明。`correctedSource` 從來沒被用過，改成選填、說明「不用填」
（舊輸出照樣合格，省一整篇的輸出）。生圖 prompt 本來就不帶原稿。

**已經改好了**：規則 `isAlreadyDone`（review-apply.ts）——before 找不到、after 找得到（跟套用同一套逐字、標籤外的定位）、
after 至少 6 個字母數字（審查後從「去空白 4 字」改的）、after 不是 before 的一部分、before 非空。讀取時算、不存：`ReviewItem.alreadyDone` 為真時
`state` 回 `skipped`；資料庫不動，所以不需要 migration，GET 也不寫資料。重判 pending／unappliable／按過「保留原文」的；
已接受、自己改了不重判。pendingCount、blockers、總覽數字、結案共用 `openReviewRows`。按接受時碰到的回在
`ReviewResolveResult.alreadyDone`。**結案只看存下來的狀態**（審查後改的，見下）。

**卡片**：已處理清單多「已經改好了」；真的找不到的卡片寫「文章裡找不到「before」…」，拿掉「再試一次」
（重按結果一樣）；定位不到段落的卡片按「自己改」，游標放文章開頭，頂端講找不到。

**job 2（唯讀）**：提案 6 的 47（爲→為，DB 是 unappliable）、48（加頓號，DB 是 pending）顯示「已經改好了」；
49（吃得苦，使用者按過保留原文）也改顯示「已經改好了」；pendingCount 從 7 變 5（剩 5 個觀察）。真實 DB 的狀態沒被改。

**沒做到**：示範資料沒在瀏覽器實際點過（Chrome 擴充沒連上），只有 typecheck；示範資料的 f-reviewed 多了一張
真的找不到（9005）與一張已經改好了（9006）。模板 rules.md 的「原稿」字眼不在 write_paths，沒動。

**獨立審查修正（同日）**：
1. 補字型建議會把字重複（「很多事→很多事情」在文章已是「很多事情」時按接受得到「很多事情情」）：
   before 落在對齊的完整 after 裡不算數（`isInsideAligned`，contract/text-match.ts），套用定位、`isAlreadyDone`、
   卡片段落（`locateItem`）、字上標記與「自己改」的游標全部用同一條。別處還有獨立的 before 就套到那一個
   （它真的沒改，卡片與標記也指著它）。
2. 字數門檻只算字母數字（`\p{L}\p{N}`），門檻 6：「的時侯，→的時候，」、「好的我→好的，我」不再判成改好了。
3. 自動結案只看存下來的狀態，推算的「已經改好了」不算：拿掉「任何新版本存好後檢查結案」與按接受碰到
   已改好時的結案；全部都已改好時提案仍開著（pendingCount 0），文章改回去卡片會回來（有測試）。
4. 「文章裡找不到」的提示改看 `state === 'unappliable'`（改標題的建議沒有段落但找得到，不該提示）；
   逐字對不上但知道段落的，提示寫「游標放在第 N 段開頭」。
補的測試：補在後面／前面、別處有獨立 before、混合一批（套上＋已改好＋找不到）、同一批前一項造出後一項的 after、
推算的已改好不結案＋改回去會回來、標點不算字。
