---
id: P5-T050
phase: 5
status: done
depends_on: []
specs: [wordpress-site.md, design-system.md, architecture.md, security.md]
write_paths: ["src/contract/", "src/ui/", "src/wordpress/", "src/preview/", "src/templates/", "src/core/", "tests/", "docs/specs/wordpress-site.md", "docs/specs/templates.md", "docs/specs/design-system.md", "docs/specs/architecture.md", "docs/known-issues.md", "docs/tasks/P5-T050-text-align.md", "docs/CURRENT_TASK.md"]
contract_change: additive
expected_commit: "feat(P5-T050): 段落與小標可選靠左、置中、靠右"
---

# 段落與小標可選靠左、置中、靠右

## 目標
D-049。使用者 2026-10-21 問有沒有段落靠左、置中、靠右；目前完全沒有。
做法照使用者同意的建議：只做段落與小標（清單 WordPress 本來就沒有、引用先不做），不做兩端對齊（中文兩端對齊字距常被拉怪）。
輸出要跟在 WordPress 編輯器裡設的一模一樣，後台打開不能出現「區塊內容無效」。

## 範圍
### 包含
- 格式工具列加三顆：靠左、置中、靠右（圖示、目前狀態要亮），作用在游標或選取所在的段落／小標（選取跨多段就全部套）。靠左＝拿掉對齊設定（不輸出 class）。
  標題（文章標題）、清單、引用、圖片裡按了不做事或反灰。
- 正文 HTML 的對齊用 class `has-text-align-left|center|right`，不用 inline style（`contenteditable` 的 `justifyCenter` 會塞 style 或 `align`，不要用它，自己改 class）。
- `src/contract/rich-text.ts`：`edit`／後端再驗時允許 `p`、`h2`、`h3` 帶這三個 class（白名單，其他值拿掉）；貼上（`paste`）照舊不帶進來。後端用原始 schema 再驗一次（security.md）。
- `src/wordpress/block-serialize.ts`：段落、小標輸出對應區塊屬性與 class。**屬性名要先查證**：古騰堡段落區塊歷來用 `align`、小標用 `textAlign`，
  新版核心可能改過——對照 `docs/specs/wordpress-site.md` 寫的站台版本，去讀 WordPress／Gutenberg 原始碼（GitHub 上的 `block.json`、`save`、deprecated）確認，
  查證結果與出處寫進 wordpress-site.md 的區塊格式那節。拿不準就停下回報，不要猜。
- 校樣預覽（`src/preview/`）看得到對齊（跟前台一致的 CSS）。
- 讀回已發布或後台改過、本來就有對齊的文章時保留不掉。
- 測試、spec（wordpress-site.md 正文 HTML 詞彙與區塊格式、design-system.md 工具列、architecture.md 功能地圖）、known-issues。

### 不包含
- 兩端對齊、清單／引用／圖片的對齊。
- Agent 校稿建議或模板產生對齊（Agent 不輸出格式）。

## 工作區與 Context
### 必讀入口
`docs/specs/wordpress-site.md`（正文 HTML 詞彙、區塊格式）、`src/contract/rich-text.ts`、`src/wordpress/block-serialize.ts`、`src/ui/lib/rich-commands.ts`、`rich-format.ts`、
格式工具列元件、`src/contract/link-target.ts`（D-043 加屬性的前例：前後端怎麼一起改、怎麼測）。
### 不應載入
agent、factcheck spec。
### 驗證命令
`npm run verify`；`node scripts/ui-drive.mjs` 搭 `?fixtures=1` 截圖（工具列三顆、置中段落、置中小標）。

## 實作要求
- 先寫測試：工具列套用／切換／取消、跨段選取、標題與清單不做事；rich-text 白名單（非法值、inline style、paste 被拿掉）；
  區塊序列化對照古騰堡實際輸出逐字比對；讀回再存不掉對齊。
- 文字用繁體中文。

