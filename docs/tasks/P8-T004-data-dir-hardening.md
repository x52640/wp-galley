---
id: P8-T004
phase: 8
status: ready
depends_on: [P8-T003]
specs: [security.md, architecture.md]
write_paths: ["src/config/", "src/core/service/context.ts", "src/core/service/media.ts", "src/core/service/images.ts", "src/server/main.ts", "src/db/cli-migrate.ts", "tests/", "docs/specs/security.md", "docs/specs/architecture.md", "docs/known-issues.md", "docs/tasks/P8-T004-data-dir-hardening.md"]
contract_change: none
expected_commit: "fix(P8-T004): 資料目錄補審修正：媒體路徑限縮、工作目錄實體路徑檢查、搬家鎖與資料庫遺失防護"
---

# 資料目錄補審修正

## 目標
D-039。P8-T003（PR #23）合併後補跑 Codex 審查（使用者 2026-10-04 要求「修完都要再跑 Codex 審查，直到沒有問題」），找到五條。
使用者真實資料已在 2026-10-04 搬家完成（標記 `done`），所以第 3 條只影響未來還沒搬完的安裝；其餘四條對現在的使用者也成立。

## 範圍
### 包含
1. **媒體路徑限縮**（`src/config/paths.ts` 讀取容錯與所有讀檔／刪檔處）：DB 裡的媒體路徑（`media_assets.local_path`、`image_candidates.local_path`）
   不論相對或絕對、不論是否走「舊根目錄容錯」，解析後都必須落在 `generated-images/` 底下（含正規化 `..`、拒絕任何 `..` 段）；
   不在就當成找不到（讀取回「檔案不見了」、刪除不動任何檔），**絕不**讀到 `.env`、DB 或資料目錄其他檔，也不刪它們。
2. **Agent 工作目錄實體路徑檢查**（`context.ts` `jobWorkspace`／`resolveInsideWorkspace`）：除了字面路徑，還要確認**實體路徑**（`realpath`）
   在 `drafts/` 底下；路徑上任何一段是符號連結就拒絕（或解析後不在 `drafts/` 內就拒絕），既有工作目錄與新建的都要檢查。
3. **搬家鎖不再自動接手過期鎖**：拿掉「pid 不在就接手」；鎖存在就停止並說明（含 pid、建立時間、確定沒有在跑時要刪哪個檔），不猜。
   （拿掉的理由：檔案系統上沒有可靠的原子接手；這條路只有沒搬完的安裝會走，讓人手動刪鎖成本很低。）
4. **已搬完但資料庫不見時不默默建空的**：標記 `done` 而 `data/publisher.sqlite` 不存在（或是空檔）→ 啟動停止並說明
   （資料庫應該在哪、可能被移走了、要重新開始的話怎麼做），不建新 DB、不套 migration。全新安裝（標記 `migratedFrom: null` 且從沒建過 DB）照常建立——
   用標記檔記一個「DB 已建立過」的欄位區分。
5. **舊位置讀不到不擋已搬完的啟動**：已搬完時，`leftoverWarning` 先比 `migratedFrom`，相同就不探舊位置；探舊位置時任何錯誤（EACCES 等）
   只略過警告、不擋啟動。
- 每條補測試；spec（security.md、architecture.md「本機資料」）與 known-issues 同步。

### 不包含
- 改搬家流程以外的行為、UI。
- 跨行程的作業系統層級檔案鎖（第 3 條改成不自動接手即可）。

## 工作區與 Context
### 必讀入口
`src/config/paths.ts`、`src/config/user-data.ts`、`src/core/service/context.ts`（`jobWorkspace`、`localFile`、`storedPath`、候選圖檔）、
`src/core/service/media.ts`（刪除媒體）、`src/core/service/images.ts`（讀候選圖）、`docs/specs/security.md`、`docs/specs/architecture.md`「本機資料」。
### 不應載入
UI、`docs/archive/`。
### 驗證命令
`npm run verify`

## 實作要求
- 先寫測試再實作；測試一律用暫存目錄。
- **絕不讀寫** `~/Library/Application Support/Galley/` 與主目錄的舊 `data/`、`.env`。不設 `GALLEY_DATA_DIR` 指向真實資料。
- 不呼叫真實 Agent CLI、不連 WordPress、不啟動 server、不 commit、不 `git stash`。
- 另一個 worktree（P5-T038）正在改 `src/core/service/images.ts` 的配圖請求；本 Task 只碰讀候選圖檔那段，改動盡量小。

## 驗證
### 自動驗證
`npm run verify` 綠。
### 手動驗證（使用者）
合併後正常啟動發布台，舊稿件、圖片照常；（主 session 代做）確認啟動訊息沒有誤警告。

## 完成定義
- [x] `npm run verify` 綠
- [x] 擁有這些行為的 spec 已更新
- [x] 留下的殘餘已寫進 `docs/known-issues.md`
- [ ] CURRENT_TASK 已更新（主 session 統一更新）

## 中斷／接手紀錄
- 最後完成：PR #27 Codex 第二輪 P1 已修（實際位置比對改用檔案系統真正拼法，擋大小寫不同的根目錄連結）（2026-10-04，實作 subagent）
- 已通過驗證：`npm run verify` 綠（90 檔／1997 測試）
- 下一步：主 session commit → Codex 第三輪審查（D-039）
- Blocker：無

## 完成結果

（待審查通過後由主 session 填。實作摘要：媒體路徑走 `fromStoredMediaPath`／`CoreContext.mediaFile`；工作目錄 `jobWorkspace` 加實體路徑檢查；
搬家鎖存在即停止；標記檔新增 `databaseCreated`＋`assertDatabasePresent`／`markDatabaseCreated`；`leftoverWarning` 先比 `migratedFrom`、探測錯誤只略過。）
