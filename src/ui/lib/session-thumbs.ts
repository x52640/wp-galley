/**
 * 本回合上傳的圖的縮圖（blob 網址），以媒體 id 為鍵。
 *
 * `MediaAsset.url` 是**發布後 WordPress 的公開網址**，還沒發布時是 null。所以本回合上傳的圖另外用 blob 網址
 * 記在這個表裡，讓使用者至少在這一次操作中看得到自己剛放進去的圖。重新整理後會退回占位圖，
 * 這是後端還沒有本機媒體檔案端點的必然結果，不是壞掉。配圖面板的底下上傳、卡片上傳、媒體列換圖／移除共用。
 */
export const sessionThumbs = new Map<number, string>();