## 驗證
### 自動驗證
`npm run verify` 綠。
### 手動驗證（使用者）
長文一段置中、一個小標靠右 → 存草稿 → 後台編輯器打開沒有「區塊內容無效」、對齊正確 → 預覽前台一致。只存草稿。

## 完成定義
- [ ] `npm run verify` 綠
- [ ] 擁有這些行為的 spec 已更新（wordpress-site.md、architecture.md 功能地圖）
- [ ] 留下的殘餘已寫進 `docs/known-issues.md`
- [ ] CURRENT_TASK 已更新

## 中斷／接手紀錄
- 最後完成：補「對齊段落段尾 Enter 不帶對齊」（2026-10-21，rebase 到 P5-T049 之後）；未 commit，等主 session
- 已通過驗證：`npm run verify` 107 檔／2451 測試全綠（rebase 後基準 107／2446，＋5：`tests/text-align.test.ts` 的 Enter 規則）；`?fixtures=1` 實按 Enter 截圖通過
- 下一步：主 session 審查 → PR；使用者手動驗證（見 CURRENT_TASK 待驗表）
- Blocker：無

## 完成結果
- 查證（WordPress 7.1.3、Gutenberg `dd294ab8`，出處網址寫在 wordpress-site.md「段落與小標的對齊」）：**7.0 起段落與標題都沒有自己的對齊屬性**
  （Task 寫的「段落 `align`、小標 `textAlign`」是 6.9 以前），改用 `supports.typography.textAlign`，值在 `style.typography.textAlign`，
  HTML 只多 `has-text-align-*` class、沒有 inline style。輸出：`{"fontSize":"medium","style":{"typography":{"textAlign":"center"}}}`＋
  `<p class="has-text-align-center has-medium-font-size">`；小標 `wp-block-heading has-text-align-right has-medium-font-size`。
  舊寫法讀回時 HTML 一樣，改寫成新格式。
- 規則：`src/contract/text-align.ts`（三個值、只給 p／h2／h3、換 class、編輯整理、預覽 CSS）。後端關卡 `templates/sanitize.ts`：模板對 p／h2／h3 有列
  allowedClasses 時程式多收三個 class（不改 manifest；write_paths 不含 `templates/`，而且那是核心寫法不是站台慣例）。編輯整理 `rich-text.ts` 的 `keepAttrs`
  照輸出標籤整理對齊 class（非法值拿掉、只留一個、清單／引用身上拿掉）；貼上照舊不帶 class。inline style 在編輯整理與 sanitize 都被拿掉。
- 區塊：`block-types.ts`（`textAlign?`）、`block-parse.ts`（從 class 讀，只收三個值）、`block-serialize.ts`（屬性順序 level → fontSize → style；class 順序 wp-block-heading → 對齊 → 字級）。
- UI：`rich-format.ts`（`align-left|center|right` 三個指令、狀態、亮起／反灰、`alignCommandValue`）、`rich-commands.ts`（`setBlockTextAlign`、選取碰到的最外層段落／小標、
  段落與標題互換時補回對齊）、`FormatBar`＋`icons.tsx`（新的一組三顆）、`use-proof-editing.ts`（游標處對齊）、`use-draft-backup.ts`（MutationObserver 也看 class，
  只改對齊也會留底）、示範資料的預覽樣式。預覽：`preview/document.ts` 加核心 common.css 的三條規則。
- `?fixtures=1` 截圖（`/private/tmp/claude-501/p5t050/`）：`01-toolbar-center-right.png`（三顆按鈕、靠右小標）、`03-editing-centered-paragraph.png`（置中段落、置中按鈕亮）、
  `02-in-list-disabled.png`（清單裡反灰）、`04-saved-preview.png`（存檔後校樣）。另外用 Chrome 實測：跨三段選取全部套用；選到下一段開頭不算那一段；
  引用裡、標題上反灰；段落 → H2 → 內文對齊保留。
