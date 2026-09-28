---
id: P5-T029
phase: 5
status: done
depends_on: [P5-T028]
specs: [state-machine.md, core-service.md, http-api.md, templates.md, design-system.md, security.md, review-proposals.md]
write_paths: ["src/ui/", "src/core/", "src/contract/", "src/server/routes/", "src/templates/", "tests/", "docs/specs/", "docs/tasks/P5-T029-write-in-place.md", "docs/CURRENT_TASK.md"]
contract_change: additive
expected_commit: "feat(P5-T029): 新稿件直接在文章上寫，標題在文章上直接改"
---

# 新稿件直接在文章上寫，標題在文章上直接改

## 目標
D-030。新稿件畫面（`NewJob.tsx`）的內文大框沒有工具列、不會自動存檔；打字模式裡又改不到標題。

## 範圍
### 包含
- **新稿件畫面**：只留類型與標題（日記的「用今天」保留），拿掉內文大框。按「建立並打開」→ 進文章畫面並**直接進入打字模式**，
  游標在內文開頭。
- **允許空內文建稿**：後端建稿與後續流程要接受空的正文（或一個空段落）。確認空正文時：校樣顯示得出來、可以直接打字、
  AI 動作（校稿、一鍵配圖、建議網址）與渲染／核准／發布在內文是空的時候**不會壞**——要嘛停用並說明「先寫點內容」，要嘛照常。
  **不能發布空文章**：發布前置檢查要擋，訊息講清楚。模板 schema 若要求 body 非空，找出在哪一層擋、怎麼放寬最小（不要放寬到發布）。
- **拖放檔案、總覽 ⌘V 貼上建稿**保留：這兩條路帶著原稿建立，行為照舊（可以直接建立並打開，不必再經過一個只有類型的畫面，
  或經過類型選擇畫面——由實作者依現有 JobList 流程判斷，最少改動）。
- **打字模式裡標題可直接改**：文章最上面的標題（目前是「以下外框由網站佈景主題產生」框裡的標題）在打字模式可以點進去改，
  跟內文一起按「儲存」存成同一個新版本。空標題不准存（日記提示 YYYYMMDD）。標題只能是純文字（不接受換行、格式、HTML）。
  「標題與網址」面板照舊可用，兩邊一致。
- `?fixtures=1` 同步。
- spec 更新（擁有這些行為的那幾份）。

### 不包含
- 自動存檔（另案；本 Task 只確保「建立後內容就在後端」，不在打字中途自動存）。
- 修改已發布文章的標題（Q-5）。

## 實作要求
- 改標題與改內文一樣會產生新版本、讓核准失效（照 state-machine.md）。
- 先寫測試：空內文建稿、空內文下各動作的行為、發布擋空文章、標題在打字模式儲存、標題純文字驗證、拖放／貼上建稿不受影響。
- 測試不呼叫真實 CLI、不連真實 WordPress。

## 驗證
### 自動驗證
`npm run verify`
### 手動驗證
使用者：新日記 → 填標題 → 建立並打開 → 直接打字、用工具列 → 在文章上改標題 → 儲存 → 存成**草稿**。

## 完成定義
- [ ] `npm run verify` 綠
- [ ] 擁有這些行為的 spec 已更新
- [ ] CURRENT_TASK 已更新

## 實作紀錄
- **空內文在哪一層放寬**：只放寬 CoreService 的 `createJob`（拿掉「原稿是空的」拒絕）。模板 schema 的 `body.minLength: 1`
  與渲染的「清理後是空字串就拒絕」**都沒動**（`templates/` 不在 write_paths，也不該放寬到發布）：空原稿存成一個空段落
  `<p class="wp-block-paragraph"></p>`（`src/contract/empty-body.ts`，`buildTemplateDataFromSource` 與 `createRevision` 的 editedBody
  整理成空字串時都用它）。「空」＝沒有字、也沒有圖片或影音（`isBlankBody`，前後端共用）。
