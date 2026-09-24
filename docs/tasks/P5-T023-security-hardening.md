---
id: P5-T023
phase: 5
status: done
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
- [x] `npm run verify` 綠
- [x] 擁有這些行為的 spec 已更新
- [x] CURRENT_TASK 已更新

## 中斷／接手紀錄
- 最後完成：六條＋審查四點（編碼路徑繞過、log 非字串參數、舊內容在核准／發布／上傳前擋、重新偵測清模型快取），未 commit
- 已通過驗證：`npm run verify` 綠，58 檔 / 1030 測試（2026-09-24）
- 下一步：無（審查一輪，四條已修，已 commit）
- Blocker：無

## 完成結果
- #6：`src/server/logger.ts` 加 pino `hooks.logMethod`，字串參數過遮蔽器（物件仍交 `formatters.log`，避免把 req／err 拆壞）。
- #7：`src/server/app.ts` 在 root 掛 `onSend`，字串 payload（JSON、校樣 HTML）一律過遮蔽器；Buffer／stream 不動。
- #10：`src/server/plugins/local-only.ts` 對 `/api` 所有方法擋 `Sec-Fetch-Site: cross-site／same-site`；
  `src/agents/registry.ts` 的 `listModels` 加 30 秒快取（存 promise，同時的請求共用一趟；失敗的空清單也快取）。
  UI 全用相對路徑 `/api/...`、Vite proxy 同源、校樣 iframe 同源載入且 CSP 不載 http 圖片 → 都是 same-origin，不受影響。
- #4：`isLoopbackHostname` 移到 `src/config/env.ts`（`src/wordpress/setup.ts` 轉出，既有 import 不變）；
  `normalizeWordPressUrl` 對 http 非 loopback 丟 `ConfigError`。
- #5：`src/config/secrets.ts` 加 `containsSecret`（用同一個遮蔽器判斷，另比去掉空白的樣子）；遮蔽器本身也改成
  認得「去掉空白」的樣子。`CoreService.assertNoAppPassword` 一處檢查，呼叫點見 security.md。
  錯誤碼沿用 `INVALID_INPUT`（400），契約沒有新欄位。
- #16：`tests/state-machine.test.ts` 把 state-machine.md 的表抄成 `SPEC_TRANSITIONS`，斷言 `TRANSITIONS` 完全相等，
  合法／非法清單都由它產生（手動在實作表加 `RENDERED → PUBLISHED` 確認會紅，已還原）。
- 測試：新增 `tests/security-hardening.test.ts`、`tests/password-in-content.test.ts`；改 `tests/local-only.test.ts`
  （原「GET 帶 cross-site 不受影響」改成擋）、`tests/state-machine.test.ts`；`tests/helpers/fake-adapter.ts` 加
  `listModelsCount`、`tests/helpers/core-fixture.ts` 可注入 `scrub`。
- 審查修正（2026-09-24）：
  1. `/%61pi/...` 能繞過 #10（守門用原始網址比對）→ `isApiRequest`：看匹配到的路由路徑，404 看解碼後的路徑，解碼失敗當 `/api`。
  2. log 的 `%j`／`%o`／`%s` 物件與 Error、當第一個參數的 Error 也遮（第一個參數是一般物件時仍交給 formatters.log）。
  3. 舊內容：`approve` 丟 `InvalidInputError`、發布前置檢查 4a 丟 `PublishBlockedError`（同一句、零請求）；
     上傳／換圖／用這張在送到 WordPress 之前先檢查目前這一版。
  4. `detect(..., { refresh: true })`（`POST /api/setup/agents` 用的）一起清掉該 Agent 的模型快取。
- 殘餘：校樣的 `ETag` 是 content hash，回應被遮蔽時本體與 hash 不再對應（#5 之後內容進不了密碼，只剩設定前的舊內容會這樣）。
  dev server 重載 `src/config/env.ts` 後會用真實 `.env` 重啟；若 `WORDPRESS_URL` 是 http 非 loopback 會啟動失敗（預期）。
