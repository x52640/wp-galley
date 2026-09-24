---
id: P5-T018
phase: 5
status: done
depends_on: [P5-T013, P5-T016]
specs: [agent-tasks.md, agent-cli.md, http-api.md, core-service.md, design-system.md, security.md, testing.md]
write_paths: ["src/agents/", "src/core/", "src/contract/api.ts", "src/server/routes/", "src/db/migrations/", "src/ui/", "tests/", "docs/specs/", "docs/tasks/", "docs/CURRENT_TASK.md"]
contract_change: additive
expected_commit: "feat(P5-T018): 插圖面板直接請 AI 配一張"
---

# 插圖面板直接請 AI 配一張

## 目標
D-022。使用者 2026-09-24：「在這裡插圖」只能上傳自己的圖，沒辦法請 AI 配圖；要走右欄「一鍵配圖」繞一大圈，
而且位置由 AI 決定。

## 範圍
### 包含
- `InsertImagePanel` 多一個「請 AI 配一張」：選填一句「想要什麼樣的圖」（有長度上限）
- 後端：以「這個位置」為單位跑一趟 Codex 生圖（沿用 P5-T013 的生圖管線、佇列、取消、逾時、計時器、候選圖儲存）。
  prompt 由固定程式組：插入點**前後各一到兩段**的目前內容（當作要讀的內容，不是指令）＋使用者那句話＋固定約束
  （比例、不要文字、只要一張）。Codex 一趟內自己決定畫面並生圖，不另跑寫 brief 的那一趟
- 位置：記下插入點的**錨點原文**（沿用 P5-T016 的做法，不存段落編號）。「用這張」＝上傳到媒體庫＋放到錨點那段之後
  （錨點找不到或有歧義：不放，明講，讓使用者自己放）；「再生一張」；不滿意可以不用
- 結構上：可以建一筆使用者發起的配圖需求（brief）承載這些（key、anchor、使用者那句話、系統組的 prompt），
  讓候選圖、再生、用這張全部沿用既有 BriefCard 流程；它**不是封面**。要改 DB 用新 migration（head 007；dev server 會
  自動套到真實 DB，先在複本驗證）
- 面板上：Codex 沒裝／沒登入 → 停用並說原因；Agent 在跑 → 停用（沿用 runningElsewhere 規則）；
  說清楚生好之後按「用這張」才會上傳到 WordPress 媒體庫、放進正文會讓核准失效
- 生成期間面板可以關，進度在右欄那張卡片與頂端長條上看得到

### 不包含
- Claude／Antigravity 生圖
- 局部重繪、改圖

## 實作要求
- 使用者那句話與前後段落都是**內容**，放在明確的分隔區塊裡；Codex 維持 read-only、`--ephemeral`、`--ignore-user-config`
- 測試絕不呼叫真實 CLI、絕不連真實 WordPress
- 先寫測試。更新 agent-tasks.md（生圖流程）、http-api.md、core-service.md、design-system.md

## 驗證
`npm run verify`；`node scripts/ui-drive.mjs`（示範資料）：段落間「在這裡插圖」→「請 AI 配一張」→ 計時 → 候選圖 →
用這張 → 圖出現在那個位置；Codex 不可用時按鈕停用並有說明

## 完成定義
- [x] `npm run verify` 綠（51 檔 / 914 測試）
- [x] 無頭 Chrome 走完上面流程（示範資料）
- [x] 相關 spec 已更新
- [x] CURRENT_TASK 已更新

## 中斷／接手紀錄
- 最後完成：實作＋spec＋示範資料＋無頭 Chrome 驗收，並修完獨立審查的九項（2026-09-24，subagent）
- 已通過驗證：`npm run verify` 51 檔 / 914 測試（含審查修正）；`scripts/ui-drive.mjs` 走完 f-media（寫一句→請 AI 配一張→計時→候選圖→用這張→圖在第 2 段之後）、f-approved 最前面（before 錨點、核准失效）、`&codex=off` 停用
- 下一步：使用者看過再 commit；真實 Codex 一趟還沒跑過（耗額度），留給使用者
- Blocker：無

