---
id: P0-T004
phase: 0
status: in_progress
depends_on: [P0-T003]
specs: []
write_paths: ["tests/docs-governance.test.ts", "package.json", "docs/README.md", "docs/CURRENT_TASK.md", "docs/tasks/P0-T004-verify-docs.md"]
contract_change: none
expected_commit: "test(P0-T004): verify:docs 檢查文件狀態一致"
---

# verify:docs 檢查文件狀態一致

## 目標
D-042。D-014 說 Task 累積到 5–10 個再寫文件檢查腳本，現在 58 個仍手動維護，
結果 CURRENT_TASK、Task front matter、plan.md 三處對不上好幾天沒人發現（2026-10-09 doc-health）。
慣例會被吃回去，只有閘門守得住：做成測試，跟著 `npm run verify` 每次跑。

## 範圍
### 包含
- `tests/docs-governance.test.ts`（Vitest，只用 Node 內建模組讀檔，不連網、不跑子行程）：
  1. `docs/tasks/P*-T*.md` 每個都有 front matter；`id` 等於檔名前綴；`status` 只能是 `ready`／`in_progress`／`done`／`blocked`。
  2. `docs/CURRENT_TASK.md`「## 進行中」與「## Ready」兩節提到的 Task ID，status 必須是 `ready` 或 `in_progress`。
  3. status 是 `ready`／`in_progress` 的 Task，ID 必須出現在 CURRENT_TASK 那兩節之一。
  4. `plan.md` 決策記錄（`- **D-NNN**` 開頭的行）每行不超過 250 個字元（以 code point 算）；編號遞增不重複。
  5. `CURRENT_TASK.md` 不超過 100 行（檔頭註解自訂的上限）。
  6. `CLAUDE.md`、`plan.md`、`docs/README.md`、`docs/CURRENT_TASK.md`、`docs/specs/*.md`、`docs/adr/*.md`、`docs/tasks/*.md`
     裡的相對 Markdown 連結 `[..](path)` 指到的檔存在（略過 `http(s):`、純 `#錨點`、code span／code block 內的）。
  失敗訊息要指出哪個檔、哪一行、該怎麼改。
- `package.json` 加 `"verify:docs": "vitest run tests/docs-governance.test.ts"`（`npm test` 已會跑到，`verify` 不用改）。
- `docs/README.md` 品質閘段落寫明 `verify:docs` 檢查什麼。

### 不包含
- 檢查 plan.md 階段地圖（格式自由，機械判斷不可靠）。
- 改 `docs/archive/`；檢查錨點。

## 實作要求
- 先在目前文件上跑一次，紅的條目要是真問題（P0-T003 應已修完）；再各造一個壞例子確認會紅（不留在 repo）。

## 驗證
### 自動驗證
`npm run verify:docs`、`npm run verify`。

## 完成定義
- [ ] `npm run verify` 綠
- [ ] CURRENT_TASK 已更新

## 中斷／接手紀錄
- 最後完成：開 Task
- 已通過驗證：—
- 下一步：寫測試
- Blocker：無

## 完成結果
