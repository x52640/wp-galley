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

## 更新既有文章（P5-T022，審查 #1、#13）

程式：`src/wordpress/posts.ts`（`updateDraft`）、`src/core/service/publish.ts`（`runPublish`）。目前只有 target 設了
`fixedObjectId` 才會更新既有文章（一般稿件發過就是 PUBLISHED，不再發第二次；見 `plan.md` Q-5）。

- **只更新草稿**：遠端那篇不是草稿（`publish`、`future`、`private` 等）就在發布前拒絕、零寫入，
  不論使用者選草稿或公開——那就是「修改已發布文章」，待裁定 Q-5（見 [state-machine.md](state-machine.md) 前置檢查第 6 項）。
  `updateDraft` 自己也用剛讀回的遠端狀態再擋一次，請求**固定帶 `status: 'draft'`**；選「公開」的接著走 `setStatus('publish')`。
- `updateDraft`／`setStatus` 有 `beforeWrite` 同步回呼：讀回遠端之後、送出寫入之前呼叫，丟錯就不寫。
  CoreService 拿它做最後一刻的核准檢查。
- **封面一律送**：沒有封面送 `featured_media: 0`。
- **分類**：分類清單是空的送空陣列（欄位名是分類法 REST 名稱）；有查到的送查到的；**填了名稱但全部查不到
  就不送這個欄位**（不因為查不到就清掉遠端分類），查不到的照樣回報在 `unknownTerms`。
  省略空封面、空分類的話 WordPress 會留著舊的，線上跟核准的內容對不上。
  **建立新稿不變**：沒有就省略（新文章本來就沒有）。

## 作者（P5-T024，D-024）

程式：`src/wordpress/authors.ts`、`src/core/service/authors.ts`（`listAuthors`、`resolvePublishAuthor`）、
`src/ui/components/AuthorPicker.tsx`。發布選項的規則見 [state-machine.md](state-machine.md)「發布選項」。

不送 `author` 時，WordPress 把作者記成**發布台登入的帳號**（作者站台是 AI 帳號 `ai_publisher`，不是使用者本人）。
所以每個站可以設一個預設作者（站台設定檔頂層 `defaultAuthorId`，見 [templates.md](templates.md)「站台設定檔」），
建稿與更新（`fixedObjectId`）都送 `author`。

**誰可以當作者：`GET /wp/v2/users?who=authors&per_page=100&_fields=id,name`（view context）。**依據是 WordPress 核心
`WP_REST_Users_Controller::get_items_permissions_check`（2026-09-24 對 wordpress-develop trunk 查證）：

| 查法 | 需要的權限 | Editor 能不能用 |
| --- | --- | --- |
| `context=edit` | `list_users`（只有 Administrator） | ❌ 403 `rest_forbidden_context` |
| `roles=…` | `list_users` | ❌ 403 `rest_user_cannot_view` |
| `capabilities[]=edit_posts` | `list_users` | ❌ 403 `rest_user_cannot_view` |
| `who=authors` | 能編輯任一個支援作者的內容類型（`edit_posts`） | ✅ |

- `who=authors` 在 `WP_User_Query` 層從 5.9 起標成棄用（建議改 `capability`），但 **REST 的 `who` 參數還在、行為不變**，
  區塊編輯器的作者下拉選單用的就是它；改用 `capabilities[]` 反而 Editor 用不了。回的是 `user_level != 0` 的人（投稿者以上）。
- 帶 `who=authors` 時不套「只列發過文的人」（`has_published_posts`），還沒發過文的使用者本人也列得到。
- 回應只留 `id`、`name`（zod 丟掉其他欄位；`_fields` 讓站台本來就少回）。email 在 view context 本來就不會出現。
- **指定別人當作者要 `edit_others_posts`**（`create_item_permissions_check`／`update_item_permissions_check`，
  否則 403 `rest_cannot_edit_others`）。Author 角色沒有。發布台看 `users/me?context=edit` 的 `capabilities`
  （本人可以用 context=edit 看自己）。**只有 capabilities 在、而且確定沒有 edit_others_posts** 才當成「只能用自己」：
  不列別人，清單只有自己，面板說「這個帳號只能用自己當作者，要改作者請在 WordPress 把它升成 Editor」。
  capabilities 被外掛拿掉時不用角色猜，照樣去列清單；真的不行，WordPress 寫入時會 403（零寫入、會報錯，不靜默）。
