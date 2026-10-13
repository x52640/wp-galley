---
id: P5-T048
phase: 5
status: done
depends_on: []
specs: [design-system.md, architecture.md, security.md]
write_paths: ["src/ui/", "src/contract/", "vite.config.ts", "tests/", "docs/specs/design-system.md", "docs/specs/architecture.md", "docs/known-issues.md", "docs/tasks/P5-T048-autosave-draft.md", "docs/CURRENT_TASK.md"]
contract_change: none
expected_commit: "feat(P5-T048): 打字模式沒存的內容自動留底，重新整理也不會不見"
---

# 打字模式沒存的內容自動留底，重新整理也不會不見

## 目標
D-047。使用者 2026-10-13：在打字模式寫了一篇新文章（稿件「AI未來已來 – 3」，DB 裡內文是空的），闔上螢幕休眠、打開後整篇不見，救不回來。

查到的原因：
- 服務從 14:40 一路沒重啟，伺服器沒問題；21:08:25～32 記錄檔有一串頁面初次載入的請求＝**頁面自己重新整理了**。
- 使用者是用 Galley.app（P8-T006）跑 `npm run dev`，UI 由 Vite dev server 提供。Vite 用戶端跟 dev server 的 WebSocket 斷線後會輪詢、連回來就 `location.reload()`（`node_modules/vite/dist/client/client.mjs` 的 "server connection lost. Polling for restart..."）。休眠會讓連線斷掉。
- 打字模式只有手動「儲存」，沒存的字只在 iframe 的 DOM 裡，重新整理就沒了。

裁定（使用者 2026-10-13「開始做吧」）：兩件都做——
1. **留底（根本解）**：打字模式邊打邊把沒存的標題與內文存一份到瀏覽器儲存區（localStorage）；不管什麼原因重新整理、分頁當掉、休眠醒來，再打開同一篇就恢復。
2. **擋觸發點**：Vite 斷線重連不准自己重新整理頁面。

選瀏覽器儲存區、不自動寫成新版本的理由：自動存成 revision 會每幾秒多一個版本（每個都存整份 rendered_html），還會讓核准失效、打斷 AI 提案定位；這次要解的是「沒存的字被刷掉」，在本機留一份就夠，而且即時、不經後端。存不存成正式版本照舊由使用者按「儲存」決定。

## 範圍
### 包含
- **留底**（前端；規則寫成純函式，D-033）：
  - 打字模式中，標題或內文有變動 → 節流（約 0.5～1 秒）寫進 localStorage，以稿件 uuid 為鍵，內容含：標題、內文 HTML、寫下時間、**開始編輯時的基準 contentHash**（`expectedContentHash` 那個）。
  - 分頁被藏起來／關掉（`visibilitychange` 變 hidden、`pagehide`）時立刻再寫一次，不等節流。
  - 按「儲存」成功、或使用者明確「取消」放棄修改 → 刪掉留底。存檔失敗不刪。
  - 打開一篇稿件時有留底、且內容跟目前存好的不同：
    - 基準 hash 等於目前版本 → **直接進打字模式並填回留底內容**，編輯區上方（沿用 `EditToolbar` 提示列的位置與樣式）明講「已恢復 HH:MM 沒存的內容，還沒儲存」＋「捨棄」按鈕。不另外跳對話框（D-010：常做的事一鍵、別讓使用者先選）。
    - 基準 hash 不等於目前版本（之後有別的存檔、AI 套用、換模板）→ 不自動蓋掉，提示列講「有 HH:MM 沒存的內容，但這篇之後又改過」，給「恢復」「捨棄」。恢復後照一般存檔流程（`expectedContentHash` 衝突規則照舊）。
    - 留底跟目前內容相同（而且基準＝目前版本）→ 默默刪掉。基準不同時一律只問，不默默刪（2026-10-13 審查後主 session 裁定）。
  - 填回內文前照貼上的同一套 allowlist 整理（`lib/rich-*.ts`），不直接塞 innerHTML。
  - localStorage 不能用（無痕、被擋、滿了）→ 不壞、不吵；提示列輕輕講一次「這個視窗沒辦法自動留底，記得常按儲存」。
  - 已發布、被取代的稿件打開時刪留底；發布中、已取消（可恢復，D-031）、失敗（可重試）先不動（2026-10-13 審查後主 session 裁定，原本寫「只留未取消／未發布中」）；超過 30 天的留底在載入時清掉，避免無限累積。
  - 換篇（同一分頁切到別篇）時本篇的留底照留，切回來照上面規則恢復。
