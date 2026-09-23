# Current Task

<!-- 上限 100 行。只放指標，細節在被指向的檔案。索引目前手動維護（D-014）。 -->

## 主樹基準

- `npm run verify`：typecheck 通過；Vitest **32 檔 / 522 測試**全綠（2026-09-23）
- migration head：`004-image-briefs`
- 跑出來對不上就是環境漂移，先查清楚再動手。

## 進行中

- **P5-T007** B2 發布面板 → [tasks/P5-T007-ui-b2-publish.md](tasks/P5-T007-ui-b2-publish.md)

## Ready

| Task | 內容 | 備註 |
| --- | --- | --- |
| [P5-T001](tasks/P5-T001-test-stage-5-5.md) | 陪使用者實測階段 5.5 | 需要使用者在場 |
| [P5-T005](tasks/P5-T005-expected-content-hash.md) | 後端真的檢查 expectedContentHash | 小；保護目前不存在 |
| [P5-T004](tasks/P5-T004-split-core-service.md) | 拆分 CoreService | 跟 P5-T003 不衝突 |

## Blocked

| Task | 等什麼 |
| --- | --- |
| [P6-T001](tasks/P6-T001-factcheck.md) AI 查證 | P5-T001 |

## 待專案擁有者

`plan.md` 的「待裁定」Q-1～Q-8。其中 Q-1～Q-3 預定在 P5-T001 實測時回答。

## 已知殘餘（記錄，不擋進度）

- 前端以為建立 revision 有 `expectedContentHash` 保護，後端其實沒做 → P5-T005。
- 階段 5 的 Codex review 報告沒有留檔（`tests/review-proposal.test.ts` 已註明）。
- `core-service.md` 的方法清單是節錄 → P5-T004。
- 程式註解大量引用「計畫 §N」，指的是 `docs/archive/IMPLEMENTATION_PLAN.md`，部分已被推翻；
  以 spec 為準。
- `design-system.md` 的「版面」一節已被 D-013 取代，P5-T003 改寫。
- 刻意接受的限制（不是 bug）：見 `docs/specs/security.md` 最後一節、
  `docs/specs/review-proposals.md` 的逐項套用定位規則。

## 治理

- 人維護：本檔、plan.md、各 Task 的 front matter 與接手紀錄。
- 腳本（`task:index`、`verify:docs`、`task:close`）等 Task 累積到 5–10 個再做。