- **讀不到清單**（401／403——常見是安全外掛擋 `/wp/v2/users` 或限流——、伺服器錯誤、連不上）**不能**當成只能用自己：
  那會不送 author，作者悄悄變成發布台的帳號（P5-T024 審查）。有要送的作者（指定或預設）時發布前拒絕、零寫入、記
  `publish`／`rejected` 事件：「讀不到站上的作者清單，這次沒有發布，免得作者被記成發布台的帳號；稍後再試」。
  沒有要送的作者時根本不問站台，照舊發。面板收到 `listUnavailable: true`，有預設作者就先擋住發布按鈕。
- 內容類型不支援 `author`（`supports` 沒有 author）時，WordPress 的 schema 沒有 author 欄位，送了會被忽略、不報錯。
  作者站台的 `read-think`／`diary` 支不支援 author **沒有實測過**。
- 遠端快照多比一個 `author`（更新會送它，後台有人改了作者就算遠端被改過）；P5-T024 之前存的快照沒有這個欄位，不比。

## 設定精靈（P8-T002，D-016）

程式：`src/wordpress/setup.ts`、`src/server/routes/setup.ts`、`src/ui/components/SetupWizard.tsx`。
秘密怎麼存、怎麼防其他網頁：[security.md](security.md)「設定精靈寫入的秘密」。路由：[http-api.md](http-api.md)。

### 測試連線（只讀）

依序：網址 → https → 密碼格式 → 匿名 `GET /wp-json/` → `GET /wp/v2/users/me?context=edit` →
`GET /wp/v2/types`、`/wp/v2/taxonomies`（都帶 `context=edit`）。任何一關失敗就停，後面標「還沒測」。
不重試；逾時 15 秒。網址沒寫 scheme 補 https，結尾的 `/wp-admin…`、`/wp-login.php`、`/wp-json…` 去掉；
http 只准 loopback（本機測試站）。能不能發看 `users/me` 的 `capabilities`（`publish_posts`、`publish_pages`、
`upload_files`），沒有就退回角色推斷。

| 失敗（`SetupProblemKind`） | 怎麼認 | 畫面講的下一步 |
| --- | --- | --- |
| `invalid-url` | 網址解析不了 | 填首頁網址，例如 https://example.com |
| `not-https` | http 且不是 loopback；**一個請求都不發** | 改成 https；沒憑證先請主機商開 |
| `password-format` | 去掉空白後不是 24 個英數字；不連線 | 到「使用者 → 個人資料 → 應用程式密碼」產生一組整串貼上 |
| `unreachable` | 網路錯誤：DNS（ENOTFOUND）、拒絕連線、逾時、TLS 憑證（CERT_*） | 各自一句：確認拼字／DNS 生效、網站在不在、稍後再試、重新簽發憑證 |
| `redirect` | `/wp-json/` 或 `users/me` 回 3xx | 改填轉址後的網址（有 Location 而且看得懂就直接寫出來；寫壞了就叫人用瀏覽器看最後停在哪） |
| `not-wordpress` | `/wp-json/` 404、200 但不是 JSON、或大於 8 MB | 確認是首頁網址；永久連結改成「文章名稱」 |
| `rest-blocked` | `/wp-json/` 401／403 回網頁（防火牆）；`wp/v2` 不在 namespaces；`users/me` 401／403 帶其他代碼（安全外掛） | 放行 /wp-json/；到外掛設定允許 REST 或把 /wp/v2/users 從封鎖清單拿掉 |
| `app-passwords-disabled` | `application_passwords_disabled(_for_user)`；或首頁沒宣告 `application-passwords` 而 `users/me` 說沒登入 | 到安全外掛打開應用程式密碼 |
| `auth-header-stripped` | 首頁有宣告應用程式密碼，`users/me` 卻回 `rest_not_logged_in` | 請主機商放行 Authorization；或 .htaccess 加 `SetEnvIf Authorization …` |
| `wrong-username` | `invalid_username`／`invalid_email`（或帳號空白） | 填登入用的使用者名稱或 email |
| `wrong-password` | `incorrect_password`／`invalid_application_password` | 重新產生一組；提醒重設登入密碼會讓應用程式密碼全部失效 |
| `no-permission` | 既不能 `publish_posts` 也不能 `publish_pages`（投稿者會多講一句「只能送審」） | 把帳號改成「編輯」 |
| `types-missing` | `/wp/v2/types` 沒有 post 也沒有 page | 檢查擋 REST 的外掛 |
| `server-error` | 其他 5xx、回應格式不對 | 稍後再試；看「工具 → 網站健康狀態」 |