- **擋觸發點**：改 `vite.config.ts`，讓休眠醒來（WebSocket 斷線再連上）**不會**整頁重新整理。先查 Vite 8 實際行為再選做法（例如 `server.hmr` 設定、或自訂 client 行為），在 Task 完成結果寫清楚：選了什麼、HMR 還在不在、改了 UI 檔案要不要手動重新整理。用 scratchpad 起一個獨立埠的 Vite 實測「斷線→恢復不重新整理」，不准碰 5173。
- 測試：純函式（何時寫、何時刪、恢復判斷、過期清理、儲存區失敗）＋ hook／元件層的恢復流程；`?fixtures=1` 截圖兩種提示列。
- 文件：`docs/specs/design-system.md` 補提示列的兩種文案；`docs/specs/architecture.md` 功能地圖「在文章上改」那列補新檔案；`docs/known-issues.md` 寫殘餘（例如：換瀏覽器或清掉網站資料就沒有留底、5173 與 3000 是不同來源互不相通）。

### 不包含
- 自動存成正式版本（revision）、自動送 WordPress。
- 打字模式以外的輸入框（配圖 prompt、網址、建稿對話框）。
- 後端或 DB 的任何改動；MCP。
- 正式模式（`npm start`）啟動方式的改變。

## 工作區與 Context
### 必讀入口
`docs/specs/architecture.md` 功能地圖「在文章上改」「新稿件」兩列及其列出的檔案（重點 `src/ui/lib/use-proof-editing.ts`、`src/ui/lib/proof-editing.ts`、`src/ui/lib/use-job-workspace.ts`、`src/ui/lib/workspace-view.ts`、`src/ui/components/EditToolbar.tsx`）、`docs/specs/design-system.md`、`docs/specs/security.md`（貼上 allowlist）、`vite.config.ts`。
### 不應載入
agent、wordpress、factcheck、mcp 相關 spec。
### 驗證命令
`npm run verify`；`node scripts/ui-drive.mjs` 搭 `?fixtures=1` 截圖（Vite 要在 worktree 另起埠、另指 cacheDir，見 CURRENT_TASK）。

## 實作要求
- 在 git worktree `../wp-galley-P5-T048` 做；**不准**碰主目錄、不准對 3000／5173 起或殺任何東西（使用者的發布台正在跑）。
- 不呼叫真實 Agent CLI、不連真實 WordPress、不讀 `.env`、不 commit、不用 `git stash`。
- 留底內容只進 localStorage，不進 log、不送後端（存檔照舊走既有 `POST …/revisions`）。
- 先寫測試。

## 驗證
### 自動驗證
`npm run verify` 綠；測試涵蓋上面「包含」每一條規則；Vite 斷線不重新整理有實測紀錄。
### 手動驗證
打字模式寫幾段不按儲存 → 重新整理頁面 → 同一篇直接回到打字模式、內容都在、提示列講已恢復 → 儲存 → 再重新整理不再提示；
另寫幾段 → 闔螢幕休眠幾分鐘再打開 → 頁面沒有自己重新整理。

## 完成定義
- [x] `npm run verify` 綠
- [x] 擁有這些行為的 spec 已更新（新增或搬動功能：architecture.md 功能地圖）
- [x] 留下的殘餘已寫進 `docs/known-issues.md`
- [ ] CURRENT_TASK 已更新（主 session 收官時改）

## 中斷／接手紀錄
- 最後完成：PR #36 Codex 第一輪兩條修完（見「完成結果」最後一節）
- 已通過驗證：`npm run verify` 105 檔／2344 測試全綠（worktree，2026-10-13，Codex 第一輪修正後）
- 下一步：主 session push、Codex 第二輪；使用者手動驗證（見「手動驗證」）
- Blocker：無

## 完成結果
**留底（`src/ui/lib/draft-backup.ts` 規則、`draft-backup-dom.ts` 跟校樣比、`use-draft-backup.ts` 接 iframe 與 React）**
- 寫：打字模式中 MutationObserver 聽正文與標題，節流 800ms 寫進 localStorage（鍵 `galley.draft.v2.<uuid>/<session id>`，每次進打字模式一份；內容：標題、正文 innerHTML、寫下時間、這次打字的基準 hash＝進打字模式時工作區的 `knownHash`）；
  `visibilitychange`→hidden、`pagehide`、離開打字模式但沒作廢（換篇、回總覽、版本被換掉）立刻寫；打字中先存一版（基準換了）用新基準再寫一次。
- 刪：存檔成功離開打字模式（ProofView 送出時 `beginSave` 記下內容；Workspace 在 `createRevision` 成功後、`refresh` **之前**呼叫 `onSaved(hash)` → `finishSave`）、
  取消、沒改就離開（`useProofEditing` 的 `onDiscardDraft`，在還原正文之前同步作廢）。存檔失敗不刪。一律只刪「儲存區那份還是自己最後寫的」。
