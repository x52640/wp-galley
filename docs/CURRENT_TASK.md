# Current Task

<!-- 上限 100 行。只放指標，細節在被指向的檔案。索引目前手動維護（D-014）。 -->

## 主樹基準

- `npm run verify`：typecheck 通過；Vitest **63 檔 / 1153 測試**全綠（2026-09-27，P5-T027 commit；
  P5-T026 commit 時是 62 檔 / 1141）
- migration head：`008-user-image-briefs`（dev server 已自動套到本機 DB）
- 站台設定 `config/publish-targets.json` 已改成本機檔（不進 git）；測試讀 `config/examples/remusplus.json`。
- 跑出來對不上就是環境漂移，先查清楚再動手。

## 進行中

- [P5-T027](tasks/P5-T027-keep-edited-brief.md)：使用者改過的配圖描述不被 AI 蓋掉（D-027），已 commit（審查 3 條低度，只改文件說法），**待使用者手動驗證**。
- P5-T025（配圖的 prompt 可以直接改）已 commit，**待使用者手動驗證**。蓋掉使用者改過描述的問題 → P5-T027。
- [P5-T026](tasks/P5-T026-suggest-slug.md) AI 建議英文網址（D-026），已 commit（審查後修 3 條），**待使用者手動驗證**（真實 CLI 是否接受新 schema、是否用官方英文片名；只存草稿）。
- P5-T024（發布時指定作者）已 commit，**待使用者在自己的站手動驗證**（存草稿、後台看作者；read-think／diary 若不支援作者欄位，WordPress 會默默忽略）。

## 上次停在哪（2026-09-24 收官）

- 5.5 實測已結案（P5-T001），實測中當場修 P5-T008～P5-T018，都已 commit。
- **使用者 2026-09-24 已真實驗證**：Codex 生圖（帶 `--ephemeral`／`--ignore-user-config`）→「用這張」上傳
  → 自動放進正文 → 存成草稿，全程正常。
- 第 8 階段：P8-T001（通用文章類型、本機站台設定檔）、P8-T002（首次設定精靈）已完成並 commit。
  精靈是否已用作者本人的站完整跑過（含故意填錯密碼、填 http），使用者沒有明確回報——下次開工先問。
- 工作方式：使用者要求實作派 subagent、主 session 監工（驗證 → 另派 subagent 審查 → 修 → commit）。
- dev server（`npm run dev`）可能還在背景跑；資料庫 migration head 008。

## Ready


| Task | 內容 | 備註 |
| --- | --- | --- |
| [P6-T001](tasks/P6-T001-factcheck.md) | AI 查證 | 原本等 P5-T001，已解除 |
| [P5-T004](tasks/P5-T004-split-core-service.md) | 拆分 CoreService | 跟 P5-T003 不衝突 |

## Blocked

無。

## 待專案擁有者

`plan.md` 的「待裁定」Q-1～Q-8。其中 Q-1～Q-3 預定在 P5-T001 實測時回答。

## 已知殘餘（記錄，不擋進度）

- 設定精靈：Antigravity 的安裝／登入指令未查證；換站後舊 target 不會自動移除；shell 裡 export 的
  `WORDPRESS_*` 下次啟動會蓋掉精靈寫的 `.env`（P8-T002，見 wordpress-site.md「設定精靈」）。

- 啟動清理在建 CoreService 時就跑（P5-T020）：已開著一個後端時再啟動第二個（連接埠被占而退出），會先把第一個正在跑的 AI 工作標成「後端重啟」作廢、額度照花。修法是移到 listen 成功後（要改 `src/server/main.ts`）；MCP 若另起行程共用 DB 也會踩到。2026-09-24 使用者裁定先記下，未開 Task。
- `?fixtures=1` 的假資料（`src/ui/service/fixtures.ts`）移除／移動圖片仍整塊刪，跟後端（P5-T019）不一致，只影響示範畫面。
- 直接在文章上改遇到 409 後按「重新讀取」，編輯框裡未存的字可能消失（P5-T005，少見）。
- 階段 5 的 Codex review 報告沒有留檔（`tests/review-proposal.test.ts` 已註明）。2026-09-24 全 repo 審查有留檔：`docs/reviews/`。
- `core-service.md` 的方法清單是節錄 → P5-T004。
- D-016 未查證：Codex／Claude／Google 的條款是否允許第三方工具呼叫其 CLI；開源公開前要查。
- ~~prompt 同時帶過期的原稿（sourceText）~~ → P5-T017 已處理：prompt 只送目前這一版；sourceText 仍是
  「最早貼上的原稿」的紀錄，不跟著更新（刻意的）。模板 `rules.md` 裡還有「原稿」的字眼（指使用者的文章，
  不是那份過期的稿子），在 `templates/`，P5-T017 沒動。
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
