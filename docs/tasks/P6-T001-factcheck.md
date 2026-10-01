---
id: P6-T001
phase: 6
status: ready
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
- [ ] `npm run verify` 綠
- [ ] 擁有這些行為的 spec 已更新
- [ ] 留下的殘餘已寫進 `docs/known-issues.md`（本 Task 若有，寫進完成結果由主 session 併入）
- [ ] CURRENT_TASK 已更新

## 中斷／接手紀錄
- 最後完成：開 Task（2026-10-01，原佔位檔重寫）
- 已通過驗證：—
- 下一步：派 subagent 實作
- Blocker：無（原本等 P5-T001，已解除）

## 完成結果
