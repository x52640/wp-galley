# 安全模型

> 擁有範圍：信任邊界、三條分界線、硬性禁令、秘密處理、本機守門、已接受的限制。
> 違反本檔任何一條即為錯誤，不論 Task 怎麼寫。
> 程式：`src/server/plugins/`（local-only guard）、`src/config/secrets.ts`、
> `src/agents/process-runner.ts`、migration 001（`approvals.created_by`）。

## 三條無法繞過的分界線

1. **Agent 只產生結構化資料，固定程式產生 HTML。** Agent 回傳 JSON（校稿結果、
   templateData、imageBriefs），由 deterministic renderer 填入模板。Agent 永遠不直接寫
   HTML 外框、class、script 或 style。後端必須用 `schema.json` 再驗證一次 Agent 的輸出，
   不信任 Agent 自稱合格。
2. **人工核准無法被程式繞過。** 核准綁定特定 revision 的 content hash，內容一改就失效。
   只有本機 UI 能建立 approval（DB 也擋），規則的家在 [state-machine.md](state-machine.md)。
3. **秘密不外流。** WordPress Application Password 絕不出現在 Agent prompt、browser
   bundle、React state、HTML、log 或 MCP output 中。

## 信任邊界

模板檔案是**受信任**的本機設定；使用者貼入的文章與任何外部網頁內容是**不受信任資料**，
不能覆蓋系統規則或模板規則。

**直接在文章上改時貼上的 HTML（P5-T028）**：剪貼簿的 `text/html` 在外層用 `DOMParser` 解析（惰性文件，
script 不跑、圖片不載），只保留模板 `allowedTags` 內的標籤、連結只留 `href` 且要通過下面的連結網址規則，其餘屬性、`style`、`class`、`script`
（連內容）、圖片一律丟掉。這一步**不是安全關卡**：存檔送出的正文後端照樣用同一套規則整理
（`normalizeEditedBody`），再過 schema、`sanitize.ts`（manifest 原始 allowlist）與結構驗證。
校樣 iframe 仍是 `sandbox="allow-same-origin"`、不給 scripts；格式指令一律由外層對 iframe 文件下。

**連結網址規則（2026-09-28 使用者裁定，P5-T028 審查 F5）**：渲染（`sanitize.ts`）、編輯整理、貼上、連結輸入框
都呼叫同一個函式 `safeHref`（`src/contract/rich-text.ts`）：
- 收：scheme 在模板 `allowedSchemes` 內的絕對網址（http／https 一定要是 `scheme://主機` 形式且主機非空——`https:next`
  沒有主機、瀏覽器會照目前頁面解析，不收；`https:///x` 也不收；mailto 等冒號後要有內容。驗過後回傳原本的寫法，不正規化）；`#` 開頭的頁內錨點；以**單一** `/` 開頭的站內路徑（`/about`；
  `/%2F%2Fx` 仍是站內路徑，瀏覽器不把 `%2F` 當成分隔）。
- 不收：其他相對路徑（`../post`、`post`、`./x`、`?q=1`）、協定相對 `//host`、`/\host`。判斷前先去掉控制字元與空白
  （瀏覽器會忽略網址裡的 tab／換行，`java\tscript:`、`/\t/evil.test` 在它眼中就是 `javascript:`、`//evil.test`）。
- 不收的連結整個拆掉、字留著（不留沒有 href 的空殼 `<a>`）；sanitize 回報 `a.href`，編輯整理時進 dropped 提醒。

**存檔時沒改的頂層區塊原樣保留**（P5-T028 審查）：前後端都把編輯後的正文跟**同一份基準**逐個頂層區塊做序列比對：
基準是上一版**實際會發布的正文**（templateData 正文經 sanitize、補段落之後的 publishHtml——前端校樣顯示的就是它，
後端自己再算一次）。對得上的區塊輸出基準裡那份（HTML 解析器修補過、已 sanitize）的 HTML，不跑整理規則；
**不拼接原始字串片段**（上一版有沒關的註解、引用或清單時，逐字拼回去會吞掉後面新加的區塊）。保留**不是**免檢：整份正文（含保留的區塊）照樣過
sanitize 與結構驗證；比對用的是內容本身（正規化後的 HTML），前端無法宣稱「沒改」來讓別的內容跳過整理。

