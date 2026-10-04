---
id: P6-T006
phase: 6
status: done
depends_on: [P6-T005]
specs: [factcheck.md, http-api.md, design-system.md]
write_paths: ["src/ui/", "src/contract/agent-run.ts", "src/contract/factcheck.ts", "src/core/service/factcheck.ts", "src/core/service/content.ts", "src/core/service/media.ts", "tests/", "docs/specs/factcheck.md", "docs/specs/http-api.md", "docs/specs/design-system.md", "docs/specs/architecture.md", "docs/known-issues.md", "docs/tasks/P6-T006-check-while-writing.md"]
contract_change: none
expected_commit: "feat(P6-T006): 改字時也能查證這句，查證時可以繼續寫"
---

# 改字時也能「查證這句」，查證時可以繼續寫

## 目標
D-036。使用者 2026-10-04：「我寫完一句想要馬上請 AI 查，還需要先儲存才可以。」實際卡兩件事：

1. 打字模式下選字不會浮出「查證這句」（`ProofView` 的 `selectionchange` 在 `editingRef.current` 時直接 return），
   要先存檔、離開打字模式、再選字。
2. 查證跑的 1～3 分鐘內內容被鎖（`taskLocksContent` 沒把 `factcheck` 列為例外；後端 `createRevision` 經 `assertNotRunning` 拒絕；
   前端 `Workspace.startEdit` 在 `working` 時擋），寫完一句查了就得乾等。

查證本來就**不改文章**（factcheck.md「結果永不自動套用、不改文章」），鎖內容沒有保護到什麼；
規格裡「萬一跑完時內容已經不是發起時那一版，結果照收、用 excerpt 重新定位，找不到原句的收進已處理」的防禦規則已經處理了內容變動的情況。

不做「拿沒存的字直接查」：查證結果要靠存過的內容定位段落；而「存」只存在本機、不送 WordPress，自動存沒有副作用。

## 範圍
### 包含
- **打字模式選字也浮出「查證這句」**（同樣 4～300 字、同樣膠囊樣式與位置）。按下：
  - 內容有改 → 先照現有「儲存」流程存一版（同樣的驗證、同樣的錯誤處理；含 WordPress 密碼照舊直接拒絕），**存完留在打字模式、游標與捲動位置不變**；
    存失敗就不查，照存檔失敗的方式講。
  - 沒改 → 直接查。
  - 然後用存好的那一版發起選字查證（同現有 `POST …/factchecks` 選字 scope）。
  - 膠囊不能干擾打字：只在有非空選取時出現；開始打字、按 Esc、選取消失就收起。
- **查證跑的期間不鎖內容**：`taskLocksContent('factcheck')` 回 false（跟 `generate-image`、`suggest-slug` 同一個例外清單），
  後端 `createRevision` 等處不再因查證在跑而拒絕（拿掉或改寫 `assertNotRunning` 的呼叫，`media.ts` 放圖、設封面一併放行——同一條規則：查證不鎖內容）。
  其他 Agent 動作照舊互斥（同一篇一次只跑一個 Agent 動作，不變）。
- **查證跑的時候可以進打字模式、可以繼續打字與儲存**。查證完成、工作區重讀時**不得蓋掉或重載正在打的字**
  （打字中只更新右欄卡片與字上標記能更新的部分；需要重載校樣的，等離開打字模式再做）。
  查證進行中的計時器、停止按鈕在打字模式下照樣看得到、按得到。
- 查證結果的定位照既有規則：讀取時重算 `blockIndex`；查的那句被改掉了就照「原句已經改了」收進已處理。
- 打字模式下「去原文改」等既有入口的行為不變。
- fixtures（`?fixtures=1`）：打字模式選字查證、查證中繼續打字都能重現。
- spec：`factcheck.md`「觸發與畫面」「執行規則」（鎖內容那條改寫、防禦性規則改成正常路徑）、`http-api.md` 若有寫查證期間 409 的地方、
  `design-system.md` 若膠囊規則有寫「沒在改字時」。

