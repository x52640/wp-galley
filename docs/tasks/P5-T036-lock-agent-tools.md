---
id: P5-T036
phase: 5
status: in_progress
depends_on: []
specs: [agent-cli.md, security.md]
write_paths: ["src/agents/", "tests/", "docs/specs/agent-cli.md", "docs/tasks/P5-T036-lock-agent-tools.md"]
contract_change: none
expected_commit: "fix(P5-T036): 現有 Agent 各趟明確關掉搜尋與外部工具"
---

# 現有 Agent 各趟明確關掉搜尋與外部工具

## 目標
D-034。AI 查證的設計研究（2026-10-01）查到兩件跟文件不一致、**尚未實測**的事：

- Codex 官方文件：`web_search` 預設是 `cached`（在 OpenAI 伺服器上執行的搜尋），`src/` 沒有關掉它的設定。
  所以現有的校稿、配圖、生圖、建議網址各趟很可能都開著快取搜尋，跟 `agent-cli.md`／ADR-0001 的說法不一致。
- Claude adapter 沒帶 `--strict-mcp-config`，使用者自己設定的 MCP server 可能被載入。

本 Task 讓實際參數跟「Agent 不能連外」一致；查證要開的搜尋之後由 P6-T003 只在「找來源」那一趟明確打開。

## 範圍
### 包含
- Codex adapter：每一趟明確帶 `-c web_search="disabled"`（或官方文件確認的等效設定），並關掉其他會連外或操作瀏覽器的功能
  （以 `codex features list`、官方文件為準，例如 browser 類功能）。注意：專案目前帶 `--ignore-user-config`，
  確認 `-c` 在這個旗標下仍生效的依據（文件或 `--help` 說法）；查不到就在 Task 寫「未證實」，留給使用者真跑時確認。
- Claude adapter：加 `--strict-mcp-config`（只用明確給的 MCP 設定，不給就是沒有）；確認現有的工具限制參數仍正確。
- agy：查 `--help` 有沒有對應的限制；沒有就在 agent-cli.md 記為已知限制，不改行為。
- 測試：用假執行檔（現有 adapter 測試的做法）斷言各趟的參數包含上述設定。
- `agent-cli.md` 更新各 CLI 的實際參數與理由。

### 不包含
- 查證功能本身（P6-T002～P6-T005）。
- 改 Agent 的 prompt 或輸出 schema。

## 實作要求
- 測試絕不呼叫真實 CLI（只能看 `--help`、`codex features list` 這類不送 prompt 的指令）。
- 參數用陣列傳，不得 `shell: true`。

## 驗證
### 自動驗證
`npm run verify` 綠。
### 手動驗證
使用者真跑一次 Codex 校稿與一次 Claude 校稿，確認 CLI 不因新參數報錯（只存草稿）。

## 完成定義
- [ ] `npm run verify` 綠
- [ ] agent-cli.md 已更新
- [ ] 留下的殘餘已寫進 `docs/known-issues.md`（本 Task 不改該檔，殘餘寫進完成結果，由主 session 併入）

## 中斷／接手紀錄
- 最後完成：Codex／Claude adapter 加參數、`tests/agent-cli-args.test.ts`、agent-cli.md「各趟的不連外參數」（2026-10-01）
- 已通過驗證：`npm run verify` 73 檔 / 1497 測試全綠（基準 72 / 1494）
- 下一步：審查 → 使用者手動真跑一次 Codex 校稿、一次 Claude 校稿、一次 Codex 生圖（只存草稿）→ commit
- Blocker：無

## 完成結果
- 改的檔：`src/agents/adapters/codex.ts`（`CODEX_NO_NETWORK_ARGS`，runStructured 與 generateImage 都帶）、
  `src/agents/adapters/claude.ts`（`CLAUDE_NO_EXTERNAL_TOOLS_ARGS`、黑名單加 `Agent`、`command` 選項供測試）、
  `tests/agent-cli-args.test.ts`（新）、`tests/codex-image.test.ts`（argv 期望值）、`docs/specs/agent-cli.md`。
- Codex：`-c web_search="disabled"`、`--disable browser_use / browser_use_external / browser_use_full_cdp_access /
  computer_use / in_app_browser / apps`。Claude：`--strict-mcp-config`、`--no-chrome`。agy：不改，記為已知限制。
- 給 known-issues 的殘餘（主 session 併入）：
  1. 未證實：Codex `-c`／`--disable` 在 `--ignore-user-config` 下生效；`--disable apps` 不影響生圖；
     不認得的 feature 名稱會不會報錯。→ 手動驗證確認。
  2. Claude 工具限制是黑名單，新版新增工具不會自動被擋；`--tools ""` 是否與 `--json-schema` 相容未驗證。
  3. Claude `--strict-mcp-config` 是否也擋 claude.ai 帳號層級連接器未證實。
  4. agy 沒有停用工具／忽略 MCP 的參數；不需權限的工具（如搜尋）會不會被呼叫未證實。
  5. `security.md` 第 60 行「不授權網路」的說法現在有參數撐腰（Codex／Claude），agy 仍只靠 sandbox＋提示；
     本 Task write_paths 不含 security.md，沒改。
