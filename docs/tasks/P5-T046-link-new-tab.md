---
id: P5-T046
phase: 5
status: done
depends_on: [P5-T028]
specs: [security.md, templates.md, architecture.md]
write_paths: ["src/ui/", "src/contract/", "src/templates/", "src/wordpress/", "tests/", "docs/specs/security.md", "docs/specs/templates.md", "docs/specs/architecture.md", "docs/known-issues.md", "docs/tasks/P5-T046-link-new-tab.md", "docs/CURRENT_TASK.md"]
contract_change: additive
expected_commit: "feat(P5-T046): 連結可選在新分頁開啟"
---

# 連結可選在新分頁開啟

## 目標
D-043。使用者 2026-10-09：文字加超連結時現在一律原視窗打開，想在編輯器裡逐個連結決定新視窗或原視窗。
三份模板 manifest 的 `a` 早就允許 `target`、`rel`，缺的是編輯器的開關，以及確認整條路（編輯 → 存檔 → 預覽 → 發布 → 讀回）不丟這兩個屬性。
同時問到的「引用框」：工具列已有「引用」按鈕（P5-T028），使用者沒發現，裁定不做新功能。

## 範圍
### 包含
- 連結編輯框（`FormatBar.tsx` 的連結編輯）加勾選「在新分頁開啟」：新連結預設不勾；改既有連結時顯示它目前的狀態；
  勾 → `<a href="…" target="_blank" rel="noopener">`（WordPress 7.1 寫法，D-043 2026-10-09 改裁定）；不勾 → 拿掉 `target` 與 `rel`。實作在 `rich-commands.ts` 的 `applyLink` 一帶。
- 共用規則寫成 `src/contract` 純函式（D-033 規矩）：判斷一個連結是不是「新分頁」、產生／移除屬性。
- 後端再驗：`a` 的 `target` 只接受 `_blank`，其他值拿掉；有 `target="_blank"` 時 `rel` 正規化成 `noopener`、nofollow 等其他值接後（含 noopener 是安全要求；舊的 noreferrer 整理掉）；
  沒有 target 時不留孤兒 `rel`（除非原文本來就有其他 rel 值，照原樣）。寫進 `docs/specs/security.md` 連結規則那段。
- `edit` 模式存檔、發布的 Gutenberg 序列化、從 WordPress 讀回／解析，全程保留這兩個屬性；補測試證明逐字跟 WordPress 編輯器產生的相同。
- `docs/specs/architecture.md` 功能地圖「在文章上改」那列補上這個功能的位置。

### 不包含
- 貼上（`paste` 模式）的連結：照 D-028 只留 href，外面網站的 target 不帶進來。
- 引用框、其他格式按鈕的外觀。
- 「外部連結自動開新分頁」之類的自動規則。

## 工作區與 Context
### 必讀入口
`docs/specs/security.md`（連結／sanitize）、`docs/specs/architecture.md` 功能地圖、P5-T028 Task 檔。
### 驗證命令
`npm run verify`；UI 用 `node scripts/ui-drive.mjs` 搭 `?fixtures=1` 截圖。

## 實作要求
- 先寫測試再實作。
- 鍵盤可操作，勾選有 label；文字用繁體中文，跟現有連結編輯框風格一致。

## 驗證
### 自動驗證
`npm run verify` 綠，新增測試涵蓋：勾／不勾／改既有連結的切換、後端拿掉非 `_blank`、rel 正規化、序列化逐字、讀回保留、貼上仍只留 href。
### 手動驗證
`?fixtures=1`：加連結勾新分頁 → 存 → 再打開連結編輯框是勾著的 → 取消 → 存 → 屬性消失。真站只存草稿看後台區塊。

## 完成定義
- [x] `npm run verify` 綠
- [x] 擁有這些行為的 spec 已更新（新增或搬動功能：architecture.md 功能地圖）
- [x] 留下的殘餘已寫進 `docs/known-issues.md`
- [x] CURRENT_TASK 已更新

## 中斷／接手紀錄
- 最後完成：實作＋測試＋文件（2026-10-09）；未 commit，等主 session 驗證、審查、開 PR
- 已通過驗證：`npm run verify` 100 檔／2216 測試全綠（基準 99／2191，＋25：新增 `tests/link-new-tab.test.ts` 24 條〔初版 23＋改 7.1 寫法後加的舊格式整理 1 條〕，`contract.test.ts` 對新檔 `link-target.ts` 自動多 1 條）；`?fixtures=1` 手動流程截圖通過
- 下一步：主 session 驗證 → 審查 → PR；真站只存草稿看後台區塊（含確認站台 WordPress 版本，見完成結果）
- Blocker：無

## 完成結果
- 規則：`src/contract/link-target.ts`（`isNewTabTarget`、`opensInNewTab`、`withNewTab`、`normalizeLinkAttrs`）。後端 `templates/sanitize.ts` 的 `a` transform 呼叫 `normalizeLinkAttrs`；前端 `rich-commands.ts` 的 `setLinkNewTab`／`applyLink(…, newTab)` 呼叫 `withNewTab`。
- UI：`FormatBar` 連結編輯框加「在新分頁開啟」勾選（label 包 checkbox、Tab／空白鍵可操作）；`LinkEditorState.newTab`（新連結 false、既有連結讀它的 target）。
- 編輯整理（`cleanRich` edit 模式）本來就保留 target／rel，沒改；貼上仍只留 href（有測試）。
- 逐字依據：WordPress 7.1.3 `wp-includes/js/dist/format-library.js` 的 `createLinkFormat`（`target = "_blank"`、`rel = "noopener"`，勾 nofollow 再接 ` nofollow`）與 core/link 屬性對照（url→href、target、rel 依序）。7.0 以前是 `noreferrer noopener`（Gutenberg #26968 改掉），站台是 7.1+（D-043），舊格式讀回整理成 `noopener`。
- `?fixtures=1` 流程：選字 → 連結 → 勾新分頁 → 套用得 `<a href target="_blank" rel="noopener">` → 存 → 再開編輯框是勾著的 → 取消勾選 → 更新 → 存 → 屬性消失；什麼都沒選時插入的連結預設不勾。
- 殘餘：見 known-issues（舊文章的 `noreferrer noopener` 編輯後變 `noopener`、只改勾選不進 ⌘Z、勾選不看模板 allowedAttributes）。
