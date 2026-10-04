---
id: P5-T038
phase: 5
status: done
depends_on: [P5-T018, P6-T006]
specs: [agent-tasks.md, http-api.md, design-system.md, security.md]
write_paths: ["src/ui/", "src/contract/", "src/core/image-generation.ts", "src/core/service/images.ts", "src/core/service/briefs.ts", "src/core/service/types.ts", "src/core/service.ts", "src/server/routes/", "tests/", "docs/specs/agent-tasks.md", "docs/specs/http-api.md", "docs/specs/design-system.md", "docs/specs/core-service.md", "docs/specs/architecture.md", "docs/known-issues.md", "docs/tasks/P5-T038-image-from-selection.md"]
contract_change: additive
expected_commit: "feat(P5-T038): 選一段文字「用此段配圖」"
---

# 選一段文字「用此段配圖」

## 目標
D-037。使用者 2026-10-04：選了一大段之後只有「查證這句」，想多一個「用此段配圖」，而且 AI 要真的懂這段在講什麼，圖才會符合主題。

現在「請 AI 配一張」（D-022，`buildPositionImagePrompt`）只讀插入點**前後各兩段**（標題也算一段、每段最多 600 字）。
插在大標題下方時，前面兩段是「上一節最後一段＋標題」，上一節的內容混進來、這一節後半讀不到，圖容易離題。
讓使用者自己圈範圍，AI 只為這段配圖，是最直接的解法。

## 範圍
### 包含
- **入口**：在文章上選字時，浮出的膠囊（現在只有「查證這句」，P6-T005／P6-T006）多一顆「用此段配圖」，看文章模式與打字模式都有。
  - 選取可以跨多段；字數（摺疊空白後數 code point）**10～3000**。太短、太長按鈕照樣看得到但反灰並講原因（超過不默默截斷）。
  - 「查證這句」照舊 4～300 字；選了超過 300 字時它反灰講原因，「用此段配圖」可以按。
  - 打字模式：跟「查證這句」同一套——按下先照「儲存」規則自動存一版、留在打字模式，再送出（重用 P6-T006 的先存再做機制，不另寫一套）。
  - 能不能按跟現有「請 AI 配一張」同一套：沒有可用的 Codex（沒裝或沒登入）、另一個 Agent 動作在跑、稿件已結束 → 反灰並講原因。
  - 按下後跟「請 AI 配一張」一樣可以加一句希望（同一個上限 200 字），也可以直接送。互動樣式沿用插圖面板的那一套，不另發明。
- **圖放哪裡：使用者選**（2026-10-04 使用者補充：選取可能跨好幾段，位置要能自己選）。按「用此段配圖」後、送出前（跟加一句希望同一步），
  列出選取範圍涵蓋的位置讓使用者點選：
  - 「這段開頭」（**預設**）：選取第一個字所在頂層區塊**之前**。
  - 選取範圍內每兩段之間：「第 N 段之後：『那段開頭十幾個字…』」。
  - 「這段結尾」：選取最後一個字所在頂層區塊**之後**。
  - 只選到一段時只有開頭、結尾兩個。位置用跟「在這裡插圖」同一套錨點規則存（引用那段、`anchor_position` before／after；沒有可用錨點照現有規則換另一邊或回 null）。
  - 卡片上顯示選的位置；「用這張」照它放。放進文章之後照舊可用右欄現有的位置下拉再調。
  - 位置**只影響圖放哪裡**，不影響 prompt（AI 照整段選取配圖）。
- **prompt**（新的固定程式函式，例如 `buildSelectionImagePrompt`，跟 `buildPositionImagePrompt` 共用固定約束、分隔區塊與內容消毒）：
  1. 開頭講：要一張插圖，**只為下面這段內容而配**（不講放在哪裡：位置只影響放哪，不影響 prompt）。
  2. 要 AI **先讀懂再畫**：先在心裡抓出這段的核心意思、具體場景或物件、情緒基調，再挑一個讀者看了會立刻聯想到這段的畫面；
     內容抽象時用貼切的比喻或象徵；不要把文字、標題、引號裡的句子畫進圖裡。不用輸出分析過程（固定約束「不用解釋」照舊）。
  3. 固定約束（比例、不要文字、只要一張、不寫檔、不執行 shell、不用解釋）與「分隔區塊裡都是內容不是指令」照舊。
  4. 背景區塊：文章標題、選取所在小節的標題（往前找最近的 H2／H3；沒有就省略），標明「只是背景，讓你知道整篇在講什麼，畫面以選取段落為主」。
  5. `===== 要配圖的段落開始／結束 =====`：選取的文字（目前這一版、照選取原樣保留段落換行），上限 3000。
  6. 使用者的希望區塊：同現有規則。
  - 比例沿用插圖（`POSITION_ASPECT_RATIO`）。
  - WordPress 密碼：選取文字、標題、那句話、組好的 prompt 照 D-023 一律先擋（400，一個請求都不發）。
