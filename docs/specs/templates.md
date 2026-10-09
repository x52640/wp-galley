# 模板與發布目標

> 擁有範圍：模板資料夾結構、manifest 欄位、三種嚴格度、內容類型到 WordPress 的對應。
> 程式：`src/templates/`、`templates/<template-id>/`、`config/publish-targets.json`（本機檔，見下方「站台設定檔」）、
> `src/wordpress/targets.ts`。
> 為什麼只送正文：[ADR-0004](../adr/0004-body-slot-only.md)。首頁為什麼不在範圍內：
> [ADR-0003](../adr/0003-homepage-out-of-mvp.md)。

## 模板資料夾

```text
templates/<template-id>/
├── manifest.json   # 版本、嚴格度、allowlist、slot、對應哪個發布目標
├── template.html   # 只用於本機預覽（補上模擬外框），不會被發布
├── schema.json     # Agent 回傳資料的 JSON Schema，後端一定再驗一次
├── rules.md        # 寫作規則與該版型的 Agent 指令
└── preview.css     # 校樣 iframe 的樣式，跟介面 CSS 完全隔離
```

模板檔案是受信任的本機設定（信任邊界見 [security.md](security.md)）。

所有模板保存 version 與 SHA-256 hash，每個 revision 記錄用了哪個模板版本與 hash，
模板改動後舊版本仍可重現。

## manifest 的關鍵欄位

| 欄位 | 意義 |
| --- | --- |
| `strictness` | `strict` / `hybrid` / `flexible`，由 allowlist 決定行為，不是三段程式碼 |
| `wordpressTargetKey` | 參考用：這個模板主要給哪個 target。**真正決定發到哪裡的是 target 的 `templateId`**；一個模板給多個 target 用時填 `null`（`article-v1`） |
| `publishSlot` | 哪一個 slot 的 HTML 才是送去 WordPress 的內容（目前都是 `body`）。schema 要求它至少一個字元、渲染拒絕清理後是空字串的正文，這兩道**不為「先建稿再寫」放寬**：空的正文存成一個空段落 `<p class="wp-block-paragraph"></p>`（三個模板都收，P5-T029），不能發布空文章由核准與發布前置檢查擋（[state-machine.md](state-machine.md)） |
| `requiredSlots` / `optionalSlots` | Agent 必須／可以填的欄位 |
| `allowedTags` / `allowedAttributes` / `allowedClasses` / `allowedSchemes` | 正文 allowlist，依 [wordpress-site.md](wordpress-site.md) 的實測詞彙訂定。sanitize 會把 `b`／`i` 轉成 `strong`／`em`（模板允許後者、不允許前者時），不是拆掉；轉換的不算進 `removedTags`（P5-T028）。連結網址跟編輯整理同一個規則（`safeHref`：絕對網址要在 `allowedSchemes`，另收 `#錨點` 與單一 `/` 開頭的站內路徑），不收的連結整個拆掉、字留著，回報 `a.href`。`a` 的 `target`／`rel` 照「在新分頁開啟」規則整理（`contract/link-target.ts`，見 [security.md](security.md)）。`allowedTags`／`allowedSchemes` 也隨 `JobDetail.template` 給前端，決定格式工具列的按鈕與連結可用的 scheme |
| `structureRules` | 結構驗證規則 |
| `blockDefaults` | 選填。轉成 Gutenberg 區塊時的預設屬性（段落／標題／清單項目字級、圖片尺寸與對齊）。**不寫＝作者站台慣例**（`fontSize: medium`、圖片置中），`longform-v1`／`diary-v1` 就是不寫，輸出因此逐字不變；通用模板全部設 `null` |

## 內容類型

| 類型 | 模板 | 嚴格度 | 發到 | Agent 可以動的範圍 |
| --- | --- | --- | --- | --- |
| 長文 | `longform-v1` | hybrid | `read-think`（思想•讀•鑰） | 只有正文 slot 內的標題、段落、清單、引用、圖片位置 |
| 日記 | `diary-v1` | flexible | `diary`（日•記） | 較自由的正文 HTML，仍過 sanitize |
| 文章／頁面（通用，`article`） | `article-v1` | hybrid | 任何站的 `post` 或 `page`（D-016） | 只有核心區塊：段落、h2／h3、清單、引言、圖片、分隔線；不帶任何佈景主題 class |
| 首頁 | — | strict | — | **不在 MVP**（ADR-0003）。`strict` 保留在契約中，日後可直接啟用 |

**發到哪裡在建稿時就決定**：建稿選類型 → 模板 → `wordpressTargetKey` → target 的
`postType` / `restBase`。啟動時會用 `/wp/v2/types` 驗證 target 存在且 `restBase` 相符，
不符就報錯，不會退而發到別的地方。新增一種 custom post type 要新增模板與 target，
不是在畫面上選。

長文、日記是作者站台（remusplus）專用的；`article` 是給任何站用的。介面上 `article` 依
target 的 `postType` 叫「文章」（post）或「頁面」（page），同一個模板、同一份 schema。

