---
id: P8-T006
phase: 8
status: done
depends_on: [P8-T005]
specs: [security.md]
write_paths: ["scripts/", "tests/", ".gitignore", "README.md", "README.zh-TW.md", "docs/known-issues.md", "docs/tasks/P8-T006-background-app.md", "docs/CURRENT_TASK.md"]
contract_change: none
expected_commit: "feat(P8-T006): Galley.app 在背景跑服務，像一般 app 一樣開關"
---

# Galley.app 在背景跑服務，像一般 app 一樣開關

## 目標
D-046。使用者 2026-10-12 試過 P8-T005 的 Galley.app 可正常啟動，問能不能不開終端機；再問「忘記關怎麼辦」。
裁定：app 本身常開、看管背景服務。Dock 亮點就是「發布台開著」的指示，⌘Q／Dock 右鍵「結束」就關服務，跟一般 app 一樣。
記憶體跟開終端機時相同（只是沒有視窗），不違反 D-035「不常駐」的本意（不用時不佔資源）。
不做閒置自動關閉：寫到一半去忙別的、回來服務沒了，比忘了關更糟。

## 範圍
### 包含
- `scripts/make-app.sh` 產生的 Galley.app 改成 stay-open applet（`osacompile -s`）：
  - **啟動（on run）**：服務已在跑（5173 或 3000 有回應）→ 不另起，直接開瀏覽器（見下方「接手」）；
    沒在跑 → 在背景起服務（`npm run dev`，不開終端機），等 5173 與 `/api/health` 都通（沿用 start.command 的等法與上限）才開 `http://127.0.0.1:5173`。
    起服務的期間給一個「正在啟動」通知；逾時或服務提早結束 → 跳通知（含記錄檔位置），app 結束。
  - **點 Dock 圖示（on reopen）**：開瀏覽器到 `http://127.0.0.1:5173`。
  - **結束（on quit，含 ⌘Q、Dock 右鍵結束、登出／關機）**：把**自己起的或接手的**整棵服務程序樹（concurrently、tsx watch、vite、node 後端）
    先 SIGTERM、等數秒、還在才 SIGKILL，確認 3000／5173 都放掉才 `continue quit`。不能誤殺不相干的程序。
  - **接手**：app 起服務時記 pid（process group）檔；app 當掉／被強制結束後再點圖示，看到 pid 檔指的程序還活著且是我們的服務 → 接手，之後 ⌘Q 一樣會關。
    由 `start.command`（終端機）起的服務 → app 只開瀏覽器、**不接手**、結束 app 不關它（終端機自己管）；這種情況要讓使用者知道（例如通知一次）。
- 背景起服務的方式寫成獨立 shell 腳本（例如 `scripts/galley-service.sh start|stop|status`），app 只呼叫它，方便測試：
  - 用使用者的登入 shell 環境找 node／npm（`do shell script` 的 PATH 很陽春；使用者的 node 在 `/opt/homebrew/bin`），不寫死路徑。
  - 程序要自成一個 process group（macOS 沒有 `setsid` 指令，自己找可靠做法），stop 時對整個 group 送訊號。
  - 輸出寫到資料目錄（`~/Library/Application Support/Galley/`，`GALLEY_DATA_DIR` 可覆寫，見 `src/config/paths.ts`）下的 `logs/galley.log`，
    每次啟動前把上一次的留成 `galley.log.1`（只留一份），檔案權限 0600。
  - 可用環境變數或參數換掉要跑的指令與埠，讓測試能用假服務跑，**不碰真的 3000／5173**。
- `start.command` 行為不變（保留給想看即時訊息時用），但 P8-T005 的連點時間戳若不再需要就清掉，需要就留。
- README（中英）更新：圖示怎麼開關、記錄檔在哪、想看即時訊息用 start.command、repo 搬家重跑 make-app。
- `docs/known-issues.md` 更新 P8-T005 那段（刪掉不再成立的、補新的殘餘）。

### 不包含
- 閒置自動關閉、選單列圖示、開機自動啟動、正式模式（`npm start`）。
- 關閉時有 AI 工作在跑的確認對話框（後端下次啟動會照既有規則把它標成取消；寫進 known-issues 即可）。
- 簽章公證、把 Node 包進 app。

