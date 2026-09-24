---
id: P5-T021
phase: 5
status: ready
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
- [ ] `npm run verify` 綠
- [ ] 擁有這些行為的 spec 已更新
- [ ] CURRENT_TASK 已更新

## 中斷／接手紀錄
- 最後完成：尚未開始
- 已通過驗證：—
- 下一步：先寫失敗的測試
- Blocker：無

## 完成結果
