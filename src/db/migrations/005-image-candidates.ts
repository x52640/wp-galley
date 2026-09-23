import type { Migration } from '../migrate.js';

/**
 * 用 Codex 訂閱生圖（D-017，P5-T013）。
 *
 * **候選圖不是媒體。** Codex 生出來的圖先存在本機給使用者看，按「用這張」才上傳到
 * WordPress 媒體庫、變成一列 `media_assets`。沒被選上的就留在本機，不會出現在網站上。
 * 所以候選圖另開一張表，不塞進 `media_assets`——那張表的每一列都代表「已經（或正要）
 * 送上 WordPress 的東西」，混進去會讓「還沒上傳」有兩種意思。
 *
 * `agent_runs.image_brief_id`：生圖跟校稿共用「同一篇稿件一次只跑一個 Agent 動作」的
 * 規則，所以也記在 `agent_runs`（purpose = `generate-image`）。多這一欄是為了讓畫面知道
 * 「正在畫的是哪一張卡片」，計時器才掛得到對的卡片上。
 *
 * 候選圖的 `media_asset_id` 是「用了這張」之後上傳出來的那一列；用過的候選圖不再顯示。
 */
export const migration005: Migration = {
  id: '005',
  name: 'image-candidates',
  sql: `
ALTER TABLE agent_runs ADD COLUMN image_brief_id INTEGER REFERENCES image_briefs(id) ON DELETE SET NULL;

CREATE TABLE image_candidates (
  id              INTEGER PRIMARY KEY,
  job_id          INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  image_brief_id  INTEGER NOT NULL REFERENCES image_briefs(id) ON DELETE CASCADE,
  agent_run_id    INTEGER REFERENCES agent_runs(id) ON DELETE SET NULL,
  -- 本機檔案的絕對路徑（generated-images/ 底下）。只由後端讀，不會送到前端。
  local_path      TEXT NOT NULL,
  mime_type       TEXT NOT NULL,
  byte_size       INTEGER NOT NULL,
  width           INTEGER,
  height          INTEGER,
  sha256          TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  -- 按「用這張」之後上傳出來的媒體。NULL 代表還只是候選。
  media_asset_id  INTEGER REFERENCES media_assets(id) ON DELETE SET NULL,
  used_at         TEXT
);

CREATE INDEX idx_image_candidates_brief ON image_candidates (image_brief_id, id);
`,
};