- 恢復：iframe 確定載入的是目前這一版、不在打字模式時（`draftCheckReady`＋`pickDraftPlan`＋`planDraftRestore`）：過期／已發布／被取代→刪；
  發布中／已取消／失敗→不動；基準≠目前版本→只問；基準＝目前版本：照「儲存」同一套整理比相同→默默刪，不同且能進打字模式→
  請工作區 `startEdit(null)`，進去、`syncEditing` 記下原文之後填回（`restoreDraft`），內容寫進那次打字自己的鍵（Codex 第一輪 2 起不接手別人的鍵）；否則提示列問恢復／捨棄。
- 填回前整理：**沒照 Task 寫的「貼上那一套」**，改用存檔那一套（`cleanRichEdit`，跟目前版本一樣的區塊原樣保留）再拿掉 `on*` 屬性與 `javascript:` 網址（`safeRestoredEdit`）。
  原因：貼上模式會丟掉圖片、figure 與 `wp-block-*` class，恢復一篇有圖的文章會把圖弄不見。都經外層 `DOMParser`（惰性文件），不直接塞原始 HTML。
- 稿件狀態：已發布、被取代打開時刪；發布中、已取消、失敗先不動（審查 4，主 session 裁定改 Task）。
- 提示列（`EditToolbar` 的 `DraftNotice`，`.proof-status-warn`，在格式工具列下、丟格式警告旁）：已恢復＋捨棄、之後又改過＋恢復／捨棄、
  基準相同但不能進打字模式（AI 在跑、待同步）＋恢復反灰、儲存區不能用（每頁只講一次）。打字模式中問恢復的提示照樣留著，恢復會直接填回目前的編輯區。

**擋觸發點（`vite.config.ts`）**
- 查 Vite 8.2.2 用戶端（`dist/client/client.mjs`）：`vite:ws:disconnect` 之後 `await waitForSuccessfulPing(...)`，接著 `location.reload()`。沒有設定能只關這一行
  （`server.hmr: false`／`server.ws: false` 會整個沒有 HMR），`location.reload` 也不能覆寫。
- 選的做法：自訂外掛 `keepPageOnReconnect`（`apply: 'serve'`），在 transform 時把那一行換成「講一句＋`transport.connect(...)` 重新接上 HMR，用有沒有收到 `vite:ws:connect` 判斷接回來沒有，沒有就講一句」。
  找不到那段字就在 dev server 終端機警告；`tests/vite-no-reload.test.ts` 對裝好的 Vite 用戶端檢查（升級 Vite 先紅）。
- HMR：只斷線（休眠醒來）會自動接回、照常熱更新；dev server 真的重啟過（WebSocket token 每次啟動都換）接不回去，頁面照樣能用，改了 UI 檔要自己重新整理一次。
  正式模式（`npm start`）沒有 Vite 用戶端，不受影響。
- 實測（scratchpad 獨立根目錄＋5199 的 Vite＋5198 的 TCP 代理模擬只斷 WebSocket＋9333 無頭 Chrome，用頁面上的 `window.__mark` 判斷有沒有重新整理）：

  | 情境 | 沒外掛（對照） | 有外掛 |
  | --- | --- | --- |
  | 只斷 WebSocket 4 秒再接回（像休眠） | 重新整理（mark 不見、導覽 1 次） | 不重新整理（mark 在、導覽 0 次）；之後改檔 HMR 照常（v1→v2） |
  | dev server 停掉 3 秒再重啟（有 hmr 埠的設定） | 重新整理 | 不重新整理；HMR 接不回去（改檔畫面不變），主控台講 `[galley] HMR 接不回去…` |
  | dev server 停掉再重啟（沒設 hmr 埠＝發布台實際的設定，審查後補測） | — | 不重新整理；主控台講 `[galley] HMR 接不回去…`（修正前這句永遠不會印） |

**`?fixtures=1` 實測（5199，`/api` 指到沒人聽的 3099）**：打字不存→重新整理→直接回打字模式、內容在、提示「已恢復…」→儲存→留底刪掉、不再提示；
塞一份基準不同的留底→提示「之後又改過」→恢復→填回→捨棄→回到存好的版本、留底刪掉；跟目前內容相同的留底→默默刪掉；打字後取消→刪掉；
打字後馬上換篇→留底有最後一個字（換篇時立刻寫）→切回來自動恢復；儲存區丟錯→提示「這個視窗沒辦法自動留底…」；壞掉的鍵載入時清掉。
截圖：scratchpad `shots/draft-restored.png`、`draft-offer.png`、`draft-unavailable.png`。

**獨立審查修正（2026-10-13，每條先寫測試）**
1. 【高】編輯中版本被換掉、新版本還沒載好時拿舊文件（使用者剛打的字）比→誤刪：`useProofFrame` 在 `handleLoad` 記下載入時的 `shown.key`（`loadedKey`），
   `draftCheckReady` 要 `loadedKey === revisionKey` 才比；`planDraftRestore` 基準不同時一律只問、不呼叫比對、不默默刪。版本被換掉那次打字的基準固定是它自己的（`session.base`），收尾時寫下的留底不會冒充新版本。
