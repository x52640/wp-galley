# WordPress 站台：通用說明與作者站台實況

> 擁有範圍：站台組成、內容類型對應、正文 HTML 詞彙、區塊格式、分類法、外部副作用。
> 前半是**任何 WordPress 站**共通的部分（D-016）；後半「作者站台實況」是 www.remusplus.com 的
> **實測事實**，據此做的範圍決定在 [ADR-0003](../adr/0003-homepage-out-of-mvp.md)
> （首頁移出 MVP）與 [ADR-0004](../adr/0004-body-slot-only.md)（只送正文）。
> 程式：`src/wordpress/`、`config/publish-targets.json`（本機檔，範例見 [templates.md](templates.md)「站台設定檔」）。

## 通用站台（任何 WordPress）

一次連一個站。第一版只支援核心內建的兩種內容類型，不支援 CPT（D-016：別人的 CPT
多半靠自訂欄位排版，只送正文會是空版面）。

| 內容類型 | post type | rest_base | 分類法（slug → REST 名稱） | 模板 |
| --- | --- | --- | --- | --- |
| 文章 | `post` | `posts` | `category` → `categories`（另有 `post_tag` → `tags`，第一版不用） | `article-v1` |
| 頁面 | `page` | `pages` | 無 | `article-v1` |

- 正文一律用**核心區塊的預設屬性**：不知道對方的佈景主題，就不帶任何字級、顏色、版面 class
  （規則見 [templates.md](templates.md)「通用模板 article-v1」）。
- ⚠️ **核心分類法的 slug 不等於 REST 名稱**：`category` 的端點與文章 JSON 欄位都叫 `categories`
  （`/wp/v2/types` 回的 `taxonomies` 是 slug）。所以 target 分兩個欄位：`taxonomy` 放 slug
  （跟站台比對、畫面上用），`taxonomyRestBase` 放 REST 名稱（查項目、寫分類、遠端快照用）。
  作者站台的兩個分類法 slug＝rest_base，不用寫 `taxonomyRestBase`。
- ⚠️ 通用站的區塊輸出**沒有拿真實站台逐字比對過**（作者手上只有 remusplus）。
- 連線診斷（`GET /api/wordpress`）檢查的內容類型來自設定檔裡的 target，不寫死；也會拿
  `/wp/v2/taxonomies` 的 `rest_base` 比對 target 的分類法 REST 名稱，對不上就直接講要設什麼。
- 「改成公開可能寄出電子報、自動分享」這條對任何站都成立（見文末），不只作者站台。

---

# 作者站台實況（www.remusplus.com）

探查日期：2026-08-27。全部以**匿名 REST API 與前台 HTML** 取得，未使用任何憑證。
這份文件記錄「原始計畫的假設」與「網站實況」的差異。

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

首頁不在發布台範圍內，見 ADR-0003。

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

> 上面的篇數與 h2 結論已被下方「階段 4 連線後的實測」修正。原本的三項待確認：
> h2 已開放（`longform-v1` 的 allowlist 有 h2）；分類項目見下方 4-3 節；日記標題格式
> 見 `plan.md` Q-8。

## 階段 4 連線後的實測（2026-08-28）

以 Application Password 連線後重新抓了**全部** 115 篇文章（先前是匿名 API，
只看得到部分內容）。以下數字取代上面「正文的實際 HTML 詞彙」一節的統計。

### 連線與權限

| 項目 | 實況 |
| --- | --- |
| 帳號 | `ai_publisher`（顯示名稱 AI Romulus，id 7），角色 **editor** |
| REST root | `https://www.remusplus.com/wp-json/` 直接 200，**沒有 www 跳轉** |
| Elementor | 兩個 CPT 的 `_elementor_*` meta 存在但**值全為空**——文章不是 Elementor 管的，寫 `content` 有效 |

`wp_authenticate_application_password` 會先用 login 找使用者，找不到再用 email，
所以 `WORDPRESS_USERNAME` 填 email 可以動。錯誤代碼可以拿來分辨問題：
`invalid_username` = 帳號不存在，`incorrect_password` = 帳號對、密碼錯。

⚠️ **使用者重設登入密碼會讓該帳號所有 Application Password 立即失效**，要重新產生。

### 修正先前的兩個錯誤結論

| 先前寫的 | 實際 |
| --- | --- |
| 日記 30 篇 | **108 篇**（掃描取樣 100 篇） |
| 長文「未出現 h2」 | h2 出現 **8 次**，h3 出現 41 次，h4 出現 3 次 |

### 區塊格式：全站 100% 是 Gutenberg 區塊

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

### 字級慣例在 2026 年變過

| 內容類型 | 2023 | 2025 | 2026 |
| --- | --- | --- | --- |
| 長文段落 medium 佔比 | 0%（176 段） | 0%（202 段） | **100%**（19 段） |
| 日記段落 medium 佔比 | — | — | 76% → 42% → 90% → 87%（2–5 月） |

**新文章跟 2026 的慣例**：段落與標題預設 `fontSize: medium`。這是
`BlockDefaults` 的預設值來源，寫在 manifest 而不是程式碼裡。

### 其他實測數字

| | read-think（15） | diary（100） |
| --- | --- | --- |
| 有精選圖片 | 15／15 | **0／100** |
| 有分類 | 13／15 | **0／100** |

日記現況幾乎不用圖片（100 篇共 3 張內文圖）；這**不代表**可以砍掉日記的圖片能力，見 `plan.md` D-006。

### 序列化器的驗證方式

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

### 階段 4-2 實測補充

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

### 階段 4-3：分類項目的實際狀況

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

據此決定預設不自動建立分類項目，見 `plan.md` D-004。

兩個分類法的 `rest_base` 都等於 slug（`read-think-tag`、`diary-category`），所以設定檔不用寫
`taxonomyRestBase`（通用站的 `category` 就要寫，見上方「通用站台」）。

### 媒體類型

WordPress 核心預設不收 SVG（可內嵌 script），要開啟只能裝外掛或改 PHP，兩者都違反
硬性禁令。所以 SVG 一律在瀏覽器轉成 PNG 再上傳（`src/ui/lib/svg-to-png.ts`）。

### ⚠ 發布可能觸發無法回收的外部動作

站台裝了 **MailPoet**（電子報）與 **Jetpack**。實測時在 `/wp/v2/types` 看到的
外掛痕跡：`mailpoet_email`、`jetpack_form`、`jp_pay_order`、`jp_pay_product`、
`feedback`。

若 MailPoet 設了「新文章自動寄電子報」，或 Jetpack Publicize 設了自動分享，
**把文章從草稿改成公開的瞬間，信就寄出去了；之後刪文章救不回來**。

這是唯一一個「刪掉就沒事」不成立的地方，UI 在把狀態改成公開之前應該提醒一次。
建草稿、改草稿、上傳媒體都不會觸發。

尚未確認使用者實際有沒有開那些自動化——階段 4 的真實驗證全部停在草稿狀態，
沒有公開過任何測試文章。
