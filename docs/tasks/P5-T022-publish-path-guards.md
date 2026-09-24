---
id: P5-T022
phase: 5
status: ready
depends_on: []
specs: [state-machine.md, security.md, wordpress-site.md, core-service.md]
write_paths: ["src/core/", "src/wordpress/", "tests/", "docs/specs/state-machine.md", "docs/specs/wordpress-site.md", "docs/specs/core-service.md", "docs/tasks/P5-T022-publish-path-guards.md", "docs/CURRENT_TASK.md"]
contract_change: none
expected_commit: "fix(P5-T022): 發布路徑補上核准與草稿狀態的防護"
---

# 發布路徑補上核准與草稿狀態的防護

## 目標
D-023。審查 #3、#2、#1、#13。

## 範圍
### 包含
- #3：換圖／上傳等待回來後，寫入本機媒體紀錄前重新確認工作仍可修改；不可修改就不寫，並回報清楚的錯誤。
  另外：同一工作在換圖或上傳進行中時拒絕發布（比照現有 publishing 旗子的做法）。
- #2：`setStatus(publish)` 前再確認建立發布時的那張核准仍有效；無效就停在草稿並記事件。
- #1：更新既有文章（`fixedObjectId` 路徑）時，使用者選草稿就固定送 `status: draft`；
  遠端已公開而使用者選草稿時，直接拒絕並說明（不能用「更新」把公開文章變草稿或改公開內容）。
- #13：更新既有文章時封面固定送 `featured_media`（沒有就 0）、分類送完整陣列（空的送 `[]`）。
### 不包含
- 開放「修改已發布文章」（Q-5 未裁定）。

## 實作要求
- 測試一律用假 WordPress，絕不連真站。
- #1 的「遠端已公開 → 拒絕」與 #1 的「送 status:draft」擇一或兩者都做，依規格；若與 state-machine.md 前置檢查衝突，停下回報。

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
