---
id: P8-T005
phase: 8
status: in_progress
depends_on: [P8-T003]
specs: [security.md]
write_paths: ["scripts/", "tests/", ".gitignore", "README.md", "README.zh-TW.md", "docs/known-issues.md", "docs/tasks/P8-T005-launcher-app.md", "docs/CURRENT_TASK.md"]
contract_change: none
expected_commit: "feat(P8-T005): 啟動不再 502，並可包成 Dock 上的 Galley.app"
---

# 啟動不再 502，並可包成 Dock 上的 Galley.app

## 目標
D-044。使用者 2026-10-12：
1. 雙擊 `scripts/start.command` 常常一打開就是稿件列表「後端回應 HTTP 502」，重新整理才好。
   原因：腳本只等 Vite（5173）有回應就開瀏覽器，後端（`tsx watch`，3000）起得比較慢，Vite proxy 轉不到就回 502。
2. 想把 `start.command` 變成有圖示的 app 放 Dock。D-035 當時說「現階段不做外殼 App」，顧慮是常駐吃記憶體；
   這個 app 只負責啟動、不常駐，所以修訂 D-035。

## 範圍
### 包含
- `scripts/start.command`：開瀏覽器前要同時等到 `http://127.0.0.1:5173/` 和 `http://127.0.0.1:3000/api/health`（後者回 2xx）。
  等待上限放寬到合理值（後端第一次啟動可能要跑 migration／搬家），逾時訊息照舊講清楚。
- 新增產生 app 的腳本（例如 `scripts/make-app.sh`）：產生 `Galley.app`，預設放 `~/Applications/`（可用參數改位置），使用者再拖到 Dock。
  - app 點下去：服務已在跑（health＋5173 都通）→ 只開 `http://127.0.0.1:5173`；沒在跑 → 用 `open` 打開 repo 裡的 `scripts/start.command`（開終端機視窗，跟雙擊一樣，視窗就是服務本體）。
  - repo 絕對路徑在產生 app 時寫進去；repo 搬家後重跑腳本即可（寫在 README）。路徑含空白要正確處理（使用者的路徑是 `My Programs`）。
  - 用 macOS 內建工具（`osacompile`／AppleScript、`sips`、`iconutil` 等），不加 npm 依賴、不下載任何東西。
  - 有自己的圖示：圖示來源檔放進 repo（例如 `scripts/app/`），由腳本轉成 `.icns` 放進 app。簡單乾淨即可（深色底＋字母 G 之類），之後使用者可換圖。
  - 產生出來的 `.app` 不進 git。
- README（中英）加一小段：怎麼產生 app、放 Dock、repo 搬家要重跑。
- 能自動測的部分加測試（例如守住 `start.command` 有等 `/api/health`、make-app 腳本產出的 AppleScript 內容正確跳脫路徑）；不能自動測的寫進手動驗證。

### 不包含
- 常駐背景、選單列圖示、自動開機啟動。
- 把 Node／專案打包進 app、簽章公證、正式模式（`npm start`）切換。
- 前端遇到 502 自動重試（這次只修啟動時序）。

## 工作區與 Context
### 必讀入口
`scripts/start.command`、`src/server/routes/health.ts`、`vite.config.ts`、`docs/tasks/P8-T003-user-data-dir.md`（D-035 背景）。
### 不應載入
其他 spec。
### 驗證命令
`npm run verify`；`bash -n scripts/*.sh scripts/start.command`；make-app 產到 scratchpad 目錄（**不要**產到 `~/Applications`）並檢查 app 結構、圖示、`osadecompile` 出來的腳本。

## 實作要求
- 不准真的雙擊／`open` 產出的 app 或 `start.command`（使用者的 dev server 正在 3000/5173 跑，會撞埠或干擾）。
- 不用 `shell: true`、不碰 Cookie、不讀 `.env`。

## 驗證
### 自動驗證
`npm run verify` 綠。
### 手動驗證（使用者）
1. 關掉發布台 → 雙擊 `start.command` → 瀏覽器打開時稿件列表直接正常，沒有 502。
2. 跑 make-app → `~/Applications/Galley.app` 有圖示 → 拖到 Dock → 發布台沒開時點它 → 開終端機並啟動；已開時點它 → 只開瀏覽器分頁。

## 完成定義
- [ ] `npm run verify` 綠
- [ ] 擁有這些行為的 spec 已更新（新增或搬動功能：architecture.md 功能地圖）
- [ ] 留下的殘餘已寫進 `docs/known-issues.md`
- [ ] CURRENT_TASK 已更新

## 中斷／接手紀錄
- 最後完成：開 Task（2026-10-12）
- 已通過驗證：無
- 下一步：實作
- Blocker：無

## 完成結果