- 殘餘：見 known-issues「段落與小標對齊」（站台版本未實測、不進 ⌘Z、Enter 帶著對齊、只改對齊沒有頁邊符號等）。
- 跟進（段尾 Enter）：查 Gutenberg dd294ab8 的 `store/actions.js` `__unstableSplitSelection`（由 `writing-flow/use-input.js` 在 `splitting` 區塊按 Enter 呼叫）：
  段尾（含空段）→ 後面插沒有屬性的預設段落、游標移過去；有字的段首 → 前面插空段落、游標留原段；段中 → 兩半都帶原屬性（小標後半轉段落、對齊照帶，`heading/transforms.js`）。
  實作 `src/ui/lib/align-enter.ts`（純函式 `alignEnterAction`＋`attachAlignEnter`），在 `use-proof-frame.ts` 掛在 `attachFigureKeys` 後面、已被擋掉的 Enter 不管；
  只處理有對齊的段落／小標，輸入法組字中、Shift／⌘ 組合、選了字都不攔。截圖：`/private/tmp/claude-501/p5t050/05-enter-at-end-left.png`（置中段尾 Enter 打字靠左、「靠左」亮）、
  `06-enter-middle-both-centered.png`（段中 Enter 兩半都置中）；另實測小標靠右段尾 Enter 開乾淨段落、沒對齊段落的 Enter 行為不變。差異：小標段中 Enter 後半仍是小標（瀏覽器拆）。
- PR #38 Codex 第一輪 P2（段尾判斷沒算 `<br>`）：`align-enter.ts` 改用 `caretEdges`——字、圖、Shift+Enter 的軟換行都算內容，只有段落最後一個 `<br>`（瀏覽器的佔位）不算；
  `A|<br><br>`、`A|<br>B`、`A<br>|B`、`<br>|B` 是段中（交給瀏覽器拆，兩半保留對齊），`A<br>B|`、`A|<br>`、空段是段尾。測試 8 條；Chrome 實按 Shift+Enter 再回到 `A|` 按 Enter，在游標處拆開。
- PR #38 Codex 第二輪：(1) 後端 sanitize 對 p／h2／h3 的 class 也跑 `normalizeTextAlignClass`（一塊只留第一個合法的對齊，跟編輯整理同一份規則），
  Agent／templateData 正文帶兩個對齊時預覽（publishHtml）與發布區塊讀到同一個；(2) 跨段選取最後一塊算不算改看 DOM 位置（`selectionEntersBlock`＋`caretTokens`）：
  結尾前面有這塊的字、`<br>` 或圖就算，空段落被選到也算，只有停在開頭才不算。測試 6 條；Chrome 實測 `<p><br>|B</p>`、空段落、`|CC` 三種。
- PR #38 Codex 第三輪（**這一輪的修正沒經過 Codex**）：(1) 段首／段尾的空白照「看得到就算」：正文 white-space 是 normal，只有一般空白（ASCII 空格、tab、換行、CR、FF）
  會被摺疊、不算；`&nbsp;`、全形空白算內容（`isVisibleText`、`textTokensAtCaret`）。只有一般空格的那一邊必在行頭或行尾、被摺掉看不見，所以「 |B」是段首、「A| 」是段尾；
  Chrome 打的會顯示的行頭行尾空格本來就存成 `&nbsp;`。(2) 跨段選取兩端都要「進去了才算」（`selectionCoversBlock`：開始端後面、結束端前面要有這一塊的內容；空段落算），
  不分方向、不再豁免第一塊；對齊按鈕看同一個判斷（`selectionAlign` → `FormatState.alignTargets`，0 塊就反灰），按鈕跟套用一致。測試 14 條；
  Chrome 實測：錨點在段首、反向延伸進引用 → 三顆反灰、按了不動；置中段落 `&nbsp;|B` 按 Enter 在游標處拆、兩半都置中。
