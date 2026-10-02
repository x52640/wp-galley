---
id: P5-T037
phase: 5
status: in_progress
depends_on: [P5-T031]
specs: [review-proposals.md, design-system.md]
write_paths: ["src/ui/", "src/core/service/review.ts", "src/core/service/types.ts", "src/contract/", "tests/", "docs/specs/review-proposals.md", "docs/specs/core-service.md", "docs/specs/http-api.md", "docs/specs/design-system.md", "docs/tasks/P5-T037-edit-target-fixes.md", "docs/CURRENT_TASK.md"]
contract_change: additive
expected_commit: "fix(P5-T037): 去原文改找得到被改過的原句並標黃；找不到要明講；打字時游標不被框線蓋住"
---

# 「去原文改」的兩個問題：被改過的原句標不出來、段首游標被框線蓋住

## 目標
使用者 2026-10-02 實測兩個問題：

1. **觀察卡「去原文改」沒有黃底。** 實例（job 17）：同一份校稿裡，改錯字的那條（`大腕→大碗`）已接受；
   另一條觀察（「事實・交代不足」）引用的原句是「那是被湯匙跟高麗菜撐出來的大腕」。文章裡現在是「大碗」，
   後端 `ReviewService.locateItem` 找不到 → `blockIndex: null` → `editTarget` 沒有目標，游標默默放文章開頭、不標色、也沒有提示。
   規格 `review-proposals.md`「畫面」那段早就寫「任何定位不到段落的卡片按自己改，頂端要講找不到」，
   但 `Workspace.startEdit` 只在 `unappliable` 時講——這條本來就是 bug。
2. **換段落後段首游標看不到。** 打字模式下正文用的是瀏覽器預設焦點框，緊貼文字左緣，游標在段首時疊在框線上。

## 範圍
### 包含
- **同一份校稿已接受的修改，讓觀察的原句跟著對應。** 觀察的 `excerpt` 在目前內容找不到時，拿同一份校稿裡
  已套用（`applied`）或已經改好了（`alreadyDone`）的 change，把 excerpt 裡**完整包含**的 `before` 換成 `after` 再找一次
  （依 ordinal 順序套）。找到了就用它算 `blockIndex`。部分重疊（excerpt 跟 before 只交疊一段）不處理，維持找不到。
- `ReviewItem` 加一個欄位（例如 `locatedText: string | null`）：後端實際在目前內容找到的那段字（原句找得到就是原句；
  靠上面對應找到的就是對應後的字；找不到 null）。**加欄位不改既有欄位**。UI 的字上標記（`highlightText`）與
  「去原文改」游標都用它，沒有它時退回原本的字。change 類照舊（套用前找 before、套用後找 after），不必走新規則，但欄位也要填。
- **找不到就明講**：任何卡片（校稿 change／觀察、查證 finding）按「去原文改／自己改」，最後游標落在 fallback
  且**沒有段落可標**（`editTarget` 回 `target: null` 但有要求的字）時，頂端顯示「文章裡找不到「…」，游標放在文章開頭。」
  （段落找得到、字找不到的照現行標整段，不另提示。）`unappliable` 原本的文案不變。
- **段首游標**：打字模式的正文焦點框跟標題一樣往外推（`outline-offset`，用 `proof-edit-dom.ts` 的 `WRITE_RULES`，
  CSSOM 插入，不改模板 CSS），游標在段首不再跟框線重疊。框線不能被 iframe 邊緣切掉（模板左右各有 1.25rem padding）。
- fixtures（`?fixtures=1`）重現兩種情境：一份校稿裡一條 change 已套用、另一條觀察引用套用前的字。
- 擁有這些行為的 spec 補一句（`review-proposals.md` 的定位規則與「畫面」段、`http-api.md`／`core-service.md` 的欄位）。

### 不包含
- 查證 finding 的原句對應（查證沒有「同一份校稿的已套用修改」這種關係；只做「找不到要明講」）。
- 模糊比對、編輯距離之類猜位置的做法（規格明定猜位置比不能跳更糟）。

## 實作要求
- 先寫測試：後端對應規則（含已套用、alreadyDone、部分重疊不處理、多條依序）、`locatedText` 欄位、UI 找不到的提示、焦點框規則。
- 測試不呼叫真實 CLI、不連真實 WordPress。

## 驗證
### 自動驗證
`npm run verify` 綠。
### 手動驗證
使用者：job 17 那張「湯匙」卡按「去原文改」→ 那句標黃、游標在句首；任一段段首按 Enter 換段 → 看得到游標。

## 完成定義
- [ ] `npm run verify` 綠
- [ ] 擁有這些行為的 spec 已更新
- [ ] CURRENT_TASK 已更新

## 中斷／接手紀錄

## 完成結果
