---
id: P8-T002
phase: 8
status: blocked          # 等 P8-T001
depends_on: [P8-T001]
specs: [security.md, wordpress-site.md, agent-cli.md, http-api.md, design-system.md]
write_paths: ["src/config/", "src/wordpress/", "src/agents/", "src/server/routes/", "src/contract/api.ts", "src/ui/", "tests/", "docs/specs/security.md", "docs/specs/http-api.md", "docs/specs/design-system.md", "README.md"]
contract_change: additive
expected_commit: "feat(P8-T002): 首次設定精靈"
---

# 首次設定精靈

## 目標
D-016：別人裝好之後第一眼看到的畫面。README 只能叫人改設定檔；精靈可以**當場測試並說出卡在哪裡**。

## 範圍
### 包含
四步，每步失敗都要講出原因並附下一步該做什麼（D-008：不讓使用者猜）：

| 步驟 | 內容 | 要能分辨的失敗 |
| --- | --- | --- |
| 1 連線 WordPress | 網址、帳號、應用程式密碼 → 測試連線 | 不是 HTTPS、REST API 被擋（安全外掛／主機商）、帳密錯、權限不夠發文 |
| 2 選 Agent | 偵測 Codex／Claude Code／agy 有沒有裝、有沒有登入 | 沒裝附安裝指令、沒登入附登入指令（使用者自己在終端機執行） |
| 3 發到哪裡 | 文章或頁面，寫入 P8-T001 的本機站台設定檔 | — |
| 4 完成 | 進稿件總覽；設定頁可重跑精靈 | — |

- 沒有設定時自動進精靈；已有設定時不打擾。
- README：安裝、啟動、精靈截圖、「應用程式密碼怎麼申請」。

### 不包含
- API Key、CPT（D-016）
- 多站台切換
- 自動幫使用者安裝或登入 CLI

## 工作區與 Context
### 必讀入口
`docs/specs/security.md`（秘密的規則）、`src/config/env.ts`、`src/wordpress/client.ts`、
`src/agents/` 的偵測邏輯
### 不應載入
`docs/archive/`、校稿與配圖相關 spec
### 驗證命令
`npm run verify`

## 實作要求
- **動工前先更新 security.md**：密碼由精靈寫入時存在哪裡。建議沿用 `.env`（已進
  `.gitignore`），檔案權限 0600；要換別的做法先回報。
- 密碼只從前端送到本機後端一次，之後任何 API 回應、log、錯誤訊息都不得帶回（遮蔽器要涵蓋）。
- 測試連線只做讀取（`/wp-json/`、`/users/me`），**不建立任何文章**。
- 連線診斷用 fixture 模擬各種失敗；測試不連真實 WordPress、不呼叫真實 Agent CLI。

## 驗證
### 自動驗證
每一種失敗都有對應測試，訊息是中文、講得出下一步。
### 手動驗證
用作者本人的站跑一次完整精靈；故意填錯密碼、填 http 網址各一次。

## 完成定義
- [ ] `npm run verify` 綠
- [ ] security.md、http-api.md、design-system.md 已更新
- [ ] README 能讓陌生人從零跑起來
- [ ] CURRENT_TASK 已更新

## 中斷／接手紀錄
- 最後完成：尚未開始
- 已通過驗證：—
- 下一步：等 P8-T001
- Blocker：P8-T001

## 完成結果
