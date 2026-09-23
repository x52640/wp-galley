---
id: P5-T001
phase: 5
status: ready
depends_on: []
specs: [review-proposals.md, agent-tasks.md]
write_paths: ["docs/tasks/", "plan.md"]
contract_change: none
expected_commit: "test(P5-T001): 階段 5.5 實測紀錄"
---

# 陪使用者實測階段 5.5

## 目標
5.5 的程式與測試都完成了，但使用者還沒點過畫面。Q-1～Q-3 要實際用過才答得準。

## 範圍
### 包含
- 照下方順序走一遍，記錄每一步的結果
- 把發現的問題開成新 Task；把使用者對 Q-1～Q-3 的回答寫進 plan.md 決策記錄
### 不包含
- 當場修 bug（開 Task，另外修）
- UI 改版（P5-T003）

## 工作區與 Context
### 必讀入口
`docs/specs/review-proposals.md`、`docs/specs/agent-tasks.md`
### 不應載入
其他 spec
### 驗證命令
`npm run dev`；不用後端可開 `?fixtures=1`

## 實作要求
- 測試素材 `drafts/測試素材/測試長文-行為科學課.txt`（1,400 字）裡的錯誤**全部是故意的**：
  錯字、前後矛盾的年份、加起來 105% 的百分比、沒出處的引用與宣稱。不要順手改掉。
- 真實 CLI 會消耗訂閱額度，每一步只跑一次。
- 不得公開任何文章（`docs/specs/security.md`「發布的外部副作用」）。

## 驗證
### 手動驗證
建 job（長文）→ 渲染 → 一鍵校驗 → 看清單有沒有抓到那些坑 → 只勾一個錯字套用（其他要還在）
→ 一鍵配圖（**校稿清單不該消失**）→ 上傳一張圖。

## 完成定義
- [ ] 每一步都有結果紀錄
- [ ] 發現的問題已開成 Task
- [ ] Q-1～Q-3 有裁定或明確延後

## 中斷／接手紀錄
- 最後完成：尚未開始
- 已通過驗證：—
- 下一步：啟動 `npm run dev`，從建 job 開始
- Blocker：需要使用者在場

## 完成結果
