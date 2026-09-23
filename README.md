# 本機 AI WordPress 發布台

只在你自己電腦上執行的 WordPress 發布台：**本機 AI 當編輯，你當總編。**

貼上文章，請你已經訂閱、已經登入的 AI（Codex／Claude Code／Antigravity）校稿、建議配圖，
你逐項決定、看過成品、按核准，發布台才用 WordPress 的 REST API 發到你的站。
AI 碰不到你的 WordPress，也不需要任何 AI API Key。

- 產品目標、範圍與決策：[`plan.md`](./plan.md)
- 目前進度：[`docs/CURRENT_TASK.md`](./docs/CURRENT_TASK.md)
- 技術規格：[`docs/specs/`](./docs/specs/README.md)

## 需求

- macOS 或 Linux，Node.js ≥ 22.5（需要內建的 `node:sqlite`；開發機實測 v26.7.0）
- 一個 **https** 的 WordPress 站（5.6 以上，內建「應用程式密碼」），和一個能發文的帳號
- 至少一個 AI 編輯（選用，見下方「AI 編輯」）；一個都沒有也能自己改稿、發布

## 安裝與啟動

```bash
git clone <這個 repo 的網址> wordpress-publisher
cd wordpress-publisher
npm install
npm run build
npm start                 # 打開 http://127.0.0.1:3000
```

第一次打開會自動進**設定精靈**，不用先改任何設定檔。

## 設定精靈

四步，每一步失敗都會講「卡在哪裡、下一步做什麼」：

1. **連線 WordPress**：填網址、帳號、應用程式密碼，按「測試連線」。
   測試只會讀取（不會在站上建立或修改任何東西），會分別告訴你：網址是不是 https、連不連得上、
   REST API 有沒有被安全外掛或主機商擋住、帳號密碼對不對、站上有沒有關掉應用程式密碼、
   這個帳號能不能發文。通過後按「儲存並繼續」。
2. **AI 編輯**：偵測三個 CLI 有沒有裝、有沒有登入。沒裝或沒登入的，畫面上會給你要在終端機執行的指令
   （發布台不會替你安裝或登入）。
3. **發到哪裡**：勾「文章」和／或「頁面」。
4. **完成**：進稿件總覽，直接開新稿。

存好就生效，**不用重新啟動**。之後要改，按稿件總覽右上角的齒輪「設定」重跑一次。
換到另一個站時，精靈會先講清楚哪些不會跟過去（已經發到舊站的稿件、傳到舊站媒體庫的圖），確認之後才存。

測試連線失敗時，畫面會列出過了哪幾關、卡在哪一關，以及下一步：

![設定精靈第一步：測試連線失敗，列出卡在哪一關與下一步](docs/images/setup-1-connection.png)

第二步列出每個 AI 編輯的狀態，沒裝或沒登入的附上要自己執行的指令：

![設定精靈第二步：AI 編輯的安裝與登入狀態](docs/images/setup-2-agents.png)

第三步選要發到文章還是頁面：

![設定精靈第三步：選擇發到文章或頁面](docs/images/setup-3-destinations.png)

（截圖是示範資料模式，網址與帳號都是假的。）

### 應用程式密碼怎麼申請

應用程式密碼是 WordPress 內建、專門給外部程式用的密碼，**不是你的登入密碼**，可以隨時單獨撤銷。

1. 建議先在後台「使用者 → 新增使用者」開一個**編輯（Editor）**角色的帳號專門給發布台用，不要用管理員。
2. 用那個帳號登入後台，左邊選「使用者 → 個人資料」。
3. 捲到最下面「應用程式密碼」，名稱填「發布台」，按「新增應用程式密碼」。
4. 把出現的那串 24 個字（每 4 個一組）整串複製，貼到精靈裡。它只會顯示這一次。

找不到「應用程式密碼」這一區：站台要是 https，而且沒有被安全外掛關掉。精靈的測試連線會告訴你是哪一個。

