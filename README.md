# 本機 AI WordPress 發布台

只在本機執行的 WordPress 內容發布台：本機 AI 當編輯，你當總編。

- 產品目標、範圍與決策：[`plan.md`](./plan.md)
- 目前進度：[`docs/CURRENT_TASK.md`](./docs/CURRENT_TASK.md)
- 技術規格：[`docs/specs/`](./docs/specs/README.md)

## 需求

- Node.js ≥ 22.5（需要內建的 `node:sqlite`；開發機實測 v26.7.0）
- 不需要任何 AI API Key

## 安裝與啟動

```bash
npm install
cp .env.example .env      # 填入 WordPress 網址、帳號與 Application Password
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
| `npm run verify` | typecheck ＋ 全部測試（commit 前的品質閘） |

## 安全設計

只綁 loopback、擋 DNS rebinding、秘密只在後端記憶體、核准只能由本機 UI 建立。
細節見 [`docs/specs/security.md`](./docs/specs/security.md)。

## 環境變數

見 [`.env.example`](./.env.example)。`.env` 已列入 `.gitignore`，連同 `data/`、`drafts/`、`generated-images/`、`backups/` 一起不進版控。

WordPress 相關三個變數要**一起填或一起留空**，只填一半會在啟動時報錯（避免發布當下才爆炸）。
