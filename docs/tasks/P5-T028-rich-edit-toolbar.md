---
id: P5-T028
phase: 5
status: done
depends_on: []
specs: [review-proposals.md, templates.md, security.md, design-system.md, http-api.md, core-service.md]
write_paths: ["src/ui/", "src/core/", "src/templates/", "src/contract/", "src/wordpress/block-serialize.ts", "tests/", "docs/specs/", "docs/tasks/P5-T028-rich-edit-toolbar.md", "docs/CURRENT_TASK.md"]
contract_change: additive
expected_commit: "feat(P5-T028): 直接在文章上改時可以加格式"
---

# 直接在文章上改時可以加格式

## 目標
D-028。「改原文」（`ProofView.tsx` 的 contenteditable，P5-T010）目前只能打純文字、貼上一律轉純文字。

## 範圍
### 包含
- 編輯中的工具列（放在現有編輯列 `proof-editbar` 附近）：連結、粗體、斜體、H2、H3、回到段落、項目清單、編號清單、引用、分隔線。
  **按鈕依該篇模板的 `allowedTags` 決定要不要出現**（不是寫死）。按鈕反映游標所在的狀態（例如在粗體裡時亮起）。
- 快捷鍵：⌘B、⌘I、⌘K（連結）。
- 連結：在發布台內的小輸入框填網址（**不要用 `window.prompt`／alert／confirm**），只收模板 `allowedSchemes`；已是連結時可改網址或移除。
- 貼上：保留 allowlist 內的標籤與屬性，其餘（style、class、span、font、div、script、不允許的 scheme…）丟掉，
  文字保留；純文字剪貼簿照舊。
- 正規化：`b`→`strong`、`i`→`em`；Chrome 產生的 `div`、`span style=…`、`font` 等不能讓格式或文字默默消失。
  前端存檔前整理一次，**後端照原始規則再驗一次**（`src/templates/sanitize.ts` 那條路），b/i 在後端也要轉換而不是被剝掉。
- 確認清單、引用、標題、分隔線存檔後渲染與發布的古騰堡區塊正確（`block-serialize.ts`，對照 `wordpress-site.md` 的區塊格式）。
  已知殘餘「整理規則只處理頂層、巢狀 div 不轉段落」：清單項目裡的情況這次要處理到不會壞。
- `?fixtures=1` 可示範。
- spec：擁有「直接在文章上改」的 spec（看 `review-proposals.md`／`design-system.md` 哪份擁有）與 `security.md`（貼上 HTML 的處理）更新。

### 不包含
- allowlist 以外的格式（底線、表格、顏色、對齊）。
- 新建稿件畫面（`NewJob.tsx`）的格式工具。
- 引入任何編輯器套件（Tiptap、Lexical、古騰堡等）。

## 實作要求
- iframe 維持 `sandbox="allow-same-origin"` 不給 scripts；指令一律由外層對 iframe document 下。
- `execCommand` 可用，但產出一律經過整理；寫測試鎖住：b/i 轉換、貼上各種髒 HTML（Word、Google Docs、網頁）、javascript: 連結被擋、
  巢狀結構、標題與段落互換、清單。
- 先寫測試再實作。測試不呼叫真實 CLI、不連真實 WordPress。

## 驗證
### 自動驗證
`npm run verify`
### 手動驗證
使用者在一篇長文：加粗、連結、H2、清單、從網頁貼一段有格式的字 → 存 → 校樣正確 → 存成**草稿**看後台區塊。

## 完成定義
- [ ] `npm run verify` 綠
- [ ] 擁有這些行為的 spec 已更新
- [ ] CURRENT_TASK 已更新

## 中斷／接手紀錄
- 最後完成：實作（subagent，2026-09-28）：共用整理規則 `src/contract/rich-text.ts`（前端貼上／存檔、後端 normalizeEditedBody
  共用）、工具列 `FormatBar.tsx`＋`lib/rich-format.ts`（純規則）＋`lib/rich-commands.ts`（對 iframe 下指令）、sanitize 的 b/i 轉換、
  `JobDetail.template` 加 `allowedTags`／`allowedSchemes`（契約新增欄位）、spec 更新
- 已通過驗證：`npm run verify` 65 檔 / 1213 測試；`?fixtures=1` 用無頭 Chrome 走過工具列、⌘B／⌘I／⌘K、連結輸入框（擋 javascript:）、
  貼上髒 HTML、存檔、不支援格式的提醒
- Codex 審查（PR #2）6 條 medium 已修（未 commit）：沒實質改動就存檔時還原畫面並重量；繼承的粗斜體往下套到區塊內、不包住清單；
  清單項目攤平時區塊與後面的字分段、穿過包裝取出子清單；子清單後面還有字的項目照原樣留著（發布走 wp:html 保底），
  補「沒改過的合法正文逐字不變」不變式測試；連結輸入框每次打開以 session 為 key 重建。verify 65 檔 / 1241 測試
- Codex 第二輪（6 條 medium）已修（未 commit）：存檔改成「沒改的頂層區塊原樣保留、只整理改過的」（LCS 序列比對，
  前後端共用 `cleanRichEdit`，後端用上一版 templateData 正文並逐字沿用原始片段）；F1 只在分段邊界修空白；F2 連結包區塊時拆到各段；
  F3 改過的區塊裡攤平標題／引用／分隔線要進 dropped；F4 `font-weight/font-style: normal` 把外層 strong／em 切開；
  F5 連結網址規則統一成 `safeHref`（使用者 2026-09-28 裁定：`#` 與單一 `/` 站內路徑收，其他相對路徑拒絕並提醒），sanitize 也用它；
  F6 游標在 li 裡就是清單情境。verify 65 檔 / 1271 測試
- Codex 第三輪（6 條）已修（未 commit）：比對基準改成上一版 sanitize 後的 publishHtml（前後端同一份），保留的區塊輸出基準的
  正規化 HTML、不拼原始字串；「不粗／不斜」對任何元素有效；連結包圖片區塊時移進 figure（發布走 wp:html，見 CURRENT_TASK 殘餘）；
  http(s) 必須有主機；工具列粗／斜照實際樣式。verify 65 檔 / 1294 測試
- Codex 第四輪（5 條）已修（未 commit）：style 照 CSS 規則逐條解析（mso-bidi-* 不再誤判）；「不粗／不斜」標記傳到所有祖先、
  巢狀同名 strong／em 合併；行內貼上保留前後空白；連結包圖片時圖說與被包住的圖片都帶連結、包不進去的進 dropped；
  網址主機檢查先拿掉 tab／LF／CR 與頭尾控制字元。verify 65 檔 / 1306 測試
- Codex 第五輪（parseStyle 2 條）已修（未 commit）：先依 CSS 規則拿掉註解、處理跳脫字元；font-weight／font-style 的無效值忽略、不覆蓋前面有效的。verify 65 檔 / 1310 測試
- 下一步：主 session 驗收 → 另派審查 → commit；commit 後跑 Codex review 讀 diff（使用者要求）；使用者手動驗證（只存草稿）
- Blocker：無

## 完成結果
