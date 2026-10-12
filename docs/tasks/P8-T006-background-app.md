---
id: P8-T006
phase: 8
status: in_progress
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
- 最後完成：開 Task（2026-10-12）
- 已通過驗證：無
- 下一步：實作
- Blocker：無

## 完成結果
