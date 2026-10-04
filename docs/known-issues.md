# 已知問題

> 記錄、不擋進度的殘餘。修掉的劃掉或刪掉；要修就開 Task。從 `docs/CURRENT_TASK.md` 搬來（P0-T002）。

## 已知殘餘（記錄，不擋進度）


- 發布面板與「標題與網址」改網址都沒有前端格式檢查（P5-T039 沿用抽屜現況）：打了大寫、空格、中文要等存的時候後端用模板 schema 擋，
  錯誤文案是後端的驗證訊息，不是白話。AI 建議的候選一定合格（`contract/slug.ts`）。
- 存網址進行中，發布面板的關閉鈕、點遮罩、工作區換畫面仍然關得掉面板（只有 Escape 被擋；要擋這些得改 `Sheet.tsx`／`Workspace.tsx`，不在 P5-T039 範圍）。不影響安全：「還在存」記在模組層級，重開的面板照樣擋發布，存完才放開（PR #25 Codex 審查 P2）。存的期間面板關著時，存失敗的錯誤訊息沒有地方顯示（網址就是沒存上，重開看得到）。
- 發布面板網址框有沒存的改動或正在存時，Escape 在 window 捕獲階段被網址列先攔下（P5-T039 審查 #3）：這時面板裡若開著確認框（例如「建立分類項目」），第一次 Escape 只還原網址、要再按一次才關確認框。

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

- P6-T004 查證流程（2026-10-01）：~~查證中換圖已改成上傳前就拒絕、換圖中也不能開始查證（兩者互斥）~~（P6-T006 查證不鎖內容，兩邊都放行）；換圖上傳失敗時核准已在上傳前撤銷、不會還原（原本就刻意如此，防止上傳途中重新核准發出舊圖）；
  網頁來源標題用 AI 給的標題或網域（取回器不回 `<title>`，維基才是真條目名）；按停止時正在抽文字的 worker 不中止（最多 10 秒，結果丟掉）；
  查證跑的期間取消稿件，查證不會停、跑完照存結果（不出錯，但用掉額度）。

- P8-T003 資料目錄（2026-10-04）：
  畫面文案還寫舊位置（`SetupWizard` 的「存在這台電腦的 config/publish-targets.json」「備份到 backups/」、`TaxonomyPanel`、`Workspace` 提到
  `config/publish-targets.json`；`?fixtures=1` 的備份路徑是相對的），本 Task 不改 UI，下次碰到這些元件時一起改成「資料目錄的 publish-targets.json」；
  精靈回應的備份路徑改成完整路徑後，`SetupFiles.rootDir`／`writeSiteConfig` 的 `rootDir` 已經用不到，但 `src/server/routes/setup.ts` 還在傳（不在 write_paths），留著沒拿掉；
  搬家時如果新資料目錄還沒有 DB、卻已經有使用者手放的 `.env`（手動設定完才第一次啟動、而且程式資料夾還有舊資料），會被舊位置的覆蓋（舊位置為準）；
  換了 clone 的位置（重 clone 到別的資料夾）再啟動，新程式資料夾沒有舊資料、就當全新安裝，舊 clone 裡的資料不會自動找到。
  **不要**把 `GALLEY_DATA_DIR` 指到舊 clone（舊佈局的站台設定檔在 `config/publish-targets.json`，資料目錄要的是 `publish-targets.json`，會讓精靈重跑）。
  要接回舊資料：關掉發布台、把資料目錄整個移走（或改名），把舊 clone 的 `data/`、`drafts/`、`generated-images/`、`backups/`、`.env`、`config/publish-targets.json`
  複製進**新** clone 的同一位置，啟動一次就照正常流程搬進資料目錄。注意這時 migration 010 拿到的是新 clone 的根目錄，DB 裡舊 clone 的絕對路徑
  **一筆都不會轉**（010 照樣記成已套用）；讀取時的容錯（取最後一個 `/drafts/`／`/generated-images/` 段、資料目錄裡有那個檔才用）讓圖與工作目錄照樣找得到，
  所以舊 clone 之後可以刪。DB 裡那些路徑會一直是舊 clone 的絕對路徑（不影響使用；要轉成相對得另寫一次性的修正）；
  git worktree（`.git` 是檔案）沒設 `GALLEY_DATA_DIR` 時預設用 `<worktree>/.galley-data`（已進 `.gitignore`），跟主 checkout 的資料完全分開，worktree 裡看不到真的稿件；
  ~~搬家的鎖檔 pid 不在就自動接手~~（P8-T004 改成鎖檔存在就停止、請使用者確認後手動刪）；
  Agent 工作目錄只限制在 `drafts/` 底下，沒限制一定是 `drafts/<自己的 uuid>`（DB 被手改成別篇的資料夾仍會用）；
  `resolveDataDir()` 用 `VITEST` 環境變數判斷測試行程（正式程式碼裡有一段只為測試的分支，換測試框架要跟著改）；
  搬家時開舊 DB 做 `VACUUM INTO`，關閉時 SQLite 可能把舊位置的 WAL 併回主檔（內容不變，但舊檔的修改時間會變）。

