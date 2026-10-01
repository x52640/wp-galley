---
id: P6-T002
phase: 6
status: done
depends_on: [P6-T001]
specs: [security.md, factcheck.md, architecture.md, testing.md]
write_paths: ["src/fetch/", "tests/safe-fetch.test.ts", "tests/url-guard.test.ts", "tests/extract-text.test.ts", "tests/wikipedia.test.ts", "tests/fixtures/fetch/", "docs/specs/security.md", "docs/specs/factcheck.md", "docs/specs/architecture.md", "docs/tasks/P6-T002-safe-fetcher.md"]
contract_change: none
expected_commit: "feat(P6-T002): AI 查證的安全取回器與維基百科查詢"
---

# 安全取回器與維基百科查詢

## 目標
D-034。AI 查證要由我們的程式代抓網頁（Agent 不能在使用者機器上連外，ADR-0001 修訂）。
這是整個專案第一次照 Agent 給的網址對外發請求，先單獨做成一個純後端模組、測透，P6-T004 再接進流程。

## 範圍
### 包含
- 新模組 `src/fetch/`：
  - 安全抓取：協定與埠、在 `lookup` 裡檢查位址、跳轉、代理、請求標頭、Content-Type、大小（含解壓後）、逾時（含本體）。
  - 外洩檢查：網址長度、查詢字串長度、文章連續片段、`containsSecret`；依來源種類套不同項目。
  - 抽文字：HTML（parse5）→ 純文字，截斷規則。
  - 維基百科：搜尋與 extracts 兩個端點、User-Agent、繁體變體、條目網址改走 API。
  - 數量上限（嘗試數、同時數、同主機數、維基 API 次數）由一個「這次查證的額度」物件管。
- `architecture.md` 模組表加 `src/fetch` 一列與依賴規則。
### 不包含
- 接進 CoreService、API、畫面（P6-T004、P6-T005）。
- Agent 的 schema、prompt、adapter（P6-T003）。
- 來源挑選與分配給哪條主張（P6-T004；這裡只提供抓的能力與額度）。

## 工作區與 Context
### 必讀入口
`docs/specs/security.md`「取回器」（硬性要求的家）、`docs/specs/factcheck.md`「② 候選來源與抓取」、
`docs/specs/architecture.md`「依賴方向」、`docs/specs/testing.md`；做法參考 `src/wordpress/client.ts`（逾時涵蓋本體、大小上限）。
### 不應載入
`src/ui/`、`src/agents/`、`docs/specs/agent-cli.md`、`docs/archive/`。
### 驗證命令
`npx vitest run tests/safe-fetch.test.ts tests/url-guard.test.ts tests/extract-text.test.ts tests/wikipedia.test.ts`、`npm run verify`

## 實作要求
- **測試絕不連真實網路**：DNS 解析與傳輸都要能注入。預設實作只在正式啟動時用。
- `src/fetch/` 只 import Node 內建與 parse5；文章文字、`containsSecret`、User-Agent 版本由呼叫方傳入，不 import `src/config`、`src/core`、`src/agents`、`src/server`。
- 位址檢查用 Node 內建 `net.BlockList`；檢查必須發生在實際連線用的那次解析裡（不准先 `dns.lookup` 檢查、再讓 HTTP 層自己解析一次）。
- 不跟隨跳轉的預設行為：自己處理 3xx，每一跳重新檢查。
- 不靠全域 `fetch` 的代理行為：明確指定不經代理的連線方式。測試：設 `HTTPS_PROXY`（與 `NODE_USE_ENV_PROXY=1`）指向一個本機監聽埠，用注入的 DNS 讓**預設傳輸**連到本機測試伺服器，斷言代理埠沒收到任何連線（這條測試只連 127.0.0.1 的測試伺服器，不連外）。
- 檢查順序照 security.md「取回器」：網址格式與外洩檢查在 DNS 解析之前，不合格的連 DNS 查詢都不發（有測試：假 DNS 沒被呼叫）。
- 失敗一律回結構化的原因（被擋的哪一項、逾時、太大、Content-Type 不對、HTTP 狀態），不丟例外到呼叫方；原因文字給畫面用，白話（例如「網址含文章原句，沒抓」）——P6-T005 要顯示在來源旁。
- 先寫測試再實作。

