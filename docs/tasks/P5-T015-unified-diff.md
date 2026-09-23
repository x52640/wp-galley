---
id: P5-T015
phase: 5
status: done
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
- [x] `npm run verify` 綠
- [x] 無頭 Chrome：只換封面的版本摘要寫得出來；改字的版本只列有改的段落、收合可展開、點卡片會展開並框出
- [x] 相關 spec 已更新
- [x] CURRENT_TASK 已更新

## 中斷／接手紀錄
- 最後完成：實作、spec、無頭驗收、真實 r12→r13 唯讀檢查
- 已通過驗證：`npm run verify` 42 檔／642 測試綠
- 下一步：主 agent 審查後 commit（`feat(P5-T015): 對照改成 git diff 式`）
- Blocker：無

## 完成結果

- 契約（additive）：`Comparison.fieldChanges: FieldChange[]`（`field`／`label`／`before`／`after`，值是顯示用字串，
  null＝沒設定）；`CompareRow.segments`（單欄用的完整差異序列）。
- 後端：`src/core/field-diff.ts`（`diffFields`、`describeMediaForDiff`），`getComparison` 兩種比對都帶 `fieldChanges`；
  跟提案比不比精選圖片（提案不動它）。精選圖片顯示「WordPress 網址的檔名（替代文字，24 字截斷）」，
  沒上傳只有替代文字；本機不存原始檔名。跟上一版比不再需要模板。
- 前端：`src/ui/lib/diff-view.ts`（分組、段號、摘要、`runKeyForBlock`）＋重寫的 `CompareView`；
  Workspace 多一個 `focusSeq`，每點一次卡片加一，對照據此展開收起來的那一組並捲過去。
- 示範資料：f-reviewed（跟提案比，改字，第 3–4 段收起，點「八成」觀察卡片會展開並框出第 3 段）、
  f-rendered（跟上一版比，改字＋新增一段＋標籤）、f-torn（只換封面）。
- 真實資料（唯讀）：使用者那篇 r12→r13 顯示「正文沒變，只設了精選圖片」（監工時把「換了」改成依情況「設了／換了／拿掉了」），
  「精選圖片（沒有）→ featured.png（一份表單上只有一個核取方塊…）」，下面一行「第 1–15 段沒變（15 段）」。
- 測試：新增 `tests/field-diff.test.ts`、`tests/diff-view.test.ts`，`word-diff`／`review-proposal` 各加幾條（608 → 637）。
- 審查（subagent）後監工修正（637 → 642）：沒有文字的新增／刪除段落（沒圖說的圖、分隔線）給空的 segments，
  畫面才會說「這一段沒有文字」而不是一個空標記；字串清單（標籤、分類）當集合比，只換順序不算改動。

