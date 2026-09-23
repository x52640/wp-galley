---
id: P5-T008
phase: 5
status: done
depends_on: []
specs: [review-proposals.md]
write_paths: ["src/contract/", "docs/specs/architecture.md", "src/core/html-blocks.ts", "src/ui/components/ProofView.tsx", "src/ui/lib/", "tests/", "docs/specs/review-proposals.md", "docs/tasks/", "docs/CURRENT_TASK.md"]
contract_change: none
expected_commit: "fix(P5-T008): 定位建議時忽略空白"
---

# 定位建議時忽略空白

## 目標
P5-T001 實測發現：Agent 引用原文時會在中文與數字間自己加空格（寫「佔 40%」，原文是「佔40%」），
定位要求逐字相同，所以 9 個觀察裡 3 個定位不到——右欄沒有「第 N 段」、字上也沒標。

## 範圍
### 包含
- 後端 `findBlockContaining`（算 `blockIndex`）比對時忽略所有空白
- 前端 `ProofView` 的 `wrapFirst`（字上標記）同樣忽略空白，標記範圍對回原文位置
### 不包含
- 逐項**套用**改動的定位規則（改字要精準，照舊逐字比對）
- 全形／半形標點的差異

## 驗證命令
`npm run verify`

## 完成定義
- [x] 「佔 40%」能定位到含「佔40%」的段落，也能在字上標出
- [x] review-proposals.md 已更新
- [x] CURRENT_TASK 已更新

## 中斷／接手紀錄
- 最後完成：全部
- 已通過驗證：npm run verify；實測那篇稿子 9 個觀察全部定位到（修前 3 個定位不到）
- 下一步：無
- Blocker：無

## 完成結果
共用 `findIgnoringSpaces`（`src/contract/text-match.ts`），後端 `findBlockContaining` 與前端 `wrapFirst` 都改用它。