**MCP Server 與 Web UI 必須呼叫同一個 `CoreService`，不能各寫一套發布邏輯。**
這是整個安全模型的基礎——所有核准、驗證與稽核只實作一次。

## 硬性禁令

- 不得用 `shell: true` 啟動 Agent CLI。一律 `spawn` + 參數陣列，prompt 走 stdin。
- 不得擷取、複製或讀取 ChatGPT／Claude／Google 的網頁 Cookie 或登入憑證。只啟動官方
  可執行檔，讓它自己用已登入狀態。
- 不得把 WordPress Application Password 傳給任何 Agent。
- 不得提供能呼叫任意 REST endpoint、任意 shell command 或任意檔案路徑的 MCP 工具。
  檔案參數只接受 job workspace 內 resolve 過的路徑。
- 不得在測試期間寫入正式首頁；WordPress 整合先用 staging 或 mock。
- 不得修改 WordPress 的 PHP／Theme／Plugin 原始碼。CPT 沒開 `show_in_rest` 就顯示
  設定錯誤，不要去改 PHP。
- 校稿工作不授權 Agent 使用 shell、檔案寫入、網路或 WordPress 工具。每次執行要有
  timeout、取消機制、最大輸出、concurrency 1，工作目錄設為隔離的 job workspace。
  （Agent 為什麼不能連外：[ADR-0001](../adr/0001-agent-no-network.md)。）
- `data/`、`drafts/`、`generated-images/`、`backups/`、`.env`、SQLite 全部進 `.gitignore`。
- 進到需要 WordPress 網址、Application Password 等資料時向使用者索取，不要預先寫進
  任何檔案。使用者自己在設定精靈填的，照下方「設定精靈寫入的秘密」存進 `.env`。

## 本機守門與秘密

- **只綁 loopback。** `APP_HOST` 只接受 `127.0.0.1` / `localhost` / `::1`，填 `0.0.0.0`
  會直接啟動失敗。
- **擋 DNS rebinding。** 每個請求都檢查 `Host` 與 `Origin` header 是否指向本機，
  不只看綁定位址。
- **守門用 `applyLocalOnlyGuard(app)` 直接掛在 root instance，不要改成 `app.register()`**——
  Fastify plugin 會建立封裝範圍，hook 就套不到父層註冊的路由，守門會整個失效（階段 1 踩過）。
