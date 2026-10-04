---
id: P8-T003
phase: 8
status: ready
depends_on: []
specs: [architecture.md, security.md, wordpress-site.md]
write_paths: ["src/config/", "src/server/main.ts", "src/server/app.ts", "src/db/", "src/core/", "src/agents/", "src/media/", "src/wordpress/setup.ts", "tests/", "docs/specs/architecture.md", "docs/specs/security.md", "docs/specs/wordpress-site.md", "docs/specs/agent-tasks.md", "docs/known-issues.md", "docs/tasks/P8-T003-user-data-dir.md", "docs/CURRENT_TASK.md", "README.md", "README.zh-TW.md"]
contract_change: none
expected_commit: "feat(P8-T003): 使用者資料搬出程式資料夾"
---

# 使用者資料搬出程式資料夾

## 目標
D-035。之後要做成可下載的 Mac App 或 Homebrew 安裝（都還沒裁定要做），兩種方式升級時都會**整個換掉程式資料夾**。
現在 `.env`（含應用程式密碼）、站台設定、SQLite、稿件、圖片、備份都放在程式資料夾裡，換掉就全沒了。
不管之後走哪條路都得先做這步；現在做，作者自己 `git pull`／重 clone 也不怕弄壞資料。

另一個要一起修的：DB 裡存的是**絕對路徑**（`jobs.workspace_path`、`media_assets.local_path`、
`image_candidates.local_path`，本機 DB 實測 25 筆含 `/Users/…/wordpress-publisher/`），只搬檔不改 DB 舊稿舊圖就找不到。
改成存**相對資料目錄**的路徑，以後再搬也不會壞。

使用者要求：在發布台裡的使用體驗**完全不變**。

## 範圍
### 包含
- **資料目錄**（`src/config/paths.ts`）：
  - macOS：`~/Library/Application Support/Galley/`；其他平台：`$XDG_DATA_HOME/galley`，沒設就 `~/.local/share/galley`。
  - 環境變數 `GALLEY_DATA_DIR` 可覆寫（絕對路徑；給開發或想放別處的人）。
  - 資料目錄建立時權限 `0700`。
- **搬到資料目錄的**：`.env`、`config/publish-targets.json`（放 `<資料目錄>/publish-targets.json`）、`data/`、`drafts/`、
  `generated-images/`、`backups/`。
- **留在程式資料夾的**：`templates/`、`config/examples/`、`config/publish-targets.example.json`、`.env.example`、`dist/`。
- **DB 改存相對路徑**：新 migration 把上面三個欄位中「以舊程式根目錄＋`/` 開頭」的值改成相對資料目錄的路徑
  （例如 `drafts/<uuid>`）；不是這個開頭的（使用者自己設過別處、或已經是相對的）原樣不動。
  程式寫入一律寫相對路徑，讀出時以資料目錄解析；讀到絕對路徑照舊能用（舊資料容錯）。
- **第一次啟動自動搬家**（`npm start`、`npm run dev`、`npm run migrate` 都走同一段）：
  - 條件：新資料目錄裡**沒有** `data/publisher.sqlite`，且舊位置**有**任何一項要搬的東西。
  - 做法：**複製**到新位置（不刪舊的，舊的就是備份），`.env` 複製後維持 `0600`；SQLite 用一致的方式複製
    （不是在寫入中途的半份檔），複製後 `PRAGMA integrity_check` 通過才算成功。
  - 任何一步失敗：停止啟動、清楚說出卡在哪、新位置留下的半成品不能讓下次啟動誤判為「已搬過」。
  - 成功後終端機印一段話：資料搬到哪、舊資料還留在哪、確認沒問題後可以自己刪（列出要刪的路徑，**`.env` 裡有密碼**要提）。
  - 舊位置 = 程式根目錄（`projectRoot`）底下的原路徑。
- 設定精靈寫 `.env`／站台設定檔／備份的路徑跟著換（`src/server/main.ts` 傳進去的那幾個）；`rootDir` 換成資料目錄
  （完成頁顯示的備份相對路徑改相對資料目錄，或改顯示完整路徑，擇一，文案要讓人找得到檔）。
- 啟動訊息印一行「資料目錄：…」。
- 擁有這些行為的 spec：`architecture.md`「本機資料」表改寫、`security.md`（`.env` 位置、資料目錄權限、
  「設定精靈寫入的秘密」）、`wordpress-site.md`（站台設定檔與備份位置）、`agent-tasks.md`（候選圖路徑）；
  README 中英兩份的安裝、手動設定、不進版控那幾段。

### 不包含
- Mac App、Homebrew、選單列程式、打包 Node（之後另外裁定）。
- `templates/` 讓使用者自訂（目前屬於程式本身）。
- 自動刪除舊資料。
- 改任何 UI 畫面或 API 格式。

## 工作區與 Context
### 必讀入口
`src/config/paths.ts`（所有路徑的家）、`src/server/main.ts`、`src/db/migrations/index.ts`＋`007`、`docs/specs/architecture.md`「程式慣例」與「本機資料」、
`docs/specs/security.md`「設定精靈寫入的秘密」。用 `grep -rn "paths\.\|workspace_path\|local_path" src` 找所有使用處。
### 不應載入
`docs/archive/`、UI 元件、查證／校稿 spec。
### 驗證命令
`npm run verify`

## 實作要求
- **絕不動真實資料**：測試一律用暫存目錄＋`GALLEY_DATA_DIR`／注入路徑；不得讀寫真的 `~/Library/Application Support/Galley/`、
  專案根目錄的 `.env`、`data/`、`config/publish-targets.json`。
- 新 migration 照 `architecture.md` 程式慣例：先寫測試、在 `data/publisher.sqlite` 的**副本**上驗完、SQL 定稿，最後才註冊。
- 搬家邏輯是純函式＋可注入路徑（舊根目錄、新資料目錄），方便用暫存目錄測。
- 測試必須涵蓋：首次搬家成功（含 DB 路徑變相對、`.env` 權限 0600）、已搬過不再搬、舊位置沒東西時直接建新目錄、
  搬到一半失敗下次能重試、`GALLEY_DATA_DIR` 覆寫、讀到舊的絕對路徑仍可用、Agent 工作目錄仍限制在 `drafts/` 裡（路徑含空白）。
- 不呼叫真實 Agent CLI、不連真實 WordPress、不重啟 dev server、不 commit。

## 驗證
### 自動驗證
`npm run verify` 綠，數字記進 CURRENT_TASK。
### 手動驗證（使用者）
1. 先備份專案資料夾的 `data/`、`.env`（主 session 代做）。
2. 雙擊 `scripts/start.command` → 終端機印出搬家訊息 → 發布台照常打開，舊稿件、舊圖都在。
3. 打開一篇草稿真跑一次校稿、一次 Codex 生圖（確認 Agent 在新工作目錄不出錯）。只存草稿，不公開。

## 完成定義
- [ ] `npm run verify` 綠
- [ ] 擁有這些行為的 spec 已更新（新增或搬動功能：architecture.md 功能地圖）
- [ ] 留下的殘餘已寫進 `docs/known-issues.md`
- [ ] CURRENT_TASK 已更新

## 中斷／接手紀錄
- 最後完成：Task 開立
- 已通過驗證：—
- 下一步：派實作 subagent
- Blocker：無

## 完成結果
