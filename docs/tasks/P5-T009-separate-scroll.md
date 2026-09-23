---
id: P5-T009
phase: 5
status: done
depends_on: []
specs: [design-system.md]
write_paths: ["src/ui/styles.css", "docs/tasks/", "docs/CURRENT_TASK.md"]
contract_change: none
expected_commit: "fix(P5-T009): 文章與建議欄各自捲動，點建議捲到那一段"
---

# 文章與建議欄各自捲動

## 目標
P5-T001 實測：文章和右欄一起捲；點右欄的建議，文章不會捲到那一段，超長文要自己找。

## 範圍
### 包含
- 根因：`#root` 只有 `min-height: 100vh`，整頁跟著文章長高，捲的是整頁；`.proof-scroll`
  與 `.margin` 永遠沒東西可捲，所以 ProofView 已經寫好的 `scrollTo` 沒有效果。
- 工作區畫面把 `#root` 釘在視窗高度；`.desk` 的列高設 `minmax(0, 1fr)`。
### 不包含
- 稿件總覽等其他畫面（照舊整頁捲動）

## 驗證命令
`npm run verify`；`node scripts/ui-drive.mjs`（真實後端、只讀）

## 完成定義
- [x] 整頁不捲（documentElement.scrollHeight = innerHeight）
- [x] 點右欄建議，文章區捲到那一段並畫框

## 中斷／接手紀錄
- 最後完成：全部
- 已通過驗證：npm run verify；無頭 Chrome 在實測稿上點「課程一開始講師…」那張卡，文章區 scrollTop 0 → 1174，框在正確段落
- 下一步：無
- Blocker：無

## 完成結果
純 CSS，兩行。
