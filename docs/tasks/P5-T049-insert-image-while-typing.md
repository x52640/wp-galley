---
id: P5-T049
phase: 5
status: ready
depends_on: []
specs: [design-system.md, architecture.md]
write_paths: ["src/ui/", "src/contract/", "tests/", "docs/specs/design-system.md", "docs/specs/architecture.md", "docs/known-issues.md", "docs/tasks/P5-T049-insert-image-while-typing.md", "docs/CURRENT_TASK.md"]
contract_change: none
expected_commit: "fix(P5-T049): 打字模式也能插圖，圖片後按 Enter 不再變置中"
---

# 打字模式也能插圖，圖片後按 Enter 不再變置中

## 目標
D-048。使用者 2026-10-21 回報兩件事：
1. 打字模式看不到「在這裡插圖」，只能先按儲存、離開打字模式才能插。原因：P5-T016 故意在編輯中擋掉（打字時區塊一直變，「插在第幾塊之後」會對不上）。
   改法比照「用此段配圖」已有的「先存再做」（`actWhileWriting`，P5-T038／P6-T006）：按下時內容有改就先照「儲存」存一版、**留在打字模式**，再插。
2. 圖片在文章最尾端時，接著按 Enter 打的字變成置中。推測：圖片 figure 帶 `aligncenter`（`src/core/service/media.ts`），游標只能落在 figure 裡，
   Chrome 按 Enter 把 figure 的 class 帶給新段落（或新段落落在 figure 裡）。**先用 `?fixtures=1` 重現確認原因再修**，原因不同就照實際原因修並寫進這裡。

## 範圍
### 包含
- 打字模式也畫「在這裡插圖」；按下打開同一個插圖面板（上傳、選媒體庫、請 AI 配一張都可用，照原規則）。
  按下或送出時有未存改動就先存（跟「儲存」共用存檔狀態；存失敗就不插、講原因）。插完人留在打字模式、游標與捲動不亂跳。
- 插圖會改到正文：插完之後編輯區要看得到新圖，**存檔後到插圖完成之間又打的字不准掉**（memory：掉資料都算 bug）。做不到安全合併就在插圖期間擋打字並明講，不要靜靜蓋掉。
  跟 P5-T048 的自動留底（localStorage）要一致，不要插完又跳「已恢復…」。
- 在圖片 figure 裡（含它是最後一塊、游標在圖片後或圖說後）按 Enter：在 figure **下方**開一個乾淨 `<p>`（不帶 figure 的任何 class／style），游標移過去；
  圖說裡按 Enter 同樣跳出到下方新段落（不在圖說裡換行）。最後一塊是圖片時，要有辦法把游標放到圖片後面開始打字（點圖片下方空白或按 → ／ ↓ 都行，挑一種做好並寫進 spec）。
- 已經被弄成置中的段落：存檔整理時不用特別救（D-049 之後置中是合法格式），但這個 Task 不准再產生。
- `docs/specs/design-system.md`、`architecture.md` 功能地圖對應列更新；殘餘寫 known-issues。

### 不包含
- 段落對齊按鈕（P5-T050）。
- 拖曳移動圖片、圖片大小與對齊調整。

## 工作區與 Context
### 必讀入口
`src/ui/components/ProofView.tsx` 檔頭第五、六、七節、`InsertSlots.tsx`、`InsertImagePanel.tsx`、`src/ui/lib/use-proof-editing.ts`（`actWhileWriting`）、
`src/ui/lib/check-while-writing.ts`（hold）、`src/ui/lib/proof-edit-dom.ts`（Enter 處理）、`src/ui/lib/use-draft-backup.ts`、architecture.md 功能地圖「在文章上改」。
### 不應載入
agent、wordpress、factcheck spec。
### 驗證命令
`npm run verify`；`node scripts/ui-drive.mjs` 搭 `?fixtures=1` 截圖（打字模式插圖前後、圖片在最後一塊時按 Enter 打字）。

## 實作要求
- 先寫測試再實作：打字模式出現插圖鈕、有改動先存再插、存失敗不插、插完留在打字模式、存檔後又打的字不掉；
  figure 裡（圖後、圖說內、最後一塊）按 Enter 產生乾淨 `<p>` 在 figure 之後。
- 文字用繁體中文。

## 驗證
### 自動驗證
`npm run verify` 綠。
### 手動驗證（使用者）
打字模式寫一段不存 → 段落間「在這裡插圖」→ 上傳一張 → 圖出現、剛寫的字都在、還在打字模式；在最後一張圖後面按 Enter 打字 → 靠左 → 存草稿看後台。

## 完成定義
- [ ] `npm run verify` 綠
- [ ] 擁有這些行為的 spec 已更新（architecture.md 功能地圖）
- [ ] 留下的殘餘已寫進 `docs/known-issues.md`
- [ ] CURRENT_TASK 已更新

## 中斷／接手紀錄
- 最後完成：開 Task（2026-10-21）
- 已通過驗證：無
- 下一步：重現 Enter 置中、寫測試、實作
- Blocker：無

## 完成結果
