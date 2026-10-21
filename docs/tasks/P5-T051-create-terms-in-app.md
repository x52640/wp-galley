---
id: P5-T051
phase: 5
status: ready
depends_on: []
specs: [wordpress-site.md, http-api.md, security.md, design-system.md, architecture.md]
write_paths: ["src/server/", "src/core/", "src/wordpress/", "src/contract/", "src/ui/", "config/", "tests/", "docs/specs/wordpress-site.md", "docs/specs/http-api.md", "docs/specs/templates.md", "docs/specs/design-system.md", "docs/specs/architecture.md", "docs/known-issues.md", "docs/tasks/P5-T051-create-terms-in-app.md", "docs/CURRENT_TASK.md"]
contract_change: additive
expected_commit: "feat(P5-T051): 在發布台直接建立分類項目"
---

# 在發布台直接建立分類項目

## 目標
D-050。使用者 2026-10-21：想新增類別，以為只能去 WordPress 後台。其實右欄「建立新的分類項目」已存在（`TaxonomyPanel.tsx`、`POST /api/wordpress/terms`），
但四個發布目標的 `allowCreateTerms` 都是 false，展開只看到「去改 config/publish-targets.json 再重啟」——路徑也過期（D-035 後設定在資料目錄）。
叫使用者離開發布台改設定檔，照 memory「不准離開發布台」算 bug。

D-004 擋的是**Agent 給的名稱在發布時自動建立**（近義詞會把分類變垃圾場），不是使用者自己手動建。
現況是一個開關同時管兩件事：手動建立路由（`src/server/routes/wordpress.ts` 約 85 行）與發布時自動建立（`src/core/service/publish.ts` 約 476 行 `allowCreate: target.allowCreateTerms`）。
光把開關打開會連 Agent 的名稱都自動建，所以要拆開。

## 範圍
### 包含
- 手動建立不再看 `allowCreateTerms`：只要發布目標有分類法就能建。路由仍只給本機 UI（照既有的來源／CSRF 防護；確認並寫測試），MCP 不加建立工具。
- 發布路徑寫死不自動建立（`allowCreate: false`），對不上的名稱照 D-004 原樣回報。寫測試守住：就算設定檔寫 `allowCreateTerms: true` 也不自動建。
- `allowCreateTerms` 欄位：舊設定檔仍能讀（不報錯），但不再有作用；從精靈產生的設定（`src/wordpress/setup.ts`）、範例設定（`config/`）、型別與 UI 拿掉。`targets.ts` 的「沒 taxonomy 卻開 allowCreateTerms」驗證跟著處理。
  真實資料目錄的 `publish-targets.json` **不准改**，舊檔留著那個欄位也要正常。
- UI（`TaxonomyPanel.tsx`）：
  - 拿掉「去改設定檔」提示。
  - 打名稱時即時列出站上名稱相近的既有項目（用已載入的清單在前端比對：去頭尾空白、不分大小寫、全半形、包含／被包含；不另打 WordPress），可以直接點選既有的。
  - 按「建立」先確認一次（行內確認即可，不用瀏覽器原生對話框），講清楚「會直接建在正式站上，之後每篇都選得到」；同名已存在就直接選那個（後端 `resolveTerms` 本來就會回既有的）。
  - 建好後自動選上，清單更新。失敗講原因。
- 錯誤訊息與文件中過期的 `config/publish-targets.json` 路徑一併修正（本 Task 碰到的範圍內）。
- spec：wordpress-site.md（分類法、外部副作用）、http-api.md（terms 路由）、templates.md 若有提到、design-system.md、architecture.md 功能地圖；known-issues。

### 不包含
- 刪除、改名、建立階層（父分類）。
- 標籤（`post_tag`）。
- Agent 建議新分類的流程。

## 工作區與 Context
### 必讀入口
`src/ui/components/panels/TaxonomyPanel.tsx`、`src/server/routes/wordpress.ts`、`src/wordpress/terms.ts`（檔頭說明）、`src/wordpress/targets.ts`、`src/wordpress/setup.ts`（約 690 行）、`src/core/service/publish.ts`（約 460～480 行）、`docs/specs/wordpress-site.md` 分類法相關段落。
### 不應載入
agent、factcheck spec。
### 驗證命令
`npm run verify`；`node scripts/ui-drive.mjs` 搭 `?fixtures=1` 截圖（展開建立、打字出現相近項目、確認、建好選上）。

## 實作要求
- 先寫測試：手動建立不看開關；發布路徑不管設定都不自動建；舊設定檔含欄位可讀；相近名稱比對（大小寫、全半形、空白、包含）；路由來源防護。
- 測試絕不連真實 WordPress（用既有的假 client）。文字用繁體中文。

## 驗證
### 自動驗證
`npm run verify` 綠。
### 手動驗證（使用者）
右欄分類 → 建立新的分類項目 → 打一個跟既有相近的名稱看到提示 → 打一個新名稱 → 確認 → 建好自動選上 → 存草稿，後台看到新分類且文章有勾。（會在正式站真的建一個分類項目，不會公開文章。）

## 完成定義
- [ ] `npm run verify` 綠
- [ ] 擁有這些行為的 spec 已更新（architecture.md 功能地圖）
- [ ] 留下的殘餘已寫進 `docs/known-issues.md`
- [ ] CURRENT_TASK 已更新

## 中斷／接手紀錄
- 最後完成：開 Task（2026-10-22）
- 已通過驗證：無
- 下一步：寫測試、實作
- Blocker：無

## 完成結果
