# 本機 AI WordPress 發布台

只在本機執行的 WordPress 內容發布台。完整規格見 [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md)。

> **目前進度：階段 1／7（安全本機骨架）**
> 已完成：本機限定伺服器、設定驗證與秘密遮蔽、SQLite migration、健康檢查、測試。
> 尚未實作：模板渲染、Agent 適配器、WordPress 連線、發布 UI、MCP Server。

## 需求

- Node.js ≥ 22.5（需要內建的 `node:sqlite`；開發機實測 v26.7.0）
- 不需要任何 AI API Key

## 安裝與啟動

```bash
npm install
cp .env.example .env      # 階段 1 可以不改任何值
npm run migrate           # 建立 data/publisher.sqlite
npm run dev               # 後端 127.0.0.1:3000 + Vite UI 127.0.0.1:5173
```

正式啟動（先建置，由 Fastify 直接提供 UI）：

```bash
npm run build
npm start                 # http://127.0.0.1:3000
```

## 指令

| 指令 | 用途 |
| --- | --- |
| `npm run dev` | 同時啟動後端（tsx watch）與 Vite UI |
| `npm run dev:server` | 只啟動後端 |
| `npm run dev:ui` | 只啟動 UI（會 proxy `/api` 到 3000） |
| `npm run build` | 編譯後端到 `dist/`、UI 到 `dist/ui/` |
| `npm start` | 執行已建置的服務 |
| `npm run migrate` | 套用 SQLite migration |
| `npm test` | 跑全部測試（Vitest） |
| `npm run test:watch` | watch 模式 |
| `npx vitest run tests/health.test.ts` | 只跑單一測試檔 |
| `npx vitest run -t "遮蔽"` | 只跑名稱含關鍵字的測試 |
| `npm run typecheck` | TypeScript 檢查（不產生輸出） |

## 安全設計

- **只綁 loopback。** `APP_HOST` 只接受 `127.0.0.1` / `localhost` / `::1`，填 `0.0.0.0` 會直接啟動失敗。
- **擋 DNS rebinding。** 每個請求都檢查 `Host` 與 `Origin` header 是否指向本機，不只看綁定位址。
- **秘密不外洩。** Application Password 只存在於後端記憶體；health endpoint 只回報「是否已設定」，log 有兩層遮蔽（pino redact + 字面值抹除）。
- **核准寫死在 DB。** `approvals.created_by` 有 `CHECK (created_by = 'ui')`，未來 MCP Server 即使程式寫錯也無法建立發布核准。

## 環境變數

見 [`.env.example`](./.env.example)。`.env` 已列入 `.gitignore`，連同 `data/`、`drafts/`、`generated-images/`、`backups/` 一起不進版控。

WordPress 相關三個變數要**一起填或一起留空**，只填一半會在啟動時報錯（避免發布當下才爆炸）。階段 4 之前留空即可。
