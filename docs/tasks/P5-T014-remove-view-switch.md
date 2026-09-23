---
id: P5-T014
phase: 5
status: done
depends_on: []
specs: [design-system.md, review-proposals.md]
write_paths: ["src/ui/", "tests/", "docs/specs/design-system.md", "docs/specs/review-proposals.md", "docs/tasks/", "docs/CURRENT_TASK.md"]
contract_change: none
expected_commit: "refactor(P5-T014): 拿掉三段切換，對照改成工具列按鈕"
---

# 拿掉「編輯／對照／成品」三段切換

## 目標
D-018。實測（使用者 2026-09-23）：編輯與成品幾乎一樣，三段切換沒有實際功能。

## 範圍
### 包含
- 頂列拿掉 `ViewSwitch`（`src/ui/components/ViewSwitch.tsx` 與 Workspace 裡的使用）
- 預設畫面＝現在的「編輯」檢視（標記、頁邊符號、卡片對應）
- 校樣工具列（ProofView 的 `tools`）加一顆切換按鈕「對照上一版」／「回到文章」，打開 CompareView；
  按右欄卡片時若在對照中，照舊能跳到那一段（CompareView 已有 focusBlock）
- 打開發布面板時自動顯示乾淨成品（沿用現在的 `mode='final'` 機制），關掉面板回到原本畫面；
  這是唯一會出現成品的地方
- 直接在文章上改（P5-T010）時不能進對照；對照中按「改原文」／「去原文改」先回到文章
- 示範資料模式同樣可用

### 不包含
- 對照本身的比對邏輯、後端

## 實作要求
- 校樣永遠掛在樹上（切到對照只是蓋住，見 Workspace 的註解與 review-proposals.md），不要改成卸載
- 發布前「看過成品」的規則不能弱化：核准前畫面一定是乾淨成品
- 測試絕不呼叫真實 CLI、絕不連真實 WordPress

## 驗證
`npm run verify`；`node scripts/ui-drive.mjs`（示範資料）走：預設文章 → 對照上一版 → 回到文章 → 打開發布面板（成品）→ 關掉 → 回到文章

## 完成定義
- [x] `npm run verify` 綠
- [x] 無頭 Chrome 走完上面流程
- [x] design-system.md（線框圖、頂列說明）、review-proposals.md（「主區的三種檢視」一節）已更新
- [x] CURRENT_TASK 已更新

## 中斷／接手紀錄
- 最後完成：實作、測試、文件（subagent，2026-09-23）
- 已通過驗證：`npm run verify` 40 檔 / 608 測試；無頭 Chrome 示範資料走完
- 下一步：使用者看過後 commit
- Blocker：無

## 完成結果
- 頂列拿掉三段切換；`ViewSwitch.tsx` 與 `.seg-item` 樣式刪除。
- 「主區顯示什麼」抽成 `src/ui/lib/stage-view.ts`（`stageDisplay`），`tests/stage-view.test.ts` 5 條：
  發布面板打開時一定是成品，**就算剛才在對照**（對照不能蓋住成品）。
- 切換按鈕放兩處：校樣工具列「對照 AI 提案」／「對照上一版」（有未結案提案時後端跟提案比，字照實際對象；
  監工時改的）、對照的工具列「回到文章」（對照蓋住了校樣的工具列）。發布面板開著時這顆 disabled
  （審查發現鍵盤 Tab 按得到，按了會在關面板後突然跳進對照）。稿件已發布／取消時也看得到這顆。
- 關掉發布面板回到原本的文章或對照；面板裡按「回去看」一律回到文章（要看的是字上的建議或圖片區）。
- 對照中按卡片：留在對照，CompareView 捲到那一段並框起來；底下的校樣同時標亮，回到文章時停在那一項。
- 編輯中不能進對照（工具列本來就換成取消／儲存，按鈕另外 disabled）；對照中按「自己改／去原文改」先回到文章。
- `.proof-bar-left` 加 `margin-right: auto`，工具列按鈕一律靠右（沒有校對符號勾選框時原本會黏在左邊）。
- 已知、不處理：發布面板沒有鎖住焦點，鍵盤 Tab 仍能到底下的「改原文」「標題與網址」（原本就有）；
  切換對照後焦點掉回 body。