## 驗證
### 自動驗證
`npm run verify` 綠。測試至少涵蓋（全部用假 DNS／假傳輸／錄好的回應）：
- 位址：`evil.test → 127.0.0.1`、`10.x`、`169.254.169.254`、`::1`、`::ffff:127.0.0.1`、`64:ff9b::7f00:1`、`64:ff9b:1::1`（RFC 8215 本地前綴，整段拒）、`2002:7f00:1::`、多個位址其中一個是私有、第二次解析換成私有位址（rebinding）。
- 網址：`http:`、非 443 埠、`user@host`、IP 字面值、`localhost`、沒有點的主機名。
- 跳轉：第 4 跳被拒、跳到 `http:`、跳到私有位址、跳轉網址夾帶文章片段。
- 回應：超大本體、壓縮炸彈（解壓後超過）、標頭先到本體一直不來（逾時）、錯誤 Content-Type；`application/json` 只對維基 API 收、Agent 給的網址回 JSON 被拒。
- 外洩檢查：文章連續 12 字（含 URL 編碼後、含 punycode 主機名 `xn--…` 解回 Unicode 後）、密碼（含去空白）、超長網址與查詢字串；文章連結不做片段檢查、維基網址只做密碼與長度。
- 額度：第 13 個嘗試被拒、同主機第 4 個被拒、同時不超過 3 個、維基 API 第 31 次被拒；Agent 給的維基條目網址改走 API 時扣 API 額度、不扣 12 次網址嘗試。
- 抽文字：拿掉該拿掉的元素、截斷；維基回應用 `tests/fixtures/fetch/` 裡錄好的 JSON（**錄的時候**可以手動抓一次真實回應存檔，測試本身不連網）。
### 手動驗證
無（P6-T005 一起做）。

## 完成定義
- [x] `npm run verify` 綠
- [x] 擁有這些行為的 spec 已更新（security.md「取回器」拿掉「尚未上線」；architecture.md 模組表）
- [x] 留下的殘餘寫進完成結果（由主 session 併入 `docs/known-issues.md`）
- [x] CURRENT_TASK 已更新（由主 session）

## 中斷／接手紀錄
- 最後完成：審查修正（抽文字移進 worker＋時間上限、非遞迴走訪、同主機去結尾點、密碼與文章片段比對去掉看不見的字元；2026-10-01）。之前：`src/fetch/` 九個檔＋四個測試檔＋`tests/fixtures/fetch/`；security.md「取回器」補實作細節、factcheck.md 維基與抽文字、architecture.md 模組表與依賴規則（2026-10-01）
- 已通過驗證：`npm run verify` 綠，77 檔／1655（基準 73／1497，新增 4 檔／158）；`npm run build` 後從 dist 載入 worker 實測可用；代理測試另做過變異驗證（改用 `https.globalAgent` 時測試會紅）
- 下一步：主 session 審查 → 另派審查 → commit；殘餘併入 known-issues；P6-T004 接進流程
- Blocker：無

## 完成結果
- 模組：`types.ts`（上限、失敗碼與白話原因）、`extract-runner.ts`＋`extract-worker.ts`（在 worker 裡抽文字、時間與資源上限）、`address-guard.ts`（BlockList＋取出內含 IPv4）、`url-guard.ts`（DNS 前的格式與外洩檢查、候選網址整批密碼檢查）、
  `budget.ts`（這次查證的額度）、`transport.ts`（預設 https 傳輸與 DNS）、`safe-fetch.ts`（請求、跳轉、回應檢查）、`wikipedia.ts`、`extract-text.ts`、`index.ts`（`createSourceFetcher` 組起來）。
- 偏離：
  - 實作與測試是同一輪寫的，不是嚴格的先紅後綠。
  - 維基回應的 fixture 照 API 文件手寫，沒有錄真實回應（實作時不准連外網）。
- 殘餘（給 known-issues）：
  - 「文章片段」對英文誤擋較多：12 字只有兩三個英文字，文章裡的專有名詞出現在網址裡就會擋（例如 `united states`）。
  - 中文繁體變體（`Accept-Language` 與 `variant=zh-tw`）哪個有效未證實，P6-T005 手動驗證時看。
  - 維基 fixture 不是錄的真實回應，P6-T005 手動驗證時順便對一次格式。
  - 外洩檢查的密碼比對不分大小寫沒做（要動 `src/config` 的遮蔽器，超出本 Task）：把密碼換成全小寫夾帶擋不住。
  - 測試用的自簽憑證與私鑰（`tests/fixtures/fetch/test-*.pem`，只給 example.test）進版控，秘密掃描工具可能會報。
- 資安審查（2026-10-01）：網路層（SSRF 各種 IP 寫法、DNS rebinding、跳轉、代理、資源耗盡）全部擋得住。high 已修：抽文字移到 worker（10 秒上限、超時終止）、`walk` 非遞迴、例外一律轉結構化原因。low 已修：主機名結尾點、密碼 NFKC＋去非英數比對、片段比對先去不可見字元。殘餘已併入 known-issues.md。
