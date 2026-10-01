---
id: P6-T003
phase: 6
status: blocked
depends_on: [P6-T001, P5-T036]
specs: [factcheck.md, agent-cli.md, security.md]
write_paths: ["src/agents/output-contract.ts", "src/agents/types.ts", "src/agents/registry.ts", "src/agents/adapters/base.ts", "src/agents/adapters/codex.ts", "src/agents/adapters/claude.ts", "src/agents/adapters/google.ts", "src/core/factcheck-prompts.ts", "tests/factcheck-schema.test.ts", "tests/factcheck-prompts.test.ts", "tests/agent-hosted-search.test.ts", "tests/helpers/fake-adapter.ts", "docs/specs/agent-cli.md", "docs/specs/factcheck.md", "docs/tasks/P6-T003-factcheck-contract.md"]
contract_change: none
expected_commit: "feat(P6-T003): 查證兩趟的 schema 與 prompt，adapter 可只開廠商端搜尋"
---

# 查證的輸出契約與「只開搜尋」

## 目標
D-034。查證的第一趟「找來源」要能只開**廠商伺服器上執行**的搜尋，第二趟「判斷」跟校稿一樣什麼都不開；
兩趟各有自己的輸出 schema（都沒有 templateData）。本 Task 只做 Agent 這一層，不接流程。

疊在 P5-T036 之上：P5-T036 讓現有各趟 Codex 明確 `web_search="disabled"`、Claude 一律 `--disallowed-tools`（含 `WebSearch`、`WebFetch`）＋`--strict-mcp-config`＋`--no-chrome`；
本 Task 只在明確要求時把第一趟的搜尋打開。P5-T036 沒合併前不准開工（兩邊都改 adapter 參數）。

## 範圍
### 包含
- `output-contract.ts`：`FACTCHECK_FIND_SCHEMA`、`FACTCHECK_JUDGE_SCHEMA`（形狀與上限照 factcheck.md），能過 openai-strict 轉換。
- `src/core/factcheck-prompts.ts`：兩趟的 system／user prompt（照 `src/core/slug-suggestion.ts` 的放法）。第一趟依「有沒有開搜尋」換說法；
  第二趟把來源包成 `S1`、`S2`… 並明講不受信任。
- `AgentRequest` 加 `hostedSearch?: boolean`（預設 false）；adapter 各自決定怎麼開，做不到的（agy）回報能力為 false、
  收到 `hostedSearch: true` 直接拒絕（不默默降級成沒搜尋）。registry 能問「這家能不能只開搜尋」。
- 各家參數（照 factcheck.md「P6-T003 要加進 agent-cli.md 的參數」）並寫進 `agent-cli.md`。
- 假 adapter 支援 `hostedSearch` 與兩份 schema，給 P6-T004 用。
### 不包含
- 取回器（P6-T002）、查證流程與 API（P6-T004）、畫面（P6-T005）。
- 改現有校稿、配圖、生圖、建議網址任何一趟的參數或 prompt。

## 工作區與 Context
### 必讀入口
`docs/specs/factcheck.md`「① 找來源」「③ 判斷」、`docs/specs/agent-cli.md`（P5-T036 改過的版本）、`docs/specs/security.md`「硬性禁令」、
`src/agents/adapters/openai-strict.ts`、`tests/codex-image.test.ts`（假執行檔記錄參數的做法）。
### 不應載入
`src/ui/`、`src/fetch/`、`docs/archive/`。
### 驗證命令
`npx vitest run tests/factcheck-schema.test.ts tests/factcheck-prompts.test.ts tests/agent-hosted-search.test.ts`、`npm run verify`

## 實作要求
- **測試絕不呼叫真實 CLI**：用假執行檔記錄收到的參數；確認旗標存在只能看 `--help` 這類不送 prompt 的指令。
- 參數陣列傳遞，不得 `shell: true`。
- Codex：只准 `cached`，程式裡不得出現 `live`／`indexed` 的路徑。
- Claude：`--disallowed-tools` 禁用優先，所以第一趟＝P5-T036 的禁用名單**減掉 `WebSearch`**（`WebFetch` 與其他照舊禁用）＋`--tools WebSearch --allowed-tools WebSearch`＋`--strict-mcp-config --no-chrome`。
- `hostedSearch` 沒給或 false 時，產生的參數必須跟 P5-T036 之後完全一樣（有測試逐項比對）。
- 判斷趟要「最嚴格無工具模式」（factcheck.md「③ 判斷」）：`AgentRequest` 另加一個選項（例如 `strictNoTools`），Claude 帶 `--tools ""`（參數陣列裡的空字串）
  ＋`--strict-mcp-config --no-chrome`；Codex、agy 跟校稿那趟一樣。沒給時參數不變。
- `correction` 照 factcheck.md 定為**選填、不接受 null**（不改 `stripNulls`，對現有 schema 零影響）；程式把缺少的當 null。
- 先寫測試再實作。

## 驗證
### 自動驗證
`npm run verify` 綠。至少：
- 兩份 schema 的正反例（含 openai-strict 轉換後仍合格、超過上限被拒）。
- 假執行檔斷言：Codex 第一趟帶 `web_search="cached"` 且沒有 `live`／`indexed`、其餘 P5-T036 的關閉參數都在；Claude 第一趟
  `--tools`／`--allowed-tools` 的值只有 `WebSearch`（`WebFetch` 不在裡面）、`WebSearch` 不在禁用名單而 `WebFetch` 仍在、`--strict-mcp-config` 與 `--no-chrome` 都在；agy 收到 `hostedSearch` 被拒；
  三家 `hostedSearch` 為 false 時參數不變。
- 判斷趟：Claude 參數有 `--tools` 且值是空字串、有 `--strict-mcp-config` 與 `--no-chrome`、沒有 `--allowed-tools`；Codex 帶 `web_search="disabled"`。
- 解析：兩份 schema 的輸出要**走完整的 adapter 解析流程**測（假執行檔吐出 Codex strict 模式會給的 JSON，含 `"correction": null`，經 `stripNulls`＋原 schema 驗證），
  沒有建議時結果是合格、`correction` 視為 null；不能只對 schema 單獨驗。
- prompt：第二趟每份來源有編號與不受信任標示；第一趟開搜尋時不出現「你沒有網路」。
### 手動驗證
- **必驗**：使用者真跑一次 Claude 判斷趟的參數組合（`--tools ""`＋`--json-schema`，給一小段假來源，不碰 WordPress），確認回得出結構化輸出。
  不相容就退回禁用名單，結果寫進 agent-cli.md 與 factcheck.md「③ 判斷」。
- 其餘未證實的三件——Codex `-c` 在 `--ignore-user-config` 下是否生效、Claude `-p` 下 `WebSearch` 能不能用、`--tools WebSearch` 搭配 `--json-schema` 結構化輸出是否仍可用——在 P6-T005 使用者真跑時確認。

## 完成定義
- [ ] `npm run verify` 綠
- [ ] 擁有這些行為的 spec 已更新（agent-cli.md 參數；factcheck.md 若實作時發現跟規格不同）
- [ ] 留下的殘餘寫進完成結果（由主 session 併入 `docs/known-issues.md`）
- [ ] CURRENT_TASK 已更新（由主 session）

## 中斷／接手紀錄
- 最後完成：開 Task（2026-10-01，P6-T001）
- 已通過驗證：—
- 下一步：等 P6-T001、P5-T036 合併後派 subagent 實作（可跟 P6-T002 平行）
- Blocker：P5-T036、P6-T001 未合併（合併後 status 改回 ready）

## 完成結果
