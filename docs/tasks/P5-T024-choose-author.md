---
id: P5-T024
phase: 5
status: done
depends_on: []
specs: [wordpress-site.md, http-api.md, core-service.md, state-machine.md, security.md, design-system.md]
write_paths: ["src/wordpress/", "src/core/", "src/contract/", "src/server/routes/", "src/config/", "src/ui/", "config/examples/", "tests/", "docs/specs/", "docs/tasks/P5-T024-choose-author.md", "docs/CURRENT_TASK.md"]
contract_change: additive
expected_commit: "feat(P5-T024): 發布時指定作者，預設是使用者本人"
---

# 發布時指定作者，預設是使用者本人

## 目標
D-024。目前發布不送 `author`，WordPress 把作者設成發布台登入的帳號（使用者的 AI 帳號）。

## 範圍
### 包含
- 後端取得站上可當作者的使用者清單（WordPress REST `/wp/v2/users`，只取能發文的角色；需要 `context=edit` 時注意權限）。
- 每個站的**預設作者**存在本機站台設定（`config/publish-targets.json` 那一層，不進 git；範例檔補欄位）。沒設時預設作者 = 未指定（維持現行為），面板提示去設。
- 發布面板顯示「作者：<名字>」，可改這一篇、可「設為預設」。
- 建稿與更新（fixedObjectId 路徑）都送 `author`。
- 帳號沒有 `edit_others_posts`（例如 Author 角色）時：面板說明做不到並停用選擇，不要等發布才失敗。
### 不包含
- 設定精靈裡的作者步驟（之後需要再開）。
- 修改已發布文章的作者（Q-5）。

## 實作要求
- **作者是發布選項，不算核准的內容**（2026-09-24 使用者開工時同意）：比照 `status`（草稿／公開），在發布請求裡帶，改作者不讓核准失效；後端驗證作者 id 在站上可當作者的清單內，並把實際送出的作者寫進發布事件。
- 使用者清單回應要過遮蔽器；不得把 Application Password 帶到前端。
- 測試一律用假 WordPress。

## 驗證
### 自動驗證
`npm run verify`
### 手動驗證
使用者在自己的站上選作者 → 存成**草稿** → 到後台確認作者是本人。絕不選公開。

## 完成定義
- [ ] `npm run verify` 綠
- [ ] 擁有這些行為的 spec 已更新
- [ ] CURRENT_TASK 已更新

## 中斷／接手紀錄
- 最後完成：後端（作者清單、預設作者存站台設定檔、發布送 author、驗證與事件）、發布面板、spec 全部完成（2026-09-24）
- 已通過驗證：`npm run verify` 59 檔／1061 測試全綠（新增 `tests/publish-author.test.ts` 31 條，含審查修正）；`?fixtures=1` 截圖六種情境
- 下一步：使用者在自己的站手動驗證（選作者 → 存草稿 → 後台看作者；確認 read-think／diary 支援作者欄位）
- Blocker：無

## 實作紀錄
- 權限依據（WordPress 核心 `WP_REST_Users_Controller`，2026-09-24 查 trunk）：`context=edit`、`roles`、`capabilities[]`
  都要 `list_users`（Editor 沒有）→ 改用 `who=authors`（區塊編輯器同一招）。指定別人要 `edit_others_posts`。
  細節在 wordpress-site.md「作者」。
- 預設作者放**站台設定檔頂層** `defaultAuthorId`（每個站一個，不是每個 target 一個）；不用 migration。
  設定精靈重寫檔案時原樣保留。範例：`config/examples/default-author.json`（沒動 remusplus.json：測試都用它，
  加了會讓所有發布測試多打使用者端點）。
- 新路由：`GET /api/wordpress/authors`、`POST /api/setup/default-author`（寫檔路由放 setup 那組，共用守門）。
- 遠端快照多比 `author`；舊快照沒有這欄不比。
- 審查修正（2026-09-24）：讀不到作者清單不再當成「只能用自己」（那會靜默變成 AI 帳號）；有要送的作者就發布前拒絕、
  記 rejected 事件；「只能用自己」只認 capabilities 確定沒有 edit_others_posts；`AuthorsResponse.listUnavailable`；
  完成畫面沒送作者時寫「作者是發布台的帳號（名字）」。
- 未查證：作者站台的 `read-think`／`diary` 是否 `supports: author`（不支援的話 WordPress 會默默忽略 author）。
- 已知限制：換站（精靈改網址）不會清掉 `defaultAuthorId`；新站上同一個 id 若剛好是別人，面板會顯示那個人的名字，
  要靠使用者看一眼。不在名單則會擋下來。

## 完成結果