- **任何要輸出的東西**（log、HTTP response、未來的 MCP output）都要先過
  `createSecretScrubber()`；設定摘要用 `redactConfig()`，永遠不要直接序列化 `AppConfig`。
  集中點（P5-T023，審查 #6 #7）：
  - **log**：pino 的 `formatters.log` 遮合併進 log 的物件；`hooks.logMethod` 遮其餘所有參數——訊息字串
    （`log.warn(obj, msg)` 的 msg）、printf 參數（`%s`／`%j`／`%o` 的字串、物件、Error，格式化前先深層遮）、
    當第一個參數的 Error（pino 拿它的 message 當 msg）。第一個參數是一般物件時不在這裡動（例如 Fastify 的
    `{ req }`，先拆開 serializer 就認不得），交給 formatters.log。Error 複製時保留型別與 stack，照樣當 Error
    序列化。遮蔽器深層走到第 8 層為止。原本只遮物件，錯誤訊息裡的密碼原樣進 log。有測試擷取實際 log 輸出斷言。
  - **HTTP 回應**：`buildApp` 在 root 掛一個 `onSend`，**所有路由、所有狀態碼**的字串回應（JSON 已序列化、
    校樣 HTML）送出前過遮蔽器；Buffer（圖片）與 stream（靜態檔）不動。Content-Length 由 Fastify 依換過的
    字串計算。原本只遮錯誤回應，WordPress 回來的資料（例如分類名稱）原樣回給畫面。
  - **遮蔽器認得兩種樣子**：每個秘密的原樣，加上去掉所有空白的樣子（WordPress 顯示的密碼每 4 字一組有空白，
    驗證時會去掉；`.env` 手填有空白、貼進文章沒空白，都要抹）。
  - 遮蔽是字串比對：秘密在 JSON 裡被跳脫（含 `"`、`\`）就對不上。Application Password 只有英數，不受影響。
- **內容裡有 WordPress 應用程式密碼就拒絕（D-023，P5-T023，審查 #5）**：使用者文字進系統、以及任何要送給
  Agent 的東西，都在 `CoreService.assertNoAppPassword` 一處檢查，含遮蔽器認得的任何密碼就丟
  `InvalidInputError`「內容裡有你的 WordPress 應用程式密碼，請刪掉再存」（400 `INVALID_INPUT`），**在任何寫入、
  任何派工之前**；錯誤訊息、details、log 都不含密碼。
  - 涵蓋：`createJob`（原稿、標題、templateData）、`createRevision`（整份新內容、editedBody、sourceText、reason
    ——放圖、設封面、套用校稿都經過它）、上傳／換圖／「用這張」的替代文字與說明、派校稿（指示＋**組好的
    prompt**）、請 AI 配一張（那句話＋組好的 prompt）、在卡片上改配圖描述（改的 prompt 或那句話＋重組好的 prompt，P5-T025）、生圖（組好的 prompt）。派工檢查組好的 prompt，所以密碼
    設定之前就存進去的舊內容也送不出去。
  - 舊內容（密碼設定之前存的）另外在三處擋：**核准**（`approve`，`InvalidInputError`）、**發布**（前置檢查 4a，
    `PublishBlockedError`，同一句訊息，一個請求都不送）、**上傳／換圖／用這張**（送到 WordPress 之前先看目前
    這一版；不然自動放圖、設封面建新版本時才被擋，圖已經傳上去了）。
  - 判斷用同一個遮蔽器（`containsSecret`）：認得的樣子跟遮蔽完全一致，設定精靈當場加的新密碼立刻算數；
    另外把字串的空白全部去掉再比一次，密碼中間的空白換成換行、tab 也認得。舊密碼留在遮蔽器裡，也一樣會擋。
- 帳號用專用 WordPress 使用者（editor，不用 administrator）與 Application Password。
- **本機守門對「會改東西的請求」更嚴（P8-T002）**：非 GET／HEAD／OPTIONS 的請求（`isAllowedWriteSource`）：
  - `Origin: null`（沙箱 iframe、`file://` 頁面）拒絕。原本「Origin 是 null 就放行」讓沙箱裡的外站頁面
    可以發不帶 body 的 POST。
  - `Sec-Fetch-Site` 有的話只能是 `same-origin` 或 `none`。
  - 有 Origin 時必須跟 `Host` **同源**（同一個 host:port、http）。原本任何本機埠都算本機，
    `localhost:8080` 上別的開發中網站就能改發布台的東西。
  - UI 由後端直接提供時是 :3000 對 :3000；經 Vite dev server 時 proxy 設 `changeOrigin: false`，
    Host 保持 :5173，跟瀏覽器送的 Origin 一樣，所以不用另外開例外（有測試；實測 dev server 通過）。
    **改 Vite proxy 設定時不能打開 `changeOrigin`**，不然畫面上所有修改都會被擋。
  - 沒有 Origin 也沒有 Sec-Fetch-Site 的（curl、測試、非瀏覽器程式）照舊放行：本機程式本來就讀得到 `.env`。
