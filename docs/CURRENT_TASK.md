# Current Task

<!-- 上限 100 行。只放指標，細節在被指向的檔案。索引目前手動維護（D-014）。 -->

## 主樹基準

- `npm run verify`：typecheck 通過；Vitest **39 檔 / 603 測試**全綠（2026-09-23，P5-T013 後）
- migration head：`005-image-candidates`
- 跑出來對不上就是環境漂移，先查清楚再動手。

## 進行中

P5-T001 實測進行中（走到第 2 步）。使用者要求把實測發現的問題當場修，已完成：P5-T008 定位忽略空白、
P5-T009 兩欄各自捲動、P5-T010 直接在文章上改、P5-T011 標出要改的地方、P5-T012 改完卡片自動結案。下一步：回到實測第 3 步（只接受一個錯字）。

[P5-T013](tasks/P5-T013-codex-image-generation.md) 用 Codex 生圖（D-017）已完成，只走過示範資料；
**真實 Codex 生圖與「用這張」的真實上傳還沒跑過**（耗額度、會寫進媒體庫），留給使用者在實測時做。
生圖帶了 `--ephemeral`／`--ignore-user-config`，這兩個在生圖上沒驗證過：第一次真實生圖若回「在 generated_images/… 找不到圖」，
先懷疑它們（見 `docs/specs/agent-cli.md`「Codex 生圖」）。

## 上次停在哪（2026-09-23）

B 版三個畫面都做完、commit 了，**使用者還沒實際用過**。真實後端只測到發布按鈕可以按，
沒有真的發布（會在正式站建草稿，要使用者決定）。畫面行為跟以前最大的不同：還有未處理的建議時
只提醒、不擋發布（Q-1）。

## Ready

| Task | 內容 | 備註 |
| --- | --- | --- |
| [P5-T001](tasks/P5-T001-test-stage-5-5.md) | 陪使用者實測（5.5 功能＋B 版畫面） | 需要使用者在場；**下一步** |
| [P5-T005](tasks/P5-T005-expected-content-hash.md) | 後端真的檢查 expectedContentHash | 小；保護目前不存在 |
| [P5-T004](tasks/P5-T004-split-core-service.md) | 拆分 CoreService | 跟 P5-T003 不衝突 |

## Blocked

| Task | 等什麼 |
| --- | --- |
| [P6-T001](tasks/P6-T001-factcheck.md) AI 查證 | P5-T001 |
| [P8-T001](tasks/P8-T001-site-profile.md) 通用文章類型與本機站台設定檔（D-016） | P5-T001 |
| [P8-T002](tasks/P8-T002-setup-wizard.md) 首次設定精靈（D-016） | P8-T001 |

## 待專案擁有者

`plan.md` 的「待裁定」Q-1～Q-8。其中 Q-1～Q-3 預定在 P5-T001 實測時回答。

## 已知殘餘（記錄，不擋進度）

- 前端以為建立 revision 有 `expectedContentHash` 保護，後端其實沒做 → P5-T005。
- 階段 5 的 Codex review 報告沒有留檔（`tests/review-proposal.test.ts` 已註明）。
- `core-service.md` 的方法清單是節錄 → P5-T004。
- D-016 未查證：Codex／Claude／Google 的條款是否允許第三方工具呼叫其 CLI；開源公開前要查。
- Agent 的 prompt 同時帶「原稿」（sourceText）與目前的 templateData；接受建議或直接在文章上改都不更新
  sourceText，兩者會不一致（P5-T010 審查發現，原本就存在），尚未開 Task。
- 直接在文章上改的整理規則只處理頂層：巢狀 `div`（例如清單項目裡）不轉成段落、空標題不刪（P5-T010 審查，少見）。
- 程式註解大量引用「計畫 §N」，指的是 `docs/archive/IMPLEMENTATION_PLAN.md`，部分已被推翻；
  以 spec 為準。
- 發布面板靠比對後端的中文 blocker 字串分類（後端改字會多擋）→ 應改成結構化代碼，尚未開 Task。
- Codex 生圖的圖檔留在 `~/.codex/generated_images/`（那是 Codex 的資料夾，發布台不刪）。
- `CODEX_HOME` 只明確傳給生圖那一趟；偵測（`codex login status`）與校稿沒傳，使用者自訂 `CODEX_HOME` 時會用預設位置（P5-T013 審查，未處理）。
- `-s read-only` 的 Codex 仍然**讀得到**磁碟上的檔案（例如專案的 `.env`），校稿與生圖都一樣，原本就存在；
  目前靠 cwd 是隔離工作區與 prompt 約束，沒有真的擋（P5-T013 審查，未處理）。
- 刻意接受的限制（不是 bug）：見 `docs/specs/security.md` 最後一節、
  `docs/specs/review-proposals.md` 的逐項套用定位規則。

## 治理

- 人維護：本檔、plan.md、各 Task 的 front matter 與接手紀錄。
- 腳本（`task:index`、`verify:docs`、`task:close`）等 Task 累積到 5–10 個再做。
