---
id: P5-T025
phase: 5
status: done
depends_on: []
specs: [agent-tasks.md, http-api.md, core-service.md, security.md, design-system.md]
write_paths: ["src/core/", "src/contract/", "src/server/routes/", "src/ui/", "tests/", "docs/specs/", "docs/tasks/P5-T025-edit-image-prompt.md", "docs/CURRENT_TASK.md"]
contract_change: additive
expected_commit: "feat(P5-T025): 配圖的 prompt 可以在卡片上直接改"
---

# 配圖的 prompt 可以在卡片上直接改

## 目標
D-025。配圖需求卡片（`MediaPanel.tsx` 的 `BriefCard`）上的 prompt 只能看；後端沒有修改配圖需求的路由。
使用者想調畫面只能複製 prompt 到別處，違反 D-008。

## 範圍
### 包含
- **Agent 建議的那條**（`origin = 'agent'`，含封面）：卡片上的 prompt 可以切到編輯（文字框）、「存」／「取消」。
  存的是 `image_briefs.prompt`（畫面描述）；生圖時照舊由 `buildImagePrompt` 包進固定約束。
- **使用者發起的那條**（`origin = 'user'`，D-022）：它的 `prompt` 是系統組好的整份指令，不給人直接改。
  可改的是「想要：…」那句（`user_note`，沿用 `USER_NOTE_MAX` 與 `normalizeUserNote`），存的時候由
  `buildPositionImagePrompt` 用**目前這一版**的內容與既有錨點重組 `prompt`。錨點在目前內容對不上時：照存 note，
  prompt 怎麼處理由實作者判斷並寫進 spec（不可以默默用舊段落卻不講）。
- 後端新路由（建議 `PATCH /api/jobs/:uuid/briefs/:id`，放 jobs 路由那組、走同一套守門），CoreService 新方法，
  共用契約（`src/contract/`）補型別；回傳更新後的 brief 或整個 job，照現有慣例。
- 後端用原始規則再驗一次：非空、長度上限（agent prompt 定一個合理上限並寫進 spec；note 用 `USER_NOTE_MAX`）、
  含已知 WordPress 密碼直接拒絕（沿用 D-023／P5-T023 正文那一套檢查，不是只遮）。
- 已 fulfilled 的 brief 也可以改（之後可能要重生替換）。已被刪除（dismissed）的 404 或照現有慣例拒絕。
- 正在替這條 brief 生圖時：不准改（回明確錯誤；UI 停用編輯並說明「Codex 正在畫這張，等它跑完再改」）。
- 已經生好的候選圖（`candidate`）保留，不因改 prompt 而刪；再按生圖就用新的 prompt。
- `?fixtures=1` 的假資料服務（`src/ui/service/fixtures.ts`）同步支援，示範畫面能改。
- spec 更新：`agent-tasks.md`（可編輯的規則）、`http-api.md`（新路由）、`core-service.md`（新方法）。

### 不包含
- 改比例、alt、錨點位置（之後需要再開）。
- 讓 AI 重寫 prompt。
- 任何 migration（欄位都已存在；若真的需要，先停下回報）。

## 工作區與 Context
### 必讀入口
`src/ui/components/panels/MediaPanel.tsx`、`src/core/image-generation.ts`、`src/core/service.ts`（brief 相關方法）、
`src/core/repository.ts`、`src/server/routes/jobs.ts`（`/briefs/:id` 附近）、`docs/specs/agent-tasks.md`「配圖需求」與 D-022 節。
### 不應載入
`docs/archive/`、跟配圖無關的 spec。
### 驗證命令
`npm run verify`；UI 截圖用 `node scripts/ui-drive.mjs`（`?fixtures=1`）。

## 實作要求
- 改 prompt **不影響核准**：配圖需求不是文章內容（確認一次 `state-machine.md` 沒把 brief 算進內容雜湊；若有，停下回報）。
- 先寫測試再實作：core（agent／user 兩種、長度、密碼、生圖中拒絕、dismissed、user 的 prompt 重組）、HTTP 路由（含守門）。
- 文案照 `design-system.md`：白話、不用「prompt」以外的術語；按鈕「存」「取消」。
- 測試不呼叫真實 CLI、不連真實 WordPress。

## 驗證
### 自動驗證
`npm run verify`
### 手動驗證
使用者在發布台：一鍵配圖 → 改封面那條的 prompt → 存 → 用 Codex 生圖，確認畫面照新描述。只存草稿。

## 完成定義
- [ ] `npm run verify` 綠
- [ ] 擁有這些行為的 spec 已更新
- [ ] CURRENT_TASK 已更新

## 中斷／接手紀錄
- 最後完成：實作＋測試＋spec 更新（2026-09-27，未 commit）
- 已通過驗證：`npm run verify` 綠（60 檔 / 1090 測試，含審查後補修）；`?fixtures=1` 截圖走過 Agent 那條與使用者那條的改／存／超長／生圖中
- 下一步：主 session 審查 → commit；使用者手動驗證（一鍵配圖 → 改封面 prompt → 存 → Codex 生圖，只存草稿）
- Blocker：無

## 實作紀錄
- 路由 `PATCH /api/jobs/:uuid/briefs/:id`（`.strict()`，`prompt`／`note` 只能送一個）→ `CoreService.updateImageBrief`
  → `repo.updateImageBriefText`（只動 `prompt`、`user_note`；`agent_run_id` 不變，候選圖因此不過時）。回 `{ brief, notice }`。
- 共用契約：`UpdateImageBriefRequest`／`UpdateImageBriefResponse`（`src/contract/api.ts`），
  `src/contract/brief-prompt.ts`（`BRIEF_PROMPT_MAX = 2000`、去頭尾保留換行、數 code point；跟 Agent 輸出契約的 maxLength 同一個數字）。
- 使用者那條：錨點在目前這一版剛好對上一段 → 用目前的前後段落重組；對不上（改掉、不只一段、當初就沒有）→ 照存那句話，
  `replacePositionNote` 只換 prompt 最後那塊、前後段落沿用當初的，`notice` 講清楚（寫進 agent-tasks.md）。那句話可以清空。
- Codex 正在畫這張 → `AgentError`（502，跟「另一個 Agent 在跑」同一類）；稿件不能改 → 拒絕；dismissed → 跟生圖同一句 400。
- 事件 `image_brief_edited`（不記內容）。不影響核准：brief 不在 revision／`content_hash` 裡（state-machine.md 已確認）。
- UI：卡片上「改」（新增 pencil 圖示）→ 文字框＋計數＋「存」「取消」；改的時候不給生圖；生圖中「改」反灰並寫明。
- 基準：P5-T024 之後既有測試實際是 1062（CURRENT_TASK 記 1061，差 1，非本 Task 造成）；本 Task 新增 `tests/edit-image-brief.test.ts` 28 條。
- 審查後補修：`buildImagePrompt` 的畫面描述也過 `neutralize`（描述現在人也能改，做得出「畫面描述結束」那條線）；
  補測試（錨點不只一段、當初沒有錨點、舊指令認不出來、前後段落含密碼）；「正在畫這張」的測試改用可控的 promise 卡住假生圖，不靠計時器。
  「Agent 回同一個 key 會蓋掉改過的描述、復活按過不要了的」記在 agent-tasks.md，待使用者裁定。

## 完成結果