## 工作區與 Context
### 必讀入口
`scripts/make-app.sh`、`scripts/start.command`、`tests/launcher-app.test.ts`、`docs/tasks/P8-T005-launcher-app.md`（完成結果與殘餘）、
`src/config/paths.ts`（資料目錄）、`docs/specs/security.md`（log 不得含密碼）。
### 驗證命令
`npm run verify`；`bash -n` 每個腳本各跑一次；make-app 產到 scratchpad；`galley-service.sh` 用假服務（別的埠）實跑 start／status／stop。

## 實作要求
- **不准**打開產出的 app、不准跑 `start.command`、不准對 3000／5173 起或殺任何東西（使用者的發布台正在跑）。
- 不用 `shell: true`；不讀 `.env`；log 只收服務自己的輸出。
- 先寫測試。

## 驗證
### 自動驗證
`npm run verify` 綠；測試涵蓋：服務腳本 start→status→stop 用假服務真的起停、整個 process group 都死、pid 檔清掉；
stop 不殺 pid 檔以外的程序（pid 檔過期／被重用時不誤殺）；log 輪替與權限；AppleScript 有 on run／on reopen／on quit 且 quit 會叫 stop；路徑跳脫沿用既有測試。
### 手動驗證（使用者）
1. 主目錄重跑 `scripts/make-app.sh`，Dock 上的 Galley 拿掉再拖一次。
2. 發布台關著 → 點圖示 → 沒有終端機、瀏覽器自動開、沒有 502、Dock 有亮點。
3. 關掉瀏覽器分頁 → 點圖示 → 瀏覽器再開。
4. ⌘Q 或右鍵結束 → 亮點消失 → 重新整理瀏覽器連不上（服務真的關了）。
5. 先雙擊 `start.command` 起服務 → 點圖示 → 只開瀏覽器；結束 app → 終端機裡的服務還在。

## 完成定義
- [ ] `npm run verify` 綠
- [ ] 擁有這些行為的 spec 已更新（新增或搬動功能：architecture.md 功能地圖）
- [ ] 留下的殘餘已寫進 `docs/known-issues.md`
- [ ] CURRENT_TASK 已更新

## 中斷／接手紀錄
- 最後完成：實作＋測試＋README 中英＋known-issues（2026-10-12）；獨立審查六點已修（時區、登入 shell 卡住、測試清理、kill 防線、逾時註解、Dock 點擊重起）；make-app 只產到暫存目錄驗過結構；假服務實跑 start／status／stop／接手／過期 pid
- 已通過驗證：`npm run verify`（審查修正後 103 檔／2283 測試，typecheck 通過）、三個腳本各自 `bash -n`、`osadecompile`／`codesign --verify`／`OSAAppletStayOpen`
- 下一步：主 session 審查；`architecture.md` 功能地圖、`CURRENT_TASK.md`（P8-T005 那列的手動驗證已不適用）由主 session 更新；使用者手動驗證
- Blocker：無