- **`/api` 不論方法都擋跨站（P5-T023，審查 #10）**：`Sec-Fetch-Site` 是 `cross-site` 或 `same-site` 一律 403
  `CROSS_ORIGIN_BLOCKED`，GET／HEAD 也算。有些 GET 有副作用（`GET /api/agents/:id/models` 會啟動 CLI 子行程），
  外站用一張 `<img>` 就能觸發；`same-site` 也擋，因為同一台機器的其他埠對瀏覽器來說是同一個 site。
  - 不受影響的：發布台自己的畫面一律 `same-origin`（後端直接提供時 :3000 對 :3000；經 Vite dev server 時畫面在
    :5173、`/api` 也打 :5173 再由 proxy 轉給 :3000，UI 的請求全是相對路徑 `/api/...`）；校樣 iframe 由同源畫面
    載入，也是 `same-origin`（校樣自己的 CSP 不准載 http 圖片，不會再打 `/api`）；網址列直接打是 `none`；
    curl／測試沒有這個標頭。**UI 若改成直接打 :3000（不經 proxy），會變成 same-site 被擋。**
  - 只管 `/api`：外站連結點進首頁（靜態 UI）不擋。判斷「是不是 `/api`」不能只看原始網址——`/%61pi/...` 會被
    Fastify 解碼後路由到 `/api/...`。有匹配路由看路由本身的路徑，沒匹配（404）看解碼後的路徑，解碼失敗當成
    `/api`（`isApiRequest`）。
  - 模型列表另有 30 秒快取（跟 `GET /api/agents` 同一個時間），同時進來的請求共用同一趟；設定精靈的
    「重新偵測」（`POST /api/setup/agents`）會一起清掉。

## 設定精靈寫入的秘密（P8-T002）

精靈要收 Application Password、要寫檔，是整個專案唯一「從瀏覽器收秘密」的地方。

- **存在哪裡：`.env`**（專案根目錄，已在 `.gitignore`）。跟手動設定是同一個檔，啟動流程不用改。
  - 只改 `WORDPRESS_URL`、`WORDPRESS_USERNAME`、`WORDPRESS_APP_PASSWORD` 三行；其他行（`APP_PORT`、
    註解、使用者自己加的東西）原樣保留。同一個鍵出現多次時留第一行、刪掉其餘（避免誰生效不明）。
  - 檔案不存在時以 `.env.example` 為底產生。寫法是先寫同目錄暫存檔再改名（寫到一半當掉不會留下半個
    `.env`），**權限一律 0600**（原本的 `.env` 若是 0644 也會被收緊）。
  - 密碼存成去掉空白的 24 個英數字（WordPress 驗證前本來就會去掉空白）。值只含英數與 `._@:/+-` 時
    直接寫（網址、密碼、一般帳號都是這樣）；有其他字元（空白、`#`、中文…）才用單引號包起來
    （dotenv 的單引號值是字面值）。含單引號或換行的值直接拒絕，不做跳脫。
  - 不另存備份：`.env` 的備份就是另一份秘密。
  - **`.env` 是符號連結時**：改名會把連結本身換成一般檔案，連結原本指向的檔不動、也不會被寫入。
    要把 `.env` 放在別處的人，存完要自己把連結接回去（或不要用精靈改）。
  - **shell 環境變數優先**：dotenv 啟動時不覆蓋已經存在的環境變數。使用者在 shell 裡 export 了
    `WORDPRESS_*` 的話，精靈這次當場生效，但下次啟動會被 shell 的值蓋回去。
- **只送一次**：「測試連線」把網址、帳號、密碼送到本機後端一次。測試通過後後端把這組憑證放在
  **記憶體**裡（10 分鐘、只留最新一組），回給畫面一個隨機的 `testId`；「儲存」只送 `testId`，
  密碼不再過網路。沒通過的測試不留任何東西。
- **不帶回**：任何 API 回應、錯誤訊息、log、稽核事件都不含密碼，連遮蔽過的樣子或長度都不給。
  狀態只回「有沒有設定」。診斷結果回傳前再過一次含這組密碼的遮蔽器。
