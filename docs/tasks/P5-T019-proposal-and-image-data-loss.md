---
id: P5-T019
phase: 5
status: done
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
- 最後完成：#8、#9 修正＋測試＋spec；審查的三個邊角（圖庫、空容器、認圖規則統一）已修（2026-09-24）
- 已通過驗證：`npm run verify` 綠，53 檔 / 948 測試（基準 52 / 923）
- 下一步：審查後收官（commit、CURRENT_TASK 基準數字）
- Blocker：無

## 完成結果
- #8：`resolveReviewItems` 只在套用前提案**未過期**時才 `rebaseReviewProposal`；過期的維持 stale，
  「全部接受」照樣擋下。未過期時逐項套用後仍可全部接受（原行為不變）。規則寫進 review-proposals.md。
- #9：`html-blocks.ts` 新增 `removeImageFromBody`／`replaceImageInBody`，只拿掉 `<img class="wp-image-N">`
  （在 figure 裡就連同最近的 figure），包它的東西空了才一起拿掉；`placeMedia`、`removeMedia`、
  `replaceMedia`、「換一張」（`replaceInBody`）改用它們。混合段落換圖時新圖接在那段後面。規則寫進 core-service.md。
- 測試：`tests/review-proposal.test.ts`（手改→逐項套用→全部接受被擋）、`tests/image-inline-text.test.ts`（新檔，
  移動／移除／換圖＋helper 單元測試）、`tests/image-anchor.test.ts`（換一張的混合段落）。先確認紅再修。
- 審查追加：最近的 figure 是圖庫（`wp-block-gallery` 或含多張 img）時只拿 img；拿掉圖後變空的 blockquote／ul／ol／li
  等容器一起拿掉；新增 `containsImage`／`findImageBlockIndex`，「換一張」找舊圖、`toMedia` 的 placed、
  發布前擋別站圖都改用它（不再被正文文字「wp-image-N」誤中）；「換一張」替換 0 張改為丟錯（autoPlace 回 failed）。
  補測試：圖庫、引用、清單、共用判斷、同一張圖在兩塊時的搬家位置、文字誤中不算換一張、替換 0 張丟錯。
- 沒改：`src/ui/service/fixtures.ts`（`?fixtures=1` 假資料）仍整塊刪；`docs/specs/agent-tasks.md` 「換一張」那列
  沒補混合段落的細節——兩者都不在 write_paths。
