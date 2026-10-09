# 本機 AI WordPress 發布台：產品計畫

> 本檔擁有：產品目標、範圍邊界、階段地圖、**決策記錄**、待裁定事項。
> 技術定義一律在 `docs/specs/`；決策理由長的在 `docs/adr/`。
> 原始實作計畫已封存在 `docs/archive/IMPLEMENTATION_PLAN.md`，**不是現行需求**；
> 程式註解裡的「計畫 §N」指的是那份封存檔的章節。

## 目標

只在使用者本機執行的 WordPress 發布台。使用者貼上文章，讓已訂閱並登入的
Codex／Claude Code／Antigravity 校稿、建議配圖，自己逐項決定、預覽、核准，
最後透過 WordPress REST API 發布到使用者自己的站（作者本人是 www.remusplus.com，D-016）。不需要任何 AI API Key。

**定位：本機 AI 當編輯，使用者當總編。** Agent 進不了 WordPress 是賣點不是限制——
市面上的 AI 外掛都在講「裝上去、給權限、它幫你寫」，這個專案是反過來的。
寫對外文案時不要為了好聽把這點丟掉。

**設計準則：任何會讓使用者離開發布台的功能都算 bug。**

## 範圍

### 包含

- 僅監聽 `127.0.0.1` 的本機發布台，單一使用者、一次連一個站台；任何 WordPress 站都能連（D-016）。
- 首次設定精靈：連線診斷、偵測 Agent、選發布目的地（D-016）。
- 內容類型：通用的文章／頁面（`article`，發到任何站的 `post`／`page`，D-016）；作者站台另有
  長文（`read-think`）、日記（`diary`）。對應見 `docs/specs/templates.md`。
- 偵測並使用本機 Codex、Claude Code、Antigravity（`agy`）CLI。
- 校稿以提案呈現，逐項接受／略過；observations 列出需要人判斷的疑點。
- 配圖需求（Agent 產生 brief 與 prompt）、圖片上傳、精選圖片。
- 本機校樣預覽、左右對照、人工核准、發布成 WordPress 草稿或公開。
- MCP Server，讓外部 Agent 走同一個 CoreService（階段 6）。
- AI 查證：Agent 不能在使用者機器上連外，抓網頁由我們的程式做；只有「找來源」那一趟可開廠商伺服器上的搜尋（階段 6，D-034，見 ADR-0001）。

### 不包含

- 首頁（D-001）。
- 修改 WordPress PHP、Theme 或 Plugin 原始碼。
- 擷取任何網頁 Cookie 或登入憑證；把訂閱憑證轉成自製 API Token。
- 未經人工核准的發布。
- 多人、雲端或公開網路服務。
- 修改已發布文章（目前沒有這條路，待裁定 Q-5）。

## 階段地圖

| 階段 | 內容 | 狀態 |
| --- | --- | --- |
| 1 | 安全本機骨架 | ✅ |
| 2 | 模板 registry 與決定性渲染器 | ✅ |
| 3 | 訂閱式 Agent 適配器 | ✅ 三家實測端到端通過 |
| 4 | WordPress REST 與媒體流程 | ✅ 正式站實測建立過兩篇草稿 |
| 5 | 發布台端到端 UI | ✅ |
| 5.5 | 提案制、待處理清單、左右對照、一鍵動作、配圖需求 | ✅ 使用者 2026-09-23 實測並發布（P5-T001） |
| 5（續） | UI 改版為 B 版（D-013）✅、前後端共用契約（D-015）✅、拆分 CoreService（P5-T004）✅、大檔拆分（D-040）✅ | ✅ |
| 6 | AI 查證、MCP Server | 🔶 查證規格定稿（P6-T001），實作 P6-T002～P6-T005 待做；MCP 未開始 |
| 7 | 測試、文件與交付 | ⬜ |
| 8 | 開源產品化：通用內容類型、站台設定檔、設定精靈（D-016）、資料目錄（D-035） | 🔶 P8-T001 ✅、P8-T002 ✅（精靈真站實跑待確認）、P8-T003 ✅ |

目前在做什麼：見 `docs/CURRENT_TASK.md`。

## 決策記錄

格式：`D-編號 日期 裁定者｜一句話結論（含關鍵限制）｜→ 執行的 Task／ADR／spec`，一條一行。
理由寫在被連到的 Task「目標」或 ADR；這裡只留結論與「不做 X」的限制（Task 沒寫理由的才附一句短理由）。
裁定者「Remus」＝使用者明確同意；「Claude 提案」＝實作時由 Claude 決定、使用者沒另行裁定，可以被推翻（後面註明何時追認）。
2026-09-23 之前沒有 Task 制度，執行欄寫階段；寫「原則」的不對應單一實作。

