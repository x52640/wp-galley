# CLAUDE.md

本機 AI WordPress 發布台。本檔只放冷啟動協定、硬規則摘要與指令；其餘都在被指向的檔案。

## 冷啟動：改任何檔案之前

1. 讀 `plan.md`（邊界＋決策記錄＋待裁定）
2. 讀 `docs/README.md`（權威順序、鐵律、Task 規則、品質閘）
3. 讀 `docs/CURRENT_TASK.md`
4. 讀當前 Task，以及**只有它引用到的** spec／ADR
5. Task 狀態不是 `ready`／`in_progress` → 不准實作

不要預設載入全部 spec。不要把 `docs/archive/` 當現行需求。
使用者提出新方向時：先進 plan.md 決策記錄拿到裁定，再開 Task。

## 永遠適用（細節在 `docs/specs/security.md`）

- Agent 只產生結構化資料，HTML 由固定程式產生；後端一定用原始 schema 再驗一次。
- 核准只能由本機 UI 建立，內容一改就失效。MCP 與 UI 共用同一個 CoreService。
- WordPress Application Password 不進 Agent prompt、前端、log、MCP output。
- 不用 `shell: true` 啟動 CLI；不碰任何網頁 Cookie；不改 WordPress PHP。
- **把文章改成公開可能寄出電子報、自動分享，收不回來。** 真實驗證一律停在草稿。
- 測試絕不呼叫真實 Agent CLI（耗訂閱額度）、絕不連真實 WordPress。

## 指令

```bash
npm run verify     # typecheck ＋ 全部測試；commit 前必須綠
npm run dev        # 後端 127.0.0.1:3000 + Vite UI 127.0.0.1:5173（?fixtures=1 不用後端）
npm test           # Vitest 全部
npx vitest run tests/health.test.ts   # 單一檔案
npx vitest run -t "遮蔽"               # 依名稱篩選
npm run typecheck  # tsc --noEmit
npm run migrate    # 套用 SQLite migration
npm run build && npm start            # 正式啟動
```

## 地圖

| 要找 | 在哪 |
| --- | --- |
| 現在做什麼、基準數字 | `docs/CURRENT_TASK.md` |
| 為什麼這樣決定 | `plan.md` 決策記錄（一行結論）→ 連到的 Task「目標」、`docs/adr/` |
| 技術規格（誰擁有什麼） | `docs/specs/README.md` |
| 模組與依賴方向、程式慣例 | `docs/specs/architecture.md` |
| 功能在哪個檔（畫面 → 路由 → 後端 → spec → 測試） | `docs/specs/architecture.md`「功能地圖」 |
| 已知問題、殘餘 | `docs/known-issues.md` |
| 站台實況（post type、區塊格式、分類法） | `docs/specs/wordpress-site.md` |
| 三個 CLI 的參數與坑 | `docs/specs/agent-cli.md` |
| 首頁風格快照（不在發布台範圍） | `docs/reference/homepage/` |
