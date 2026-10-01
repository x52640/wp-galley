---
id: P5-T034
phase: 5
status: done
depends_on: [P5-T033]
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
- [x] `npm run verify` 綠
- [x] 串接後與原檔一致、截圖無差異
- [ ] CURRENT_TASK 已更新

## 中斷／接手紀錄
- 最後完成：拆檔、比對、截圖比對（2026-10-01；使用者同意跟 P5-T033 並行，兩者不重疊）
- 已通過驗證：`npm run verify` 70 檔／1441 綠；`npm run build` 成功
- 下一步：主 session 更新 CURRENT_TASK、architecture.md 功能地圖（若需要）、審查後 commit
- Blocker：無

## 完成結果
- `src/ui/styles.css`（2152 行）拆成 `src/ui/styles/` 下 24 個檔，切點就是原檔的 `/* --- 區塊 --- */` 註解
  （最後一段「建議網址」沒有 `---` 標頭但是獨立功能，也拆開）。檔名前的數字＝引入順序：
  01-tokens（變數＋深色模式）、02-base、03-controls、04-demo-banner、05-shell、06-proof、07-margin-marks、
  08-drawer-panels、09-media、10-jobs、11-setup-wizard、12-confirm、13-diagnostics、14-stage、15-compare、
  16-agent、17-image-briefs、18-workspace、19-drawer、20-publish、21-responsive、22-insert-image、
  23-ai-image-request、24-slug-suggest。入口 `styles/index.css` 依序 `@import`；`main.tsx` 改引入它。
- 逐字比對：`git show 9df04db:src/ui/styles.css > orig.css`；照 `index.css` 的 `@import` 順序把各檔 `cat` 起來成
  `joined.css`；兩者 `tr -d ' \t\n\r' | shasum` 相同，`diff` 去掉空行後也完全一樣。唯一差別是每個切點原本的尾端空行。
- 打包比對：拆前、拆後各跑 `vite build`，產出的 CSS 檔 `cmp` 位元組完全相同（同一個 hash `index-D_cvkXo3.css`）。
- 截圖比對：純前端 Vite（5174）`?fixtures=1`，`scripts/ui-drive.mjs` 拍 14 張（總覽、新稿件、設定精靈、診斷、
  6 篇稿件的工作區，其中 2 篇再拍對照與發布面板），拆前拆後 `cmp` 位元組全部相同；拆前先連拍兩次確認截圖本身是穩定的。
- 順手改指向舊路徑的文字：`docs/specs/design-system.md` 兩處、`ProofView.tsx`／`Workspace.tsx` 各一行註解。
- 主 session 驗證（2026-10-01）：另起 main 的 worktree 打包，CSS 產物與拆檔後 `cmp` 逐位元組相同（`index-D_cvkXo3.css`）。因產物完全相同，未另派獨立審查，交 Codex 審 PR。
