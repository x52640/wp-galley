---
id: P8-T001
phase: 8
status: blocked          # 等 P5-T001（D-016：排在實測之後）
depends_on: [P5-T001]
specs: [templates.md, wordpress-site.md, architecture.md, security.md]
write_paths: ["config/", "templates/", "src/templates/", "src/wordpress/targets.ts", "src/db/migrations/", "src/contract/api.ts", "src/ui/", "tests/", "docs/specs/templates.md", "docs/specs/wordpress-site.md", "docs/specs/architecture.md", ".gitignore", ".env.example"]
contract_change: additive
expected_commit: "feat(P8-T001): 通用文章類型與本機站台設定檔"
---

# 通用文章類型與本機站台設定檔

## 目標
D-016：讓任何 WordPress 站都能用。現在有兩個地方把發布台綁死在 remusplus：

1. 內容類型只有 `homepage`／`longform`／`diary`，而且寫死在 zod enum 與
   `001-init` 的 SQL CHECK 裡（`src/templates/types.ts`、`src/db/migrations/001-init.ts`）。
2. `config/publish-targets.json` 放的是 remusplus 的 CPT（`read-think`、`diary`），而且有進 git。

## 範圍
### 包含
- 新增通用內容類型（暫名 `article`）與通用模板 `templates/article-v1/`：只用 WordPress
  核心區塊（段落、標題、清單、引言、圖片），能發到 `post` 與 `page`。
- migration 放寬 `content_type` CHECK（SQLite 要重建表，照既有 migration 慣例）。
- 站台設定檔改成本機檔（進 `.gitignore`），repo 只附範例：
  - `config/publish-targets.example.json`：通用範例（文章＋頁面）
  - remusplus 的設定保留成 `config/examples/remusplus.json`，作者本人照舊能用
- 找不到本機設定檔時，啟動訊息要講清楚「請先跑設定精靈或複製範例」，不能崩潰。

### 不包含
- 設定精靈本身（P8-T002）
- CPT 支援、API Key（D-016 第一版不做）
- 改動 `longform-v1`／`diary-v1` 的輸出：remusplus 的發布結果要跟改之前逐字相同

## 工作區與 Context
### 必讀入口
`docs/specs/templates.md`（manifest 與 target 對應）、`src/wordpress/targets.ts`、
`templates/longform-v1/`（當作通用模板的參考）
### 不應載入
`docs/archive/`、UI 版面相關 spec
### 驗證命令
`npm run verify`

## 實作要求
- 先寫測試：通用模板渲染成核心區塊、`post`／`page` 兩種 target 都能通過驗證、
  remusplus 既有的快照測試不能變。
- 發布到 `post` 時分類法是 `category`，`page` 沒有分類法；D-004（不自動建立分類項目）照舊。
- 測試不連真實 WordPress。

## 驗證
### 自動驗證
`npm run verify` 綠，既有測試數字只增不減。
### 手動驗證
`?fixtures=1` 能選到「文章」類型並預覽。

## 完成定義
- [ ] `npm run verify` 綠
- [ ] templates.md、wordpress-site.md（改成「作者站台實況」＋通用說明）、architecture.md 已更新
- [ ] CURRENT_TASK 已更新

## 中斷／接手紀錄
- 最後完成：尚未開始
- 已通過驗證：—
- 下一步：等 P5-T001 完成後改成 ready
- Blocker：P5-T001

## 完成結果
