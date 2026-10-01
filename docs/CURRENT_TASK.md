# Current Task

<!-- 上限 100 行。只放指標，細節在被指向的檔案。索引目前手動維護（D-014）。 -->

## 主樹基準

- `npm run verify`：typecheck 通過；Vitest **72 檔 / 1494 測試**全綠（2026-10-01，P5-T033；D-033 這批合併後）
- migration head：`008-user-image-briefs`（dev server 已自動套到本機 DB）
- 站台設定 `config/publish-targets.json` 已改成本機檔（不進 git）；測試讀 `config/examples/remusplus.json`。
- 跑出來對不上就是環境漂移，先查清楚再動手。

## 進行中

D-033 健檢後的瘦身與拆分（[P0-T002](tasks/P0-T002-slim-docs.md) 已合併）；以下各一個 PR，重構不改行為：

| Task | 內容 | 狀態 |
| --- | --- | --- |
| [P5-T004](tasks/P5-T004-split-core-service.md) | 拆分 CoreService（含 `api.ts`） | PR #14 已合併 |
| [P5-T034](tasks/P5-T034-split-styles.md) | 樣式表照畫面拆檔 | PR #12 已合併 |
| [P5-T035](tasks/P5-T035-proofview-edit-logic.md) | 抽出 ProofView 編輯邏輯 | PR #13 已合併 |
| [P5-T033](tasks/P5-T033-split-fixtures.md) | 拆分示範資料，規則改用 contract（疊在 P5-T004 上） | PR 審查中（D-033 最後一個） |

## 待使用者手動驗證（都已合併；一律只存草稿）

| Task | 驗什麼 |
| --- | --- |
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

## 上次停在哪（2026-09-30 收官）

- 合併 #6 P5-T030、#7＋#8 P5-T031（#7 在 GitHub 同步前被合併、漏掉 Codex 修正，#8 補上）、#9 P5-T032。
- 工作方式：實作派 subagent、主 session 監工 → 獨立審查 → PR → Codex 審查 → 修正與意見貼 PR。
  開完 PR 主動跑 Codex、有問題直接修；叫使用者合併前先確認 PR head 等於本機 HEAD。
- 已真實驗證（2026-09-24）：Codex 生圖 → 上傳 → 放進正文 → 存草稿。P5-T029 使用者決定不補 Codex 審查。
- 開源在 https://github.com/x52640/wp-galley （D-029），main 有分支保護（只能 PR）；commit 用 noreply 信箱。
- 背景跑的 dev server 最多 2 小時會被 Claude Code 關掉；要長開請使用者自己在終端機跑 `npm run dev`。

## Ready

| Task | 內容 | 備註 |
| --- | --- | --- |
| [P6-T001](tasks/P6-T001-factcheck.md) | AI 查證 | |

## Blocked

無。

## 待專案擁有者

`plan.md` 的「待裁定」Q-1～Q-8。其中 Q-1～Q-3 預定在 P5-T001 實測時回答。

## 已知問題

見 [known-issues.md](known-issues.md)（記錄，不擋進度）。

## 治理

- 人維護：本檔、plan.md、各 Task 的 front matter 與接手紀錄。
- 腳本（`task:index`、`verify:docs`、`task:close`）等 Task 累積到 5–10 個再做。