⚠️ 重設這個帳號的登入密碼，會讓它所有的應用程式密碼一起失效，要重新產生一組、重跑精靈。

### 密碼存在哪裡

精靈把網址、帳號、應用程式密碼寫進專案根目錄的 `.env`（權限 0600，只有你的帳號讀得到；
已在 `.gitignore`，不會進 Git）。發布目標寫進 `config/publish-targets.json`（本機檔，也不進 Git）。
密碼只在按「測試連線」時從瀏覽器送到本機後端一次，之後任何畫面、回應、log 都不會再出現。
細節見 [`docs/specs/security.md`](./docs/specs/security.md)「設定精靈寫入的秘密」。

## AI 編輯

發布台直接呼叫你電腦上已經登入的官方 CLI，用的是你原本的訂閱額度。三個都是選用的，裝一個就能用。
**只有 Codex 能生圖**；其他兩個能校稿、建議配圖，但不能畫。

| AI 編輯 | 需要的訂閱 | 安裝 | 登入 |
| --- | --- | --- | --- |
| Codex | ChatGPT 付費方案（Plus 以上） | `npm install -g @openai/codex` | `codex login` |
| Claude Code | Claude 付費方案（Pro 以上） | `npm install -g @anthropic-ai/claude-code` | `claude auth login` |
| Antigravity（`agy`） | Google 帳號 | 從 https://antigravity.google 下載安裝 | 第一次執行 `agy` 時登入；`agy models` 列得出模型就代表好了 |

裝好或登入之後不用重開發布台，在精靈第二步按「重新偵測」就好。

## 不用精靈、手動設定

```bash
cp .env.example .env                                           # 填 WORDPRESS_URL、WORDPRESS_USERNAME、WORDPRESS_APP_PASSWORD
cp config/publish-targets.example.json config/publish-targets.json
```

手動改 `.env` 要重新啟動才會生效。WordPress 相關三個變數要**一起填或一起留空**，只填一半會在啟動時報錯。

## 開發

```bash
npm run migrate           # 建立 data/publisher.sqlite（啟動時也會自動套用）
npm run dev               # 後端 127.0.0.1:3000 + Vite UI 127.0.0.1:5173
```

UI 網址加上 `?fixtures=1` 是示範資料模式，不連後端；`?fixtures=1&setup=needed` 會從設定精靈開始，
第一步有下拉選單可以模擬每一種連線失敗。

| 指令 | 用途 |
| --- | --- |
| `npm run dev` | 同時啟動後端（tsx watch）與 Vite UI |
| `npm run dev:server` | 只啟動後端 |
| `npm run dev:ui` | 只啟動 UI（會 proxy `/api` 到 3000） |
| `npm run build` | 編譯後端到 `dist/`、UI 到 `dist/ui/` |
| `npm start` | 執行已建置的服務 |
| `npm run migrate` | 套用 SQLite migration |
| `npm test` | 跑全部測試（Vitest；不呼叫真的 AI CLI、不連真的 WordPress） |
| `npm run test:watch` | watch 模式 |
| `npx vitest run tests/health.test.ts` | 只跑單一測試檔 |
| `npx vitest run -t "遮蔽"` | 只跑名稱含關鍵字的測試 |
| `npm run typecheck` | TypeScript 檢查（不產生輸出） |
| `npm run verify` | typecheck ＋ 全部測試（commit 前的品質閘） |

## 安全設計

只綁 127.0.0.1、擋 DNS rebinding 與其他網頁送來的修改請求、密碼只在後端記憶體與 `.env`、
核准只能由本機畫面建立、內容一改核准就失效。
細節見 [`docs/specs/security.md`](./docs/specs/security.md)。

⚠️ 把文章改成公開，可能會觸發站上的電子報或自動分享外掛，**寄出去就收不回來**。第一次用建議先發成草稿。

`.env`、`config/publish-targets.json`、`data/`、`drafts/`、`generated-images/`、`backups/` 都不進版控。