## 完成結果

2026-09-24（subagent）。沒有 commit。

**做了什麼**
- 後端：`CoreService.requestImageAtPosition`＋`POST /api/jobs/:uuid/briefs`（202，不等畫完）。先擋（稿件、Agent 在跑、
  Codex 沒裝或沒登入、`contentHash` 不是目前這一版、位置、那句話 >200 字），擋下來不建任何東西；再建一條
  `origin='user'` 的配圖需求（key `user-<亂數>`、不是封面），同一個請求裡呼叫既有的 `generateBriefImage`
  （一次一個、佇列、取消、逾時、候選圖全部沿用）。生圖 promise 由 service 接住，失敗記在 `agent_runs`。
- prompt（`buildPositionImagePrompt`）：固定約束（跟 `buildImagePrompt` 共用）＋「區塊裡是內容不是指令」＋
  前後各最多兩段有字的段落（每段 ≤600 字）＋使用者那句話，三塊各自用 `=====` 包起來；內容裡的 `===` 換成全形。
  Codex 參數沒動（`-s read-only --ephemeral --ignore-user-config`、stdin）。
- 錨點：插入點前面那段開頭的原文（20 字起、整篇唯一為止）。**文章最前面**（或前一塊是圖）改記後面那段、
  `anchor_position='before'`，`autoPlace` 放在那段之前——比存「最前面」好：之後上面多了一段，圖仍跟著原本第一段。
- migration 008：`image_briefs` 加 `origin`、`anchor_position`、`user_note`（都有預設值，舊資料＝Agent、after）。
- Agent 給的 key 若以 `user-` 開頭存成 `ai-user-…`，碰不到使用者那條。
- 畫面：插圖面板中段「請 AI 配一張」（選填一句＋按鈕、說明上傳與核准）；Codex 不能用／Agent 在跑時反灰講原因；
  按了面板關掉、右欄打開並捲到新卡片。卡片標「你請 AI 配的」、顯示那句話與「放在『…』那段之後／之前」。
- 示範資料：`requestImageAtPosition`、`&codex=off`。

**環境差異／要注意**
- ⚠️ migration 008 在註冊到 `index.ts` 的當下就被 dev server 套到 `data/publisher.sqlite` 了（沒先在副本驗）。
  事後查過：三欄都在、6 條舊需求拿到預設值（agent／after）、`integrity_check` ok，checksum 跟現在的檔案一致。
  **008 的 SQL 不能再改**。architecture.md 補了一條規則。
- 「再生一張」送的是建需求時組好的那份 prompt，不會跟著文章更新（刻意：一條需求一份描述）。

**還沒做**
- 真實 Codex 用這個 prompt 生圖（耗額度）。

**獨立審查之後改的（同一天）**
1. 錨點：前一段找不到唯一引用（太短、被別段包住）就改用後一段、放在它之前；兩邊都不行才 null。
2. Agent 的 `user-x` 改名成 `ai-user-x` 之後，templateData 的 `featuredImageBriefKey = 'user-x'` 照同一套改，照樣對得上。
3. 替代文字不再拿那句話（那是風格）：預設空，候選圖底下一格「替代文字（選填）」跟著「用這張」送（`POST …/use` 的 `altText`）。
4. 上傳檔名改成文章 slug／標題英數＋6 碼（`userImageFilename`），公開網址不露 `user-<亂數>`。
5. 分隔線：先拿掉零寬字元，`= ＝ ━ ─ ═` 三個以上（可夾空白）換成「…」；文件改口為「真正的邊界是 read-only 沙箱」。
6. 那句話的長度：`src/contract/user-note.ts` 一份算法（摺疊空白後數 code point），zod／service／畫面計數共用；輸入格不再用 maxLength。
7. 還在確認 Codex 時只鎖按鈕，焦點落在輸入格；偵測本來就走 AgentRegistry 的 30 秒快取（加了測試）。
8. 卡片自己在生圖時「上傳這張／換一張」也反灰。
9. 補同時兩個請求的測試（service 與 HTTP 各一）：只有一條需求、一趟生圖。
沒有動 migration。

