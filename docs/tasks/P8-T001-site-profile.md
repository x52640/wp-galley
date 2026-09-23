---
id: P8-T001
phase: 8
status: done
depends_on: [P5-T001]
specs: [templates.md, wordpress-site.md, architecture.md, security.md]
write_paths: ["config/", "templates/", "src/templates/", "src/wordpress/targets.ts", "src/db/migrations/", "src/contract/api.ts", "src/ui/", "tests/", "docs/specs/templates.md", "docs/specs/wordpress-site.md", "docs/specs/architecture.md", ".gitignore", ".env.example", "src/core/service.ts", "src/wordpress/posts.ts", "src/wordpress/terms.ts", "src/server/routes/wordpress.ts", "src/server/main.ts", "plan.md", "docs/specs/http-api.md", "docs/specs/core-service.md"]
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
- [x] `npm run verify` 綠（46 檔 / 726 測試）
- [x] templates.md、wordpress-site.md（改成「作者站台實況」＋通用說明）、architecture.md 已更新
      （擴大範圍後另更新 plan.md 範圍、http-api.md、core-service.md）
- [x] CURRENT_TASK 已更新

> 2026-09-23 使用者同意擴大 write_paths（發布時的區塊預設值、內建分類法 REST 名稱、沒有設定檔的提示、連線診斷寫死類型、plan.md 範圍描述）。

## 中斷／接手紀錄
- 最後完成：全部（2026-09-23，subagent）。第一輪做 write_paths 內的部分；使用者同意擴大範圍後補完四處接線。
- 已通過驗證：`npm run verify` 46 檔 / 720 測試；migration 007 先在記憶體 DB 與真實 DB 的副本上
  逐列比對過才註冊，dev server 已套到本機 DB（7 篇稿件的 target、24 個 revision 的模板指向都在，
  `foreign_key_check` 乾淨）；`?fixtures=1` 能選「文章」「頁面」並預覽（無頭 Chrome）；
  假 WordPress 上發 post／page 的測試通過（`tests/generic-site.test.ts`）。
- 下一步：使用者實測時第一次發到**別的**站，打開編輯器確認區塊沒被判定「非預期內容」（沒有真站驗證過）。
- Blocker：無

## 完成結果

- **article-v1**：hybrid、h2／h3、最外層必須是區塊、巢狀上限 6；allowlist 只有核心區塊 class；
  manifest 新增選填的 `blockDefaults`，article-v1 全部 null，longform／diary 不寫（輸出逐字不變）。
  欄位 `title`、`body`、`slug`、`category`（單一）、`featuredImageBriefKey`；`wordpressTargetKey: null`。
  發布時 CoreService 用模板的 `blockDefaults` 轉區塊（只有一個呼叫點，建立與更新共用）。
- **post／page**：兩個 target 共用 article-v1，差在 `postType`／`restBase`／`taxonomy`（post＝category、
  page＝null）。介面依 `postType` 叫「文章」「頁面」；總覽改成依 target 篩選（同一 contentType 有兩個 target）。
  第一版只接 category，不接 post_tag。
- **分類法 REST 名稱**：target 新增選填 `taxonomyRestBase`（不寫＝`taxonomy`）；範例 post 填 `categories`。
  查項目、寫文章欄位、遠端快照與衝突比對、`/api/wordpress/terms` 都改用 `taxonomyRestBaseOf(target)`；
  畫面與 API 參數仍用 slug。作者站台設定不用改。
- **沒有設定檔**：`loadPublishTargets` 回空 registry＋`setupRequired`；啟動時終端機印出那句
  （`startupNotice`），伺服器照樣起來，健康檢查與診斷正常；建稿回 400，訊息就是那句；畫面在發布目標
  清單為空時顯示同一句話。檔案在但壞掉（含空的 `targets`）仍然啟動失敗。
- **連線診斷**：檢查的內容類型改成設定檔 target 的 `postType`，不再寫死 read-think／diary。
- **migration 007**：重建 `publish_targets`、`templates`，CHECK 多 `article`。交易裡關不掉外鍵、`DROP TABLE`
  會觸發子表 SET NULL，所以先把 `jobs.target_id`、`revisions.template_row_id` 抄到暫存表再寫回。
- **測試改讀 `config/examples/remusplus.json`**，不再依賴本機設定檔（新 clone 沒有那個檔）。
- **審查補強（2026-09-24）**：連線診斷多比對分類法的 REST 名稱——`validateTargetsAgainstSite` 多吃
  `/wp/v2/taxonomies` 的結果，`taxonomyRestBaseOf(target)` 跟站上的 `rest_base` 不同就回報
  「分類法 category 的 REST 名稱是 categories，請在設定檔加上 taxonomyRestBase: "categories"」，
  站上找不到該分類法也回報（否則分類讀取 404、遠端分類變更偵測無聲失效）。`taxonomy` 也套上跟
  `taxonomyRestBase` 同一個格式限制（它會接進網址）；作者站台的 slug 照樣通過。
- 未解：通用站的區塊輸出沒有真站驗證；`plan.md` 範圍一節「首次設定精靈」仍待 P8-T002；
  P8-T002 的 front matter 還是 blocked（不在本 Task write_paths），依賴已解除。
