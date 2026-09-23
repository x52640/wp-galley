---
id: P5-T010
phase: 5
status: done
depends_on: []
specs: [review-proposals.md, http-api.md, core-service.md, design-system.md, security.md]
write_paths: ["src/core/", "src/contract/api.ts", "src/server/routes/jobs.ts", "src/ui/", "tests/", "docs/specs/", "docs/tasks/", "docs/CURRENT_TASK.md"]
contract_change: additive
expected_commit: "feat(P5-T010): 直接在文章上改"
---

# 直接在文章上改

## 目標
P5-T001 實測，使用者 2026-09-23 同意這個做法：
- 「改原文」抽屜顯示原始 HTML，對寫作者不友善（CURRENT_TASK 已知殘餘）
- 卡片上的「去原文改」打開整篇，要從頭找位置
- 「沒問題」看不懂是什麼意思

## 範圍
### 包含
- 校樣可切換成編輯狀態：`.preview-body` 設成 contenteditable，看到的是排好版的文章，沒有標籤。
  - 卡片「去原文改」→ 游標停在那一項引用的字前面，並捲過去
  - 上方「改原文」→ 同一個模式，游標在開頭
  - 貼上一律當純文字；編輯中暫停字上標記、頁邊符號，右欄與上方動作鎖住（避免編到一半內容被別的動作換掉）
  - 「儲存」送出正文；沒改就直接離開；「取消」還原
- 契約 `CreateRevisionRequest.editedBody?`（additive）：只換正文，其他欄位沿用上一版；
  後端先整理瀏覽器編輯產生的雜訊（`b`→`strong`、`i`→`em`、拆掉 `span`／`font`／`mark`、
  去 `style`、頂層 `div`→`p`、刪空段落、段尾多餘 `br`），再走原本的渲染與 sanitize
- 原抽屜只留標題與網址片段，改名「標題與網址」
- 「沒問題」改名「不用改」

### 不包含
- 格式工具列（粗體、連結按鈕）；鍵盤快捷鍵產生的粗體／斜體會保留
- 後端檢查 expectedContentHash（P5-T005）

## 驗證命令
`npm run verify`；`node scripts/ui-drive.mjs`

## 實作要求
- 先寫測試：整理函式各條規則；**沒改內容就存一次，publishHtml 逐字不變**；editedBody 不動標題與分類。
- 安全：整理之後照樣走 schema、sanitize、結構驗證，編輯器不是信任來源。

## 完成定義
- [x] `npm run verify` 綠
- [x] 無頭 Chrome：去原文改 → 游標位置正確 → 打字 → 儲存 → 新版本只有那一段變
- [x] http-api.md、core-service.md、review-proposals.md、design-system.md 已更新
- [x] CURRENT_TASK 已更新

## 中斷／接手紀錄
- 最後完成：全部，含 subagent 審查後的修正
- 已通過驗證：npm run verify（34 檔／542）；無頭 Chrome 示範資料與真實後端（臨時稿件，測完已取消）：卡片進入游標位置正確、打字／Enter／⌘B 存檔只改到那兩段、沒改不建版本、只多按 Enter 不建版本且畫面還原、編輯中整條上方列與右欄鎖住
- 下一步：無
- Blocker：無

## 完成結果
審查（subagent）發現並已修正：
- AI 在跑時可以進入編輯，跑完換版本會吃掉打的字 → 跑的時候不給進；編輯中換版本就結束編輯並告知
- 返回鍵沒鎖 → 整條上方列在編輯中 inert
- 長文（hybrid）頂層裸文字存檔失敗 → 整理函式自己包段落，`<br>` 當分段
- 刪空段落會刪掉作者刻意的 `<p>&nbsp;</p>`、段尾 br → 只刪 Chrome 產生的 `<p><br></p>`／`<p></p>`，段內 br 不動
- 行內元素之間的空白被吃掉 → 保留
- 整理後跟原本一樣仍建新版本、撤銷核准 → 後端不建；前端還原畫面
- 輪詢時重標會讓游標跳掉 → 編輯中不碰正文
記為殘餘（CURRENT_TASK）：sourceText 與正文不一致；巢狀 div、空標題。
