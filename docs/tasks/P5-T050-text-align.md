---
id: P5-T050
phase: 5
status: ready
depends_on: []
specs: [wordpress-site.md, design-system.md, architecture.md, security.md]
write_paths: ["src/contract/", "src/ui/", "src/wordpress/", "src/preview/", "src/templates/", "src/core/", "tests/", "docs/specs/wordpress-site.md", "docs/specs/templates.md", "docs/specs/design-system.md", "docs/specs/architecture.md", "docs/known-issues.md", "docs/tasks/P5-T050-text-align.md", "docs/CURRENT_TASK.md"]
contract_change: additive
expected_commit: "feat(P5-T050): 段落與小標可選靠左、置中、靠右"
---

# 段落與小標可選靠左、置中、靠右

## 目標
D-049。使用者 2026-10-21 問有沒有段落靠左、置中、靠右；目前完全沒有。
做法照使用者同意的建議：只做段落與小標（清單 WordPress 本來就沒有、引用先不做），不做兩端對齊（中文兩端對齊字距常被拉怪）。
輸出要跟在 WordPress 編輯器裡設的一模一樣，後台打開不能出現「區塊內容無效」。

## 範圍
### 包含
- 格式工具列加三顆：靠左、置中、靠右（圖示、目前狀態要亮），作用在游標或選取所在的段落／小標（選取跨多段就全部套）。靠左＝拿掉對齊設定（不輸出 class）。
  標題（文章標題）、清單、引用、圖片裡按了不做事或反灰。
- 正文 HTML 的對齊用 class `has-text-align-left|center|right`，不用 inline style（`contenteditable` 的 `justifyCenter` 會塞 style 或 `align`，不要用它，自己改 class）。
- `src/contract/rich-text.ts`：`edit`／後端再驗時允許 `p`、`h2`、`h3` 帶這三個 class（白名單，其他值拿掉）；貼上（`paste`）照舊不帶進來。後端用原始 schema 再驗一次（security.md）。
- `src/wordpress/block-serialize.ts`：段落、小標輸出對應區塊屬性與 class。**屬性名要先查證**：古騰堡段落區塊歷來用 `align`、小標用 `textAlign`，
  新版核心可能改過——對照 `docs/specs/wordpress-site.md` 寫的站台版本，去讀 WordPress／Gutenberg 原始碼（GitHub 上的 `block.json`、`save`、deprecated）確認，
  查證結果與出處寫進 wordpress-site.md 的區塊格式那節。拿不準就停下回報，不要猜。
- 校樣預覽（`src/preview/`）看得到對齊（跟前台一致的 CSS）。
- 讀回已發布或後台改過、本來就有對齊的文章時保留不掉。
- 測試、spec（wordpress-site.md 正文 HTML 詞彙與區塊格式、design-system.md 工具列、architecture.md 功能地圖）、known-issues。

### 不包含
- 兩端對齊、清單／引用／圖片的對齊。
- Agent 校稿建議或模板產生對齊（Agent 不輸出格式）。

## 工作區與 Context
### 必讀入口
`docs/specs/wordpress-site.md`（正文 HTML 詞彙、區塊格式）、`src/contract/rich-text.ts`、`src/wordpress/block-serialize.ts`、`src/ui/lib/rich-commands.ts`、`rich-format.ts`、
格式工具列元件、`src/contract/link-target.ts`（D-043 加屬性的前例：前後端怎麼一起改、怎麼測）。
### 不應載入
agent、factcheck spec。
### 驗證命令
`npm run verify`；`node scripts/ui-drive.mjs` 搭 `?fixtures=1` 截圖（工具列三顆、置中段落、置中小標）。

## 實作要求
- 先寫測試：工具列套用／切換／取消、跨段選取、標題與清單不做事；rich-text 白名單（非法值、inline style、paste 被拿掉）；
  區塊序列化對照古騰堡實際輸出逐字比對；讀回再存不掉對齊。
- 文字用繁體中文。

## 驗證
### 自動驗證
`npm run verify` 綠。
### 手動驗證（使用者）
長文一段置中、一個小標靠右 → 存草稿 → 後台編輯器打開沒有「區塊內容無效」、對齊正確 → 預覽前台一致。只存草稿。

## 完成定義
- [ ] `npm run verify` 綠
- [ ] 擁有這些行為的 spec 已更新（wordpress-site.md、architecture.md 功能地圖）
- [ ] 留下的殘餘已寫進 `docs/known-issues.md`
- [ ] CURRENT_TASK 已更新

## 中斷／接手紀錄
- 最後完成：開 Task（2026-10-21）
- 已通過驗證：無
- 下一步：查證區塊屬性名、寫測試、實作
- Blocker：無

## 完成結果
