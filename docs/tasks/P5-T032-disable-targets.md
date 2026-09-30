---
id: P5-T032
phase: 5
status: ready
depends_on: [P8-T002]
specs: [wordpress-site.md, http-api.md, design-system.md, core-service.md]
write_paths: ["src/wordpress/targets.ts", "src/wordpress/setup.ts", "src/core/", "src/contract/", "src/server/routes/", "src/ui/", "config/publish-targets.example.json", "config/examples/", "tests/", "docs/specs/", "docs/tasks/P5-T032-disable-targets.md", "docs/CURRENT_TASK.md"]
contract_change: additive
expected_commit: "feat(P5-T032): 設定精靈可以停用不要的文章類型"
---

# 設定精靈可以停用不要的文章類型

## 目標
D-032。設定精靈「發到哪裡」那一步，既有的類型（read-think、diary、post、page）只是一排唯讀標籤，精靈只加不刪。
使用者要能在同一個畫面把不要的類型**停用**，之後也能再打開。

## 範圍
### 包含
- **設定檔格式**：target 多一個可選的停用標記（名稱由實作者依現有欄位命名慣例決定，例如 `"disabled": true`）。
  **沒有這個欄位＝啟用**，舊檔不用改就相容。範例檔（`config/publish-targets.example.json`）與「精靈寫出的欄位跟範例一字不差」
  那條測試照 spec 同步處理。
- **寫檔規則沿用精靈既有的保護**（見 `wordpress-site.md`「設定精靈」）：寫前備份到 `backups/`、檔壞了不覆寫、
  既有 target 除了這個標記之外**原樣保留**（不補預設值、不改順序、不動其他欄位）、寫完當場套用不用重啟。
- **至少要留一個啟用的類型**：全部停用的請求後端拒絕，畫面也不讓送出。
- **停用的效果**：
  - 新稿件的類型選單（`NewJob.tsx`）與總覽拖放／⌘V 貼上建稿（`JobList.tsx`）不出現、不預設停用的類型。
  - 後端建稿（`createJob`）拒絕停用的 target——不信任前端。
  - **已經用這個類型的舊稿件照常**：能開、能編輯、能發布，總覽照常顯示類型名稱（所以 `listTargets` 仍要回傳停用的，帶上停用狀態）。
- **畫面**：精靈「發到哪裡」那一排既有類型改成可切換（啟用／停用），停用的看得出來是停用；有既有設定檔時仍然預設「不改」。
  用詞白話（例如「不用這個類型」），說明停用只是隱藏、舊稿件不受影響、隨時可以打開。`?fixtures=1` 同步。
- 停用中、但有進行中（未發布、未取消）稿件的類型：停用時在畫面上講一句「還有 N 篇用這個類型的稿件，停用後照常可以編輯」即可，不擋。
- spec：`wordpress-site.md`（設定檔欄位、精靈規則）、`http-api.md`（請求／回應變化）、`core-service.md`（若 createJob 規則寫在那）。

### 不包含
- 真的從設定檔刪除 target。
- 新增自訂類型（CPT）的偵測或精靈建立 read-think 這類 target。
- 換站後舊 target 的處理。

## 實作要求
- 先寫測試：舊檔（沒有標記）全部視為啟用、停用／再啟用寫檔只動那個標記且有備份、全部停用被拒、createJob 拒絕停用類型、
  舊稿件用停用類型仍可編輯與發布（用假 WordPress）、listTargets 回傳停用狀態。
- 測試不呼叫真實 CLI、不連真實 WordPress；**不讀寫真實的 `config/publish-targets.json`、`.env`、`data/`**（測試用暫存目錄）。

## 驗證
### 自動驗證
`npm run verify` 綠。
### 手動驗證
使用者：精靈 →「發到哪裡」停用一個類型 → 新稿件選單看不到它 → 用那個類型的舊稿件照常打開 → 再啟用回來。

## 完成定義
- [ ] `npm run verify` 綠
- [ ] 擁有這些行為的 spec 已更新
- [ ] CURRENT_TASK 已更新

## 中斷／接手紀錄
- 最後完成：開 Task（2026-09-30）
- 已通過驗證：—
- 下一步：派 subagent 實作
- Blocker：無

## 完成結果
