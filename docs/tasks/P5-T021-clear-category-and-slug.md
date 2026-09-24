---
id: P5-T021
phase: 5
status: done
depends_on: []
specs: [templates.md]
write_paths: ["src/ui/components/panels/", "tests/", "docs/tasks/P5-T021-clear-category-and-slug.md", "docs/CURRENT_TASK.md"]
contract_change: none
expected_commit: "fix(P5-T021): 分類與網址片段可以清空"
---

# 分類與網址片段可以清空

## 目標
D-023。審查 #14、#15：UI 允許清空，但存不進去或存了沒效果。

## 範圍
### 包含
- #14：TaxonomyPanel 取消唯一的分類時，從 templateData 刪掉 `category` 鍵，不送空字串。
- #15：SourcePanel 清空網址片段時，從送出的 templateData 刪掉 `slug` 鍵。
### 不包含
- 模板 schema 改動。

## 實作要求
- 兩處都要有測試：清空後儲存成功，重新讀取值確實不見。

## 完成定義
- [x] `npm run verify` 綠
- [x] 擁有這些行為的 spec 已更新（不需改：`templates.md` 本來就寫 slug、category 選填；清空＝拿掉鍵是 UI 組資料的細節）
- [x] CURRENT_TASK 已更新

## 中斷／接手紀錄
- 最後完成：兩處都改完、測試補齊（2026-09-24）
- 已通過驗證：`npm run verify` 綠，55 檔 / 965 測試
- 下一步：無（改動小，主 session 直接審過程式碼後 commit）
- Blocker：無

## 完成結果
- 先確認：`diary-v1`、`article-v1` 的 schema `required` 只有 title、body，category／slug 都選填。
- 新增 `src/ui/components/panels/template-data.ts`：`taxonomyTemplateData`、`sourceTemplateData` 兩個純函式。
  清空單選分類 → 拿掉 `category` 鍵；清空網址片段 → 拿掉 `slug` 鍵（舊值不再從 `...data` 漏回去）。
  長文 tags 照舊送陣列（空陣列合法）。
- `TaxonomyPanel`、`SourcePanel` 改用這兩個函式；`expectedContentHash` 照舊帶。
- 測試 `tests/clear-template-fields.test.ts`（10 個）：純函式斷言沒有該鍵；再走 `CoreService.createRevision`
  （後端同一條渲染＋schema 驗證）確認 diary-v1、article-v1 清空後存得進去、重讀確實沒有該鍵；
  另留一個對照：送空字串 category 會被擋。
- 沒做：元件層（React）互動測試——專案沒有 DOM 測試環境，只測抽出來的組資料邏輯。