- P8-T004 資料目錄補審修正（2026-10-04）：
  搬家中途當掉留下的鎖檔不再自動清，下次啟動會停下來，要使用者照訊息確認沒有別的發布台在跑、手動刪鎖；
  標記檔沒有 `databaseCreated` 欄位的**全新**安裝（P8-T004 之前建的、`migratedFrom: null`），如果在升級後第一次啟動前資料庫就已經不見，分不出是全新還是遺失，照全新處理（建空的）；
  標記檔壞掉（不是合法 JSON）時當成有過資料庫：資料庫不在就停止啟動，要照訊息處理；
  工作目錄與媒體檔的實體路徑是在使用前檢查的，檢查完到真正使用之間被換成符號連結的情況不擋（本機單人工具，能這樣改檔的人本來就能直接讀資料目錄）；
  媒體路徑在 `generated-images/` 裡但檔案不存在時，候選圖照舊回 404「檔案不見了」；路徑不在 `generated-images/` 裡則回 400（訊息同樣是「檔案不見了」）；
  DB 裡的媒體路徑若是別處的舊絕對路徑（P8-T003 之前存的、不在資料目錄、也對應不到 `generated-images/` 裡的檔），現在一律當成不見了，不再照原路徑讀刪；
  `generated-images/` 裡指到外面的符號連結，刪媒體時不刪（連結檔留著，不影響使用）。

## 收官紀錄裡的殘餘（原在 CURRENT_TASK「上次停在哪」「更早」）

- P5-T030：取消時沒停掉跑到一半的 Agent，恢復後結果仍會收下（有 content hash 保護，接受）。
- P5-T032：畫面要連得上 WordPress 才改得了停用；精靈寫檔一律兩格縮排 JSON（原有行為）。
- 2026-09-28：Safari／Firefox 未測；「不要了」的配圖需求被 Agent 再提會復活（未裁定）；可考慮加 CI 後開「測試通過才能合併」。
  （同一行的「帶連結的圖片走 wp:html」「D-016 條款未查證」見上一節。）

- P6-T006 改字時查證（2026-10-04）：
  打字中查證跑完，右欄卡片會更新，但字上的新虛線標記、自動捲到那張卡片要等離開打字模式（存檔或取消、校樣重載）才出現（刻意：不碰正在打的字）；
  打字中按「查證這句」存的那一版，畫面上維持使用者打的樣子、不換成後端整理過的樣子，離開打字模式才重載（整理只差在格式時看不出差別）；
  送去查的是畫面上選的純文字，萬一後端整理後字不一樣（少見），會照既有規則回「選的字在目前的文章裡找不到」；
  審查 3 的「照樣存之後換成整理後的樣子」：等存檔回應期間又打了字就不換，下次存會再問一次「照樣存」；
  游標照非空白字數放回去，整理若刪掉字（少見）會偏移、超出時放最後一段結尾；
  Codex P1 修法（hold 認這次打字中自己存的每一版、存檔基準用最後一次存成功的 hash）：自動存之後的重讀一直失敗時，右欄與版本號停在舊的，
  離開打字模式才靠重載校樣與下一次成功的重讀對上；在標題上選字、正文其實是空的，膠囊照樣能按（P2），按下會先存、再由後端回「正文是空的」；
  「打字模式不重載」與「先存再查」的前端行為只有純函式測試（`tests/check-while-writing.test.ts`）＋`?fixtures=1` 截圖，沒有 DOM 層的自動測試（專案的 Vitest 是 node 環境）。

