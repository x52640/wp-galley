---
id: P5-T044
phase: 5
status: done
depends_on: [P5-T040]
specs: [architecture.md, design-system.md]
write_paths: ["src/ui/components/panels/MediaPanel.tsx", "src/ui/components/panels/BriefCard.tsx", "src/ui/components/panels/MediaRow.tsx", "src/ui/lib/", "tests/", "docs/specs/architecture.md", "docs/tasks/P5-T044-split-mediapanel.md"]
contract_change: none
expected_commit: "refactor(P5-T044): 拆分配圖面板"
---

# 拆分配圖面板 MediaPanel

## 目標
D-040（使用者 2026-10-04：「不要把功能都擠在同一個檔案，要模組化，之後比較好更新跟維護」；2026-10-05 要求拆成 Task）。
`MediaPanel.tsx` 1010 行，其中配圖卡片 `BriefCard` 一個元件就約 550 行（描述編輯、生圖、候選圖、用這張、位置、打字中擋放圖）。
之後的「配圖排隊」「AI 挑哪幾節配圖」都會長在這裡，先拆開。

## 範圍
### 包含
- `BriefCard.tsx`、`MediaRow.tsx` 各自一檔；`useImageGenerationStatus` 移到 `src/ui/lib/`；卡片裡的判斷（能不能生圖、能不能放、文案）抽純函式補測試。
- MediaPanel 只留清單組裝。
- `docs/specs/architecture.md` 功能地圖對應欄更新。

### 不包含
- 改任何行為或畫面。
- 本 Task write_paths 以外的檔案；需要動到就停下來回報。

## 工作區與 Context
### 必讀入口
`docs/specs/architecture.md`（程式慣例、功能地圖）、本 Task 要拆的檔案、`docs/tasks/P5-T035-proofview-edit-logic.md`（上一次拆 ProofView 的做法）。
### 不應載入
後端、`docs/archive/`。
### 驗證命令
`npm run verify`；`node scripts/ui-drive.mjs` 搭 `?fixtures=1`。

## 實作要求
- **重構不改行為**（D-033、D-040）：畫面、文案、互動、API 呼叫順序都不變；props 介面盡量不變，要變就只在本 Task 範圍內的檔案間調整。
- 前後端都要的規則照舊放 `src/contract`；這次抽出的是 UI 層，放 `src/ui/components/`（元件）與 `src/ui/lib/`（hook、純函式）。
- 抽出的純函式補單元測試；`npm run verify` 測試數不減。
- 動手前用 `node scripts/ui-drive.mjs` 搭 `?fixtures=1` 把「驗證」列的流程各截一張「改動前」，完成後同流程截「改動後」逐張比對，回報差異（應為零）。
- 不呼叫真實 Agent CLI、不連 WordPress、不啟動或重啟主目錄 dev server、不設 `GALLEY_DATA_DIR`、不 commit、不 `git stash`。
- 截圖前確認 9333 埠沒人用；Vite 只在 worktree、非 3000／5173 埠，快取放 scratchpad，用完關掉。

## 驗證
### 自動驗證
`npm run verify` 綠，測試數不減。
### 畫面比對（`?fixtures=1`，改動前後各一次）
一鍵配圖產生卡片；改描述存；生圖、再生一張、用這張；手動上傳；右欄位置下拉；刪除圖片；打字模式下用這張反灰。

## 完成定義
- [x] `npm run verify` 綠，測試數不減
- [x] 改動前後截圖逐張相同
- [x] `docs/specs/architecture.md` 功能地圖對應欄已更新
- [ ] CURRENT_TASK 已更新（主 session 統一更新）

## 中斷／接手紀錄
- 最後完成：拆出 `panels/BriefCard.tsx`、`panels/MediaRow.tsx`、`lib/image-generation-status.ts`、`lib/session-thumbs.ts`、`lib/media-view.ts`（卡片與媒體列的判斷，純函式）＋ `tests/media-view.test.ts`；MediaPanel 1010 → 222 行，只留清單組裝與底下上傳；Workspace／InsertImagePanel 照舊從 MediaPanel import（MediaPanel 轉出 `useImageGenerationStatus`、`assetLabel`）；功能地圖已更新（2026-10-05）
- 已通過驗證：`npm run verify` 94 檔／2106（改動前 93／2079）；`?fixtures=1` 29 張改動前後截圖，21 張逐像素相同，8 張只差左上內容雜湊小標與捲軸（改動前自己跑兩次也差同一處，示範資料亂數造成），右欄 DOM 全部相同
- 下一步：PR B 的 Codex 審查
- Blocker：無

## 完成結果
- 獨立審查一輪：無行為差異（條件逐條對過、說明文字合併後 DOM 相同、共用縮圖表仍是同一份）。
- 殘餘：MediaPanel 暫時轉出 `useImageGenerationStatus`、`assetLabel` 給 Workspace／InsertImagePanel（不在 write_paths）；之後改成直接從 `lib/` import 就能拿掉。BriefCard 仍 531 行（幾乎全是畫面結構），配圖排隊要長在這裡時再拆。
