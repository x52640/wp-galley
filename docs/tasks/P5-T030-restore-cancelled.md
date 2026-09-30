---
id: P5-T030
phase: 5
status: ready
depends_on: []
specs: [state-machine.md, core-service.md, http-api.md, design-system.md, security.md]
write_paths: ["src/core/", "src/contract/", "src/server/routes/", "src/ui/", "tests/", "docs/specs/", "docs/tasks/P5-T030-restore-cancelled.md", "docs/CURRENT_TASK.md"]
contract_change: additive
expected_commit: "feat(P5-T030): 已取消的稿件可以恢復"
---

# 已取消的稿件可以恢復

## 目標
D-031。`CANCELLED` 目前是終點（轉移表 `CANCELLED: []`），取消後沒有路回到編輯。取消只改狀態，內容、版本、配圖、
WordPress 連結都還在，所以開一條「恢復」的路。

## 範圍
### 包含
- **記下取消前的狀態**：`cancelJob` 寫 `job_cancelled` 事件時，把取消前的狀態記在 `detail_json`（例如 `{ "fromState": "PREVIEWED" }`）。
  不加 migration（`detail_json` 已存在）。
- **CoreService `restoreJob(uuid)`**：只接受 `CANCELLED`，其他狀態丟 `InvalidTransitionError`（或現有同類錯誤）。
  目標狀態：最近一筆 `job_cancelled` 事件的 `fromState`；`APPROVED` 改成 `RENDERED`；沒有記錄、解析不了、
  或值不是合法的非終止狀態 → `SOURCE`。寫一筆 `job_restored` 事件（`actor: 'ui'`，detail 記目標狀態）。
  **不建立、不恢復任何核准**（取消時已撤銷，維持撤銷）。
- **轉移表**：`src/core/state-machine.ts` 讓 `CANCELLED` 能回到 `SOURCE`、`REVIEWED`、`MEDIA_READY`、`RENDERED`、`PREVIEWED`，
  走表格，不要寫 if 繞過。`CANCELLED` 仍算終止狀態的那些用途（例如 `isContentMutable`、清單分區、發布 blocker）要逐一確認
  加了轉移之後行為沒變——恢復前仍不可編輯、不可發布。
- **HTTP**：新增 `POST /api/jobs/:uuid/restore` → `JobResponse`，契約放 `src/contract/api.ts`。照現有路由的保護方式（CSRF／來源檢查等）。
- **MCP 不開**這個動作。
- **UI**：打開一篇已取消的稿件時，最上面有一條說明「這篇已經取消」＋「恢復這篇」按鈕（不是破壞性操作，不用確認框）。
  按下後重新載入，回到可編輯；如果回到的狀態需要重新核准，照現有畫面自然呈現即可。總覽「已結束」裡的已取消稿件點進去就能看到這條。
  `?fixtures=1` 同步。
- spec：`state-machine.md`（轉移表、恢復規則）、`http-api.md`（新路由）、`core-service.md`（新方法），設計系統若有對應元件規範也補。

### 不包含
- `FAILED`、`SUPERSEDED` 的恢復。
- 真正刪除稿件（從資料庫清掉、刪 WordPress 草稿）。
- 「複製成新稿」。

## 工作區與 Context
### 必讀入口
`docs/specs/state-machine.md`、`src/core/state-machine.ts`、`src/core/service.ts`（`cancelJob`、`assertMutable`、publish blockers）、
`src/server/routes/jobs.ts`（`DELETE /api/jobs/:uuid`）、`src/ui/components/Workspace.tsx`（`CancelButton`）、`src/ui/components/JobList.tsx`（已結束區）。
### 不應載入
`docs/archive/`、跟 Agent／生圖相關的 spec。
### 驗證命令
`npm run verify`

## 實作要求
- 先寫測試：轉移表、取消會記 `fromState`、各種取消前狀態恢復到哪（含 `APPROVED`→`RENDERED`、沒記錄→`SOURCE`）、
  恢復後核准仍是撤銷、非 `CANCELLED` 恢復被拒、HTTP 路由、恢復後能編輯。
- 測試不呼叫真實 CLI、不連真實 WordPress。
- 不改 `.env`、`config/publish-targets.json`、`data/` 的真實 DB。

## 驗證
### 自動驗證
`npm run verify` 綠。
### 手動驗證
使用者在自己的發布台：打開一篇已取消的稿件 → 恢復 → 能繼續改 → 核准 → **只存草稿**。

## 完成定義
- [ ] `npm run verify` 綠
- [ ] 擁有這些行為的 spec 已更新
- [ ] CURRENT_TASK 已更新

## 中斷／接手紀錄
- 最後完成：開 Task（2026-09-30）
- 已通過驗證：—
- 下一步：派 subagent 實作
- Blocker：無

## 完成結果
