---
id: P5-T049
phase: 5
status: done
depends_on: []
specs: [design-system.md, architecture.md]
write_paths: ["src/ui/", "src/contract/", "tests/", "docs/specs/design-system.md", "docs/specs/architecture.md", "docs/known-issues.md", "docs/tasks/P5-T049-insert-image-while-typing.md", "docs/CURRENT_TASK.md"]
contract_change: none
expected_commit: "fix(P5-T049): 打字模式也能插圖，圖片後按 Enter 不再變置中"
---

# 打字模式也能插圖，圖片後按 Enter 不再變置中

## 目標
D-048。使用者 2026-10-21 回報兩件事：
1. 打字模式看不到「在這裡插圖」，只能先按儲存、離開打字模式才能插。原因：P5-T016 故意在編輯中擋掉（打字時區塊一直變，「插在第幾塊之後」會對不上）。
   改法比照「用此段配圖」已有的「先存再做」（`actWhileWriting`，P5-T038／P6-T006）：按下時內容有改就先照「儲存」存一版、**留在打字模式**，再插。
2. 圖片在文章最尾端時，接著按 Enter 打的字變成置中。推測：圖片 figure 帶 `aligncenter`（`src/core/service/media.ts`），游標只能落在 figure 裡，
   Chrome 按 Enter 把 figure 的 class 帶給新段落（或新段落落在 figure 裡）。**先用 `?fixtures=1` 重現確認原因再修**，原因不同就照實際原因修並寫進這裡。
   **實際原因（2026-10-21 重現）**：點圖片不會放游標；從上一段按 → 或 ↓ 游標停在 figure **裡**（圖片前或圖片後）。這時按 Enter，Chrome 把整個
   `<figure class="wp-block-image size-large aligncenter">` **複製一份**，打的字落在新 figure 裡（不是段落）；存檔整理在 edit 模式原樣保留 figure，
   所以存進去是一塊只有字的置中圖片區塊。不按 Enter 直接打字也會打進 figure、跟圖片擠在一起。點圖片下方空白落在正文外面，放不了游標。

## 範圍
### 包含
- 打字模式也畫「在這裡插圖」；按下打開同一個插圖面板（上傳、選媒體庫、請 AI 配一張都可用，照原規則）。
  按下或送出時有未存改動就先存（跟「儲存」共用存檔狀態；存失敗就不插、講原因）。插完人留在打字模式、游標與捲動不亂跳。
- 插圖會改到正文：插完之後編輯區要看得到新圖，**存檔後到插圖完成之間又打的字不准掉**（memory：掉資料都算 bug）。做不到安全合併就在插圖期間擋打字並明講，不要靜靜蓋掉。
  跟 P5-T048 的自動留底（localStorage）要一致，不要插完又跳「已恢復…」。
- 在圖片 figure 裡（含它是最後一塊、游標在圖片後或圖說後）按 Enter：在 figure **下方**開一個乾淨 `<p>`（不帶 figure 的任何 class／style），游標移過去；
  圖說裡按 Enter 同樣跳出到下方新段落（不在圖說裡換行）。最後一塊是圖片時，要有辦法把游標放到圖片後面開始打字（點圖片下方空白或按 → ／ ↓ 都行，挑一種做好並寫進 spec）。
- 已經被弄成置中的段落：存檔整理時不用特別救（D-049 之後置中是合法格式），但這個 Task 不准再產生。
- `docs/specs/design-system.md`、`architecture.md` 功能地圖對應列更新；殘餘寫 known-issues。

### 不包含
- 段落對齊按鈕（P5-T050）。
- 拖曳移動圖片、圖片大小與對齊調整。

## 工作區與 Context
### 必讀入口
`src/ui/components/ProofView.tsx` 檔頭第五、六、七節、`InsertSlots.tsx`、`InsertImagePanel.tsx`、`src/ui/lib/use-proof-editing.ts`（`actWhileWriting`）、
`src/ui/lib/check-while-writing.ts`（hold）、`src/ui/lib/proof-edit-dom.ts`（Enter 處理）、`src/ui/lib/use-draft-backup.ts`、architecture.md 功能地圖「在文章上改」。
### 不應載入
agent、wordpress、factcheck spec。
### 驗證命令
`npm run verify`；`node scripts/ui-drive.mjs` 搭 `?fixtures=1` 截圖（打字模式插圖前後、圖片在最後一塊時按 Enter 打字）。

