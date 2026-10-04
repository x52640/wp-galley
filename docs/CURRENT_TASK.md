# Current Task

<!-- 上限 100 行。只放指標，細節在被指向的檔案。索引目前手動維護（D-014）。 -->

## 主樹基準

- `npm run verify`：typecheck 通過；Vitest **98 檔 / 2177 測試**全綠（2026-10-05 主樹，D-040 三個拆檔 PR #29～#31 合併後）
- 使用者資料在 `~/Library/Application Support/Galley/`（D-035）：2026-10-04 19:15 dev server 重載時自動搬家完成（標記 `done`、19 篇、絕對路徑 0 筆、integrity_check ok）；搬家前完整備份在 `~/wp-galley-backup-20261004`；舊資料仍留在程式資料夾，使用者確認後可刪。
- migration head：`010-relative-paths`（已套到資料目錄的 DB）。git worktree 預設用自己的 `.galley-data/`，碰不到真實資料。
- 站台設定在資料目錄的 `publish-targets.json`（不進 git）；測試讀 `config/examples/remusplus.json`。
- 跑出來對不上就是環境漂移，先查清楚再動手。

## 進行中

無。拆檔 Task P5-T041～P5-T045（D-040）已開立但**還沒開工**：Task 檔與 D-040 在分支 `p5-t041-proofview-selection`（worktree `../wp-galley-P5-T041`，commit f76dd5e），尚未進 main；開工前先 rebase 到 main。使用者提議的分組：PR A＝T041～T043（同一 PR、一 Task 一 commit）、PR B＝T044、PR C＝T045。

## 待使用者手動驗證（都已合併；一律只存草稿）

2026-10-05 使用者：目前無法手動測試，Codex 審到沒問題就由主 session 直接合併；下表留待日後驗。

| Task | 驗什麼 |
| --- | --- |
| [P5-T041](tasks/P5-T041-proofview-selection.md)～[P5-T045](tasks/P5-T045-split-workspace.md) | D-040 拆檔（只拆不改行為，`?fixtures=1` 截圖已比對）：真實資料開一篇草稿，改原文打字、格式工具列、儲存；選字查證這句、用此段配圖；右欄配圖卡片生圖、用這張；換篇、停止、恢復已取消，看起來都跟以前一樣 |
| [P8-T004](tasks/P8-T004-data-dir-hardening.md) | 啟動發布台：沒有誤警告、舊稿件與圖片照常（2026-10-05 使用者確認正常；搬家來的舊標記讀取時視為已建過 DB，不需補記） |
| [P5-T040](tasks/P5-T040-review-followups.md) | 發布面板打網址不存 → 按 × 關掉再開 → 仍擋發布；「標題與網址」存網址中開發布面板 → 被擋 |
| [P5-T038](tasks/P5-T038-image-from-selection.md) | 用真的 Codex：選兩三段 → 用此段配圖 → 選「第 N 段之後」→ 圖跟主題相關 → 用這張 → 圖在選的位置 |
| [P5-T039](tasks/P5-T039-slug-in-publish.md) | 沒填網址的長文 → 發布面板黃色提醒 → 建議網址 → 點一個 → 存網址 → 存草稿，後台網址正確；打了沒存時發布被擋 |
| [P8-T003](tasks/P8-T003-user-data-dir.md) | 舊稿件、舊圖都在；開一篇草稿真跑一次校稿＋Codex 生圖（Agent 在新工作目錄不出錯）。設定精靈畫面上仍寫舊路徑（known-issues） |
| [P6-T006](tasks/P6-T006-check-while-writing.md) | 打字模式寫一句、選起來按「查證這句」→ 查證期間繼續寫、按儲存 → 結果出現、字沒被蓋掉；空白新稿打第一句也能查 |
| [P5-T037](tasks/P5-T037-edit-target-fixes.md) | job 17「湯匙」卡按「去原文改」→ 那句標黃、游標在句首；任一段段首按 Enter 換段 → 看得到游標 |
| [P6-T005](tasks/P6-T005-factcheck-ui.md) | **優先**：Codex、Claude 各跑一次一鍵查證＋查證這句，agy 跑一次；看判定合理、看原文對得上、停止有效；順便確認 Codex `web_search="cached"`、Claude `WebSearch`＋`--json-schema`（同 P6-T003 那條）、中文維基是繁體。只在本機，不核准不發布 |
| [P5-T036](tasks/P5-T036-lock-agent-tools.md) | **優先**：真跑 Codex 校稿、Claude 校稿、Codex 生圖各一次，確認新的不連外參數不讓 CLI 報錯（`-c` 在 `--ignore-user-config` 下是否生效等未證實項見 known-issues） |
| [P6-T003](tasks/P6-T003-factcheck-contract.md) | Claude `--tools ""` 搭 `--json-schema` 能否回結構化輸出（主 session 已給一行 `! claude --print …` 測試指令；不相容就拿掉 `claude.ts` strictNoTools 的 `--tools ""`） |
| [P5-T032](tasks/P5-T032-disable-targets.md) | 精靈停用一個類型 → 新稿件選單看不到 → 舊稿件照常打開 → 再啟用 |
| [P5-T031](tasks/P5-T031-edit-jump-to-title.md) | 講標題的建議按「去原文改」→ 游標在標題、可直接改 → 儲存 |
| [P5-T030](tasks/P5-T030-restore-cancelled.md) | 打開已取消的稿件 → 恢復 → 繼續改 → 核准 → 存草稿 |
| [P5-T029](tasks/P5-T029-write-in-place.md) | 新日記 → 建立並打開 → 直接打字、用工具列、改標題 → 儲存；文章上滾輪不用滾兩次 |
| [P5-T028](tasks/P5-T028-rich-edit-toolbar.md) | 長文加粗、連結、H2、清單、貼網頁格式 → 存 → 草稿看後台區塊 |
| [P5-T027](tasks/P5-T027-keep-edited-brief.md) | 改封面描述 → 按「校驗」→ 描述仍是自己改的 |
| [P5-T026](tasks/P5-T026-suggest-slug.md) | 「建議網址」：真實 CLI 接受新 schema、候選跟內容有關、用官方英文片名、點了才填 |
| [P5-T025](tasks/P5-T025-edit-image-prompt.md) | 一鍵配圖 → 改封面 prompt → 存 → Codex 生圖照新描述 |
| [P5-T024](tasks/P5-T024-choose-author.md) | 選作者 → 存草稿 → 後台作者是本人（read-think／diary 不支援作者欄位時 WordPress 會默默忽略） |
| [P8-T002](tasks/P8-T002-setup-wizard.md) | 精靈用作者本人的站完整跑過（含填錯密碼、填 http）？使用者沒明確回報，下次開工先問 |

