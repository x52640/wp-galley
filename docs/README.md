# 治理規則

## 權威順序

衝突時上面的贏：

1. `docs/specs/security.md`（硬性禁令，任何 Task 都不能豁免）
2. `plan.md`（邊界與決策記錄）
3. `docs/specs/`（技術定義的唯一權威，索引見 `docs/specs/README.md`）
4. `docs/adr/`（解釋 spec 的理由，不覆蓋 spec）
5. `docs/tasks/`（可執行任務，只引用 spec，不重抄）
6. `docs/archive/`（封存，**不是現行需求**）

程式碼與 spec 不一致時，先判斷哪邊是對的，再修另一邊；不要默默照程式碼做。

## 三條鐵律

1. **先裁定再實作。** 新議題先進 `plan.md` 決策記錄或待裁定清單，拿到裁定（含日期）
   再開 Task。
2. **一個概念只有一個家。** 引用不複製：Task 不重抄欄位、狀態、API、安全規則，只連到
   spec。文件互相矛盾時**停止實作**，先修權威文件（或開前置 Task）。
3. **一個 Task 一個 commit。** 可獨立 revert，格式 `type(任務ID): 成果`，例如
   `feat(P5-T003): 發布台改為文件式版面`。不混入無關變更。commit hash 不寫進產生它的
   commit。

## Task 規則

- 一個 Task 一個檔：`docs/tasks/<ID>-<slug>.md`，照 `docs/tasks/_TEMPLATE.md`。
- ID 格式 `P<階段>-T<三位數>`；治理類用 `P0`；小數階段（5.5）併入整數編號（P5）。ID 不重用。
- `status` 只有 `ready`、`in_progress`、`done`、`blocked`。**不是 `ready`／`in_progress`
  就不准實作。**
- 一次只飛一個主 Task，`docs/CURRENT_TASK.md` 指向它。
- 變更只能落在 front matter 的 `write_paths`；超出的先停下回報。
- 先寫或更新測試，再實作。
- 「中斷／接手紀錄」四行隨時保持最新，不是收官才寫。
- 完成回報給使用者：改了哪些檔案、驗證數字、發現的環境差異、進下一步前需要使用者確認什麼。
- Task 做完 ≠ 階段完成；階段收尾另外做真實資料驗收（`docs/specs/testing.md`）。

## 品質閘

`npm run verify`（typecheck ＋ 全部測試）必須綠才能 commit。
CURRENT_TASK 的「主樹基準」記錄目前的數字；跑出來對不上就是環境漂移，先查清楚。

文件更新是**完成定義的一部分**：改了行為就改擁有它的 spec，新決定就進決策記錄。

索引與 `verify:docs` 目前手動維護；Task 累積到 5–10 個再寫腳本（D-014）。

## 本機使用者偏好

回答風格、可被質疑等偏好寫在使用者的全域設定，不在本 repo。本 repo 只放專案本身的規則。
