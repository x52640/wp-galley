import type { Migration } from '../migrate.js';

/**
 * 遠端變動偵測要比對的欄位變多了。
 *
 * 001 只存 `remote_hash`（content.raw 的 SHA-256）與 `remote_modified_gmt`，
 * 但我們每次更新實際會覆寫的是 title、slug、featured_media 與分類項目。只比內容
 * 的話，別人在後台改了標題或把草稿發成公開，發布台完全看不見，照樣蓋掉。
 *
 * 存成一整包 JSON 而不是四個欄位：這份快照的形狀由 `wordpress/posts.ts` 的
 * `RemoteSnapshot` 決定，日後要多比一個欄位不必再動一次 schema。欄位分開存的
 * 好處（可以下 SQL 查）在這裡用不到——它只被「跟現在的遠端比一下」讀走。
 *
 * 舊資料列沒有這一欄，會被當成「沒有比對基準」，發布時會先把現況抓下來存成基準
 * 並要求使用者再確認一次。那是刻意的：與其拿一份不完整的基準假裝比對過，
 * 不如老實說沒有基準。
 */
export const migration002: Migration = {
  id: '002',
  name: 'remote-snapshot',
  sql: `
ALTER TABLE wordpress_objects ADD COLUMN remote_snapshot_json TEXT;
`,
};