## 完成結果
- 2026-10-12 使用者手動驗證通過（沒有終端機、瀏覽器自動開、Dock 亮點、再點開瀏覽器、⌘Q 關服務）。
- `scripts/galley-service.sh start|stop|status|logpath`（新）：
  - **start**：已是我們起的（pid 檔對得上）→ 接手、等它好了回 `adopted`；埠 5173 或 3000 有人在用（curl 不是「連不上」）→ 不起、結束碼 3；
    否則找 node／npm、輪替 log、在 repo 裡背景跑 `npm run dev`，等前端有回應＋`/api/health` 2xx（跟 `start.command` 同樣的等法，上限 120 秒）回 `started`。
    服務提早結束或逾時 → 把自己起的關掉、清 pid 檔，訊息含記錄檔位置，結束碼 2。
  - **process group**：macOS 沒有 `setsid`，用 bash job control（`set -m` 後 `&`），背景工作自成一個 group（pgid＝它的 pid）；
    指令用 `exec`，group leader 就是 npm 本身。stdin／stdout／stderr 全接走，`do shell script` 才會馬上回來（測試用 spawnSync 的逾時守住）。
  - **pid 檔** `<資料目錄>/galley-service.pid`（0600）記 `pgid`、leader 的 `lstart`、repo 路徑。算「我們的」只有兩種：
    leader 活著、還是 group leader、`ps lstart` 一模一樣（整組都是我們的）；或 leader 已不在、group 裡還有**工作目錄是這個 repo** 的程序（只認這些）。
    pid 被重用（啟動時間對不上、或不是 group leader）、內容不合法（0、1、負數、亂碼、空檔）、自己所在的 group → 當過期檔清掉，**不送任何訊號**。
    原本打算用環境變數當記號，但這台 macOS 的 `ps -E` 看不到別的程序的環境，改用啟動時間。
  - **stop**：先拍快照（group 成員＋從它們往下找到的所有子孫，含自成 session 的；每個記啟動時間），
    SIGTERM 整組＋快照裡的 pid → 等 `GALLEY_STOP_TIMEOUT`（預設 8 秒）→ 還在就 SIGKILL → 再等 3 秒；
    對單一 pid 送訊號前一律再對一次啟動時間。死光才清 pid 檔，接著確認兩個埠都放掉（最多 5 秒，否則結束碼 4）。不是我們的回 `not-running`。
  - **status**：`ours`／`other`（埠有人用但不是我們起的，例如 `start.command`）／`stopped`。
  - **PATH**：現在的 PATH 找得到 node 和 npm 就用；找不到（`do shell script` 只有 `/usr/bin:/bin:/usr/sbin:/sbin`）就問登入 shell
    （`$SHELL`，沒有就 `dscl` 查 UserShell，再沒有用 `/bin/zsh`）`-l -c` 印出的 PATH，用記號行抓出來；仍找不到就說明並結束。
    這台登入 shell 的 PATH 已含 `/opt/homebrew/bin`、`~/.local/bin`，node、npm、claude、codex、gemini、agy 都找得到。
  - **log**：`<資料目錄>/logs/galley.log`，每次起新服務前把上一份改名成 `galley.log.1`（蓋掉更舊的），log 與 .1 都 0600、`logs/` 0700；
    資料目錄不存在時建成 0700（跟 `ensureDataDir` 一樣）。只收服務的輸出加一行啟動時間。接手時不輪替。
  - 資料目錄規則照 `src/config/paths.ts`（`GALLEY_DATA_DIR` 絕對路徑優先、相對路徑拒絕；`.git` 是檔案的 worktree 用 `<repo>/.galley-data`；macOS 用 `~/Library/Application Support/Galley`）。
    建 `logs/` 不影響搬家判斷（搬家看標記檔 `.galley-data.json`，不看目錄在不在）。
  - 測試用覆寫：`GALLEY_SERVICE_CMD`、`GALLEY_UI_PORT`、`GALLEY_API_PORT`、`GALLEY_WAIT_SECONDS`、`GALLEY_STOP_TIMEOUT`、`GALLEY_DATA_DIR`。
  - 踩到的坑：bash 在 UTF-8 下 `$var」`、`$var）` 這種變數緊接全形字會把位元組吃進變數名（`set -u` 下直接報錯），全形字前一律寫 `${var}`；`make-app.sh` 原有的三處也順手改了。
- `scripts/make-app.sh`：`osacompile -s` 產常開 applet（Info.plist `OSAAppletStayOpen=true`），檢查改成要有可執行的 `galley-service.sh`。AppleScript：
  - `on run`：`status` 是 `other` → 通知「發布台已經在跑（多半是 start.command 開的），Galley 只開瀏覽器、不會關它」→ 開瀏覽器 → Galley 自己結束
    （決定：不留在 Dock，亮點才一直代表「Galley 管著的服務開著」；代價是每次點都通知一次）。
    其餘 → `launchService`：沒在跑先通知「正在背景啟動」→ `start` → 成功開瀏覽器；
    失敗跳對話框（錯誤訊息含記錄檔位置，可按「打開記錄檔」用 Console 開）→ 結束。
  - `on reopen`：先問 `status`；`stopped`（Galley 起的服務自己掛了）就走 `launchService` 重起，其他只開瀏覽器（審查 #6）。
  - `on quit`：`try` 包 `stop`（失敗只通知，不然登出會卡住）→ `continue quit`。stop 是同步的，回來才結束。
  - repo 路徑仍只出現在 `serviceScript()` 的一個字串常值（跳脫同 P8-T005），執行時一律 `quoted form of`。
  - P8-T005 的連點時間戳（`galley-launch.stamp`、`launchedRecently`）拿掉：app 只會有一個、起服務時同步等待，不會重複起。