- 匿名 `/wp-json/` 回 401／403 **JSON**（安全外掛「只給登入的人用 REST」）不算失敗：繼續用帳號測，
  「REST API 開著」那一關標黃、另給一句「不影響」。
- 不擋存檔的提醒：管理員權限過大、作者（只能發文章不能發頁面）、不能上傳圖片。
- 每一種失敗都有測試（`tests/setup-diagnose.test.ts`），對著本機假站台或假 fetch 跑。

### 發到哪裡

只有核心的 `post`（文章）與 `page`（頁面），都用 `article-v1`。站上實際有什麼由後端自己再問一次
（`/wp/v2/types`、`/wp/v2/taxonomies`、`users/me`），不信任畫面送來的東西：

- 站上沒有那個類型（沒開 REST）或帳號不能發 → 那一項選不了，理由寫在卡片上。
- post 的分類法：`types.post.taxonomies` 有 `category`、`/wp/v2/taxonomies` 也有它時才掛，
  `taxonomyRestBase` 用站上回報的 `rest_base`（通常是 `categories`）。D-004 不變：`allowCreateTerms: false`。
- 寫出來的 target 欄位與順序跟 `config/publish-targets.example.json` 一字不差（有測試守著）。

**已經有 `config/publish-targets.json` 時（例如作者的 read-think／diary）**：

- 既有的 target **原樣保留**（寫回的是檔案裡的原文，不補預設值、不改順序），精靈不刪任何東西；只能停用／打開（見下方「停用類型」）。
- 精靈只加 `post`／`page`。同 key 已經存在時，畫面上要**明確勾「取代」**才換；沒勾就整個請求 409、檔案不動。
- 有既有檔時預設什麼都不勾、開關照檔案裡的狀態，按鈕是「不改，下一步」。
- 真的要寫之前，先把原本的檔複製到 `backups/publish-targets-<時間到毫秒>-<亂數>.json`（不覆蓋既有檔，同一秒存兩次也各有一份），完成頁講出備份路徑。
- 磁碟上的檔壞了（不是 JSON、格式不對）就不覆寫，請使用者先處理。
- 換了站（例如從 remusplus 換到別的站）不會自動移除舊站的 target；那些 target 的連線診斷會報錯，
  要刪請手動改檔。

### 停用類型（P5-T032，D-032）

精靈「發到哪裡」把設定檔裡既有的類型列成開關（「使用中」／「不用這個類型」），同一個畫面隨時可以再打開。
停用＝隱藏，不是刪除：刪掉會讓舊稿件變成「發布目標已經不在」，而 read-think／diary 這類手寫的 target 精靈加不回來。

| 入口 | 停用的類型 |
| --- | --- |
| 新稿件的類型選單（`NewJob`）、總覽的「新 X」按鈕、拖放／⌘V 建稿 | 不出現、不預設（`src/ui/lib/targets.ts` 的 `creatableTargets`）。書籤或上一頁進 `#/new/<停用的 key>`：選擇重設（只剩一個能建的就選它，`resolveTargetKey`），沒選到能建的類型前「建立並打開」按不下去 |
| `createJob`（UI 與 MCP 共用） | 拒絕：「『X』已經停用，不能建新稿。要用的話到設定精靈『發到哪裡』把它打開…」——不信任前端 |
| 已經用這個類型的舊稿件 | 照常打開、編輯、核准、發布；總覽照常顯示類型名稱，類型篩選在還有稿件時留著 |
| `listTargets`（`GET /api/wordpress` 的 `publishTargets`）、`SetupStatus` | 照樣列出，帶 `disabled: true` |
| 連線診斷 | 照樣檢查（舊稿件還會發到那裡） |

寫檔規則（`applyDisabledTargets`，`src/wordpress/setup.ts`）：

- 請求帶 `disabled`＝存完之後停用的**完整清單**；不給＝停用狀態不動。精靈加文章／頁面和停用可以同一次存（一份備份）。
- 只動 `disabled` 這一個欄位；狀態沒變的 target 一個字都不碰（連手寫的 `"disabled": false` 都留著）。
  啟用→停用：有欄位就原地改成 `true`，沒有就接在最後；停用→啟用：拿掉欄位，檔案回到停用前的樣子。