## 實作要求
- 先寫測試再實作：打字模式出現插圖鈕、有改動先存再插、存失敗不插、插完留在打字模式、存檔後又打的字不掉；
  figure 裡（圖後、圖說內、最後一塊）按 Enter 產生乾淨 `<p>` 在 figure 之後。
- 文字用繁體中文。

## 驗證
### 自動驗證
`npm run verify` 綠。
### 手動驗證（使用者）
打字模式寫一段不存 → 段落間「在這裡插圖」→ 上傳一張 → 圖出現、剛寫的字都在、還在打字模式；在最後一張圖後面按 Enter 打字 → 靠左 → 存草稿看後台。

## 完成定義
- [ ] `npm run verify` 綠
- [ ] 擁有這些行為的 spec 已更新（architecture.md 功能地圖）
- [ ] 留下的殘餘已寫進 `docs/known-issues.md`
- [ ] CURRENT_TASK 已更新

## 中斷／接手紀錄
- 最後完成：實作與文件（2026-10-21，worktree `wp-galley-P5-T049`）
- 已通過驗證：`npm run verify` 綠；`?fixtures=1` 截圖走過打字模式插圖（打一段不存 → 插 → 圖出現、字在、留在打字模式 → 再打 → 儲存）、
  打字模式「請 AI 配一張」（先存、卡片位置對、留在打字模式）、最後一張圖後按 →→／↓ 再 Enter 或直接打字（新段落是乾淨 `<p>`、存後靠左）
- 獨立審查一輪（2026-10-21）七條已修，見「完成結果」最後一段；修後 `npm run verify` 106 檔／2395 測試綠，`?fixtures=1` 截圖走過空段落下插圖、圖片下一段段首 Backspace、圖片上貼上
- PR #37 Codex 第一輪 P1（別處改過別段時只比前一塊會誤合併、之後存檔蓋掉別處修改）已修，見「完成結果」最後一段；修後 `npm run verify` 106 檔／2401 測試綠，`?fixtures=1` 重跑有改先存、沒改直接放、空段落下插三條都照常合併
- PR #37 Codex 第二輪三條已修（見「完成結果」最後一段）；修後 `npm run verify` 106 檔／2410 測試綠，`?fixtures=1` 重跑三條插圖流程照常合併
- 下一步：Codex 下一輪；合併後移到 CURRENT_TASK 待驗證表、status 改 done
- Blocker：無

## 完成結果
- 打字模式也畫「在這裡插圖」（`canInsertImages` 不再看打字模式；打字中整條不接滑鼠，只有按鈕接）。面板拿到 `InsertWriter`：
  放圖＝上傳先做完 → 擋打字 → 有改照「儲存」存一版（stay，hold 不重載）→ 編輯區第幾塊換算成存好那一版的第幾塊 → 後端放圖（`placeMedia` 改成回新版本）→
  新版本裡那塊圖插進編輯區同一位置、基準（原文快照、整理基準、留底基準、存檔基準 `rememberSaved`）換成新版本 → 放開打字。
  「請 AI 配一張」走既有的先存再做（`actWhileWriting` 的 act 多收存好的 hash）。流程 `src/ui/lib/insert-while-writing.ts`、接線 `use-proof-editing.ts` 的 `placeWhileWriting`。
- **怎麼不掉字**：擋打字從判斷之前開始到合併完才放開（存檔、換算、合併看同一份畫面，存好之後沒有新打的字）；合併對不上（第 N+1 塊不是圖或前一塊字不同）
  就不硬合併，結束打字模式照存好的版本重載並講出來——那時所有字都存過了。存失敗不放；放圖失敗面板講原因、存好的那版照留。
