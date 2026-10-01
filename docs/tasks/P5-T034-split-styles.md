---
id: P5-T034
phase: 5
status: ready
depends_on: []
specs: [design-system.md, architecture.md]
write_paths: ["src/ui/", "tests/", "docs/specs/design-system.md", "docs/specs/architecture.md", "docs/tasks/P5-T034-split-styles.md", "docs/CURRENT_TASK.md"]
contract_change: none
expected_commit: "refactor(P5-T034): 樣式表照畫面拆檔"
---

# 樣式表照畫面拆檔

## 目標
D-033。`src/ui/styles.css` 2152 行，改一個畫面要翻全部。

## 範圍
### 包含
- 照檔內既有的區塊註解拆成 `src/ui/styles/` 底下多個檔（基礎與變數、控制項、工作區、校樣、頁邊符號、總覽、精靈、對照、Agent、配圖、媒體…），
  由一個入口依**原本的順序**引入——CSS 後寫的蓋前面的，順序不能變。
- design-system.md 若有提到 styles.css 的位置，改成新結構。

### 不包含
- 改任何樣式規則、class 名稱、顏色或版面。

## 實作要求
- 拆完後把所有檔照引入順序串起來，跟原檔逐字比對（空白與換行以外）完全一樣；比對方法寫進完成結果。
- `npm run build` 成功；`?fixtures=1` 用 `scripts/ui-drive.mjs` 截圖主要畫面，跟拆之前的截圖比對無差異。

## 完成定義
- [ ] `npm run verify` 綠
- [ ] 串接後與原檔一致、截圖無差異
- [ ] CURRENT_TASK 已更新

## 中斷／接手紀錄
- 最後完成：開 Task（2026-10-01）
- 已通過驗證：—
- 下一步：等 P5-T033
- Blocker：無

## 完成結果
