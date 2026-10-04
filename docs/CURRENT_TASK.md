# Current Task

<!-- 上限 100 行。只放指標，細節在被指向的檔案。索引目前手動維護（D-014）。 -->

## 主樹基準

- `npm run verify`：typecheck 通過；Vitest **92 檔 / 2053 測試**全綠（2026-10-04，P5-T038 rebase 到 P8-T004 之後）
- 使用者資料在 `~/Library/Application Support/Galley/`（D-035）：2026-10-04 19:15 dev server 重載時自動搬家完成（標記 `done`、19 篇、絕對路徑 0 筆、integrity_check ok）；搬家前完整備份在 `~/wp-galley-backup-20261004`；舊資料仍留在程式資料夾，使用者確認後可刪。
- migration head：`010-relative-paths`（已套到資料目錄的 DB）。git worktree 預設用自己的 `.galley-data/`，碰不到真實資料。
- 站台設定在資料目錄的 `publish-targets.json`（不進 git）；測試讀 `config/examples/remusplus.json`。
- 跑出來對不上就是環境漂移，先查清楚再動手。

## 進行中

無。

## 待使用者手動驗證（都已合併；一律只存草稿）

| Task | 驗什麼 |
| --- | --- |
| [P8-T004](tasks/P8-T004-data-dir-hardening.md) | 啟動發布台：沒有誤警告、舊稿件與圖片照常（第一次啟動會在標記檔補記 `databaseCreated`） |
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

## 上次停在哪（2026-10-02 收官）

- 合併 #22 P5-T037（去原文改標色、段首游標）；殘餘兩條低嚴重度在 Task 檔「完成結果」，也還沒併進 known-issues.md；`architecture.md` 功能地圖還沒列新檔 `src/contract/review-locate.ts`。
- 合併 #21 P6-T005 查證畫面（獨立審查一輪＋Codex 一輪，修正寫在 PR）。殘餘在 Task 檔「完成結果」，**還沒併進 known-issues.md**。
- 啟動 dev server 前先備份 `data/publisher.sqlite`（2026-10-01 套 009 時漏了）。
- 工作方式不變：subagent 實作 → 主 session 驗證 → 另派審查 → PR → Codex 審查（`codex:codex-rescue`，預設用 `~/.codex/config.toml` 的模型與 effort）→ 修正寫進 PR → 確認 PR head 同步才叫使用者合併。資安類發現先修再用籠統寫法貼 PR。
- 並行用 git worktree（`../wp-galley-<Task>`，`node_modules` symlink，用完移除）；`CURRENT_TASK`／功能地圖由主 session 統一更新避免衝突。
- 對話累積很長的 subagent 容易串流逾時停住：先看工作樹留下什麼，再續派或改派新的。
- 開源在 https://github.com/x52640/wp-galley （D-029），main 有分支保護；收官交接只改文件時不單獨開 PR，留本機給下個 Task 的 PR 帶上。

## Ready

無。

## 待專案擁有者

`plan.md` 的「待裁定」Q-1～Q-8。其中 Q-1～Q-3 預定在 P5-T001 實測時回答。

## 已知問題

見 [known-issues.md](known-issues.md)（記錄，不擋進度）。

## 治理

- 人維護：本檔、plan.md、各 Task 的 front matter 與接手紀錄。
- 腳本（`task:index`、`verify:docs`、`task:close`）等 Task 累積到 5–10 個再做。
