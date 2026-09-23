import type { Migration } from '../migrate.js';

/**
 * 通用內容類型 `article`（D-016，P8-T001）。
 *
 * `publish_targets.content_type` 與 `templates.content_type` 的 CHECK 寫死在 001-init，
 * SQLite 改不了 CHECK，只能重建表。CHECK 是放寬（多一個值），不是拿掉：
 * 內容類型仍然只能是契約裡列出的那幾種。
 *
 * ⚠️ 重建時最容易出事的是外鍵，這裡的做法是刻意的：
 *
 * - migration 在交易裡跑，交易裡 `PRAGMA foreign_keys = OFF` 不會生效。外鍵開著的時候，
 *   `DROP TABLE` 會先做一次隱含的 `DELETE`，觸發子表的 `ON DELETE SET NULL`：
 *   `jobs.target_id` 與 `revisions.template_row_id` 會被清成 NULL。
 * - 用「先把舊表改名」也不行：改名會連帶把子表的 `REFERENCES` 改成指向舊名字，
 *   舊表一刪，子表就指到不存在的表。
 *
 * 所以：先把兩個子表欄位的值抄到暫存表 → 建新表、搬資料（保留原 id）→ 刪舊表（子表被
 * 清成 NULL）→ 新表改回原名 → 從暫存表把值寫回去。子表的 `REFERENCES publish_targets`
 * 與 `REFERENCES templates` 是用名字指的，新表改回原名之後就接回來了。
 *
 * 表定義除了 CHECK 多一個 'article' 之外，跟 001-init 一字不差（002～006 沒有改過這兩張表）。
 */
export const migration007: Migration = {
  id: '007',
  name: 'article-content-type',
  sql: `
CREATE TEMP TABLE m007_job_targets AS
  SELECT id, target_id FROM jobs WHERE target_id IS NOT NULL;
CREATE TEMP TABLE m007_revision_templates AS
  SELECT id, template_row_id FROM revisions WHERE template_row_id IS NOT NULL;

CREATE TABLE publish_targets_new (
  id                          INTEGER PRIMARY KEY,
  site_id                     INTEGER REFERENCES sites(id) ON DELETE CASCADE,
  key                         TEXT NOT NULL UNIQUE,
  display_name                TEXT NOT NULL,
  content_type                TEXT NOT NULL CHECK (content_type IN ('homepage', 'longform', 'diary', 'article')),
  endpoint                    TEXT NOT NULL,
  post_type                   TEXT NOT NULL,
  fixed_object_id             INTEGER,
  template_id                 TEXT NOT NULL,
  default_categories_json     TEXT NOT NULL DEFAULT '[]',
  default_tags_json           TEXT NOT NULL DEFAULT '[]',
  preview_strategy            TEXT NOT NULL DEFAULT 'local' CHECK (preview_strategy IN ('local', 'wordpress_draft', 'staging')),
  allow_create                INTEGER NOT NULL DEFAULT 0 CHECK (allow_create IN (0, 1)),
  allow_update                INTEGER NOT NULL DEFAULT 0 CHECK (allow_update IN (0, 1)),
  require_second_confirmation INTEGER NOT NULL DEFAULT 0 CHECK (require_second_confirmation IN (0, 1)),
  created_at                  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at                  TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (content_type <> 'homepage' OR fixed_object_id IS NOT NULL)
);

INSERT INTO publish_targets_new
  (id, site_id, key, display_name, content_type, endpoint, post_type, fixed_object_id, template_id,
   default_categories_json, default_tags_json, preview_strategy, allow_create, allow_update,
   require_second_confirmation, created_at, updated_at)
SELECT
   id, site_id, key, display_name, content_type, endpoint, post_type, fixed_object_id, template_id,
   default_categories_json, default_tags_json, preview_strategy, allow_create, allow_update,
   require_second_confirmation, created_at, updated_at
FROM publish_targets;

DROP TABLE publish_targets;
ALTER TABLE publish_targets_new RENAME TO publish_targets;

CREATE TABLE templates_new (
  id            INTEGER PRIMARY KEY,
  template_id   TEXT NOT NULL,
  version       INTEGER NOT NULL,
  content_type  TEXT NOT NULL CHECK (content_type IN ('homepage', 'longform', 'diary', 'article')),
  strictness    TEXT NOT NULL CHECK (strictness IN ('strict', 'hybrid', 'flexible')),
  manifest_json TEXT NOT NULL,
  schema_json   TEXT NOT NULL,
  hash          TEXT NOT NULL,
  loaded_at     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (template_id, version, hash)
);

INSERT INTO templates_new
  (id, template_id, version, content_type, strictness, manifest_json, schema_json, hash, loaded_at)
SELECT
   id, template_id, version, content_type, strictness, manifest_json, schema_json, hash, loaded_at
FROM templates;

DROP TABLE templates;
ALTER TABLE templates_new RENAME TO templates;

UPDATE jobs
   SET target_id = (SELECT saved.target_id FROM m007_job_targets AS saved WHERE saved.id = jobs.id)
 WHERE id IN (SELECT id FROM m007_job_targets);
UPDATE revisions
   SET template_row_id = (SELECT saved.template_row_id FROM m007_revision_templates AS saved WHERE saved.id = revisions.id)
 WHERE id IN (SELECT id FROM m007_revision_templates);

DROP TABLE temp.m007_job_targets;
DROP TABLE temp.m007_revision_templates;
`,
};
