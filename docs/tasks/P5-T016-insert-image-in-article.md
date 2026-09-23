---
id: P5-T016
phase: 5
status: done
depends_on: [P5-T013]
specs: [agent-tasks.md, review-proposals.md, http-api.md, core-service.md, design-system.md, security.md, testing.md]
write_paths: ["src/agents/", "src/core/", "src/contract/api.ts", "src/server/routes/", "src/db/migrations/", "src/ui/", "tests/", "docs/specs/", "docs/tasks/", "docs/CURRENT_TASK.md"]
contract_change: additive
expected_commit: "feat(P5-T016): 在文章上直接插圖，AI 配圖自動放位置"
---

# 在文章上直接插圖，AI 配圖自動放位置

## 目標
D-020。使用者 2026-09-23：長文想在多個地方插圖。現在只能在右欄每張圖的下拉選「第 N 段之後：前 40 字」，
段落一多很難對；AI 建議的內文圖的位置只是文字說明，「用這張」之後還要自己再選一次。

## 範圍
### 包含
**一、在文章上直接插圖**
- 文章檢視（不是編輯中、不是對照、不是發布面板的成品）段落之間，滑鼠移過去出現「在這裡插圖」（含最前面）。
  做在 iframe 外層（跟頁邊校對符號同一套座標，iframe 不跑 script、不改 DOM）。
- 點了打開小面板：選一張已上傳但還沒放進正文的圖，或直接上傳新圖（上傳會進 WordPress 媒體庫，要講）。
  選定後走既有 `placeMedia`。
- 已放進正文的圖，右欄下拉仍可改位置。

**二、AI 內文配圖自動放位置**
- `ImageBriefDraft`（Agent 輸出契約）新增錨點欄位：引用這張圖要跟在後面的那一段的一小段**原文**
  （封面那張為 null）。strict schema 規則見 agent-cli.md（全部列 required、選填用 nullable）。
  一鍵配圖的 prompt 說明怎麼填。既有的 `placement` 文字保留給人看。
- 存下來（需要的話 migration 006）。「用這張」與手動「上傳這張」上傳成功後：用錨點在**目前**內容定位
  （忽略空白，沿用 `findIgnoringSpaces`／`findBlockContaining`），找到就 `placeMedia` 到那一段之後；
  找不到或有歧義就不放，卡片上明講「找不到建議的位置，請自己放」。
- 封面照舊自動設精選，不放進正文。

### 不包含
- 拖拉調整圖片位置
- 圖片以外的區塊插入

## 實作要求
- 位置一律在後端、對著目前這一版定位；不要存段落編號（內容一改就位移）
- 放進正文會建新版本、讓核准失效，照既有規則；要讓使用者知道
- 測試絕不呼叫真實 CLI、絕不連真實 WordPress（上傳用既有的 mock）
- 更新 agent-tasks.md、review-proposals.md（若動到定位規則）、http-api.md、core-service.md、design-system.md

## 驗證
`npm run verify`；`node scripts/ui-drive.mjs`（示範資料）：段落之間點「在這裡插圖」選一張已上傳的圖 → 出現在那一段後面；
AI 內文配圖卡片「用這張」→ 自動出現在錨點那段後面；錨點找不到 → 卡片提示、沒被亂放。

## 完成定義
- [x] `npm run verify` 綠
- [x] 無頭 Chrome 走完上面三種情況
- [x] 相關 spec 已更新
- [x] CURRENT_TASK 已更新

## 中斷／接手紀錄
- 最後完成：審查修正（AI 跑的時候不自動放／設精選、wp-image 編號邊界、換一張接替舊位置、上傳後例外收成 failed、插圖面板焦點）；未 commit
- 已通過驗證：`npm run verify` 43 檔／675 測試；ui-drive 走完三種情況＋從面板上傳新圖＋核准提醒＋換一張＋面板焦點／Escape
- 下一步：使用者看過後 commit；真實後端的「用這張」自動放位置還沒跑過（會寫進媒體庫）
- Blocker：無

## 完成結果

- **錨點欄位**：`ImageBriefDraft.anchor?: string`（Agent 輸出，選填、`maxLength` 200；Codex strict 自動轉
  required＋nullable、null 先 stripNulls，後端用原始 schema 驗）→ `image_briefs.anchor`（migration 006，
  `ALTER TABLE … ADD COLUMN anchor TEXT`）→ `ImageBrief.anchor: string | null`。一鍵配圖的 `TASK_BRIEF.images`
  講怎麼填（一字不差、10–30 字、挑只出現一次的句子、封面留空、不寫段落編號）。
- **自動放**：`addMediaWithOutcome` 多回 `autoPlace`（`MediaResponse.autoPlace`，新增欄位）。對著目前這一版的
  頂層區塊用 `findBlocksContaining`（新，忽略空白）找：剛好一段 → `placeMedia`；零段／沒錨點 → `not-found`；
  兩段以上 → `ambiguous`；失敗 → `failed`＋事件。封面照舊只設精選。
- **審查修正**：校稿／一鍵配圖正在跑時不自動放、不自動設精選（`agent-running`，否則那一趟的結果會被
  `assertAgentResultStillApplies` 作廢；生圖不算），卡片的「上傳這張／換一張」同時反灰；「換一張」且舊圖在正文裡
  → `replaced`，新圖接替舊位置、舊圖拿出正文留在媒體庫；`afterUpload` 把自動設精選／自動放的任何例外收成
  `failed`，「用這張」不會把已上傳的候選圖放回去；共用 `src/contract/media-marker.ts` 的 `hasWpImageClass`
  取代所有 `includes('wp-image-N')`（51 不再認成 512，搬圖、移除、換圖、toMedia、示範資料都改）；
  插圖面板打開時焦點移進去、關閉回到按鈕。示範資料同步（agent-running、replaced，上傳本身不撕核准）。
- **在這裡插圖**：`ProofView` 外層畫插入點（位置＝量到的區塊座標，上一段底與下一段頂的中間；含最前面與最後面），
  `canInsertImages`（stage-view.ts）決定何時出現。面板 `InsertImagePanel.tsx`：挑已上傳未放、非封面的圖，
  或上傳新圖（明講進 WordPress 媒體庫）後直接 `placeMedia`；上傳成功但放失敗時不會讓人重複上傳。
- **示範資料**：`placeMedia` 真的改正文；`addMedia` 回已上傳狀態（跟後端一致）；配圖需求加錨點，
  `old_notebook` 故意對不上。
- 監工補上：右欄每張圖的寫入動作（插入位置、設為精選、取消精選、換圖、移除）在校稿／一鍵配圖跑的時候鎖住
  （原本就能按，同樣會讓那一趟結果作廢）；生圖那一趟不擋。
