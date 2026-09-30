---
id: P5-T031
phase: 5
status: ready
depends_on: [P5-T029]
specs: [design-system.md, review-proposals.md]
write_paths: ["src/ui/", "tests/", "docs/specs/design-system.md", "docs/specs/review-proposals.md", "docs/tasks/P5-T031-edit-jump-to-title.md", "docs/CURRENT_TASK.md"]
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
- [ ] `npm run verify` 綠
- [ ] 擁有這些行為的 spec 已更新
- [ ] CURRENT_TASK 已更新

## 中斷／接手紀錄
- 最後完成：開 Task（2026-09-30）
- 已通過驗證：—
- 下一步：派 subagent 實作
- Blocker：無

## 完成結果
