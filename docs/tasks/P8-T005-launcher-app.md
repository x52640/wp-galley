---
id: P8-T005
phase: 8
status: done
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
`npm run verify`；`bash -n scripts/make-app.sh`、`bash -n scripts/start.command`（`bash -n` 只檢查第一個檔，要一個一個跑）；make-app 產到 scratchpad 目錄（**不要**產到 `~/Applications`）並檢查 app 結構、圖示、`osadecompile` 出來的腳本。

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
- 最後完成：實作＋測試＋README＋known-issues；獨立審查五點已修（2026-10-12）；make-app 只產到暫存目錄驗過結構
- 已通過驗證：`npm run verify`（101 檔／2229 測試）、兩個腳本各自 `bash -n`、osadecompile／codesign／icns 檢查
- 下一步：主 session 審查；`architecture.md` 功能地圖、`CURRENT_TASK.md` 由主 session 更新（前者不在本 Task write_paths）；使用者手動驗證
- Blocker：無

## 完成結果
- `scripts/start.command`：開瀏覽器前同時等 `http://127.0.0.1:5173/`（有回應即可）和 `http://127.0.0.1:3000/api/health`（`curl -f`，只認 2xx），
  前端每次檢查最多等 2 秒、後端 10 秒（冷啟動的 `/api/health` 要偵測 Agent CLI，太短會一直重送、每次再偵測一輪）。
  上限照實際經過的秒數算（`deadline=$((SECONDS + WAIT_SECONDS))`），約 120 秒（原本 30 秒），最後一輪卡在逾時時最多再多十幾秒；
  不數圈數，否則埠接了連線卻不回時每圈都等滿逾時，最壞會拖到十幾分鐘（審查 #2）。逾時訊息多一行講要等哪兩個網址。
- `scripts/make-app.sh [資料夾]`：產生 `<資料夾>/Galley.app`（預設 `~/Applications`，資料夾不存在會建），已有的整個取代。
  流程：AppleScript → `osacompile` → `sips`＋`iconutil` 把 `scripts/app/icon.png` 轉成 `applet.icns` →
  刪掉 osacompile 附的 `Assets.car` 與 Info.plist 的 `CFBundleIconName`（不刪會蓋過自己的圖示）→ 設 `CFBundleIdentifier=local.galley.launcher` →
  `codesign --sign -` 重簽 ad-hoc（改過內容原簽章失效；失敗時保留 codesign 的錯誤輸出並印中文說明、不產 app）。`--print-script` 只印 AppleScript（測試用）。
  - repo 路徑用 `pwd -P` 取實際路徑，寫成 AppleScript 字串時跳脫 `\` 與 `"`；路徑有換行直接拒絕。執行時一律 `quoted form of`，空白、引號、`$` 都安全。
  - 不用 AppleScript `property`：applet 執行後會把 property 寫回腳本檔，弄壞簽章。
  - 點下去：**5173 或 3000 任何一個有回應**就只開瀏覽器；兩個都連不上才 `open` `start.command`；`start.command` 不見或沒有執行權限時跳對話框請使用者重跑 make-app。
    跟範圍寫的「兩個都通才只開瀏覽器」差在「只有一個通」的情況：照字面會再開一個 `start.command`，撞埠報錯，
    還會踩到 known-issues「已開著一個後端時再啟動第二個」那條（把正在跑的 AI 工作標成作廢），所以改成只開瀏覽器。
  - 連點保護（審查 #5）：開 `start.command` 前寫時間戳檔 `galley-launch.stamp`（放 `path to temporary items`，即 `$TMPDIR/TemporaryItems/`）；
    兩個埠都還沒回應、但時間戳不到 20 秒時，只跳通知「發布台正在啟動」，不再開第二個 `start.command`。
  - health 檢查的逾時給 10 秒：`/api/health` 會偵測 Agent CLI（有 30 秒快取），快取過期時可能要幾秒，太短會誤判沒在跑而重複啟動。
- 圖示：`scripts/app/icon.png`（1024×1024，深色圓角方塊＋米白襯線 G＋一條橘色細線）；產生它的 `scripts/app/make-icon.swift` 一起進 repo，平常不用跑。
- `.gitignore` 加 `Galley.app/`。README 中英各加「macOS：雙擊啟動、放進 Dock」一小段。
- 測試 `tests/launcher-app.test.ts`（11 個）：兩個腳本各自 `bash -n`；`start.command` 兩個網址都等到才 `open`、health 用 `-f` 且逾時 10 秒、上限照經過秒數算；
  app 腳本先寫時間戳再開 `start.command`、`launchedRecently` 用 `osascript` 實測（沒檔／剛寫／一分鐘前）；codesign 失敗不吞錯誤；
  `--print-script` 在含空白／雙引號／反斜線／`$` 的假 repo 路徑下跳脫正確、`osascript` 讀回來一字不差；
  macOS 上把 app 產到暫存目錄，檢查 `applet.icns`（含 1024 的 `ic10`）、沒有 `Assets.car`／`CFBundleIconName`、`codesign --verify --deep --strict` 通過、`osadecompile` 出來的路徑正確；
  `icon.png` 是 1024×1024；`.gitignore` 有 `Galley.app/`。非 macOS 會略過要用 osascript／osacompile 的兩個。
- 沒有雙擊或 `open` 過產出的 app 與 `start.command`（使用者的 dev server 在跑），點下去的實際行為留給手動驗證。
- 殘餘見 `docs/known-issues.md`「啟動與 Galley.app（P8-T005）」。
