---
id: P5-T031
phase: 5
status: done
depends_on: [P5-T029]
specs: [design-system.md, review-proposals.md]
write_paths: ["src/ui/", "src/core/service.ts", "src/contract/", "src/server/routes/", "tests/", "docs/specs/core-service.md", "docs/specs/http-api.md", "docs/specs/design-system.md", "docs/specs/review-proposals.md", "docs/tasks/P5-T031-edit-jump-to-title.md", "docs/CURRENT_TASK.md"]
contract_change: none
expected_commit: "fix(P5-T031): 講標題的建議按「去原文改」，游標跳到標題"
---

# 講標題的建議按「去原文改」，游標跳到標題

## 目標
D-030 的延伸（P5-T029 讓打字模式裡的標題可以直接改）。使用者 2026-09-30 實測：AI 校稿的觀察「標題是『hello』，看起來像佔位用的暫定標題」，
按卡片的「去原文改」只進入打字模式，游標沒有跳到標題。

原因：`src/ui/components/ProofView.tsx` 的 `editTarget` 只在正文（`body`）裡找引用的字；標題（`.preview-title`）不在搜尋範圍，
找不到就退回「文章開頭」。之後還固定 `body.focus()`。

## 範圍
### 包含
- 卡片的「去原文改」／「自己改」：沒有段落（`blockIndex === null`）而正文裡找不到引用的字時，到打字模式可編輯的標題裡找；找到就把游標放在標題裡、
  標色照正文的做法（標那段字），並讓焦點落在標題上（不要被 `body.focus()` 拉回正文）。
- 正文找得到的照舊優先；標題也找不到的照舊（文章開頭）。`unappliable` 的提示文字邏輯不變。
- `?fixtures=1` 能重現並驗證（示範資料裡若沒有講標題的觀察，加一條）。
- **只改標題也讓卡片結案**（審查 medium，2026-09-30 使用者同意擴大範圍）：從卡片進來、只改標題就儲存時，那張卡片照 P5-T012 一起結案。
  後端 `createRevision` 目前規定 `resolveItemId` 只能跟 `editedBody` 一起用，放寬成搭配 `editedTitle` 也可以；「沒有實質改動就不結案」的判斷要涵蓋標題。
  前端 `Workspace.tsx` 存檔條件改成正文或標題有改就帶上。
- 擁有這個行為的 spec（`design-system.md` 或 `review-proposals.md` 裡講「自己改」游標位置的那段）補一句。

### 不包含
- 讓 AI 直接提出新標題、一鍵套用（另案，需要新裁定）。
- 模板規則「AI 不改標題」。

## 實作要求
- 先寫測試（UI 測試照現有 ProofView／Workspace 測試的做法；抽出純函式測也可以）。
- 測試不呼叫真實 CLI、不連真實 WordPress。

## 驗證
### 自動驗證
`npm run verify` 綠。
### 手動驗證
使用者：講標題的建議 → 按「去原文改」→ 游標在標題、可以直接改 → 儲存。

## 完成定義
- [x] `npm run verify` 綠
- [x] 擁有這些行為的 spec 已更新
- [x] CURRENT_TASK 已更新

## 中斷／接手紀錄
- 最後完成：實作＋審查 medium 修正（2026-09-30）。
  - 游標跳標題：判斷抽到 `src/ui/lib/edit-target.ts`（`locateEditCaret`），`ProofView` 的 `editTarget` 沒有段落、正文找不到時到標題找，焦點給標題。
  - 只改標題也結案：`createRevision` 的 `resolveItemId` 放寬成配 `editedBody` 或 `editedTitle`；標題跟目前只差在空白（`sameTitle`）
    沿用目前標題，不建版本、不結案。`Workspace.tsx` 正文或標題有改就帶 `resolveItemId`；fixtures 同步（含待處理數重算）。
  - 示範資料 `f-reviewed` 加一條講標題的觀察（9007，待處理 5→6）；design-system／review-proposals／core-service／http-api 各補一句。
- 已通過驗證：`npm run verify` 68 檔 / 1408 測試全綠（新增 `tests/edit-jump-to-title.test.ts` 7 條、`review-proposal.test.ts` 3 條）；
  `?fixtures=1#/jobs/f-reviewed` 用 `scripts/ui-drive.mjs` 實點：「「20260828」→ 去原文改」焦點在標題、標題標黃，打字進標題；
  改成 `X20260828` 按儲存 → 卡片離開待處理、還有 6 項 → 5 項、標題更新。
- 下一步：監工審查 → commit；使用者手動驗證（真實稿件講標題的建議 → 去原文改 → 改標題 → 儲存，只存草稿）
- Blocker：無

## 完成結果

- 獨立審查（2026-09-30）：一條 medium（只改標題存檔卡片不結案）→ 使用者同意擴大範圍，已修（後端 `resolveItemId` 可配 `editedTitle`）。
  一條 low 不修：示範用的 `diaryReview()` 重新校稿套到別篇時，9007 會講不存在的標題（其他示範建議原本就同樣）。
- 標題只差空白不建版本，對所有只改標題的存檔生效；spec 原本就這樣定義，目前也沒有 MCP 入口（`src/mcp` 是空的），不影響既有行為。