- **前端**：密碼欄是 uncontrolled input，送出時才讀 DOM 的值，不進 React state；測試通過後清空欄位。
- **遮蔽器立即涵蓋新密碼**：log、錯誤回應、CoreService 用的是同一個可更新的遮蔽器
  （`createMutableScrubber`）。按「測試連線」的當下，**只有去掉空白後是 24 個英數字的值**才加進去
  （含空白與不含空白兩種樣子）；格式不對的不加——那多半是貼錯欄位的網址或帳號，加進去會讓它在 log
  與稽核紀錄裡永遠變成 `[REDACTED]`，而它也不會被送去 WordPress（格式不對在連線前就擋）。
  診斷本身另有一個只活在這一次的遮蔽器，涵蓋輸入的原樣。存檔時再加一次；舊密碼留在清單裡不移除。
  有測試把整趟測試＋儲存的 pino 輸出收起來，確認裡面沒有密碼。
- **防其他本機網頁（CSRF）**：精靈的所有 `POST /api/setup/*` 除了上面的全域守門，再要求
  `Content-Type: application/json`（跨來源送 JSON 一定先有 preflight，後端不回 CORS 標頭，
  瀏覽器就不會真的送出）。**有副作用的讀取也走 POST＋JSON**：第三步的站台查詢會打真的 WordPress
  （`POST /api/setup/destinations/check`），第二步的重新偵測會啟動 CLI 子行程（`POST /api/setup/agents`）；
  `GET /api/agents` 不再接受 `?refresh=1`（只給 30 秒快取）。
- **只讀不寫**：測試連線只打 `GET /wp-json/`、`GET /wp/v2/users/me`、`GET /wp/v2/types`、
  `GET /wp/v2/taxonomies`，不建立、不修改站上任何東西；不重試（認證錯誤重試會被安全外掛鎖帳號）。
- **http 網址只准 loopback**（本機架的測試站）；其他一律要 https：Application Password 走明碼
  就等於把密碼送給路上每一台機器。**啟動設定也一樣**（P5-T023，審查 #4）：`.env` 手填的 `WORDPRESS_URL`
  是 http 且不是 loopback，`loadConfig` 丟 `ConfigError`、啟動失敗。精靈與啟動共用 `src/config/env.ts` 的
  `isLoopbackHostname`（`localhost`、`127.x.x.x`、`::1`）。
- **回應本體有逾時與上限**：逾時涵蓋到本體讀完（標頭先到、本體一直不來的伺服器也會被切斷）；
  `/wp-json/` 首頁上限 8 MB，一般 REST 回應上限 32 MB（`WordPressClient`），超過就中止、不重試。
- **換設定的期間不碰 WordPress**：存檔先 `CoreService.tryBeginReconfigure()`——有發布或上傳在跑就 409；
  沒有就立旗子，旗子立著的期間發布、上傳、換圖、放圖、設封面一律拒絕，存完放下。`reconfigure()`
  本身再檢查一次沒有動作在跑。
- **換站不會打到錯的站**：規則見 [wordpress-site.md](wordpress-site.md)「換站」。
- 精靈寫的站台設定檔（`config/publish-targets.json`）沒有秘密；已經有檔時的規則見
  [wordpress-site.md](wordpress-site.md)「設定精靈」。
- 測試一律注入暫存路徑；`buildApp` 沒拿到路徑時寫入路由回 503，不會退回專案裡真的 `.env`。

## 發布的外部副作用

把草稿改成公開的瞬間，MailPoet／Jetpack 可能寄出電子報或自動分享，**之後刪文章救不回來**。
這是整個流程裡唯一「刪掉就沒事」不成立的地方。UI 在公開前必須提醒；真實驗證一律停在
草稿狀態。細節見 [wordpress-site.md](wordpress-site.md)。

## 刻意接受的限制（不是 bug，不要去「修」）

- **`actor: 'ui'` 是宣告不是證明。** 本機單人工具無法真正證明呼叫來源；靠 loopback 守門
  加這道檢查擋住我們自己的 MCP 路徑，僅此而已。
- **WordPress REST 不支援條件式寫入。** 遠端「檢查」與「寫入」必然是兩個請求，中間的
  空隙只能縮小、不能消除。
- `wordpress_objects` 沒做多站台 scoping；目前只有一個站台。
- 校樣預覽的 CSP 允許任意 loopback 埠嵌入。
