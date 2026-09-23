# 模板與發布目標

> 擁有範圍：模板資料夾結構、manifest 欄位、三種嚴格度、內容類型到 WordPress 的對應。
> 程式：`src/templates/`、`templates/<template-id>/`、`config/publish-targets.json`、
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
| `wordpressTargetKey` | 對應 `config/publish-targets.json` 的哪個 target，**決定發到哪裡** |
| `publishSlot` | 哪一個 slot 的 HTML 才是送去 WordPress 的內容（目前都是 `body`） |
| `requiredSlots` / `optionalSlots` | Agent 必須／可以填的欄位 |
| `allowedTags` / `allowedAttributes` / `allowedClasses` / `allowedSchemes` | 正文 allowlist，依 [wordpress-site.md](wordpress-site.md) 的實測詞彙訂定 |
| `structureRules` | 結構驗證規則 |

## 內容類型

| 類型 | 模板 | 嚴格度 | 發到 | Agent 可以動的範圍 |
| --- | --- | --- | --- | --- |
| 長文 | `longform-v1` | hybrid | `read-think`（思想•讀•鑰） | 只有正文 slot 內的標題、段落、清單、引用、圖片位置 |
| 日記 | `diary-v1` | flexible | `diary`（日•記） | 較自由的正文 HTML，仍過 sanitize |
| 首頁 | — | strict | — | **不在 MVP**（ADR-0003）。`strict` 保留在契約中，日後可直接啟用 |

**發到哪裡在建稿時就決定**：建稿選類型 → 模板 → `wordpressTargetKey` → target 的
`postType` / `restBase`。啟動時會用 `/wp/v2/types` 驗證 target 存在且 `restBase` 相符，
不符就報錯，不會退而發到別的地方。新增一種 custom post type 要新增模板與 target，
不是在畫面上選。

## 發布目標（target）的欄位

`config/publish-targets.json` 每個 target：`key`、`displayName`、`contentType`、
`postType`、`restBase`、`templateId`、`taxonomy`、`fixedObjectId`（首頁用，目前皆 null）、
`allowCreate`、`allowUpdate`、`allowCreateTerms`（預設 false，見 D-004）、
`requireFeaturedImage`、`requireSecondConfirmation`。
