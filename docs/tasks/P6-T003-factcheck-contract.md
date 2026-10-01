---
id: P6-T003
phase: 6
status: done
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
- [x] `npm run verify` 綠
- [x] 擁有這些行為的 spec 已更新（agent-cli.md 參數；factcheck.md 若實作時發現跟規格不同）
- [x] 留下的殘餘寫進完成結果（由主 session 併入 `docs/known-issues.md`）
- [x] CURRENT_TASK 已更新（由主 session）

## 中斷／接手紀錄
- 最後完成：實作完成（2026-10-01）：兩份 schema、兩趟 prompt、`hostedSearch`／`strictNoTools`、registry `supportsHostedSearch`、假 adapter、agent-cli.md／factcheck.md
- 已通過驗證：`npm run verify` 綠（76 檔／1580 個測試；基準 73／1497）
- 下一步：主 session 審查與 commit；使用者做手動必驗（Claude 判斷趟 `--tools ""`＋`--json-schema`）
- Blocker：無（P5-T036、P6-T001 已合併）

## 完成結果
- `output-contract.ts`：`FACTCHECK_FIND_SCHEMA`、`FACTCHECK_JUDGE_SCHEMA`（形狀與上限照 factcheck.md；判斷趟 findings 另定最多 10 筆）、
  `correctionOf()`（沒給或空白 → null）。`correction` 選填、不接受 null，`stripNulls` 沒改。
- `src/core/factcheck-prompts.ts`：第一趟依 `hostedSearch` 換說法（開搜尋時沒有「你沒有網路」）；第二趟每份來源標 `S` 編號、
  包在標明不受信任的分隔區塊，內容過 `neutralize`、標題網址攤成一行；編號格式不對或重複丟錯。
- 審查修正：匯出 `sourceTextForAgent`／`articleTextForAgent`＝prompt 裡實際放的文字，**P6-T004 核對引文、檢查 excerpt、組「看原文」前後文都要用它們的輸出**；
  前處理依 Unicode 屬性整類刪 `Default_Ignorable_Code_Point`＋`Cf`、刪分隔字元後的組合記號、`﹦` 等 NFKC 後是分隔字元的字換成正規化樣子、NEL 當換行；
  `oneLine` 另把 NEL、U+2028、U+2029 當換行。emoji 的 VS16／ZWJ 會被刪（可接受）。
- `AgentRequest.hostedSearch`／`strictNoTools`；`AgentAdapter.supportsHostedSearch`（Codex、Claude true，agy false）；
  `AgentRegistry.supportsHostedSearch(id)`，`runStructured` 排隊前擋不支援的。兩個同時 true 三家都拒絕。
- `GoogleAdapter` 多一個測試用的 `command` 選項（跟另外兩家一樣），正式環境不變。
- 假 adapter：`hostedSearch` 能力、`respond` 依 schema 回結果、預設依兩份查證 schema 回示範輸出、`calls` 多記 `schema`。
- 測試：`tests/factcheck-schema.test.ts`、`tests/factcheck-prompts.test.ts`、`tests/agent-hosted-search.test.ts`（三家沒給選項時整串 argv 逐項鎖住）。

**殘餘（給 known-issues）：**
- 必驗未做：Claude 判斷趟 `--tools ""`＋`--json-schema` 是否回得出結構化輸出（subagent 不能送 prompt 給真實 CLI）。
  不相容就把 `claude.ts` `toolArgs` 的 strictNoTools 分支拿掉 `'--tools', ''`，並改 agent-cli.md「查證兩趟的參數」與 factcheck.md「③ 判斷」。
- 未證實（P6-T005 真跑時確認）：Codex `-c web_search="cached"` 在 `--ignore-user-config` 下是否生效；Claude `-p` 下 `--tools WebSearch`
  能不能用、搭 `--json-schema` 是否仍有結構化輸出。
- Claude 判斷趟另外照留禁用名單（規格只要求 `--tools ""`），多一層保險；退回方案因此只要拿掉 `--tools ""`。
- 獨立審查（2026-10-01）：既有各趟參數與 main 逐字相同、第一趟只開廠商端搜尋、第二趟最嚴格，安全邊界無問題。
  medium 已修：核對改用 Agent 實際看到的文字（`sourceTextForAgent`／`articleTextForAgent`）。low 已修：分隔線仿冒字元（未整段 NFKC，避免全形數字無法回原文定位）。
