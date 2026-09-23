import type { Migration } from '../migrate.js';

/**
 * AI 內文配圖自動放位置（D-020，P5-T016）。
 *
 * `anchor` 是 Agent 引用的一小段**原文**：這張圖要跟在哪一段後面。上傳成功後由後端拿它在
 * **目前這一版**裡找（忽略空白），剛好一段對得上才放進正文。
 *
 * 刻意存文字、不存段落編號：內容一改，編號就指到別段了；文字還在就找得到，不在了就明講
 * 「找不到」。封面那條沒有錨點（NULL），舊資料也是 NULL——兩者都不會被自動放進正文。
 */
export const migration006: Migration = {
  id: '006',
  name: 'image-brief-anchor',
  sql: `
ALTER TABLE image_briefs ADD COLUMN anchor TEXT;
`,
};