- **至少要留一個啟用的**：全部停用的請求 400、檔案不動；畫面上最後一個使用中的開關按不下去。
  這條在每次寫檔前對合併後的結果檢查（`writeSiteConfig`），不只帶 `disabled` 的請求——例如取代唯一一個停用的 target 也擋。
  設定檔裡沒有的 key 也 400。停用清單的 key 格式跟設定檔共用同一個 schema（`TargetKeySchema`），不另加長度限制。
- 什麼都沒變就不寫檔、不備份（`backupFile: null`），但仍把磁碟上已驗過的設定重新載入記憶體（啟動後手改過檔也跟得上）。有變就照上面的規則：先備份、壞掉的檔不覆寫、寫完當場套用。
- 只改停用時**不問站台**：後端沒連上 WordPress 也能關掉不用的類型（加文章／頁面才需要連線）。
  ⚠️ 但**畫面**的「發到哪裡」要先讀 `destinations/check`（會打站台），連不上 WordPress 時整步讀不出來，開關也就改不了；
  這時只能手改設定檔（P5-T032 審查，刻意不修）。
- 請求沒帶 `disabled` 就不動停用狀態；畫面只在使用者動過開關時才帶（兩個分頁同開精靈，舊分頁只加文章不會把
  另一個分頁剛停用的打開）。**取代**（`replace`）一個停用的 target 時，換成精靈的設定但保留 `disabled: true`
  （`mergeSiteTargets`），取代不等於打開。
- 停用的類型還有進行中（沒發布、沒取消）的稿件時，畫面講一句「還有 N 篇用這個類型的稿件，停用後照常可以編輯、發布」，不擋。
  數字來自 `destinations/check` 回應的 `openJobs`（`CoreService.openJobCountsByTarget`）。
- 手改設定檔把全部都停用：載得起來（不讓啟動失敗），但新稿件畫面說「所有類型都停用了：到設定精靈打開一個」，建稿全被拒。

### 換站（網址換成另一個）

同一個 WordPress 編號在不同站是不同的東西，所以發布與媒體一律**以目前連的站為準**（`sites` 以網址為 key；
`wordpress_objects.site_id`）。不用新 migration：媒體屬於哪個站看它在 `wordpress_objects` 那一列（`media_assets`
本身沒有 site_id），查的時候連 job 一起比，避免兩站的編號撞號。沒有站台紀錄（site_id NULL）的舊資料當成目前這個站，
不因為缺紀錄就擋住原本能用的東西。

| 情況 | 行為 |
| --- | --- |
| 稿件發到過舊站、新站上沒有 | 發布擋下：「這篇之前發到另一個站（網址，第 N 號）…不會改發到新站，也不會去動舊站」。不送任何寫入 |
| 封面是舊站媒體庫的圖 | 設封面拒絕；發布前檢查擋下：「封面圖是傳到另一個站的…請在現在這個站重新上傳」 |
| 正文裡放了舊站的圖 | 放圖拒絕；發布前檢查擋下：「正文裡有 N 張圖是傳到另一個站的…」 |
| 換回舊站 | 一切照舊（舊站那篇照常更新） |

**精靈在存檔前先講**：測試的是另一個站、而目前的站上發過文或傳過圖時，測試結果帶 `siteChange`，畫面列出
「已發到舊站的 N 篇不能再從這裡更新、M 張圖不會跟過去（發布前會擋）、原稿與版本都留著、舊站上的東西不動」，
要勾「我知道了，要換到新站」才能存；後端也要求 `confirmSiteChange: true`。

### 不用重新啟動

存檔前先 `tryBeginReconfigure()` 立旗子（有發布或上傳在跑就 409；旗子立著時會碰 WordPress 的動作一律拒絕，
見 [security.md](security.md)）。存 WordPress 連線：先把新密碼加進遮蔽器，再換掉 `AppContext.config`／`wordpress`，`CoreService.reconfigure`
換 client 並重新同步 `sites`／`publish_targets`（`src/server/reconfigure.ts`）。存站台設定：重新讀檔建 registry，
一樣 `reconfigure`。目前**沒有**任何部分需要重新啟動；回應帶
`restartRequired` 讓畫面照後端講的做。

注意：shell 裡 export 的 `WORDPRESS_*` 下次啟動會蓋掉精靈寫的 `.env`（見 [security.md](security.md)）。

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
