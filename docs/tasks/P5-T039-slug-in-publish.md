---
id: P5-T039
phase: 5
status: ready
depends_on: [P5-T026]
specs: [agent-tasks.md, design-system.md, state-machine.md]
write_paths: ["src/ui/components/PublishSheet.tsx", "src/ui/components/panels/SourcePanel.tsx", "src/ui/components/SlugSuggest.tsx", "src/ui/lib/", "src/ui/service/fixtures/", "src/ui/styles/", "src/contract/", "tests/", "docs/specs/agent-tasks.md", "docs/specs/design-system.md", "docs/specs/architecture.md", "docs/known-issues.md", "docs/tasks/P5-T039-slug-in-publish.md"]
contract_change: none
expected_commit: "feat(P5-T039): 發布面板顯示網址，空的可以當場建議"
---

# 發布面板顯示網址，空的可以當場建議

## 目標
D-038。使用者 2026-10-04 發布「AI未來已來 - 1」（長文）時沒看到「建議網址」就發出去了，網址空著，WordPress 用中文標題產生一長串編碼網址，只好事後去後台改。

「建議網址」（D-026）藏在工具列「標題與網址」裡；發布面板（D-013 規定要顯示「發到哪裡」）完全不顯示網址。
發布前最後一眼看的就是發布面板，網址應該在那裡，空的要講清楚後果、當場就能一鍵建議（D-010 常做的事一鍵）。

## 範圍
### 包含
- **發布面板顯示「網址：…」**（放在「發到哪裡」附近），所有有網址欄的類型都顯示：
  - 有填：顯示網址（可點「改」直接在面板裡改，或連到「標題與網址」，擇一；以不離開面板為優先，D-008）。
  - **沒填**：醒目但不擋發布（跟 Q-1 現況一致，只提醒），文案講後果，例如「沒填網址，WordPress 會用標題自動產生（中文標題會變成一長串編碼）」，
    旁邊直接一顆「建議網址」。點建議的其中一個才填（D-026 規則不變：不自動填、可再改）。
  - 日記（網址是日期，D-026 不建議）：只顯示網址，不給建議按鈕；空的照實際行為講（例如會用日期標題）。
- **建議網址的 UI 抽成共用元件**（例如 `src/ui/components/SlugSuggest.tsx`），「標題與網址」面板與發布面板共用同一個，不複製兩份；
  計時器、能不能按（另一個 AI 動作在跑、標題沒存…）、錯誤文案照 P5-T026 現行。
- **改網址跟核准的關係照現行規則**（state-machine.md／核准失效規則，不另發明）：
  如果在面板裡改網址會讓核准失效，改之前要講清楚「改網址要重新核准」，改完面板回到要核准的狀態，**不默默失效**；
  如果現行規則網址不在核准範圍，照做並在 spec 寫明。實作前先查清楚現行規則再決定。
- fixtures（`?fixtures=1`）：一篇沒填網址的長文打開發布面板能重現提醒與建議。
- spec：agent-tasks.md（建議網址的入口多一處）、design-system.md（發布面板的網址列）、architecture.md 功能地圖。

### 不包含
- 改已發布文章的網址（Q-5：沒有這條路）。
- 發布前強制要填網址。
- 改 Agent 建議網址的 prompt 或後端。

## 工作區與 Context
### 必讀入口
`src/ui/components/PublishSheet.tsx`、`src/ui/components/panels/SourcePanel.tsx`（現有建議網址 UI，D-026）、`docs/specs/agent-tasks.md`「建議網址」節、
`docs/specs/state-machine.md`（核准失效）、`docs/specs/design-system.md`（發布面板）。
### 不應載入
`docs/archive/`、查證、配圖、ProofView（另一個 Task P5-T038 正在改，避免衝突）。
### 驗證命令
`npm run verify`；畫面用 `node scripts/ui-drive.mjs` 搭 `?fixtures=1` 截圖。

