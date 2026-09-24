---
id: P5-T022
phase: 5
status: done
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
- [x] `npm run verify` 綠
- [x] 擁有這些行為的 spec 已更新
- [x] CURRENT_TASK 已更新

## 中斷／接手紀錄
- 最後完成：審查三條已修（beforeWrite、非草稿一律擋、查不到的分類不清空），待再審與 commit
- 已通過驗證：`npm run verify` 綠，56 檔 / 984 測試（2026-09-24）
- 下一步：無（審查一輪，三條已修，已 commit）
- Blocker：無

## 完成結果
- #3：`addMedia`／`replaceMedia` 上傳回來後先重讀 job，不能改就不寫本機、記 failed 事件、講清楚圖在媒體庫第 N 號
  （不去 WordPress 刪）；上傳／換圖進行中（`mediaUploads`）同一篇的 `publish` 拒絕。
- #2：進 PUBLISHING 後每個寫入送出前同步確認那張核准仍有效：建新稿前直接查；`updateDraft`／`setStatus`
  走新的 `beforeWrite` 回呼（它們內部先 GET 再 POST，檢查必須在 GET 之後）。無效 → `FAILED`
  （PUBLISHING 只能到 PUBLISHED／FAILED，見 state-machine.md），訊息依那篇實際狀態寫。
- #1（審查後擴大，2026-09-24 裁定）：更新既有文章時遠端不是草稿，不論選草稿或公開一律前置檢查拒絕、零寫入，
  訊息指向 Q-5；`updateDraft` 固定帶 `status:'draft'`，自己也用剛讀回的遠端狀態再擋一次。
- #13：只有更新路徑固定送 `featured_media`（沒有送 0）；分類清單空的送 `[]`，填了名稱但全部查不到就不送
  （照報 unknownTerms）；建立新稿不變。
- 測試：新增 `tests/publish-path-guards.test.ts`（16 個）、`tests/wordpress-posts.test.ts` 加 3 個，共 +19；
  兩輪都先確認紅再實作。
- 程式：`src/core/service.ts`、`src/wordpress/posts.ts`。Spec：state-machine.md、wordpress-site.md、core-service.md。
