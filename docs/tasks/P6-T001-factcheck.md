---
id: P6-T001
phase: 6
status: done
depends_on: []
specs: [factcheck.md, security.md]
write_paths: ["docs/specs/factcheck.md", "docs/specs/security.md", "docs/specs/README.md", "docs/specs/architecture.md", "docs/adr/0001-agent-no-network.md", "docs/adr/README.md", "docs/tasks/P6-T001-factcheck.md", "docs/tasks/P6-T002-*.md", "docs/tasks/P6-T003-*.md", "docs/tasks/P6-T004-*.md", "docs/tasks/P6-T005-*.md", "docs/CURRENT_TASK.md", "plan.md"]
contract_change: none
expected_commit: "docs(P6-T001): AI 查證規格定稿、修訂 ADR-0001，拆出 P6-T002～P6-T005"
---

# AI 查證規格定稿

## 目標
D-034（修訂 D-009）。設計研究的提案在 `/private/tmp/claude-501/factcheck-proposal.md`（2026-10-01，未進 repo）；
使用者已裁定四題全照建議：廠商伺服器上的搜尋可用於「找來源」那一趟、兩趟 Agent 的額度與時間可接受、
取回器照 Agent 給的網址抓的外洩殘餘風險接受、先做 P5-T036。

## 範圍
### 包含
- `factcheck.md` 從草案改成定稿：資料流（兩趟 Agent＋取回器＋引文逐字核對）、各 CLI 參數（Codex `web_search="cached"`、
  Claude 只給 `WebSearch`、agy 不開搜尋只走「記憶網址＋維基百科」）、取回器硬性要求、兩份輸出 schema、
  降級規則、觸發方式與 UI、結果永不自動套用。提案的內容要搬進來，**提案檔不進 repo**，定稿必須自足。
- ADR-0001 修訂：決定改為「Agent 不能**在使用者機器上**連外」，寫清楚為什麼廠商伺服器上的搜尋不觸發原本的威脅、
  哪些仍然禁止（WebFetch、本機抓取、shell 連外）。狀態註明修訂日期與 D-034。
- `security.md`：信任邊界與「刻意接受的限制」補上取回器外洩殘餘風險與緩解（外洩檢查、數量上限、WordPress 密碼擋死）。
- 開出 P6-T002（取回器）、P6-T003（schema、prompt、adapter `hostedSearch`）、P6-T004（後端流程、migration、API）、
  P6-T005（畫面）的 Task 檔，照 `_TEMPLATE.md`，寫清楚 write_paths、依賴（P6-T003 依賴 P5-T036）、驗證方式
  （測試不連真實網路、不呼叫真實 CLI；migration 先在 DB 複本驗證才註冊）。
- `plan.md` 階段地圖的階段 6、`CURRENT_TASK.md` 的進行中與 Ready。
### 不包含
- 任何程式碼。`agent-cli.md`（P5-T036 正在改）。

## 驗證
### 自動驗證
`npm run verify` 綠（沒改程式，照跑）。
### 手動驗證
使用者看一眼 factcheck.md 的「資料流」與 security.md 新增的限制。

## 完成定義
- [x] `npm run verify` 綠
- [x] 擁有這些行為的 spec 已更新
- [x] 留下的殘餘已寫進 `docs/known-issues.md`（本 Task 若有，寫進完成結果由主 session 併入）
- [x] CURRENT_TASK 已更新

## 中斷／接手紀錄
- 最後完成：文件全部寫完（2026-10-01）：factcheck.md 定稿、ADR-0001 修訂、security.md（信任邊界、硬性禁令、新節「取回器」、
  刻意接受的限制）、specs／adr 索引、P6-T002～P6-T005 Task 檔、plan.md（D-009 註記、D-034 連結、範圍、階段 6）、CURRENT_TASK
- 已通過驗證：`npm run verify`（見完成結果）
- 下一步：主 session 審查 → 另派審查 → commit／PR；使用者看 factcheck.md「資料流」與 security.md「取回器」「刻意接受的限制」
- Blocker：無。D-034 連到的 P5-T036 Task 檔在另一個 PR，合併前那個連結是斷的

## 完成結果
- `npm run verify` 綠：typecheck 通過、Vitest 72 檔／1494 測試（2026-10-01，沒改程式，跟主樹基準相同）。
- 跟提案不同的地方：取回器硬性要求的家放 security.md（提案建議 factcheck.md）；CLI 參數只寫進 agent-cli.md（提案要 security.md 也列參數表）；
  停止沿用 `DELETE …/agent`、進度沿用 `JobDetail.agentRun`（提案另開 `DELETE …/factcheck`）；新增：嘗試上限 12（留 8 份）、
  引文少於 8 字不算核對、同一句再查舊結果變 `superseded`、維基 API 上限 20（審查後改 30）、Agent 給的網址才做「文章片段」外洩檢查。
- 留給 known-issues：無新殘餘。P5-T036 Task 檔在另一個 PR，plan.md／CURRENT_TASK／factcheck.md 連過去的連結合併前是斷的。

### 獨立審查修正（2026-10-01，f210f6d 之後）
- Claude 第一趟：P5-T036 一律帶 `--disallowed-tools`（含 WebSearch），禁用優先 → 第一趟是禁用名單減掉 `WebSearch`＋`--tools/--allowed-tools WebSearch`＋`--strict-mcp-config --no-chrome`；P6-T003 測試照改。
- 未證實清單與 P6-T005 手動驗證加「`--tools WebSearch` 搭配 `--json-schema` 是否可用」。
- agy 不是「沒有工具」，只靠 `--sandbox`＋prompt 提示；Codex plugins 類未關；security.md 標「P5-T036 合併後成立」並在刻意接受的限制加一條；ADR-0001 同步。
- WordPress 密碼：選字與 prompt 派工前擋；候選網址在任何抓取前整批檢查，有密碼整次失敗、零抓取、記事件（security.md、factcheck.md、P6-T004 一致）。
- 查證跑中鎖內容（`taskLocksContent` 預設已鎖，不用改）；抓網頁階段 P6-T004 要自己組 running 的 `agentRun`；「內容被改」改成防禦性規則。
- P6-T003～T005 改 `blocked`，CURRENT_TASK 移到 Blocked 表。
- 取回器：檢查順序（格式與外洩檢查在 DNS 前）、punycode 解回再比、`application/json` 只收維基 API、維基 API 上限 30 且 Agent 給的維基網址算 API 次數、抓不到的原因要讓使用者看得到（`failReason`）。
- P6-T002 代理測試改成「代理埠沒收到連線」；P6-T005 write_paths 加 review-proposals.md、agent-tasks.md、`src/ui/lib/review-kinds.ts`。

### Codex 審查修正（2026-10-01，PR #17）
- 取回器整段拒絕 NAT64 本地前綴 `64:ff9b:1::/48`（RFC 8215）；P6-T002 加假 DNS 測試。
- 判斷趟改成「該 CLI 做得到的最嚴格無工具模式」：Claude `--tools ""`＋`--strict-mcp-config --no-chrome`（跟 `--json-schema` 的相容性是 P6-T003 手動必驗，不相容退回禁用名單並記錄）；Codex 照 P5-T036；agy 照現況。security.md 信任邊界改成有條件的說法並連到已接受的限制；ADR-0001、P6-T003 要求與測試同步。
- `correction` 改成選填、不接受 null（缺少＝null）：跟 Codex strict 轉換＋`stripNulls` 相容、不動現有 schema；P6-T003 要求測試走完整 adapter 解析流程。
- P6-T005 write_paths 加 `src/ui/service/types.ts`。
