# ADR-0003：首頁移出 MVP

- 日期：2026-08-27
- 狀態：已採納（決策 D-001，Remus 裁定）
- 影響：[templates.md](../specs/templates.md)、[wordpress-site.md](../specs/wordpress-site.md)、
  `docs/reference/homepage/`

## 問題

page 1665 的 `content.rendered` 是**空字串**。首頁完全由 `astra-child` 子主題的 PHP 樣板
渲染，搭配 `assets/css/home-main.css`、`assets/js/home-main.js` 與手刻的 `ph-` class 系統
（`ph-hero`、`ph-about-item`、`ph-project-card-flip`…）。資料庫裡沒有任何首頁內容。

這使原始計畫的兩條規則無法同時成立：

- §4.2「首頁對應固定 Page ID，用 REST 更新」→ 寫進 `content` 不會有任何效果。
- §2「不修改 WordPress PHP、Theme 或 Plugin 原始碼」→ 唯一能改首頁的途徑被禁止。

## 決定

首頁移出 MVP。發布台只做 `diary` 與 `read-think`。首頁維持現行的手改主題方式
（流程見 `docs/reference/homepage/README.md`）。

## 影響

原始計畫以下段落在 MVP 中不實作：§4.2 全部、§8.4 首頁特殊保護、§9 首頁第二次警告、
§13 中與首頁相關的兩項完成條件、階段 2 驗收的「首頁模板結構遭更動時驗證失敗」。

`strict` 這個嚴格度仍保留在模板契約中（由 manifest 的 allowlist 決定，不是三段程式碼），
日後若把首頁內容搬進 WordPress 就能直接啟用，不需重寫 renderer。