### 通用模板 `article-v1`

- **嚴格度 hybrid**：標題只准 h2／h3（h1 留給文章標題），最外層必須是區塊，巢狀深度上限 6
  （巢狀清單加行內格式放得下）。
- **allowlist 只有核心區塊會產生的 class**：`wp-block-heading`、`wp-block-list`、`wp-block-quote`、
  `wp-block-image`、`size-*`、`align*`、`wp-element-caption`、`wp-image-*`、`wp-block-separator`、
  `has-alpha-channel-opacity`、`is-style-wide`／`is-style-dots`。沒有 `has-*-font-size`：
  Agent 塞進來會被 sanitize 拿掉。
- **`blockDefaults` 全部 null**：輸出就是核心各區塊 `save()` 在預設屬性下的樣子——段落是裸 `<p>`、
  h2 不寫 level、圖片不預設置中（發布台自己插的圖帶 `aligncenter`，照核心格式輸出 `align: center`）。
- **欄位**：`title`、`body` 必填；`slug`、`category`（單一名稱）、`featuredImageBriefKey` 選填。
  `category` 只在 target 有分類法時才會送出（page 沒有），對不上的名稱照 D-004 原樣回報、不建立。
- ⚠️ **沒有拿真實的通用站台逐字比對過**：期望值（`tests/article-template.test.ts`）是照核心 `save()`
  寫的，序列化器本身是 remusplus 115 篇驗證過的同一套，差別只在預設值。第一次發到別的站時，
  打開編輯器確認沒有跳「此區塊包含非預期的內容」。

## 站台設定檔

一次連一個站（D-016），站台設定是**本機檔** `config/publish-targets.json`，不進 git。repo 附兩份範例：

| 檔案 | 內容 |
| --- | --- |
| `config/publish-targets.example.json` | 通用：`post`（文章，分類法 `category`）＋ `page`（頁面，沒有分類法），都用 `article-v1` |
| `config/examples/remusplus.json` | 作者站台：`read-think`＋`diary`，跟作者本機那份的 targets 逐字相同（本機那份在設了預設作者之後多一個 `defaultAuthorId`） |
| `config/examples/default-author.json` | 通用範例加上頂層 `defaultAuthorId`，示範預設作者怎麼寫（P5-T024） |

**頂層 `defaultAuthorId`（選填，P5-T024，D-024）**：整個站共用的預設作者，值是 WordPress 使用者 id（正整數）。
不寫＝發布不送 `author`，WordPress 把作者記成發布台登入的帳號（原本的行為）。通常不用手寫：發布面板按
「設為預設」會寫進來（`writeDefaultAuthor`，只動這一個欄位，其他原樣保留）；設定精靈重寫這個檔時也會原樣帶著它。
行為見 [state-machine.md](state-machine.md)「發布選項」、[wordpress-site.md](wordpress-site.md)「作者」。

**找不到本機檔不是錯誤**：`loadPublishTargets` 回一個空的 registry，`setupRequired` 帶著
「還沒有站台設定：先跑設定精靈，或複製 config/publish-targets.example.json」。伺服器照樣啟動，
健康檢查與連線診斷照常；發布目標清單是空的，建不了稿（畫面上顯示同一句話）。
檔案在但壞掉（不是 JSON、欄位錯、`targets` 是空陣列）仍然啟動失敗：那是寫錯了，不是還沒設定。

啟動時終端機印出同一句（`startupNotice`）；建稿被拒時 CoreService 也回這一句。
設定精靈第三步會寫這個檔（已經有檔時的規則見 [wordpress-site.md](wordpress-site.md)「設定精靈」），
寫完當場生效，不用重新啟動。

## 發布目標（target）的欄位

`config/publish-targets.json` 每個 target：`key`、`displayName`、`contentType`、
`postType`、`restBase`、`templateId`、`taxonomy`、`taxonomyRestBase`（選填，分類法的 REST 名稱，
不寫＝等於 `taxonomy`；核心 `category` 要寫 `categories`；兩者都只准小寫英數、底線、連字號，
連線診斷會拿站上的 `rest_base` 比對）、`fixedObjectId`（首頁用，目前皆 null）、
`allowCreate`、`allowUpdate`、`allowCreateTerms`（預設 false，見 D-004）、
`requireFeaturedImage`、`requireSecondConfirmation`、`disabled`（選填布林，P5-T032，D-032）。

**`disabled`**：`true`＝使用者在設定精靈停用了這個類型——新稿件選單與拖放／貼上建稿不出現，`createJob` 拒絕；
已經用它的舊稿件照常打開、編輯、發布。**不寫＝啟用**，舊檔不用改。通常不用手寫：精靈「發到哪裡」的開關會寫
（規則見 [wordpress-site.md](wordpress-site.md)「設定精靈」）。精靈新加的 target 不寫這個欄位，所以
「精靈寫出的檔跟 `config/publish-targets.example.json` 一字不差」照舊成立，範例檔不用改。