- `scripts/start.command` 沒改。README 中英改寫成「打開／找回分頁／關掉／記錄檔」，想看即時訊息用 `start.command`，搬家重跑 make-app。
- 測試：`tests/galley-service.test.ts`（新，審查後 26 個）用一支假 node 服務在系統給的空埠上實跑（絕不碰 3000／5173、資料目錄在暫存目錄）：
  start→status→stop 整棵樹（leader、同 group 子程序、自成 session 的子程序）都死、兩埠放掉、pid 檔清掉；接手不另起、不輪替；
  不理 SIGTERM 的改送 SIGKILL；leader 先死時仍關得掉同 group 的；提早結束、逾時；log 輪替與權限；新資料目錄 0700；
  陽春 PATH 下從（假的）登入 shell 拿 PATH、拿不到時說明；別人起的服務 status `other`、start 結束碼 3、stop 不碰；
  pid 被重用、指到非 group leader、不合法內容與死掉的 pid 都不送訊號；資料目錄三種規則。
  `tests/launcher-app.test.ts` 改成檢查三個 handler、quit 先 stop 再 `continue quit`、沒有 `start.command`／時間戳，產出的 app `OSAAppletStayOpen` 為 true、decompile 有三個 handler。
- 手動實跑（假服務，埠 47173／47000，資料目錄在 `/private/tmp/claude-501/p8t006/trial`）：用 `env -i` 只給 `/usr/bin:/bin:/usr/sbin:/sbin` 的 PATH 經 `osascript` 的
  `do shell script` 跑 `status`（stopped）→ `start`（1 秒 started，node 從真的登入 shell 找到，`do shell script` 馬上回來）→ `status`（ours）→ 再 `start`（adopted）→
  `stop`（stopped，三個程序都沒了、兩埠連不上、pid 檔清掉）；pid 檔指到不相干的 `sleep`（啟動時間不對、或不是 group leader）→ `not-running`，`sleep` 還活著。
- 沒有打開產出的 app、沒跑 `start.command`、沒碰 3000／5173、沒碰真的資料目錄。點下去的實際行為留給手動驗證。
- 獨立審查修正（2026-10-12）：
  1. **時區**：`ps lstart` 照當下時區印，台北起、倫敦看會對不上（status 說 other、stop 說 not-running、pid 檔被刪、服務還在跑）。
     所有 `ps` 呼叫改成 `LC_ALL=C TZ=UTC0 ps …`，只設在那一個指令上、不 export 給服務。測試：台北起、倫敦 status／stop；服務拿到的 TZ／LC_ALL 是原本的。
  2. **登入 shell 卡住**：原本 `$(shell -l -c … | sed | tail)` 要等所有寫端關掉，`.zprofile` 有背景程序就卡。
     改成 `set -m` 背景跑、輸出寫暫存檔，看到記號行或 shell 結束就讀；超過 `GALLEY_LOGIN_SHELL_TIMEOUT`（預設 10 秒，整數秒再 +1）就把它那一組 SIGKILL。
     正常結束時它留下的背景程序不動（可能是使用者的常駐工具）。測試：假 shell 留 `(sleep 30) &` 時 start 8 秒內完成；假 shell 卡住時放棄並收掉。
  3. **測試清理**：`setup()` 一建好就登記；afterEach 一律先跑 `stop`、再只補殺 pid 記錄裡**還活著**的。
  4. **kill 防線**：所有訊號都經 `safe_kill`，它自己拒絕 ≤ 1、非數字、前導 0、自己、自己所在的 group（不靠讀 pid 檔那關）；
     `GALLEY_SERVICE_DRY_KILL=1` 只把要送的訊號印到 stderr。不合法 pid 檔的測試全開乾跑並斷言沒有 `dry-kill`；
     另有測試把 `safe_kill` 單獨抽出來跑 `-1`、`1`、`0`、自己、自己的 group 都拒絕，並守住腳本裡沒有其他地方直接 `kill -s`。
  5. **逾時註解**：`with timeout` 對 `do shell script` 沒有作用，拿掉並改註解；登出時正在起服務可能擋下登出，寫進 known-issues。
  6. **服務死了亮點還在**：`on reopen` 先問 `status`，`stopped` 就照開啟流程重起（抽成 `launchService`：通知、等待、失敗對話框並結束），其他只開瀏覽器。
  驗證：`npm run verify` 103 檔／2283 測試（galley-service 26、launcher-app 10）；跑完沒有殘留的假服務或 sleep。
- 殘餘見 `docs/known-issues.md`「啟動與 Galley.app（P8-T005、P8-T006）」。