### 不包含
- 一鍵查證（整篇）與觀察卡片上的「查證」改到打字模式（只做選字）。
- 拿沒存的內容查證。
- 讓其他 Agent 動作（校稿、配圖…）也不鎖內容。
- MCP。

## 工作區與 Context
### 必讀入口
`docs/specs/factcheck.md`「觸發與畫面」「執行規則」、`src/contract/agent-run.ts`、`src/core/service/factcheck.ts`（`assertNotRunning`）、
`src/core/service/content.ts`、`src/core/service/media.ts`、`src/ui/components/ProofView.tsx`（選字膠囊、`editingRef`）、
`src/ui/components/Workspace.tsx`（`startEdit`、`working`、存檔 `api.createRevision`）。
### 不應載入
`docs/archive/`、取回器 `src/fetch/`、prompt 與 adapter。
### 驗證命令
`npm run verify`；畫面用 `node scripts/ui-drive.mjs` 搭 `?fixtures=1` 截圖。

## 實作要求
- 先寫測試再實作。後端測試：查證跑的期間 `createRevision`（改字、放圖、設封面、套用建議）成功；其他 Agent 動作在跑時照舊鎖。
  前端測試：打字模式選字出現膠囊、按下先存再查、存失敗不查、查證完成不蓋掉打字中的內容。
- 不呼叫真實 Agent CLI、不連真實 WordPress（含經 dev server 的 `/api/wordpress*`、`/api/setup/*`）、不啟動或重啟 dev server、不 commit、不用 `git stash`。
- 只在 worktree 內改；不讀寫主目錄的 `data/`、`.env`、`config/publish-targets.json`。

## 驗證
### 自動驗證
`npm run verify` 綠。
### 手動驗證（使用者）
打開一篇草稿進打字模式 → 寫一句 → 選起來按「查證這句」→ 查證期間繼續寫下一句、按儲存 → 查證結果出現在右欄、剛寫的字沒被蓋掉。只在本機，不核准不發布。

## 完成定義
- [x] `npm run verify` 綠
- [x] 擁有這些行為的 spec 已更新（新增或搬動功能：architecture.md 功能地圖）（`core-service.md` 由主 session 改）
- [x] 留下的殘餘已寫進 `docs/known-issues.md`
- [ ] CURRENT_TASK 已更新（主 session 統一更新）

## 中斷／接手紀錄
- 最後完成：實作（2026-10-04 subagent）＋獨立審查四條修正：①後端 `resolveFactCheckId` 指向這篇但已非 open 的那條 → 照存不結案（`findingToResolveByEdit`），
  前端重讀時清掉已非 open 的 `editing.factCheckId`（`dropStaleFactCheck`）；②`settleHold` 一律記下存出來的版本（H0→H1→H0 不重載）；
  ③打字中「照樣存」後正文換成整理後 HTML、游標照非空白字數放回（`replaceBodyKeepingCaret`）；④自動存過一版後提示列講「已自動存一版；按取消會回到這一版」
- 已通過驗證：`npm run verify` 綠（86 檔／1913 測試）；`?fixtures=1` 截圖驗過打字模式膠囊、查證中繼續打字、查證完成字沒被蓋掉、照樣存後底線拿掉且游標續寫在原處、
  去原文改期間同一句被重查後存檔不報錯、空白新稿打第一句選起來膠囊可按並先存再查
- 再追加（PR #24 Codex 審查兩條，未 commit）：P1 hold 改成記下這次打字中自己存的每一版（`own`），重讀失敗、快照較舊不換 frame；
  存檔基準用最後一次存成功的 hash（`nextSaveBase`、Workspace 的 `lastSavedHash`）。P2 打字模式膠囊不看存過的 `bodyEmpty`（`selectionCheckBlockedReason`）
- 下一步：主 session 審查 → commit 進 PR #24；`docs/specs/core-service.md` 第 31 行 `content.ts` 用的方法名（`findingToResolveByEdit`）若還沒改要改；使用者手動驗證
- Blocker：無

## 完成結果
