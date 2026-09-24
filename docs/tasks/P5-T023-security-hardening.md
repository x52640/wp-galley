---
id: P5-T023
phase: 5
status: ready
depends_on: []
specs: [security.md, http-api.md, testing.md, state-machine.md]
write_paths: ["src/server/", "src/config/", "src/core/", "src/agents/registry.ts", "src/wordpress/setup.ts", "tests/", "docs/specs/security.md", "docs/specs/http-api.md", "docs/tasks/P5-T023-security-hardening.md", "docs/CURRENT_TASK.md"]
contract_change: additive
expected_commit: "fix(P5-T023): 秘密遮蔽補洞、擋跨站 GET、http 只准 loopback"
---

# 秘密遮蔽補洞、擋跨站 GET、http 只准 loopback

## 目標
D-023。審查 #6、#10、#4、#7、#5、#16。

## 範圍
### 包含
- #6：logger 的字串訊息參數也過遮蔽器（pino `hooks.logMethod` 之類的治本做法）。
- #7：所有 HTTP 回應（含 200）在送出前過遮蔽器，一次涵蓋所有路由。預覽 HTML 也要涵蓋。
- #10：本機守門對 `/api` 請求拒絕 `Sec-Fetch-Site: cross-site`／`same-site`（GET 也擋；確認不影響 UI 自己的請求與預覽）；
  `listModels` 加 30 秒快取。
- #4：啟動設定的 `WORDPRESS_URL` 為 http 且不是 loopback 時啟動失敗，重用精靈的 loopback 判斷。
- #5：正文、校稿指示、任何送給 Agent 的使用者輸入含已知 WordPress 密碼時，在儲存／派工時直接拒絕，
  錯誤訊息告訴使用者「內容裡有你的 WordPress 應用程式密碼，請刪掉」（錯誤訊息本身不得含密碼）。
- #16：狀態機測試把 state-machine.md 的轉移表寫死成常數，斷言實作與它完全相等。
### 不包含
- 其他 GET 的副作用盤點以外的重構。

## 實作要求
- 測試只用合成密碼。不讀 .env。
- #10 若會擋掉 Vite dev（5173 → 3000）的正常請求，停下回報，不要自己放寬。

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