- **空內文下各動作**：校稿／一鍵配圖（`runAgentReview`）後端 400、前端反灰並說明；核准 400；發布前置檢查第 4 項再擋一次；
  `blockers` 多一條「正文是空的，先寫點內容再發布」（發布面板照舊列成「還不能發布」）。建議網址、在這裡插圖、渲染照常。
  `JobDetail.bodyEmpty` 新增欄位給畫面用。
- **拖放／⌘V 建稿**：路線不變（總覽 → 新稿件畫面選類型 → 建立），新稿件畫面沒有內文框，改成一行「已帶入貼上的原稿，N 字」，
  建立時照舊送 sourceText、不進打字模式（`lib/write-in-place.ts` 的 `newJobRequest`）。
- **標題**：`contenteditable="plaintext-only"`；貼上插純文字、換行攤平；Enter 跳到正文開頭；格式快捷鍵在標題裡不做事。
  存檔 `decideProofSave` 決定送 `editedBody`／`editedTitle` 哪幾個；後端 `editedTitle` 用 `contract/plain-title.ts` 再驗。
- **捲動兩次的 bug**（使用者回報、併入本 Task）：原因是 `measure()` 只量 body 的底邊，漏掉瀏覽器預設的 body 8px 下外距，
  iframe 文件永遠比 iframe 高 7–8px、可以捲；滑鼠停在文章上滾輪先把這幾 px 捲完，外層才動。一般瀏覽就會發生
  （示範資料的樣式有 `body{margin:0}`，所以 `?fixtures=1` 看不到；已改成跟真的模板一樣）。修法：iframe `scrolling="no"`、
  載入後外層用 CSSOM 設 `html { overflow: hidden }`、高度加上 body 下外距／最後一個子元素的下外距／html 下內距與框線、
  打字時瀏覽器為了游標把文件捲下去的，量測時捲回頂端（`scroll` 事件觸發重量）。
  無頭 Chrome 實測（CDP 真的滾輪事件，停在 iframe 上 deltaY=120）：修好後外層 scrollTop 0→120→240、iframe scrollY 一直 0；
  在同一頁把舊行為還原（拿掉 overflow、高度用舊算法：1334 vs 文件 1341）再滾一次，外層 scrollTop 停在 0。
  打 30 行字：iframe 高度跟著長到 2044＝文件 scrollHeight、iframe scrollY 0，外層自動捲到游標，往回滾一次外層就動。

- **對抗性審查 4 條（low）已修**：
  1. 標題只差空白被當成改動：`flattenTitleText` 只把換行（與編輯器塞的 NBSP）換成空格、不合併空白；比較改用 `sameTitle`（兩邊一起正規化）；
     `checkPlainTitle` 只修前後空白，中間空白原樣存。
  2. 標題上限寫死 120：改成照該篇模板 schema 的 `title.maxLength`（`titleMaxLengthFromSchema`；後端讀模板 schema，前端讀新增的
     `JobTemplate.titleMaxLength`），通用文章 200。
  3. 最後一個是浮動圖時高度量不到、被裁：body 用 CSSOM 設 `display: flow-root`；內容超出 iframe 時改用 scrollHeight（差 <4px 維持原高度防來回跳）。
     無頭 Chrome 實測（長文校樣、插入真實模板的 alignright 規則與最後一張 900px 高的 alignright 圖）：iframe 高 2298、圖底 2258、沒裁；
     拿掉 flow-root 用舊算法只量到 1398。
  4. `editOnOpen` 殘留：`keepEditOnOpen` 在 route 變動時作廢（離開那一篇就清掉）、回總覽清掉、工作區載入失敗（或目標不在）也清掉。

## 中斷／接手紀錄
- 最後完成：實作＋測試＋spec（2026-09-28，subagent）
- 已通過驗證：`npm run verify` 66 檔／1363 測試綠（審查修正後）；`?fixtures=1` 無頭 Chrome 走過新稿件→打字→改標題→儲存、空標題被擋、空內文反灰、發布擋空文章、貼上建稿
- 下一步：主 session 審查 → 另派審查 → commit、開 PR；使用者手動驗證（只存草稿）
- Blocker：無

## 完成結果
