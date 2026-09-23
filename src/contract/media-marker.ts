/**
 * 這段 HTML 裡有沒有 WordPress 媒體 `mediaId` 的圖（`class` 裡的 `wp-image-<id>`）。
 *
 * **一定要整個 class 對上**：直接 `includes('wp-image-51')` 會把 `wp-image-512` 也算進去，
 * 搬圖時就會拿掉別張圖、畫面也會說還沒放的圖已經放了（P5-T016 審查）。後端判斷「放在哪」
 * 與前端示範資料用同一份，放在共用契約裡（不 import 任何東西）。
 *
 * 前後界線：前面是 class 屬性的開頭（引號）或空白，後面是空白或引號。
 */
export function hasWpImageClass(html: string, mediaId: number): boolean {
  if (!Number.isInteger(mediaId) || mediaId < 0) return false;
  return new RegExp(`(?:^|[\\s"'])wp-image-${mediaId}(?=[\\s"']|$)`).test(html);
}
