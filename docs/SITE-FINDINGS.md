# 目標網站探查結果（www.remusplus.com）

探查日期：2026-08-27。全部以**匿名 REST API 與前台 HTML** 取得，未使用任何憑證。
這份文件記錄「計畫假設」與「網站實況」的差異，以及據此做的決定。
IMPLEMENTATION_PLAN.md 維持原樣不改；有衝突時以本文件為準。

## 網站組成

| 項目 | 實況 |
| --- | --- |
| 佈景主題 | Astra 4.12.2 + `astra-child` 子主題 |
| 版面 | Elementor Pro Theme Builder（header / footer / single-post / loop-item 模板） |
| 其他外掛 | Rank Math SEO、JetEngine、JetMenu、Jetpack、MailPoet、GTM |
| 語言 | zh-TW |

## 三種內容類型的對應

| 計畫用語 | 實際 post type | rest_base | 分類法 | 篇數 |
| --- | --- | --- | --- | --- |
| 長文 | `read-think`（思想•讀•鑰） | `read-think` | `read-think-tag` | 15 |
| 日記 | `diary`（日•記） | `diary` | `diary-category` | 30 |
| 首頁 | page ID `1665`（slug `home`） | `pages` | — | 1 |

兩個 CPT 都已啟用 `show_in_rest`，可用 REST 建立與更新草稿（寫入權限待階段 4 以
Application Password 實測）。

## 決定一：首頁移出 MVP

**問題。** page 1665 的 `content.rendered` 是**空字串**。首頁完全由 `astra-child`
子主題的 PHP 樣板渲染，搭配 `assets/css/home-main.css`、`assets/js/home-main.js`
與手刻的 `ph-` class 系統（`ph-hero`、`ph-about-item`、`ph-project-card-flip`…）。
資料庫裡沒有任何首頁內容。

這使計畫的兩條規則無法同時成立：

- §4.2「首頁對應固定 Page ID，用 REST 更新」→ 寫進 `content` 不會有任何效果。
- §2「不修改 WordPress PHP、Theme 或 Plugin 原始碼」→ 唯一能改首頁的途徑被禁止。

**決定（使用者於 2026-08-27 確認）**：首頁移出 MVP。發布台只做 `diary` 與
`read-think`。首頁維持現行的手改主題方式。

**影響。** 以下計畫段落在 MVP 中不實作：§4.2 全部、§8.4 首頁特殊保護、
§9 首頁第二次警告、§13 中與首頁相關的兩項完成條件、階段 2 驗收的
「首頁模板結構遭更動時驗證失敗」。

`strict` 這個嚴格度仍保留在模板契約中（由 manifest 的 allowlist 決定，不是三段
程式碼），日後若把首頁內容搬進 WordPress 就能直接啟用，不需重寫 renderer。

## 決定二：模板只負責正文，外框不碰

**問題。** 計畫 §4.3 說長文的「固定外框包括標題、導讀、封面圖、正文、重點摘要、
作者資訊及延伸閱讀」。實際文章的 `content` 裡**沒有任何這些結構**——標題、日期、
精選圖片、作者全部由 Elementor 的 `single-post` 模板產生，正文則透過
`elementor-widget-theme-post-content` widget 輸出。

**決定。** 發布台送出的 `content` **只有正文**。外框不在我們的輸出裡，所以
「Agent 不能修改外框」自動成立；要守的是正文的標籤／class allowlist。

模板的 `template.html` 只用於**本機預覽**（補上模擬外框讓使用者看得懂），
manifest 以 `publishSlot` 指定哪一個 slot 的 HTML 才是要送去 WordPress 的內容。
預覽用的外框永遠不會被發布。

## 正文的實際 HTML 詞彙

抓 15 篇長文與 30 篇日記統計，用到的標籤與 class 少得驚人，allowlist 可以訂得很緊。

**長文 `read-think`**

| 標籤 | class |
| --- | --- |
| `p` | `wp-block-paragraph`、`has-medium-font-size` |
| `h3` | `wp-block-heading`、`has-medium-font-size`（內容常包 `<strong>`） |
| `ul` / `ol` | `wp-block-list` |
| `li` / `a` / `strong` | 無 |
| `figure` / `img` | `wp-block-image`、`aligncenter`、`size-large`、`size-full`、`is-resized` |

- 15 篇**全部**有精選圖片（featured media）。
- 正文內嵌圖片只有 4／15 篇。
- 未出現 `h2`：現有文章最高階標題是 `h3`。
- `excerpt` 全部是 WordPress 自動截斷，沒有手寫摘要。

**日記 `diary`**

| 標籤 | class |
| --- | --- |
| `p` | `wp-block-paragraph`、`has-medium-font-size` |

- 30 篇**完全沒有圖片**，也沒有精選圖片。
- 標題就是日期數字，例如 `20260522`；slug 同樣是 `20260522`。
- 日記的圖片流程在 MVP 幾乎用不到，但保留能力。

## 待確認事項

- 長文要不要開放 `h2`？現有文章只用到 `h3`。
- 日記標題是否固定用 `YYYYMMDD`，由發布台自動產生？
- `read-think-tag` 與 `diary-category` 的現有分類項目，等階段 4 連線後再列出。
