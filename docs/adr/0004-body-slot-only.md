# ADR-0004：模板只負責正文，外框不碰

- 日期：2026-08-27
- 狀態：已採納（決策 D-002）
- 影響：[templates.md](../specs/templates.md)

## 問題

原始計畫 §4.3 說長文的「固定外框包括標題、導讀、封面圖、正文、重點摘要、作者資訊及
延伸閱讀」。實際文章的 `content` 裡**沒有任何這些結構**——標題、日期、精選圖片、作者
全部由 Elementor 的 `single-post` 模板產生，正文則透過
`elementor-widget-theme-post-content` widget 輸出。

## 決定

發布台送出的 `content` **只有正文**。外框不在我們的輸出裡，所以「Agent 不能修改外框」
自動成立；要守的是正文的標籤／class allowlist。

模板的 `template.html` 只用於**本機預覽**（補上模擬外框讓使用者看得懂），manifest 以
`publishSlot` 指定哪一個 slot 的 HTML 才是要送去 WordPress 的內容。預覽用的外框永遠
不會被發布。
