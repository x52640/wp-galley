---
id: P5-T024
phase: 5
status: ready
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
- 作者要不要算進核准的內容（改作者要不要讓核准失效）：先讀 state-machine.md 與 security.md 的核准定義；規格沒寫就停下回報，由使用者裁定。
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
- 最後完成：尚未開始
- 已通過驗證：—
- 下一步：等使用者說開工；開工後先釐清「改作者是否讓核准失效」
- Blocker：無

## 完成結果
