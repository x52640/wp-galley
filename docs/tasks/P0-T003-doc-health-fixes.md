---
id: P0-T003
phase: 0
status: done
depends_on: []
specs: []
write_paths: ["plan.md", "docs/README.md", "docs/CURRENT_TASK.md", "docs/tasks/P5-T004-split-core-service.md", "docs/tasks/P0-T003-doc-health-fixes.md", "docs/tasks/*.md（只在搬決策細節時補「目標」）"]
contract_change: none
expected_commit: "docs(P0-T003): 修正過期狀態、決策記錄壓成一行"
---

# 修正過期狀態、決策記錄壓成一行

## 目標
D-042。2026-10-09 文件健檢（doc-health quick）找到會讓新 session 做錯事的四處：
CURRENT_TASK「進行中」說 P5-T041～T045 還沒開工（實際 #29～#31 已合併，同檔下面又說已合併）；
P5-T004 已合併（#14）但 status 仍是 `in_progress`；plan.md 階段地圖「拆分 CoreService ⬜」；
D-039「直到沒問題才合併」已被使用者 2026-10-05 改成最多三輪，只記在記憶，plan.md 權威較高、會被照舊執行（補 D-041）。
另外 plan.md 是冷啟動最大的檔（19.4 KB），9 條決策超過 250 字、內含 PR 分組與參數名，違反「一條一行」。

## 範圍
### 包含
- `docs/CURRENT_TASK.md`：「進行中」改成無；Q-1～Q-3「預定在 P5-T001 實測時回答」改成現況；「治理」段改指 P0-T004。
- `docs/tasks/P5-T004-split-core-service.md`：status 改 `done`，完成結果補「#14 合併」。
- `plan.md`：階段地圖「拆分 CoreService」改 ✅；D-039 標「已被 D-041 修訂」；
  超過 250 字的決策（D-016、D-023、D-028、D-033、D-034、D-035、D-037、D-039、D-040）壓到 250 字以內：
  保留結論與「不做 X」限制，細節確認對應 Task「目標」已有，沒有才補進去。
- `docs/README.md`：「Task 累積到 5–10 個再寫腳本」改指 `verify:docs`（P0-T004）。

### 不包含
- 改程式、改 spec。
- 改決策的意思；只搬細節。

## 實作要求
- 每條壓縮後的決策逐一核對：舊行的每個限制都能在新行或被連到的 Task 找到。
- 改前改後量 `plan.md` 位元組數，寫進完成結果。

## 驗證
### 自動驗證
`npm run verify`（P0-T004 的 docs 檢查一起過）。

## 完成定義
- [x] `npm run verify` 綠
- [x] CURRENT_TASK 已更新

## 中斷／接手紀錄
- 最後完成：範圍內全部改完（`docs/README.md` 那句由 P0-T004 一起改）
- 已通過驗證：見完成結果
- 下一步：跟 P0-T004 一起 verify 後 commit；不單獨開 PR（D-042）
- Blocker：無

## 完成結果
- 壓到 250 字以內的決策：D-028、D-034、D-035、D-037、D-039、D-040（連結網址不算字，依 P0-T004 的算法；D-016、D-023、D-033 去掉網址後已在上限內，不動）。
- 搬走的細節逐條查過：留在 Task 或 spec 的不再補；沒有的補進 P8-T003（不做常駐／外殼 App 的理由）、P5-T041（暫不拆四個大檔的理由等）「目標」。
- D-042 的「收官文件」一句：開 Task 時寫「直接開小 PR」，使用者 2026-10-09 改裁定為「照舊不單獨開 PR，跟下一個 Task 一起進」（嫌 PR 臃腫），已改。
- 審查順手修：CURRENT_TASK「由主 session 直接合併」改指 D-041；待裁定清單排除已裁定的 Q-6；D-035 補回「現階段」。
- `plan.md` 19,826 → 約 19,000 bytes（只省約 4%）：250 字上限擋的是之後繼續長，不是大幅瘦身；冷啟動大頭仍是決策記錄 42 條。
