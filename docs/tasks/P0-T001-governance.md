---
id: P0-T001
phase: 0
status: done
depends_on: []
specs: [README.md]
write_paths: ["plan.md", "CLAUDE.md", "README.md", "docs/", "package.json", "src/**（僅註解中的文件路徑）"]
contract_change: none
expected_commit: "docs(P0-T001): 改用冷啟動治理架構"
---

# 改用冷啟動治理架構

## 目標
D-014。專案變大後，接手者要能在沒有記憶的前提下啟動；舊文件同一件事有多份說法。

## 範圍
### 包含
- 新增 `plan.md`、`docs/README.md`、`docs/CURRENT_TASK.md`、`docs/specs/`、`docs/adr/`、`docs/tasks/`
- 舊 `docs/STAGE-5-CONTRACT.md`、`STAGE-6-FACTCHECK.md`、`SITE-FINDINGS.md`、
  `AGENT-CLI-PROBE.md` 內容搬進 specs／ADR 後刪除（git 歷史保留原檔）
- `IMPLEMENTATION_PLAN.md` 移到 `docs/archive/`，章節編號不動（程式註解引用「計畫 §N」）
- `CLAUDE.md` 縮成冷啟動協定＋指令；`README.md` 更新進度
- 程式註解中的舊文件路徑改指新 spec
- `package.json` 加 `verify`
### 不包含
- 任何程式邏輯變更
- `task:index`／`verify:docs`／`task:close` 腳本（D-014：之後再做）

## 工作區與 Context
### 必讀入口
`know_how.md`（使用者提供的方法論，放在 repo 根目錄；是否納入版控由使用者決定，本 Task 不 commit 它）
### 驗證命令
`npm run verify`

## 完成定義
- [x] 舊文件每一節都有新家（由獨立 subagent 稽核）
- [x] 所有內部連結有效
- [x] `npm run verify` 綠，數字與基準相同（519）

## 中斷／接手紀錄
- 最後完成：全部檔案；獨立 subagent 稽核完成，缺漏、重複、矛盾已修
- 已通過驗證：`npm run verify` 519/519
- 下一步：無（已收官）
- Blocker：無

## 完成結果

舊文件拆成 14 份 spec、4 份 ADR、plan.md 決策記錄 15 條與待裁定 8 題；CLAUDE.md 從 218 行
縮到約 60 行；原始計畫封存。獨立稽核抓到的缺漏、重複定義與矛盾已修正。
驗證：`npm run verify` 31 檔 / 519 測試全綠，與基準相同。