## 上次停在哪（2026-10-05 拆檔）

- D-040 拆檔分三個 PR、都從 main 開：A＝P5-T041～P5-T043（ProofView 1560 → 360 行）、B＝P5-T044（MediaPanel 1010 → 222）、C＝P5-T045（Workspace 989 → 714）。每張 Task 實作 → verify → 獨立審查（皆無行為差異）→ Codex。
- 合併順序 #30 → #29 → #31；#31 在 `architecture.md` 功能地圖衝突，逐列合併後 rebase（只動文件）。三個 PR 都 Codex 一輪無問題、每張 Task 獨立審查一輪無行為差異。
- 合併後發現 5 處文件／註解仍指向拆檔前的位置（design-system、agent-tasks、tokens.css、SelectionActions），已修在本分支第一個 commit，跟下一個 Task 一起進 PR。
- 殘餘（各 Task 檔「完成結果」）：MediaPanel 暫時轉出 `useImageGenerationStatus`／`assetLabel`；`proof-editing`／`proof-frame` 守門測試靠找原始碼字串判斷 hook 順序。
- Vite 8 沒有 `--cacheDir` 參數：worktree 起 Vite 要另寫 config 指 cacheDir，否則快取寫進主目錄 `node_modules/.vite`（worktree 的 node_modules 是 symlink）。
- 截圖排隊：同一時間只一個 ui-drive（9333 埠）；示範資料版本 hash 是亂數、計時器看時間、捲軸會淡出，比對前先連跑兩次找出本來就會變的。

## 上次停在哪（2026-10-05 收官）

- 合併 #23（P8-T003 資料目錄，真實資料 2026-10-04 已搬到 `~/Library/Application Support/Galley/`）、#24（P6-T006）、#25（P5-T039）、#26（P5-T038，Codex 七輪）、#27（P8-T004 補審修正，Codex 三輪）。
- PR #28（P5-T040）：Codex 四輪，**第四輪的修正（refresh-scheduler、卸載時 sync 收尾）沒有再經過 Codex 審**（使用者指定第四輪為最後一輪）。
- 新規矩（memory `publisher-github-pr-flow`）：每個 PR Codex 最多三輪，第三輪有問題修完直接推、不再審；**合併由使用者按**，主 session 不 `gh pr merge`。使用者目前無法手動測試。
- 同時跑 ui-drive 截圖會撞 9333 埠，截圖要排隊。
- 2026-10-02 留下的文件欠帳：P5-T037、P6-T005 的殘餘還沒併進 known-issues.md；功能地圖還沒列 `src/contract/review-locate.ts`。
- 工作方式：subagent 實作 → 主 session 驗證 → 另派審查 → PR → Codex（`codex:codex-rescue`）→ 修正寫進 PR → 確認 PR head 同步才交使用者合併。並行用 git worktree（`../wp-galley-<Task>`、`node_modules` symlink）；`CURRENT_TASK`／功能地圖由主 session 統一更新。

## Ready

無。

## 待專案擁有者

`plan.md` 的「待裁定」Q-1～Q-8。其中 Q-1～Q-3 預定在 P5-T001 實測時回答。

## 已知問題

見 [known-issues.md](known-issues.md)（記錄，不擋進度）。

## 治理

- 人維護：本檔、plan.md、各 Task 的 front matter 與接手紀錄。
- 腳本（`task:index`、`verify:docs`、`task:close`）等 Task 累積到 5–10 個再做。
