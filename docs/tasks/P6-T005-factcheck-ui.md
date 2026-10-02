---
id: P6-T005
phase: 6
status: in_progress
depends_on: [P6-T004]
specs: [factcheck.md, design-system.md, review-proposals.md, architecture.md]
write_paths: ["src/ui/components/Factcheck*.tsx", "src/ui/components/SuggestionColumn.tsx", "src/ui/components/ProofView.tsx", "src/ui/components/AgentButton.tsx", "src/ui/components/AgentProgress.tsx", "src/ui/components/Workspace.tsx", "src/ui/components/PublishSheet.tsx", "src/ui/lib/factcheck-view.ts", "src/ui/lib/stage-view.ts", "src/ui/lib/agent-tasks.ts", "src/ui/lib/review-kinds.ts", "src/ui/service/client.ts", "src/ui/service/types.ts", "src/ui/service/fixtures.ts", "src/ui/service/fixtures/factcheck.ts", "src/ui/service/fixtures/data.ts", "src/ui/service/fixtures/store.ts", "src/ui/service/fixtures/agent.ts", "src/ui/service/fixtures/content.ts", "src/ui/service/fixtures/jobs.ts", "src/ui/styles/25-factcheck.css", "src/ui/styles/index.css", "src/ui/styles/01-tokens.css", "tests/factcheck-view.test.ts", "tests/stage-view.test.ts", "tests/agent-progress.test.ts", "docs/specs/design-system.md", "docs/specs/review-proposals.md", "docs/specs/agent-tasks.md", "docs/specs/architecture.md", "docs/specs/factcheck.md", "docs/tasks/P6-T005-factcheck-ui.md"]
contract_change: none
expected_commit: "feat(P6-T005): AI 查證的畫面"
---

# AI 查證的畫面

## 目標
D-034、D-008（不離開發布台）、D-010（一鍵、慢可以不確定不行）。把 P6-T004 的查證接到 B 版文件式畫面：
三個不用打字的入口、分段進度、右欄卡片、文章上的標記、就地看原文、發布面板提醒。

## 範圍
### 包含
- 三個入口：觀察卡片的「查證」、選字「查證這句」、按鈕列「一鍵查證」；選 Antigravity 時的說明；反灰條件與原因。
- 進度：`AgentProgress` 分段文字（找來源／抓網頁／判斷／核對）、計時器、停止；全部抓不到時的說明。
- 右欄查證卡片（跟校稿卡片混排、依段落順序）、判定文案、來源列（`origin`、核對結果、看原文就地展開）、降級說明、
  跳到該段／去原文改／知道了、「已處理」裡的查證（含「原句已經改了」）。
- 文章上的查證標記（跟校稿不同的樣式，一對一對應）；`ProofView` 的 `HIGHLIGHT_COLORS` 跟 tokens 一起改。
- 發布面板提醒「有 N 條查證說法不同」（不擋）。
- 示範資料（`?fixtures=1`）：每種判定、降級、抓不到、原句已經改了、跑中的四個階段；規則用 `src/contract`，不重寫。
- 文件：design-system.md（版面與文案）；review-proposals.md「統一模型」裡舊的 emoji 查證示意改成指向 factcheck.md；agent-tasks.md「執行中的回饋」的「四件事」加上查證變五件；architecture.md 功能地圖加一列。
- 來源抓不到時把原因（例如「網址含文章原句，沒抓」）顯示在來源旁。
### 不包含
- 後端與契約（P6-T004 已做；畫面需要的欄位不夠就停下回報，不自己改 `src/contract`）。
- MCP。

## 工作區與 Context
### 必讀入口
`docs/specs/factcheck.md`「觸發與畫面」、`docs/specs/design-system.md`（品質底線、文案、「在這裡插圖」的膠囊）、
`docs/specs/review-proposals.md`「統一模型」「`blockIndex` 每次讀取時重算」、`docs/specs/agent-tasks.md`「執行中的回饋」。
### 不應載入
`src/core/`、`src/fetch/`、`src/agents/`、`docs/archive/`。
### 驗證命令
`npx vitest run tests/factcheck-view.test.ts tests/stage-view.test.ts tests/agent-progress.test.ts`、`npm run verify`；畫面用 `npm run dev` 開 `?fixtures=1`（不用後端）。

## 實作要求
- **測試絕不呼叫真實 CLI、絕不連真實網路**；自動測試只測純函式（卡片文案、降級說明、排序、反灰條件、進度文字）。
- 抓回的文字（evidence、quote、context）一律當純文字顯示，不用 `dangerouslySetInnerHTML`。
- 圖示用 Lucide SVG，不用 emoji；判定不只靠顏色。對比 4.5:1、焦點看得見、`prefers-reduced-motion`。
- `correction` 只顯示，不提供「一鍵套用」。
- 先寫測試再實作。

## 驗證
### 自動驗證
`npm run verify` 綠。
### 手動驗證
**使用者真跑一次查證**（只在本機，不核准、不發布、不碰 WordPress）：
- Codex、Claude 各跑一次選字查證與一鍵查證：結果卡片合理、引文核對結果跟「看原文」對得上、停止有效。
  同時確認三件未證實的事：Codex 的 `-c web_search="cached"` 有生效（第一趟真的給得出搜尋來的網址）、Claude `-p` 下 `WebSearch` 能用、`--tools WebSearch` 搭配 `--json-schema` 仍回得出結構化輸出。
- agy 跑一次：按鈕旁有說明、來源只有維基百科與 AI 給的網址。
- 中文維基的引文是繁體。
- `?fixtures=1` 把每種卡片、四個階段看一遍。

