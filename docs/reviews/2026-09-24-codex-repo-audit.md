# 2026-09-24 Codex 全 repo 審查（已查證）

Codex `exec -s read-only` 掃整個 repo（commit 51bf293）產出 16 條；主 session 派三個 subagent 以暫時測試
（fake adapter、假 WordPress、記憶體 DB）逐條查證。**16 條全部 CONFIRMED**，沒有一條屬於「刻意接受的限制」。
處理方式見 plan.md D-023。原始報告附在下方，行號以 51bf293 為準。

## 查證後的實際影響與分派

| # | 查證結論（重點修正） | 使用者碰得到？ | Task |
| --- | --- | --- | --- |
| 8 | 逐項套用無條件換提案基準（service.ts:1118）→ 過期提案可整份覆蓋，手改內容消失 | 會 | P5-T019 |
| 9 | placeMedia／removeMedia／換圖都整塊刪含圖的頂層區塊；`<p>文<img>文</p>` 可能來自整份採用 Agent 稿或 contenteditable 合併 | 少見 | P5-T019 |
| 12 | `activeRuns` 只在記憶體，重啟後 DB 留 running；取消查不到直接 return；UI 卡「看稿中」且每 1.5 秒輪詢 | 會（tsx watch 重啟） | P5-T020 |
| 11 | `runStructured` 輪到時不檢查 `cancelledRuns`（生圖有檢查） | 會（兩篇並行） | P5-T020 |
| 14 | 單選分類清空送 `category:''`，schema 要求 minLength 1 → 儲存失敗、訊息籠統 | 會 | P5-T021 |
| 15 | SourcePanel 清空 slug 時舊值留在 `...data` | 會 | P5-T021 |
| 3 | 換圖上傳等待中可核准並發布；回來後 `updateMedia` 仍覆寫本機紀錄，產生孤兒媒體。**發出去的是核准過的舊圖**，問題是本機與線上不一致 | 要手快 | P5-T022 |
| 2 | PUBLISHING 期間撤銷核准不影響後續 `setStatus('publish')`。UI 沒有撤銷按鈕，只有 API | 幾乎不會 | P5-T022 |
| 1 | `updateDraft` 不送 `status:'draft'`；只有手設 `fixedObjectId` 才走到 | 現在不會；Q-5 前必修 | P5-T022 |
| 13 | 更新既有文章時空封面／空分類被省略而非清除；前提同 #1 | 現在不會 | P5-T022 |
| 6 | pino `formatters.log` 只遮物件，`app.ts:141` 的 msg 參數原樣寫 log | 中低 | P5-T023 |
| 10 | `GET /api/agents/:id/models` 每次啟動 `agy models`；守門只擋非 GET 的 cross-site；任何外部網頁 `<img>` 都能觸發 | 低到中 | P5-T023 |
| 4 | `normalizeWordPressUrl` 接受非 loopback 的 http；精靈有擋，手動 .env 沒擋 | 低 | P5-T023 |
| 7 | 200 回應沒過遮蔽器（只遮錯誤回應） | 很低 | P5-T023 |
| 5 | 使用者把已知密碼貼進正文 → 進 prompt、預覽、發布。裁定：直接拒絕（D-023） | 很低 | P5-T023 |
| 16 | 狀態機非法轉移測試從 `TRANSITIONS` 反推，恆真 | 不影響使用 | P5-T023 |

## Codex 原始報告

1. **高｜[src/wordpress/posts.ts:232](../../src/wordpress/posts.ts)｜「存成草稿」可能直接更新公開內容。** 設定允許更新的 `fixedObjectId` 指向已公開文章，完成基準確認後以 `status:'draft'` 發布 → `updateDraft()` 未送出草稿狀態，遠端維持 `publish`，新正文立即公開。使用者不必勾選公開警告便能觸發，違反安全規格的公開確認要求。**把握：高，已重現。**

2. **高｜[src/core/service.ts:2575](../../src/core/service.ts)｜撤銷核准成功後仍會公開。** 發布進入 `PUBLISHING`、等待分類查詢時呼叫 `revokeApproval()` → 核准確實被撤銷，但後續建立草稿及 `setStatus('publish')` 沒有再次檢查核准，最後仍為 `PUBLISHED`。現有測試只涵蓋較早的遠端前置檢查期間撤銷，漏掉此等待點。**把握：高，已重現。**

3. **高｜[src/core/service.ts:2239](../../src/core/service.ts)｜換圖與發布競態會破壞已核准版本。** 開始替換封面、讓上傳等待，同時重新核准舊圖並完成發布，再讓上傳返回 → `updateMedia()` 先覆寫共用媒體資料，之後 `createRevision()` 才因已發布而拒絕。換圖回報失敗，媒體卻已變更；重算預覽 hash 與 revision 不符，核准仍顯示有效，違反內容變更必須使核准失效的規格。**把握：高，已重現。**

4. **高｜[src/config/env.ts:74](../../src/config/env.ts)｜手動設定可繞過 HTTPS 限制。** 手動設定 `WORDPRESS_URL=http://example.invalid` 並填入帳密 → `loadConfig()` 接受，`WordPressClient` 隨後在 HTTP 請求附上 Basic Authorization，密碼以未加密傳輸送出。設定精靈有阻擋，但啟動設定沒有，違反 `security.md`「http 網址只准 loopback」。**把握：高，設定接受行為已重現，傳送路徑已確認。**

5. **高｜[src/core/service.ts:821](../../src/core/service.ts)｜已知密碼會原樣進入 Agent prompt。** 誤將目前設定的 Application Password 貼入正文或校稿要求，再執行校稿 → `buildUserPrompt()` 的結果直接交給 Agent，未使用 CoreService 已持有的秘密遮蔽器。假 adapter 實際收到完整合成密碼，違反不得將 WordPress 密碼傳給 Agent 的硬性禁令。**把握：高，已重現。**

