---
id: P5-T015
phase: 5
status: in_progress
depends_on: [P5-T014]
specs: [review-proposals.md, http-api.md, core-service.md, design-system.md]
write_paths: ["src/core/", "src/contract/api.ts", "src/server/routes/", "src/ui/", "tests/", "docs/specs/", "docs/tasks/", "docs/CURRENT_TASK.md"]
contract_change: additive
expected_commit: "feat(P5-T015): 對照改成 git diff 式"
---

# 對照改成 git diff 式

## 目標
D-019。實測（使用者 2026-09-23）：「對照上一版」沒辦法馬上知道改了什麼。左右兩欄把全文列兩次；
使用者那篇 r12 → r13 只換了封面，畫面卻只寫「兩邊一模一樣」。

## 範圍
### 包含
- CompareView 改成**單欄**：
  - 只列有改動的段落（replaced／inserted／deleted，以及文字相同但標記改了、有 `note` 的列），
    每列標「第 N 段」與種類（改寫／新增／刪除）
  - 連續沒變的段落收成一行「⋯ 第 a–b 段沒變（n 段）⋯」，點了展開、再點收起
  - 段內改動用既有的逐詞差異（`DiffSegment`）直接標在句子裡：刪除紅色刪除線、新增綠色；
    整段新增／刪除整段標色
- 最上面一行摘要：正文改了幾段、新增幾段、刪掉幾段；**正文以外的改動**也列出來（標題、網址片段、
  精選圖片、分類／標籤等 templateData 欄位與 featuredMediaId）。正文沒變時直接講「正文沒變，只換了 …」
- 後端：`Comparison` 新增正文以外的欄位差異（additive），跟上一版比、跟 AI 提案比都要有；
  欄位的中文名稱與值的顯示方式由後端或共用契約決定一處就好（例如精選圖片顯示檔名／alt，不顯示 id）
- 跟 AI 提案對照用同一個畫面；右欄點卡片仍會捲到並框出那一段（沒變的段落被收起來時要自動展開那一段）
- 示範資料（`?fixtures=1`）同樣可用，而且要有「只換封面」「改字＋新增段落」兩種例子

### 不包含
- 選擇任意兩個版本比對
- 逐項套用、提案資料結構

## 實作要求
- 比對一律在後端算（review-proposals.md「中文 diff」一節）；前端只負責收合與呈現
- 測試絕不呼叫真實 CLI、絕不連真實 WordPress
- 更新 review-proposals.md（「左右對照的粒度」等段落）、http-api.md、core-service.md、design-system.md

## 驗證
`npm run verify`；`node scripts/ui-drive.mjs` 走示範資料兩種例子，並用真實後端（唯讀）看使用者那篇 r12→r13

## 完成定義
- [ ] `npm run verify` 綠
- [ ] 無頭 Chrome：只換封面的版本摘要寫得出來；改字的版本只列有改的段落、收合可展開、點卡片會展開並框出
- [ ] 相關 spec 已更新
- [ ] CURRENT_TASK 已更新

## 中斷／接手紀錄
- 最後完成：開 Task
- 已通過驗證：—
- 下一步：交給 subagent
- Blocker：無

## 完成結果
