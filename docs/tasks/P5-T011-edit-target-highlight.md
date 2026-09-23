---
id: P5-T011
phase: 5
status: done
depends_on: [P5-T010]
specs: [design-system.md]
write_paths: ["src/ui/components/ProofView.tsx", "docs/specs/design-system.md", "docs/tasks/"]
contract_change: none
expected_commit: "feat(P5-T011): 直接改文章時標出要改的地方"
---

# 直接改文章時標出要改的地方

## 目標
P5-T001 實測（使用者 2026-09-23）：從卡片按「去原文改」回到文章後，字多的時候找不到游標停在哪裡。

## 範圍
### 包含
- 進入編輯時，用螢光筆黃標出那一項引用的字；找不到字就標那一整段；從上方「改原文」進來不標
- 用 CSS Custom Highlight（`CSS.highlights`），不改 DOM：不會混進存檔的正文
- 離開編輯（儲存、取消、被中止）時清掉
### 不包含
- 不支援 Highlight API 的舊瀏覽器（只有游標，不標色）

## 驗證命令
`npm run verify`；`node scripts/ui-drive.mjs`

## 完成定義
- [x] 無頭 Chrome：去原文改 → `CSS.highlights` 有標記、範圍正好是引用的字、正文 HTML 沒被改；取消後標記消失
- [x] design-system.md 已更新

## 中斷／接手紀錄
- 最後完成：全部
- 已通過驗證：npm run verify；無頭 Chrome（示範資料）＋截圖
- 下一步：無
- Blocker：無

## 完成結果
`ProofView.tsx` 的 `editTarget`（原 `caretRange`）多回傳要標的範圍，`showEditTarget` 負責上色與清除。
