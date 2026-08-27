# 現行首頁參考（唯讀快照）

抓取日期：2026-08-27，來源 https://www.remusplus.com/ 的公開前台。

**首頁不在發布台範圍內**（見 [`../../SITE-FINDINGS.md`](../../SITE-FINDINGS.md) 決定一）。
首頁的工作流程是：使用者提供素材 → 直接在對話中請 Claude 從頭產生一份完整 HTML
→ 使用者自行上傳到 `astra-child` 主題。整份重生，沒有版本累積，所以不走發布台的
revision／核准管線。

這裡放的是**風格對照用的快照**，不是要被程式讀取的模板。重生首頁時照著這裡的
class 命名與 CSS 走，新版才不會跟現有樣式打架。

| 檔案 | 內容 | 網站上的位置 |
| --- | --- | --- |
| `markup.html` | 首頁 `#content` 區塊的實際輸出 | `astra-child` 的 PHP 樣板 |
| `home-main.css` | 首頁專用樣式（1122 行） | `astra-child/assets/css/home-main.css` |
| `home-main.js` | 捲動揭示與翻卡互動（189 行） | `astra-child/assets/js/home-main.js` |

## class 命名慣例

全部以 `ph-` 開頭（personal home）。主要區塊：

`ph-hero` · `ph-about` · `ph-focus-grid` · `ph-strength-grid` · `ph-project-grid`
· `ph-featured-essay` · `ph-journal-panel`

共用元件：`ph-container`（版面寬度）、`ph-section`（區塊間距）、`ph-kicker`（小標）、
`ph-title`（區塊標題）、`ph-card`、`ph-btn ph-btn-primary` / `ph-btn-ghost`、
`ph-link-arrow`。帶 `data-reveal` 屬性的元素會由 `home-main.js` 做捲動揭示動畫。
