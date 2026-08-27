import type { LoadedTemplate } from '../templates/types.js';
import type { RenderResult } from '../templates/render.js';

/**
 * 把渲染結果包成一份完整的 HTML 文件，供 UI 放進 sandboxed iframe。
 *
 * 這份文件是**離線且封閉**的：CSP 設成 `default-src 'none'`，樣式只吃內嵌的
 * preview.css。就算正文裡混進了什麼，也發不出任何對外請求。
 */

/**
 * 擋掉能提前結束 <style> 區塊的字串。模板是受信任的本機設定，但打錯字或
 * 不小心貼錯內容不該變成漏洞。
 *
 * 用 CSS 的十六進位跳脫 `\3c ` 取代會開啟標籤的 `<`。CSS 語法本身用不到 `<`
 * （只有字串與 url() 裡可能出現，那裡 `\3c ` 一樣會解析回 `<`）。
 */
function escapeForStyleBlock(css: string): string {
  return css.replace(/<(?=[/a-zA-Z!])/g, '\\3c ');
}

export function buildPreviewDocument(template: LoadedTemplate, rendered: RenderResult): string {
  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src https: data:;">
<title>預覽：${template.manifest.id}</title>
<style>
${escapeForStyleBlock(template.previewCss)}
</style>
</head>
<body>
${rendered.previewHtml}
</body>
</html>
`;
}