- **D-001** 2026-08-27 Remus｜首頁移出 MVP（首頁由主題 PHP 產生，不改 PHP 改不到）｜→ [ADR-0003](docs/adr/0003-homepage-out-of-mvp.md)、階段 2
- **D-002** 2026-08-27 Claude 提案（09-23 Remus 追認）｜模板只送正文；外框由 Elementor 產生，`template.html` 只給本機預覽｜→ [ADR-0004](docs/adr/0004-body-slot-only.md)、階段 2
- **D-003** 2026-08-27 Claude 提案（09-23 Remus 追認）｜Google Agent 用 `agy` 不用 `gemini`（`gemini` 沒有 JSON Schema 強制輸出）｜→ `docs/specs/agent-cli.md`、階段 3
- **D-004** 2026-08-28 Remus｜不自動建立分類項目，對不上的名稱原樣回報由使用者決定（Agent 愛生近義詞，久了分類變垃圾場）｜→ 階段 4-3
- **D-005** 2026-08-28 Claude 提案（09-23 Remus 追認）｜發布格式用 Gutenberg 區塊；正確性以「跟正式站既有文章逐字相同」為準（站上 115 篇 100% 是區塊）｜→ 階段 4-1
- **D-006** 2026-08-28 Remus｜日記的圖片能力做滿：現況 100 篇只有 3 張圖，但使用者打算常配圖——照想要的做法做，不照現況｜原則
- **D-007** 2026-08-28 Claude 提案（09-23 Remus 追認）｜校稿存成提案，不直接產生版本｜→ [ADR-0002](docs/adr/0002-review-as-proposal.md)、階段 5.5
- **D-008** 2026-08-28 Remus｜任何讓使用者離開發布台的功能都算 bug（源自使用者對查證流程的抱怨，適用所有功能）｜原則
- **D-009** 2026-08-28 Remus 同意｜Agent 不握連外能力：查證由我們的程式代抓，Agent 只讀｜→ [ADR-0001](docs/adr/0001-agent-no-network.md)、階段 6　**已被 D-034 修訂**（改為「不能在使用者機器上連外」）
- **D-010** 2026-08-28 Remus｜高頻動作做成一鍵（校稿面板：一鍵校驗、只找錯字、一鍵配圖）；慢可以、不確定不行：要計時器與說明，不畫假的百分比進度條｜→ 階段 5.5
- **D-011** 2026-08-28 Remus｜定位：本機 AI 當編輯，使用者當總編｜→ 本檔「目標」
- **D-012** 2026-08-27 Remus｜版面：左狀態軌＋大校樣＋右操作面板｜**已被 D-013 取代**
- **D-013** 2026-09-23 Remus｜UI 採 B 版「文件式」：文章在中間、建議標在字上、右側卡片對應、發布面板從右側滑出並顯示「發到哪裡」，另有 B0 稿件總覽；首頁不出現在畫面上｜→ [P5-T003](docs/tasks/P5-T003-ui-redesign-b.md)、[設計稿](https://claude.ai/artifact/1D5TrmCQESR3icmD6TVnC6)
- **D-014** 2026-09-23 Remus｜採冷啟動治理架構（plan.md／docs/README／specs／adr／tasks／CURRENT_TASK）；多 agent 協作流程與契約 checksum 暫緩（單人單 repo 用不到）｜→ [P0-T001](docs/tasks/P0-T001-governance.md)
- **D-015** 2026-09-23 Remus 同意｜前後端契約改為共用模組，取代手抄的 `src/ui/service/types.ts`，排在 UI 改版之前｜→ [P5-T002](docs/tasks/P5-T002-shared-contract.md)
- **D-016** 2026-09-23 Remus｜產品化為開源自架工具，別人自己架、自己修，不提供支援；任何 WordPress 站、一次連一個；站台設定抽成本機設定檔（remusplus 是第一份）＋首次設定精靈。第一版不做 API Key（賣點是用既有訂閱）、不支援 CPT；各家 CLI 條款是否允許第三方呼叫未查證，公開前要查｜→ [P8-T001](docs/tasks/P8-T001-site-profile.md)、[P8-T002](docs/tasks/P8-T002-setup-wizard.md)、`docs/specs/wordpress-site.md`
- **D-017** 2026-09-23 Remus｜用 Codex 訂閱生圖，不接生圖 API：生完先給使用者看，按「用這張」才上傳（會進媒體庫）；封面上傳後自動設精選（手動上傳也是）；只有 Codex 提供這顆按鈕｜→ [P5-T013](docs/tasks/P5-T013-codex-image-generation.md)
- **D-018** 2026-09-23 Remus｜拿掉「編輯／對照／成品」三段切換（修正 D-013；可在文章上直接改後「編輯」這名字也誤導）：預設是帶標記的文章，「對照」改成工具列切換，乾淨成品只在打開發布面板時出現（核准前一定看過成品，不變）｜→ [P5-T014](docs/tasks/P5-T014-remove-view-switch.md)
- **D-019** 2026-09-23 Remus｜對照改成 git diff 式單欄：只列有改的段落、先一行講結論（含標題、網址、封面、分類等正文以外的改動）；跟 AI 提案對照共用同一個畫面｜→ [P5-T015](docs/tasks/P5-T015-unified-diff.md)
- **D-020** 2026-09-23 Remus｜段落之間直接「在這裡插圖」；AI 內文圖用錨點（引用原文，不用段落編號——內容一改就位移）自動放位置，找不到就明講；右欄下拉保留當調整位置用｜→ [P5-T016](docs/tasks/P5-T016-insert-image-in-article.md)
- **D-021** 2026-09-24 Remus｜AI 校稿與一鍵配圖的 prompt 只給目前的內容，不送過期原稿（sourceText）；要改成的字已在文章裡的建議自動標「已經改好了」；真的找不到要講找不到哪一句｜→ [P5-T017](docs/tasks/P5-T017-review-current-content.md)
- **D-022** 2026-09-24 Remus｜插圖面板可以「請 AI 配一張」：Codex 讀該位置前後段落，一趟就決定畫面並生圖（不先另跑配圖建議，省一次額度）；按「用這張」才上傳並放在那個位置；沒有 Codex 就停用並說明｜→ [P5-T018](docs/tasks/P5-T018-ai-image-at-position.md)
- **D-023** 2026-09-24 Remus｜修掉 Codex 全 repo 審查的 16 條（全部查證屬實），依「使用者碰不碰得到」分五個 Task 依序做；正文或指示裡有已知 WordPress 密碼一律**直接拒絕並提示**，不只遮 prompt（只遮的話仍會進預覽並發布）｜→ [P5-T019](docs/tasks/P5-T019-proposal-and-image-data-loss.md)～[P5-T023](docs/tasks/P5-T023-security-hardening.md)、[審查報告](docs/reviews/2026-09-24-codex-repo-audit.md)
- **D-024** 2026-09-24 Remus｜發布時指定作者：每個站一個預設作者，發布面板顯示「作者：某某」、可改這一篇（常做的事一鍵，D-010）；帳號只是 Author 時在面板先講做不到，不等發布才失敗｜→ [P5-T024](docs/tasks/P5-T024-choose-author.md)
- **D-025** 2026-09-27 Remus｜配圖 prompt 可以在卡片上直接改、按「存」，之後生圖一律用改過的版本；已生好的候選圖留著；後端照原規則再驗（長度上限、含 WordPress 密碼直接拒絕）｜→ [P5-T025](docs/tasks/P5-T025-edit-image-prompt.md)
- **D-026** 2026-09-27 Remus｜「建議網址」：本機 Agent 讀標題＋內文開頭給 3 個英文網址，知道官方英文名就用；點了才填、可再改，不自動填（AI 可能認錯作品）；不用拼音（又長又難讀）；日記不用（網址是日期）；短的 Agent 呼叫也要計時器（D-010）｜→ [P5-T026](docs/tasks/P5-T026-suggest-slug.md)
- **D-027** 2026-09-27 Remus｜使用者在卡片上改過的配圖描述，之後任何一趟 Agent（含「校驗」）都不覆蓋｜→ [P5-T027](docs/tasks/P5-T027-keep-edited-brief.md)
- **D-028** 2026-09-28 Remus｜在文章上改時可加格式，只限模板 allowlist（連結、粗體、斜體、H2、H3、清單、引用、分隔線）；自己做、不引入編輯器套件；貼上保留 allowlist 內格式，`b`／`i` 轉 `strong`／`em` 不默默丟；存檔時沒改的頂層區塊原樣保留；相對連結只收 `#` 錨點與單一 `/` 站內路徑；後端照原規則再驗｜→ [P5-T028](docs/tasks/P5-T028-rich-edit-toolbar.md)、`docs/specs/security.md`
- **D-029** 2026-09-28 Remus｜開源名稱 Galley、repo `wp-galley`（MIT）：名稱不含 WordPress（商標，說明文字用「for WordPress」）也不含 AI 廠商名；commit 信箱用 GitHub noreply；新功能一律開 PR｜無 Task
  （Galley＝校樣，對上「AI 當編輯、你當總編」；npm 的 galley／copydesk／masthead 已被佔。[repo](https://github.com/x52640/wp-galley)）
- **D-030** 2026-09-28 Remus｜新稿件只問類型與標題，「建立並打開」直接進文章打字模式（內文可以是空的）；拖放檔案、總覽 ⌘V 貼上建稿保留；打字模式裡標題可直接改、跟內文一起存｜→ [P5-T029](docs/tasks/P5-T029-write-in-place.md)
- **D-031** 2026-09-30 Remus｜已取消的稿件可以「恢復這篇」：回到取消前的狀態（`APPROVED` 回 `RENDERED`，核准不復活；記不到的回 `SOURCE`），恢復同一篇、WordPress 草稿連結照舊；不做「複製成新稿」（會跟已送出的草稿斷開、多一篇重複草稿）；只有本機 UI，MCP 不開；`FAILED`／`SUPERSEDED` 不在範圍｜→ [P5-T030](docs/tasks/P5-T030-restore-cancelled.md)
- **D-032** 2026-09-30 Remus｜設定精靈可以**停用**文章類型（隱藏、不刪；原本要手改設定檔，違反 D-008）：停用的不出現在新稿件選單，同一畫面隨時可再打開，舊稿件照常編輯發布；不做真刪（舊稿件會失去目標，read-think／diary 這類手寫的 target 精靈加不回來）｜→ [P5-T032](docs/tasks/P5-T032-disable-targets.md)
- **D-033** 2026-10-01 Remus｜健檢後依序瘦身與拆分：文件瘦身＋功能地圖 → 拆 CoreService（含 `api.ts`）→ 拆 fixtures → 拆 styles.css → 抽出 ProofView 編輯邏輯；重構不改行為，各一個 Task、一個 PR；新規矩：前後端都要的規則一律寫成 `src/contract` 純函式，fixtures 只放假資料不重寫規則｜→ [P0-T002](docs/tasks/P0-T002-slim-docs.md)、[P5-T004](docs/tasks/P5-T004-split-core-service.md)、[P5-T033](docs/tasks/P5-T033-split-fixtures.md)～[P5-T035](docs/tasks/P5-T035-proofview-edit-logic.md)
- **D-034** 2026-10-01 Remus｜AI 查證採「兩趟 Agent＋程式代抓」：第一趟只開廠商伺服器上的搜尋（不給 WebFetch，agy 不開），我們的取回器抓網頁，第二趟無工具只讀；引文由程式逐字核對、對不上降為查不到，結果永不自動套用；修訂 D-009 為「Agent 不能在使用者機器上連外」；額度約校稿兩倍可接受；先做 P5-T036 鎖住現有各趟的工具｜→ [P6-T001](docs/tasks/P6-T001-factcheck.md)、[P5-T036](docs/tasks/P5-T036-lock-agent-tools.md)、[P6-T002](docs/tasks/P6-T002-safe-fetcher.md)～[P6-T005](docs/tasks/P6-T005-factcheck-ui.md)、[ADR-0001](docs/adr/0001-agent-no-network.md)
- **D-035** 2026-10-04 Remus｜使用者資料（`.env`、站台設定、SQLite、稿件、圖片、備份）搬到 `~/Library/Application Support/Galley/`（`GALLEY_DATA_DIR` 可覆寫），DB 改存相對路徑；第一次啟動自動複製、舊的不刪；使用體驗不變。Mac App／Homebrew **未裁定**；不做背景常駐、現階段不做外殼 App｜→ [P8-T003](docs/tasks/P8-T003-user-data-dir.md)
- **D-036** 2026-10-04 Remus｜打字模式選字也能「查證這句」：按下先自動存（只存本機）、留在打字模式再查；查證**不再鎖內容**（修訂 D-034 的執行規則；查證本來就不改文章），查的期間可以繼續寫、存，完成時不蓋掉正在打的字；不拿沒存的字查（結果要靠存過的內容定位）；一鍵查證與觀察卡片查證不改；其他 Agent 動作照舊鎖｜→ [P6-T006](docs/tasks/P6-T006-check-while-writing.md)
- **D-037** 2026-10-04 Remus｜文章上選一段（10～3000 字，可跨段）浮出「用此段配圖」，與「查證這句」並排、打字模式也有（先自動存）；prompt 只為選取段落配圖、抽象就用比喻、不畫字；圖放在範圍內使用者選的位置；其餘照 D-022；超過上限講太長不截斷；排隊、並行、每個大標題各配一張**未裁定**｜→ [P5-T038](docs/tasks/P5-T038-image-from-selection.md)
- **D-038** 2026-10-04 Remus｜發布面板顯示「網址」：空的講後果（WordPress 會用標題產生，中文變一長串編碼）並當場給「建議網址」（點了才填，D-026 不變），不擋發布；日記只顯示不建議；建議網址 UI 兩處共用一個元件；改網址若讓核准失效要先講、不默默失效｜→ [P5-T039](docs/tasks/P5-T039-slug-in-publish.md)
- **D-039** 2026-10-04 Remus｜修完 Codex 的問題再跑 Codex 審查（輪數**已被 D-041 修訂**）；已合併的 #23～#25 補審：#23 五條 → P8-T004，#24、#25 的跨稿件串畫面併入 P5-T038、其餘 → P5-T040；兩個分頁同改一篇網址的競態不修（單人本機、後端只發核准過的版本）｜→ [P8-T004](docs/tasks/P8-T004-data-dir-hardening.md)、[P5-T040](docs/tasks/P5-T040-review-followups.md)
- **D-040** 2026-10-05 Remus｜大檔模組化，重構不改行為、一個 Task 一個 commit；ProofView 拆三張同一個 PR，MediaPanel、Workspace 各一個 PR，都從 main 開、可並行；改動前後 `?fixtures=1` 截圖逐張比對；`repository.ts`、`rich-text.ts`、`SetupWizard.tsx`、`routes/jobs.ts` 暫不拆｜→ [P5-T041](docs/tasks/P5-T041-proofview-selection.md)～[P5-T045](docs/tasks/P5-T045-split-workspace.md)
- **D-041** 2026-10-05 Remus｜修訂 D-039：每個 PR Codex 審查最多三輪，第三輪的修正直接推、不再審，交接寫明「最後一輪沒經過 Codex」；合併由使用者按，主 session 不 `gh pr merge`｜無 Task
- **D-042** 2026-10-09 Remus｜文件健檢後：修正過期狀態並把決策記錄每條壓到 250 字以內（細節留在 Task）；加 `verify:docs` 併進 `npm run verify` 擋住「CURRENT_TASK、Task 狀態、決策長度」對不上；只改文件的照舊不單獨開 PR，跟下一個 Task 一起進｜→ [P0-T003](docs/tasks/P0-T003-doc-health-fixes.md)、[P0-T004](docs/tasks/P0-T004-verify-docs.md)
- **D-043** 2026-10-09 Remus｜連結可選「在新分頁開啟」：連結編輯框加勾選、預設不勾（照舊原視窗），勾了輸出 `target="_blank" rel="noreferrer noopener"`（跟 WordPress 逐字相同），取消就拿掉；後端只收 `_blank`；貼上的連結照舊只留 href。引用框不做新功能（工具列已有「引用」）｜→ [P5-T046](docs/tasks/P5-T046-link-new-tab.md)

## 待裁定

| 編號 | 問題 | 現況 |
| --- | --- | --- |
| Q-1 | 「還有 N 項校稿建議沒處理」要不要擋住發布？ | 規格與後端：只提醒。B2 發布面板照規格只提醒（舊的發布卡片其實會擋，已移除） |
| Q-2 | 處理過的建議變淡留著，還是直接消失？ | B1：收進右欄底部「已處理 N 項」 |
| Q-3 | 預設勾選 `meaningChanged: false` 的改動，還是全部不勾？ | B1：不改意思的錯字收成一張卡片，一鍵全收；其他逐項 |
| Q-4 | 要不要讓 Agent 寫 SVG 再轉 PNG 做「一鍵生圖」？只能做概念圖，做不到照片 | **沒做**（使用者曾誤以為已做好）。管線已在 `src/ui/lib/svg-to-png.ts`，不用金鑰；要做需改三處：output contract 加 svg 欄位、新的 agent task、配圖卡片多一顆按鈕 |
| Q-5 | 要不要補「修改已發布文章」？ | 沒有這條路，只能去後台改 |
| Q-6 | 怎麼真的產生圖片？ | **已裁定 → D-017**（Codex 訂閱生圖，已實測） |
| Q-7 | B 版要不要內建 A 版的「一次看一項」模式？ | Claude 建議，使用者未表態 |
| Q-8 | 日記標題是否固定 `YYYYMMDD` 由發布台自動產生？ | 目前有一鍵填入，未強制 |
