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

---

# 階段 4 連線後的實測（2026-08-28）

以 Application Password 連線後重新抓了**全部** 115 篇文章（先前是匿名 API，
只看得到部分內容）。以下數字取代上面「正文的實際 HTML 詞彙」一節的統計。

## 連線與權限

| 項目 | 實況 |
| --- | --- |
| 帳號 | `ai_publisher`（顯示名稱 AI Romulus，id 7），角色 **editor** |
| REST root | `https://www.remusplus.com/wp-json/` 直接 200，**沒有 www 跳轉** |
| Elementor | 兩個 CPT 的 `_elementor_*` meta 存在但**值全為空**——文章不是 Elementor 管的，寫 `content` 有效 |

`wp_authenticate_application_password` 會先用 login 找使用者，找不到再用 email，
所以 `WORDPRESS_USERNAME` 填 email 可以動。錯誤代碼可以拿來分辨問題：
`invalid_username` = 帳號不存在，`incorrect_password` = 帳號對、密碼錯。

⚠️ **使用者重設登入密碼會讓該帳號所有 Application Password 立即失效**，要重新產生。

## 修正先前的兩個錯誤結論

| 先前寫的 | 實際 |
| --- | --- |
| 日記 30 篇 | **108 篇**（掃描取樣 100 篇） |
| 長文「未出現 h2」 | h2 出現 **8 次**，h3 出現 41 次，h4 出現 3 次 |

## 區塊格式：全站 100% 是 Gutenberg 區塊

115 篇文章**沒有一篇**是純 HTML 或傳統編輯器格式，全部是
`<!-- wp:paragraph -->` 這種區塊標記。這是階段 4 的關鍵發現，決定了發布格式。

| 區塊 | read-think | diary |
| --- | --- | --- |
| paragraph | 397 | 1283 |
| heading | 52 | 2 |
| list / list-item | 17 / 47 | 16 / 37 |
| image | 18 | 3 |
| separator | 8 | 2 |
| quote | 1 | 1 |
| table | 0 | 2 |

## 字級慣例在 2026 年變過

| 內容類型 | 2023 | 2025 | 2026 |
| --- | --- | --- | --- |
| 長文段落 medium 佔比 | 0%（176 段） | 0%（202 段） | **100%**（19 段） |
| 日記段落 medium 佔比 | — | — | 76% → 42% → 90% → 87%（2–5 月） |

**新文章跟 2026 的慣例**：段落與標題預設 `fontSize: medium`。這是
`BlockDefaults` 的預設值來源，寫在 manifest 而不是程式碼裡。

## 其他實測數字

| | read-think（15） | diary（100） |
| --- | --- | --- |
| 有精選圖片 | 15／15 | **0／100** |
| 有分類 | 13／15 | **0／100** |

日記現況幾乎不用圖片（100 篇共 3 張內文圖），但**使用者 2026-08-28 表示日記
未來會常常需要配圖**，所以日記的圖片能力要做滿，不能因為現況沒有就砍掉。

## 序列化器的驗證方式

`src/wordpress/blocks.ts` 把渲染器的純 HTML 轉成區塊標記。正確性判準不是
「看起來合理」，而是**跟正式站既有文章逐字相同**——Gutenberg 開啟文章時會拿存檔
內容比對區塊 `save()` 的輸出，差一個空白或斜線就會跳「此區塊包含非預期的內容」。

驗證方法：把 115 篇真實文章的區塊標記剝成純 HTML，再用序列化器轉回去比對。

| 區塊 | 樣本數 | 逐字還原 |
| --- | --- | --- |
| paragraph | 1344 | 98.7% |
| heading | 50 | 98.0% |
| image | 19 | 100% |
| list | 18 | 100% |
| separator | 9 | 100% |
| table | 2 | 100% |
| quote | 1 | 100% |

未 100% 的都已查明且不是缺陷：空段落 `<p></p>` 是刻意丟棄；`id="economics_Hayek"`
與 `id=":r65:"` 是錨點屬性，本來就不在 allowlist，sanitize 階段就會清掉。

這輪比對抓到兩個真實缺陷，都已修正並補上迴歸測試：

1. `<figure class="wp-block-table">` 進了圖片分支，找不到 `<img>` 就回 null，
   而 `figure` 又在「認得的標籤」集合裡 → **整個表格被靜默丟掉**。
2. 巢狀清單被當成 `<li>` 的純 HTML 內容輸出，沒有產生巢狀的 `wp:list` 區塊，
   Gutenberg 會認不出那是可編輯的清單。

**核心的區塊屬性順序不固定**（`#1379` 是 `{"id",…,"align"}`，`#870` 是
`{"align","id",…}`），因為驗證比對的是 HTML 不是屬性 JSON。我們固定順序是安全的。

## 階段 4-2 實測補充

`/wp/v2/types` 的 `supports` 欄位**不是 `Record<string, boolean>`**。WordPress 會把
註冊時給的功能參數原樣帶出來，正式站的實際值：

| post type | supports.editor |
| --- | --- |
| `post`、`page` | `[{"notes":true}]` |
| `mailpoet_email` | `[{"default-mode":"template-locked"}]` |
| `read-think`、`diary` | `true` |

我們的兩個 CPT 都是 `true`，但 `/wp/v2/types` 一次回傳**全部**類型，所以 schema
一定要容得下陣列，否則整個探查會失敗。判斷有沒有支援某功能只能看「鍵在不在」，
不能假設值的型別。

這個缺陷是拿真實站台實跑才發現的——單元測試的假資料全部寫成 `true`，測不出來。

站台探查（`GET /api/wordpress`）對正式站的實跑結果：連線正常、帳號
`ai_publisher`（editor）、兩個 CPT 都在且支援精選圖片、`problems` 為空。

## 階段 4-3：分類項目的實際狀況

三個名詞在 WordPress 裡是不同的東西，這個專案的文件一律照下面用：

| 名詞 | 站上是什麼 |
| --- | --- |
| post type（內容類型） | `read-think`、`diary` |
| taxonomy（分類法） | `read-think-tag`、`diary-category` |
| term（分類項目） | 隨筆、藝術、讀書心得、經濟學 |

⚠️ **`read-think-tag` 名字叫 tag，但 `hierarchical` 是 `true`**，行為其實是分類
（可以有父子層）。判斷行為一律看 `hierarchical`，不要看名字。

`read-think-tag` 的實際項目：

| 名稱 | slug | 用了幾次 |
| --- | --- | --- |
| 隨筆 | `essay` | 6 |
| 藝術 | `art` | 3 |
| 讀書心得 | `reading-note` | 3 |
| 經濟學 | `%e7%b6%93%e6%bf%9f%e5%ad%b8` | 2 |

「經濟學」的 slug 是**中文被 URL 編碼**的結果，其餘三個是英文。所以名稱比對必須
同時試 `name`、`slug` 與 `decodeURIComponent(slug)`，只比其中一個會漏。

`diary-category` **一個項目都沒有**，跟 100 篇日記全部沒有分類一致。

**預設不自動建立分類項目**（使用者於 2026-08-28 確認）。理由是 Agent 容易生出
「經濟」「經濟學」「經濟學思考」這種近義詞，自動建立幾個月後分類會變垃圾場。
對不上的名稱會原樣回報，由使用者在 UI 上決定。