## 完成定義
- [x] `npm run verify` 綠
- [x] 擁有這些行為的 spec 已更新（design-system.md、review-proposals.md、architecture.md 功能地圖）
- [x] 留下的殘餘寫進完成結果（由主 session 併入 `docs/known-issues.md`）
- [ ] CURRENT_TASK 已更新（由主 session）
- [ ] 使用者真跑過一次查證

## 中斷／接手紀錄
- 最後完成：Codex 審查（PR #21）修正（2026-10-02，工作樹、未 commit）：查證完成的後續只寫回發起那一篇（換篇不串）；送出中也輪詢；「忙」統一一個條件（輪詢、改原文、卡片進編輯）；只在標題的查證在標題上標字
- 已通過驗證：`npm run verify` 綠（84 檔／1860 測試；新增 `tests/factcheck-view.test.ts`，`stage-view`、`agent-progress` 加測試）；`?fixtures=1` 用 ui-drive 截圖看過（含 1024px）
- 下一步：主 session 審查 → commit 到 PR #21 → 使用者真跑一次查證（手動驗證那幾項）
- Blocker：無（write_paths 夠用；`icons.tsx` 不在範圍內，新圖示放在 `FactcheckIcon.tsx`）

## 完成結果
- 實作（2026-10-02）：
  - 純函式 `src/ui/lib/factcheck-view.ts`（判定／來源文案、降級說明、核對結果、`safeHref`、看原文的引文定位、混排排序 `mergeByBlock`、
    反灰原因 `factCheckBlockedReason`、四段進度 `progressSteps`、最近一次的說明 `latestRunNote`、Antigravity 說明）；`stage-view.ts` 加 `canSelectToFactCheck`；
    `AgentProgress` 的 `waitingNote` 加查證。
  - 畫面：`FactcheckCard.tsx`（卡片、來源列、看原文）、`FactcheckIcon.tsx`（search-check、circle-help、info、circle-alert 四個 Lucide 圖示）、
    `SuggestionColumn`（混排、「查證 N」篩選、觀察卡片的「查證」、已處理合併、最近一次說明、查證期間鎖住接受／自己改／整份採用）、
    `ProofView`（highlight key 改成字串 `r<id>`／`f<id>`、查證虛線標記、同一句兩種標記巢狀、選字膠囊、`factCheckId` 的編輯請求）、
    `AgentButton`（選單「一鍵查證」、跑時主按鈕照 task 講）、`AgentProgress`（分段進度）、`PublishSheet`（說法不同提醒）、
    `Workspace`（讀 `GET …/factchecks`、三個入口、去原文改帶 `resolveFactCheckId`、停止不當錯誤、查一句跑完自動亮那張）。
  - client／types 加 `runFactCheck`、`listFactChecks`、`dismissFactCheck`；示範資料 `fixtures/factcheck.ts`＋稿件 `f-factcheck`。
  - 樣式 `25-factcheck.css`；token `--kind-check`／`--kind-check-bg`（深淺兩組），`HIGHLIGHT_COLORS.factcheck` 同色。
  - spec：design-system（AI 查證一節、色表）、review-proposals（統一模型的 emoji 示意改成指向）、agent-tasks（五件事、查證期待值與分段）、
    architecture 功能地圖、factcheck（實作補充）。
- 殘餘（由主 session 併入 known-issues）：
  1. 「這家能不能只開搜尋」前端寫死 `provider !== 'google'`：按之前沒有 API 問得到（`AgentRegistry.supportsHostedSearch` 只在後端）。要根治得在契約加欄位（例如 `GET /api/agents` 帶 `hostedSearch`）。
  2. 畫面上那一家叫「Gemini」，spec 原文寫「Antigravity」，說明寫成「Gemini（Antigravity）…」。頂端長條沿用舊行為顯示 provider id（「google 正在查證…」），跟其他地方的「Gemini」不一致（既有問題，不是這次引入）。
  3. 選字膠囊實際上只對滑鼠選取有用（非編輯狀態的 iframe 用鍵盤選字很難）；鍵盤使用者走「一鍵查證」或觀察卡片。
  4. 標記重疊：校稿先包、查證後包。完全同一段字時查證包在校稿裡面（點一次亮查證、再點換校稿）；**部分重疊時丟的是查證那邊**——查證不標字，點卡片退回只框出那一段；校稿標記維持原本的樣子。
  5. 頂端長條的「會用掉兩次額度」在一份都沒抓到（第二趟不跑）時沒有改口；分段那一行會講「只用掉一次額度」。
  6. 示範資料：種子結果的 `blockIndex`／`excerptGone` 寫死；**選字查證跑出來的新結果**用 `text-match` 在示範正文裡找段落（沒有種子可寫死，也沒搬後端前處理）；示範模式改了文章之後不會重算「原句已經改了」。
  7. `FactcheckIcon.tsx` 是因為 `icons.tsx` 不在寫入範圍；下一個碰 icons 的 Task 可以搬過去。
  8. 手動驗證（真跑 Codex／Claude／agy、Codex `web_search="cached"`、Claude `-p` 的 `WebSearch`＋`--json-schema`、中文維基繁體）**還沒做**，要使用者跑。
- 備忘（P6-T004 審查，2026-10-01）：`excerptGone`／`blockIndex` 由後端以 `articleTextForAgent` 處理後的文字計算並經 API 回傳；示範資料若要自己算，須先把該前處理搬進 `src/contract`（目前在 `src/core/factcheck-prompts.ts`，依賴 `image-generation.ts` 的 `neutralize`），另需放寬 write_paths。