2. 【中】提示沒處理就進打字模式打字會蓋掉舊留底、打字中按恢復會換掉剛打的：改成每次打字一個鍵（`galley.draft.v2.<uuid>/<id>`），`readDrafts` 讀全部、`pickDraftPlan` 新的先一次一份；
   恢復時接手那份的鍵；打字中這次已經打了字（MutationObserver 有記錄，填回造成的變動用 `takeRecords` 丟掉不算）「恢復」反灰並講原因（`restoreAllowed`）。
3. 【中低】兩分頁互刪：所有刪除都走 `removeDraftIfSame`（寫下時間＋內文＋標題都跟自己最後寫的一樣才刪）；hook 裡不直接呼叫 `removeDraft`（有守門測試）。
4. 【中低】已取消、失敗改成先不動（`wait`），只有已發布、被取代刪；Task「範圍」與 known-issues 一起改。
5. 【低】按「儲存」到回應之間打的字：`beginSave` 記下送出那一刻、`finishSave(token, hash)` 比（`afterSaveDraft`），有差就留著、基準換成存好的 hash，重載後自動恢復；已經換篇就拿儲存區那份比。
6. 【低】填回時整理拿掉的格式：`restoreDraft` 記下 `restoreDropped`，在 `DropWarning` 的位置講「恢復的內容裡有這個版型不支援的格式：…。已經拿掉，字留著。」＋「知道了」。
7. 【低】(a) `tests/vite-no-reload.test.ts` 用 `createServer({ server: { middlewareMode: true, ws: false } })`（不 listen 任何埠）解析 `/@vite/client`，驗 `isViteClient` 命中、`transformRequest` 出來的程式碼已換掉；
   (b) 重連改成看有沒有收到 `vite:ws:connect`，Vite 失敗時 return 不 throw 也講得出來（實測如上表最後一列）。
8. 【低】儲存區滿：`openDraftStorage` 探測寫不進去時照樣回傳 storage（讀、刪、過期清理照常），只標 `writable: false`、提示一次。

審查後 `?fixtures=1` 重測（另加）：打字不存→重新整理→自動恢復→儲存→清空；塞一份基準不同、含底線的舊留底→提示「之後又改過」→不恢復直接進打字模式打字→儲存區兩份並存、「恢復」反灰並講原因→
重新整理→新的那份自動恢復、舊的還在→儲存→提示舊的那份→恢復→填回並講「已經拿掉底線」、接手舊鍵；換篇立刻寫、取消清空、儲存區滿時提示，照舊。
截圖另加 `shots/draft-restore-blocked.png`、`draft-restore-dropped.png`。

**Codex 第一輪修正（PR #36，2026-10-13，先寫會紅的測試）**
1. 【高】打字中輪詢讀到別的分頁存的新版本，留底基準被改成新 hash → 之後被當成基準相同自動恢復、存檔蓋掉別人：拿掉「`knownHash` 變了就換基準」的 effect。
   基準只在本次編輯自己的存檔成功回呼裡換——先存再做走 `rebase(token, hash)`、離開打字模式的存檔走 `finishSave`（ProofView 兩種存檔都帶 `onSaved`，`beginSave` 記下是哪一次打字）。
   外部版本變動保留原基準，之後走「之後又改過」只提示。守門測試：hook 裡沒有依賴 `draft?.baseHash` 的 effect、`session.base =` 只出現在 `rebase`／`finishSave`。
2. 【高】B 分頁自動恢復時接手 A 的鍵、兩邊輪流蓋同一份：恢復改成把內容寫進本分頁這次打字自己的新鍵，`from` 記下來源鏈（`restoredLineage`：來源的 id＋讀到時的寫下時間＋來源自己的來源）；hook 裡不再改 `session.id`。
   原來那份什麼時候清：本分頁存檔成功（沒再打字）、捨棄／取消、恢復時發現一樣——`removeAncestors` 只刪寫下時間沒變的；
   以及之後讀留底時，被別份複製過、之後沒人再寫的（`supersededDrafts`）——它的內容都在複製的那份裡，所以刪了不掉字；別的分頁還在寫的寫下時間會變，不會被當成被取代。
   實測（`?fixtures=1`）：打字不存→連續重新整理 3 次，儲存區最多 2 份（新複製的＋上一份，再下一次載入就清掉上一份），不會越積越多；儲存→全部清空。

**主樹基準（本分支）**：`npm run verify` 105 檔／2344 測試（main @ d6b6c5e 是 103／2283；新增 `tests/draft-backup.test.ts`、`tests/vite-no-reload.test.ts`）。