- 圖片上按鍵（`src/ui/lib/figure-caret.ts`）：figure 裡（含圖說）按 Enter → 圖片下方開乾淨 `<p>`、游標移過去（下面已是空段落就沿用）；
  最後一塊是圖片時 ↓／（結尾）→ 一樣開新段落；圖片旁直接打字（含輸入法）→ 字放進新段落（圖前放上方、圖後放下方）。選了「↓／→／Enter」這一種，不做點圖片下方空白。
- 新增測試 `tests/insert-while-writing.test.ts`（索引換算、合併判斷、插圖順序與失敗、圖片按鍵、接線）；`stage-view.test.ts` 改成打字模式也出現。
- 殘餘見 `docs/known-issues.md`「打字模式插圖」「游標在圖片上」兩條。
- 獨立審查修正：
  1. 合併的基準改成存檔那一刻的內容＋插入的圖（`withFigure`），不拿當下畫面；擋打字期間「恢復」留底反灰、`restoreDraft`／連結套用／移除連結／格式指令不做。
     畫面跟存檔那一刻不同時合併失敗不重載（會丟字），留在打字模式講清楚。
  2. 錨點取往前第一個整理後還存在的區塊的字（`savedAnchor`）：在自己剛開的空段落下面插圖不再被踢出打字模式；開頭空段落下面插＝插在最前面。
  3. 存檔這一步的錯是 `InsertSaveError`：照樣存之後存失敗或標題清空，頂端顯示「沒存成功」，不是「已存，但接著的動作沒做成」。
  4. 圖片旁貼上先跳到新段落（捕獲階段的 paste）；圖片下一段段首 Backspace／上一段段尾 Delete 不併，游標移到圖片後／前，空段落順便刪（`besideFigureKeyAction`）。
  5. 圖片按鍵與貼上處理在正文擋打字（`contenteditable` 不是 true）時不動 DOM。
  6. 面板的「校樣上方在問照樣存」提示只在真的還在問時顯示（`InsertWriter.confirmPending`；按儲存離開或回去改就收）。
  7. 放圖中途換篇或離開打字模式回 `abandoned`，不呼叫 `done`（不關新那篇的面板、不重讀）、不放開別篇的編輯區。
- Codex 第一輪 P1：合併前整份核對後端回的新版本＝「編輯區對應的那一版＋這張圖」（`placedOnBase`：拿掉插入的那塊後逐塊 HTML 相同、塊數剛好多一）。
  「對應的那一版」＝進入編輯時的 `publishHtml`，之後換成打字中自己存好的（存檔回呼帶回 `publishHtml`）、放好圖的那一版。
  對不上就走既有的不硬合併：畫面跟存檔那一刻一樣就結束打字模式照最新版本重載並講「可能在別處改過」；不一樣就留在打字模式講清楚。
  存檔基準（`rememberSaved`）改成核對過、合併成功才推進（`onMerged`），對不上時下次存檔用舊基準、被後端 409 擋下，不會默默蓋掉。
  後端 `placeMedia` 不收基準版本（路由只收 `afterBlockIndex`、revision 也沒有 parent），要後端擋得改 `src/server`、`src/core`，不在本 Task write_paths，沒做。
- Codex 第二輪：
  1. 插入點在開始放圖（按「放這裡」、開始上傳）時記住那一塊的節點（`InsertWriter.mark`），放的時候（擋打字後）用 `targetIndex` 算它目前的位置；
     上傳期間前面加刪段落位置跟著走，那一塊不見了就不存不放、講「要插圖的那一段已經不見了…圖已經在媒體庫，可以在面板上再選一次」。
  2. 放圖不准重入（放圖中或插圖在等「照樣存」時再叫 `placeWhileWriting` 直接講原因）；面板拿 `InsertWriter.busy`（放圖中＋插圖等照樣存），三條路與關閉都鎖住。
     「照樣存」等待改由 `setPending` 統一設定／清掉，插圖的等待（`insertAwaiting`）跟著收。
  3. 核對基準多記標題（進入編輯時的版本、打字中自己存的版本由存檔回呼帶回 `templateData`、放好的版本），合併前 `placedMatchesBase` 正文與標題都要一樣，否則走不合併。
