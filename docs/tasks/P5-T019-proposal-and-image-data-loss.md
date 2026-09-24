---
id: P5-T019
phase: 5
status: ready
depends_on: []
specs: [review-proposals.md, core-service.md]
write_paths: ["src/core/", "tests/", "docs/specs/review-proposals.md", "docs/specs/core-service.md", "docs/tasks/P5-T019-proposal-and-image-data-loss.md", "docs/CURRENT_TASK.md"]
contract_change: none
expected_commit: "fix(P5-T019): 過期提案不能整份覆蓋、移動圖片不刪同段文字"
---

# 過期提案不能整份覆蓋、移動圖片不刪同段文字

## 目標
D-023。審查 #8、#9（`docs/reviews/2026-09-24-codex-repo-audit.md`）：兩條都會讓使用者的內容悄悄消失。

## 範圍
### 包含
- #8：逐項套用不得把「已過期」的提案變回未過期。整份採用只能在提案對應的內容沒被別處改過時放行。
- #9：placeMedia、removeMedia、換圖（封面與正文圖）只移除圖片節點（連同包它的 figure）；
  所在區塊還有其他文字或節點時保留剩下的內容。
### 不包含
- 前端 UI 改動（`review.stale` 已經控制按鈕，後端修正後自然正確）。

## 實作要求
- 先寫能重現的失敗測試（#8：手改 → 逐項套用一項 → 整份採用必須被擋；#9：`<p>前文<img class="wp-image-N">後文</p>` 移動／移除／換圖後前後文仍在）。
- 修正後原本正常的逐項套用流程（提案未過期時逐項套用後仍可整份採用與否，照 review-proposals.md 現行規格）不能改變；規格沒寫清楚就停下回報。

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