## 實作要求
- 先寫測試再實作（純函式放 `src/contract` 或 `src/ui/lib`；Vitest 沒有 DOM）。
- 不呼叫真實 Agent CLI、不連真實 WordPress（含經 dev server 的 `/api/wordpress*`、`/api/setup/*`）、不啟動或重啟主目錄的 dev server、不 commit、不用 `git stash`。
- 只在 worktree 內改；不設 `GALLEY_DATA_DIR`（worktree 有自己的 `.galley-data/`）。
- 不改 `src/ui/components/Workspace.tsx`、`ProofView.tsx`、`MediaPanel.tsx`（P5-T038 在改）；真的需要就停下來回報。
- Vite 只在 worktree、非 3000／5173 埠、`--cacheDir` 指 scratchpad，用完關掉。

## 驗證
### 自動驗證
`npm run verify` 綠。
### 手動驗證（使用者）
開一篇沒填網址的長文 → 打開發布面板 → 看到提醒 → 按建議網址 → 點一個 → 面板顯示新網址 → 存草稿，後台網址正確。只存草稿，不公開。

## 完成定義
- [ ] `npm run verify` 綠
- [ ] 擁有這些行為的 spec 已更新（新增或搬動功能：architecture.md 功能地圖）
- [ ] 留下的殘餘已寫進 `docs/known-issues.md`
- [ ] CURRENT_TASK 已更新（主 session 統一更新）

## 中斷／接手紀錄
- 最後完成：實作＋測試＋spec＋known-issues；獨立審查四條（沒存的網址照樣能發布、儲存分類清掉打好的字、Escape 關面板丟字、存網址中還能按發布）已修；PR #25 Codex 審查 P2（存網址中關面板重開後發布鈕又能按）已修；`npm run verify` 綠（89 檔／1975 測試）
- 已通過驗證：`?fixtures=1` 實測審查四條（打字沒存→發布鈕反灰＋旁邊「存網址」；儲存分類後字還在；Escape 只還原字、面板留著；存網址中發布鈕反灰）；截圖（f-noslug 沒填提醒→建議→點一個→存網址→面板顯示新網址、按鈕回到「核准並存成草稿」；f-approved 改網址先講要重新核准、存後「舊的核准已經作廢」；f-previewed 日記清空網址只顯示說明）
- 下一步：主 session 複查 P2 修正、使用者手動驗證（只存草稿）、commit 進 PR #25
- Blocker：無

## 完成結果
- 現行規則：`slug` 在 templateData 裡、進 content hash（`content-hash.ts` 的 fields），改網址＝`createRevision`＝核准作廢、PREVIEWED／APPROVED 退回 RENDERED（state-machine.md「核准失效的實作點」）。
  照做，不另發明：有核准時編輯列先講「改網址等於換一版內容：現在的核准會作廢…」，存了之後面板既有的「舊的核准已經作廢」與「核准並…」照常出現。
- 共用元件 `src/ui/components/SlugSuggest.tsx`（從 SourcePanel 搬出，多 `pickHint`、`disabled`，`useId` 取代寫死的 id）；判斷在 `src/ui/lib/publish-slug.ts`。
- 示範資料：新增 `f-noslug`（「AI未來已來 - 1」，沒填網址）；`createRevision` 改成 templateData 整份取代（跟後端一樣，清空網址才真的清掉）。
- 審查修正：網址框的值、開關、存的動作提到 `PublishSheet`；有沒存的改動或正在存時擋發布（`slugPublishBlocker`），發布鈕旁附「存網址」；換版本只在框裡沒改動時同步（`nextSlugDraft`）；Escape 照 `slugEscapeAction`，有改動時在 window 捕獲階段攔下只還原字（沒改 `Sheet.tsx`）。
- PR #25 Codex 審查 P2：「還在存網址」從元件搬到模組層級 `src/ui/lib/slug-save-store.ts`（`runSlugSave`／`isSlugSaving`），面板關掉重開照樣擋發布；存網址中 Escape 被擋（`slugEscapeAction` 回 `block`）。關閉鈕／遮罩沒擋（要改 `Sheet.tsx`），記在 known-issues。
