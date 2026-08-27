# 現行首頁參考（唯讀快照）

來源：使用者的 `../Wordpress Home Page/` 資料夾（git repo，最後 commit `4b6cb11`），
以及 2026-08-27 從 https://www.remusplus.com/ 公開前台抓取的線上版本。
`home-main.css` 與 `home-main.js` 兩份**位元組完全相同**，確認本機檔案就是線上版的來源。

**首頁不在發布台範圍內**（見 [`../../SITE-FINDINGS.md`](../../SITE-FINDINGS.md) 決定一）。
首頁的工作流程是：使用者提供素材 → 直接在對話中請 Claude 從頭產生一份完整 HTML
→ 使用者自行上傳到 `astra-child` 主題。整份重生，沒有版本累積，所以不走發布台的
revision／核准管線。

這裡放的是**風格對照用的快照**，不是要被程式讀取的模板。重生首頁時照著這裡的
class 命名與 CSS 走，新版才不會跟現有樣式打架。

| 檔案 | 內容 | 伺服器上的位置 | 已驗證 |
| --- | --- | --- | --- |
| `home-main.php.txt` | 首頁版面。**是 PHP 片段不是 HTML**，內含三處 `<?php echo get_stylesheet_directory_uri(); ?>` | `astra-child/` 底下的某個 `.php`，最可能是 `front-page.php` | ❌ 待確認 |
| `home-main.css` | 首頁專用樣式（1122 行） | `astra-child/assets/css/home-main.css` | ✅ SHA-256 相符 |
| `home-main.js` | 捲動揭示與翻卡互動（189 行） | `astra-child/assets/js/home-main.js` | ✅ SHA-256 相符 |
| （圖片不收在此） | `remus_selfie.webp`、`sales_management_profolio.webp`、`zeabur_profolio.webp` | `astra-child/assets/images/` | ✅ 路徑相符 |

## ⚠️ 待確認：版面放在哪個 PHP 檔

首頁 body class 是 `page-template-default`（沒有指定頁面範本），而 page 1665 的
`content` 是空的卻仍渲染出內容——這是 `front-page.php` 的典型行為，它會整個蓋掉
頁面內容。次要可能：`page-home.php`、`page-1665.php`。

確認方式：WordPress 後台 → 外觀 → 佈景主題檔案編輯器 → 選「Astra Child」→
看左側檔案清單。確認後把檔名填回這裡。

CSS 與 JS 的載入（`wp_enqueue_style` / `wp_enqueue_script`）應該寫在
`astra-child/functions.php`，重生首頁時如果沿用相同檔名就不必動它。

## class 命名慣例

全部以 `ph-` 開頭（personal home）。主要區塊：

`ph-hero` · `ph-about` · `ph-focus-grid` · `ph-strength-grid` · `ph-project-grid`
· `ph-featured-essay` · `ph-journal-panel`

共用元件：`ph-container`（版面寬度）、`ph-section`（區塊間距）、`ph-kicker`（小標）、
`ph-title`（區塊標題）、`ph-card`、`ph-btn ph-btn-primary` / `ph-btn-ghost`、
`ph-link-arrow`。帶 `data-reveal` 屬性的元素會由 `home-main.js` 做捲動揭示動畫。