6. **高｜[src/server/app.ts:141](../../src/server/app.ts)｜錯誤訊息的 log 遮蔽失效。** 請求 `/api/wordpress/terms?taxonomy=<已設定的密碼>` → 400 回應中的密碼被遮蔽，但 `request.log.warn(object, message)` 的第二個參數仍將密碼完整寫入 log。`logger.ts` 的 `formatters.log` 只處理物件，未涵蓋這個訊息參數，違反秘密不得出現在 log 的規格。**把握：高，已擷取實際 log 重現。**

7. **高｜[src/server/routes/wordpress.ts:59](../../src/server/routes/wordpress.ts)｜成功回應未遮蔽秘密。** WordPress 成功回傳的分類名稱包含目前 Application Password，例如外掛錯誤回顯憑證 → `WordPressClient` 僅驗證 schema，路由直接回傳，`/api/wordpress/terms` 的 200 JSON 包含完整密碼，並會進入分類面板的 React state。這違反 `security.md` 要求所有輸出先經遮蔽器的規定。**把握：高，已透過 HTTP 注入測試重現。**

8. **高｜[src/core/service.ts:1118](../../src/core/service.ts)｜逐項採用會錯誤解除過期提案的保護。** 取得校稿提案後手動新增段落，再採用其中一項建議 → 無條件 `rebaseReviewProposal()` 將提案標成未過期；接著「接受整份稿」通過檢查，以舊 `proposed_data_json` 覆蓋全文，新增段落消失。違反 `review-proposals.md` 的整份覆蓋限制；現有測試分別測手動修改與逐項採用，漏掉兩者串接。**把握：高，已重現。**

9. **高｜[src/core/service.ts:2408](../../src/core/service.ts)｜移動圖片會刪掉同段文字。** 正文含合法的 `<p>前文<img class="wp-image-10" …>後文</p>`，移動該已登錄圖片 → 程式刪除包含圖片的整個頂層區塊，再插入 figure，前文與後文一起消失。移除圖片及替換圖片也使用同類整塊處理，具有相同資料遺失問題。**把握：高，移動情境已重現。**

10. **中｜[src/server/routes/agents.ts:31](../../src/server/routes/agents.ts)｜GET 模型列表可繞過副作用請求守門。** 另一個本機埠的網頁以圖片請求載入 `/api/agents/google/models`，不帶 Origin → GET 被放行，且每次直接呼叫會啟動 `agy models` 的 adapter，沒有快取或佇列限制。違反 `security.md`「有副作用的讀取也走 POST＋JSON」；跨站標記的 GET 也已確認可觸發假 adapter。**把握：高，守門繞過已重現，未執行真實 CLI。**

11. **中｜[src/agents/registry.ts:137](../../src/agents/registry.ts)｜取消排隊校稿仍會執行。** 第一份校稿占用佇列，第二份排隊後被取消 → `cancel()` 記錄取消，但 `runStructured()` 輪到第二份時未檢查 `cancelledRuns`，仍呼叫 adapter、消耗額度並占用佇列。現有核心測試只確認結果不套用，沒有確認取消後不啟動工作。**把握：高，已重現。**

12. **中｜[src/core/service.ts:947](../../src/core/service.ts)｜重啟後的執行中工作無法取消。** Agent 執行中後端重啟 → DB 保留 `running`，記憶體 `activeRuns` 已清空；畫面持續顯示執行中並停用校稿按鈕，按取消則在第 950 行直接返回，不更新 DB。正常 UI 無法重新派工。**把握：高，以保留 DB、重建 CoreService 的方式重現。**

13. **中｜[src/core/service.ts:2585](../../src/core/service.ts)｜更新既有文章時無法清除封面及分類。** 遠端文章已有封面與分類，本次核准內容沒有封面、分類清單為空 → 發布 payload 直接省略這兩個欄位，而非送 `featured_media:0` 和空分類陣列；WordPress 因而保留舊值，實際文章與核准內容不一致。**把握：高，已確認送出的 payload 與保留舊值的結果。**

14. **中｜[src/ui/components/panels/TaxonomyPanel.tsx:265](../../src/ui/components/panels/TaxonomyPanel.tsx)｜單選分類無法取消。** 在文章或日記取消最後一個分類並按儲存 → UI 送出 `category:''`，但兩個模板的 schema 都要求分類字串 `minLength:1`，因此儲存被拒絕，原分類保留。分類本身是選填，UI 應能表達「沒有分類」，目前前後端契約互相衝突。**把握：高，schema 拒絕已重現。**

15. **低｜[src/ui/components/panels/SourcePanel.tsx:65](../../src/ui/components/panels/SourcePanel.tsx)｜清空網址片段會保留舊值。** 原資料有 `slug:'old-slug'`，使用者清空欄位後儲存 → 展開舊資料後，空值分支只加入 `{}`，沒有移除原有 slug，重新讀取仍是 `old-slug`，無法恢復由 WordPress 自動產生的行為。**把握：高，資料組裝邏輯可直接確認。**

16. **低｜[tests/state-machine.test.ts:54](../../tests/state-machine.test.ts)｜非法轉移的全面測試使用實作本身當答案。** 若誤將規格禁止的 `RENDERED → PUBLISHED` 加進 `TRANSITIONS` → 測試產生案例時會自動排除此轉移，後面的抽樣清單也沒有它，因此錯誤規則不會被這份測試發現。這不符合 `testing.md` 要求每個非法轉移都有測試的目的。**把握：高，案例產生與斷言均依賴同一張實作表。**

總條數：16