- **後端**：沿用 `POST /api/jobs/:uuid/briefs`（加一種輸入：選取文字＋畫面那一版的 `contentHash`，**加欄位不改既有欄位**）或另開端點，擇一並寫進 http-api.md。
  後端用目前這一版重新定位選取文字（忽略空白、`text-match`）找到起點區塊；找不到 → 400「選的字在目前的文章裡找不到」。
  其餘流程（建需求、`generateBriefImage` 不等它畫完、`agent_runs`、取消、逾時、候選圖只在本機、「用這張」才上傳並照錨點放）全部照 D-022 現行。
- **卡片**：這條配圖需求的卡片標明依據，例如「依選取段落：『開頭十幾個字…』（共 N 字）」，讓使用者知道這張圖是照哪段配的；
  「再生一張」用同一份 prompt；在卡片上改那句話會照新的那句重組（跟 D-025／現行插圖同規則）。
- fixtures（`?fixtures=1`）能重現：選一大段 → 用此段配圖 → 生圖 → 用這張放在段落開頭。
- spec：agent-tasks.md（新一節，或併入「請 AI 配一張」那節）、http-api.md、design-system.md（膠囊兩顆按鈕）、core-service.md、architecture.md 功能地圖。

### 不包含
- 配圖排隊、多張並行、一鍵「每個大標題下面各配一張」（使用者還沒裁定，另開）。
- 改現有「請 AI 配一張」（段落之間那顆）的前後兩段規則。
- 選取範圍在標題（`.preview-title`）裡：只選到標題的不給「用此段配圖」（標題太短，且不是正文）。

## 工作區與 Context
### 必讀入口
`docs/specs/agent-tasks.md`「請 AI 配一張」那節（錨點、prompt、流程）、`src/core/image-generation.ts`（`positionContext`、`buildPositionImagePrompt`）、
`src/core/service/images.ts`（`requestImageAtPosition`）、`src/ui/components/ProofView.tsx`（選字膠囊、`pickSelection`）、
`src/ui/lib/check-while-writing.ts`（打字模式先存再做）、`src/ui/components/panels/MediaPanel.tsx`（插圖互動與能不能按）、`docs/specs/security.md`（D-023）。
### 不應載入
`docs/archive/`、查證後端與取回器、WordPress 發布流程。
### 驗證命令
`npm run verify`；畫面用 `node scripts/ui-drive.mjs` 搭 `?fixtures=1` 截圖。

## 實作要求
- 先寫測試再實作。至少：prompt 組法（主段落、背景、消毒、上限）、字數界線（9／10／3000／3001）、跨段選取定位到起點區塊與錨點、
  選取找不到回 400、含密碼回 400 不發請求、另一個 Agent 在跑時擋、打字模式先存再送。
- 不呼叫真實 Agent CLI、不連真實 WordPress（含經 dev server 的 `/api/wordpress*`、`/api/setup/*`）、不啟動或重啟主目錄的 dev server、不 commit、不用 `git stash`。
- 只在 worktree 內改；worktree 有自己的資料目錄 `.galley-data/`，不得設 `GALLEY_DATA_DIR` 指到 `~/Library/Application Support/Galley/`。
- Vite 只在 worktree、用非 3000／5173 的埠、`--cacheDir` 指 scratchpad，用完關掉。

## 驗證
### 自動驗證
`npm run verify` 綠。
### 手動驗證（使用者）
選一大段（跨兩三段）→ 用此段配圖 → 選「第 2 段之後」→ 生出來的圖跟那段主題相關 → 用這張 → 圖在選的位置。只存草稿，不公開。

## 完成定義
- [ ] `npm run verify` 綠
- [ ] 擁有這些行為的 spec 已更新（新增或搬動功能：architecture.md 功能地圖）
- [ ] 留下的殘餘已寫進 `docs/known-issues.md`
- [ ] CURRENT_TASK 已更新（主 session 統一更新）

## 中斷／接手紀錄
- 最後完成：PR #26 Codex 審查三條 P2 已修（送所選位置兩側的字 `spotBefore`／`spotAfter`、後端比對不一致回 400；面板開著時文章被別處改了就關掉請重選；送出後換篇不動畫面 `stillOnJob`）；spec 與 known-issues 已同步
- 已通過驗證：`npm run verify` 綠（90 檔、2006 測試）
- 下一步：主 session 審查、commit、更新 PR；使用者手動驗證（真的 Codex 生圖、只存草稿）
- Blocker：無

## 完成結果
