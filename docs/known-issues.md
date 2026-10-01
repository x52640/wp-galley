# 已知問題

> 記錄、不擋進度的殘餘。修掉的劃掉或刪掉；要修就開 Task。從 `docs/CURRENT_TASK.md` 搬來（P0-T002）。

## 已知殘餘（記錄，不擋進度）


- 帶連結的圖片（`<figure><a href><img></a></figure>`）存得住、連結不丟，但發布時 `block-parse.ts` 還不認得 figure 裡的 `<a>`，
  整塊會走 wp:html 保底，不是帶 `linkDestination: custom` 的圖片區塊。要改 `block-parse.ts`／`block-types.ts`／`block-serialize.ts`
  （P5-T028 的 write_paths 只含最後一個），另開 Task（P5-T028 第三輪審查 #4）。

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
- ~~直接在文章上改的整理規則只處理頂層：巢狀 `div` 不轉成段落、空標題不刪~~ → P5-T028 已處理（清單項目、引用裡的 div，空標題刪掉）。
- 程式註解大量引用「計畫 §N」，指的是 `docs/archive/IMPLEMENTATION_PLAN.md`，部分已被推翻；
  以 spec 為準。
- 發布面板靠比對後端的中文 blocker 字串分類（後端改字會多擋）→ 應改成結構化代碼，尚未開 Task。
- Codex 生圖的圖檔留在 `~/.codex/generated_images/`（那是 Codex 的資料夾，發布台不刪）。
- `CODEX_HOME` 只明確傳給生圖那一趟；偵測（`codex login status`）與校稿沒傳，使用者自訂 `CODEX_HOME` 時會用預設位置（P5-T013 審查，未處理）。
- `-s read-only` 的 Codex 仍然**讀得到**磁碟上的檔案（例如專案的 `.env`），校稿與生圖都一樣，原本就存在；
  目前靠 cwd 是隔離工作區與 prompt 約束，沒有真的擋（P5-T013 審查，未處理）。
- 刻意接受的限制（不是 bug）：見 `docs/specs/security.md` 最後一節、
  `docs/specs/review-proposals.md` 的逐項套用定位規則。

- P5-T036 Agent 不連外參數（2026-10-01）：Codex 功能開關用 `-c features.X=false`（未知名稱不報錯，但 Codex 改名時會默默失效——
  升級 CLI 後重跑 `codex features list` 對名單）。未證實：`-c` 在 `exec`＋`--ignore-user-config` 下是否生效（使用者手動真跑確認）；
  Codex 預設開著的 `plugins`、`remote_plugin`、`skill_mcp_dependency_install`、`tool_suggest`、`multi_agent` 是否被 `--ignore-user-config` 擋掉（暫不關，怕弄壞生圖）；
  Claude 工具限制是黑名單，名單外的 `Artifact`、`ArtifactData`、`Skill`、`Monitor`、`PowerShell` 等在 `--print` 是否載入未證實（手動驗證加測 `--tools ""`＋`--json-schema`）；
  `--strict-mcp-config` 是否也擋 claude.ai 帳號層級連接器未證實；agy 沒有停用工具／忽略 MCP 的參數，只靠 `--sandbox` 與 prompt 提示。

- P6-T002 取回器（2026-10-01）：外洩檢查「連續 12 字」對英文文章偏嚴，網址含文章裡的專有名詞（如 `united states`）就不抓（寧可多擋，看實際使用再調）；
  WordPress 密碼比對不分大小寫沒做（要動 `src/config` 的遮蔽器），全小寫夾帶擋不住（密碼本來就不會進 prompt，這是第二層）；
  繁體中文維基同時送 `Accept-Language: zh-TW` 與 `variant=zh-tw`，哪個生效未證實（P6-T005 真跑時看）；
  查詢字串用非 UTF-8 編碼（如 Big5）的舊站網址會被當成編碼不正常而不抓；
  測試用的自簽憑證與私鑰（`tests/fixtures/fetch/test-*.pem`，只給 `example.test`）進版控，秘密掃描可能告警。

## 收官紀錄裡的殘餘（原在 CURRENT_TASK「上次停在哪」「更早」）

- P5-T030：取消時沒停掉跑到一半的 Agent，恢復後結果仍會收下（有 content hash 保護，接受）。
- P5-T032：畫面要連得上 WordPress 才改得了停用；精靈寫檔一律兩格縮排 JSON（原有行為）。
- 2026-09-28：Safari／Firefox 未測；「不要了」的配圖需求被 Agent 再提會復活（未裁定）；可考慮加 CI 後開「測試通過才能合併」。
  （同一行的「帶連結的圖片走 wp:html」「D-016 條款未查證」見上一節。）
