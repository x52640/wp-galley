---
id: P5-T047
phase: 5
status: in_progress
depends_on: []
specs: [design-system.md, architecture.md]
write_paths: ["src/contract/", "src/ui/", "tests/", "docs/specs/design-system.md", "docs/specs/architecture.md", "docs/known-issues.md", "docs/tasks/P5-T047-word-count.md", "docs/CURRENT_TASK.md"]
contract_change: additive
expected_commit: "feat(P5-T047): 編輯區與發布面板顯示字數"
---

# 編輯區與發布面板顯示字數

## 目標
D-045。使用者 2026-10-12：寫完文章、發布前不知道字數，要能看到目前字數。
算法照使用者同意的建議：中文（含日文假名、韓文）一字算 1；英文／數字一個詞算 1（`GPT-5`、`don't`、`3.14` 這類連在一起的算一個詞）；
標點、空白、符號不算。只算內文，不算標題。

## 範圍
### 包含
- 共用規則寫成 `src/contract` 純函式（D-033 規矩），例如 `countWords(text)`，以及「從內文 HTML 取出要算的文字」：
  含段落、小標、清單、引用；**不含**圖片 alt、圖說（figcaption）、其他非內文元件。前端（以及之後若後端要用）共用同一份。
- 編輯區底部固定顯示「N 字」：看稿與打字模式都有；打字時即時更新（要算的是編輯中的內容，不是上次存檔的）。
  長文大量內容時不能讓打字變卡（必要時節流）。
- 發布面板（`PublishSheet`）顯示同一個字數。只顯示，不擋發布。
- 樣式跟現有 design system 一致（安靜、次要文字色），`docs/specs/design-system.md` 補一句這個元件的位置與樣式；
  `docs/specs/architecture.md` 功能地圖加一列。
- `?fixtures=1` 截圖確認兩個位置。

### 不包含
- 字數目標、上限提醒、閱讀時間。
- 存進 DB 或送給 Agent／WordPress。

## 工作區與 Context
### 必讀入口
`docs/specs/design-system.md`、`docs/specs/architecture.md` 功能地圖「在文章上改」與發布面板相關列、`src/contract/link-target.ts`（contract 純函式的寫法範例）。
### 不應載入
agent、wordpress、factcheck 相關 spec。
### 驗證命令
`npm run verify`；`node scripts/ui-drive.mjs` 搭 `?fixtures=1` 截圖。

## 實作要求
- 先寫測試再實作。測試至少涵蓋：純中文、純英文、中英數混排、標點與全形符號不算、emoji、空字串、HTML 裡的小標／清單／引用要算、圖說與 alt 不算、`&nbsp;` 等實體。
- 文字用繁體中文。

## 驗證
### 自動驗證
`npm run verify` 綠。
### 手動驗證（使用者）
開一篇真實草稿 → 底部字數合理 → 打字模式打幾個字，數字即時變 → 開發布面板看到同一個數字。

## 完成定義
- [ ] `npm run verify` 綠
- [ ] 擁有這些行為的 spec 已更新（新增或搬動功能：architecture.md 功能地圖）
- [ ] 留下的殘餘已寫進 `docs/known-issues.md`
- [ ] CURRENT_TASK 已更新

## 中斷／接手紀錄
- 最後完成：開 Task（2026-10-12）
- 已通過驗證：無
- 下一步：實作
- Blocker：無

## 完成結果
