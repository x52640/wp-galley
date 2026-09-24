---
id: P5-T018
phase: 5
status: in_progress
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
- [ ] `npm run verify` 綠
- [ ] 無頭 Chrome 走完上面流程
- [ ] 相關 spec 已更新
- [ ] CURRENT_TASK 已更新

## 中斷／接手紀錄
- 最後完成：開 Task
- 已通過驗證：—
- 下一步：交給 subagent
- Blocker：無

## 完成結果
