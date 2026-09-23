---
id: P5-T016
phase: 5
status: in_progress
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
- [ ] `npm run verify` 綠
- [ ] 無頭 Chrome 走完上面三種情況
- [ ] 相關 spec 已更新
- [ ] CURRENT_TASK 已更新

## 中斷／接手紀錄
- 最後完成：開 Task
- 已通過驗證：—
- 下一步：交給 subagent
- Blocker：無

## 完成結果
