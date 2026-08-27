import type { Migration } from '../migrate.js';

/**
 * 基礎 schema，涵蓋計畫 §11 列出的所有資料表。
 *
 * 幾個約束是刻意寫死在 DB 層的安全底線，不只靠應用層檢查：
 * - jobs.state / revisions.origin / approvals.kind 用 CHECK 限制在狀態機定義的值。
 * - approvals.created_by 只接受 'ui'：計畫 §5「MCP Client 或 Agent 不能自行建立
 *   approval record」，即使日後有人在 CoreService 寫錯，DB 也會擋下來。
 * - revisions (job_id, revision_number) 唯一：版本號不可重複，保證 revision 不可變。
 */
export const migration001: Migration = {
  id: '001',
  name: 'init',
  sql: `
CREATE TABLE sites (
  id            INTEGER PRIMARY KEY,
  key           TEXT NOT NULL UNIQUE,
  display_name  TEXT NOT NULL,
  base_url      TEXT NOT NULL,
  username      TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE publish_targets (
  id                          INTEGER PRIMARY KEY,
  site_id                     INTEGER REFERENCES sites(id) ON DELETE CASCADE,
  key                         TEXT NOT NULL UNIQUE,
  display_name                TEXT NOT NULL,
  content_type                TEXT NOT NULL CHECK (content_type IN ('homepage', 'longform', 'diary')),
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
  -- 首頁必須綁定固定 Page ID，否則禁止更新（計畫 §8.4）。
  CHECK (content_type <> 'homepage' OR fixed_object_id IS NOT NULL)
);

CREATE TABLE templates (
  id            INTEGER PRIMARY KEY,
  template_id   TEXT NOT NULL,
  version       INTEGER NOT NULL,
  content_type  TEXT NOT NULL CHECK (content_type IN ('homepage', 'longform', 'diary')),
  strictness    TEXT NOT NULL CHECK (strictness IN ('strict', 'hybrid', 'flexible')),
  manifest_json TEXT NOT NULL,
  schema_json   TEXT NOT NULL,
  hash          TEXT NOT NULL,
  loaded_at     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (template_id, version, hash)
);

CREATE TABLE jobs (
  id             INTEGER PRIMARY KEY,
  uuid           TEXT NOT NULL UNIQUE,
  title          TEXT,
  target_id      INTEGER REFERENCES publish_targets(id) ON DELETE SET NULL,
  state          TEXT NOT NULL CHECK (state IN (
                   'SOURCE', 'REVIEWED', 'MEDIA_READY', 'RENDERED', 'PREVIEWED',
                   'APPROVED', 'PUBLISHING', 'PUBLISHED',
                   'FAILED', 'CANCELLED', 'SUPERSEDED')),
  workspace_path TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE revisions (
  id                 INTEGER PRIMARY KEY,
  job_id             INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  revision_number    INTEGER NOT NULL,
  parent_revision_id INTEGER REFERENCES revisions(id) ON DELETE SET NULL,
  template_row_id    INTEGER REFERENCES templates(id) ON DELETE SET NULL,
  origin             TEXT NOT NULL CHECK (origin IN (
                       'source', 'agent_review', 'media', 'template_switch', 'chat', 'manual')),
  content_hash       TEXT NOT NULL,
  source_text        TEXT,
  template_data_json TEXT,
  rendered_html      TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (job_id, revision_number)
);

CREATE INDEX idx_revisions_job ON revisions (job_id, revision_number DESC);

CREATE TABLE agent_runs (
  id            INTEGER PRIMARY KEY,
  job_id        INTEGER REFERENCES jobs(id) ON DELETE CASCADE,
  revision_id   INTEGER REFERENCES revisions(id) ON DELETE SET NULL,
  provider      TEXT NOT NULL CHECK (provider IN ('codex', 'claude', 'google')),
  model         TEXT,
  purpose       TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed', 'cancelled', 'timeout')),
  started_at    TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at   TEXT,
  input_hash    TEXT,
  output_hash   TEXT,
  usage_json    TEXT,
  error_message TEXT
);

CREATE TABLE media_assets (
  id                 INTEGER PRIMARY KEY,
  job_id             INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  brief_key          TEXT,
  local_path         TEXT NOT NULL,
  mime_type          TEXT NOT NULL,
  byte_size          INTEGER NOT NULL,
  width              INTEGER,
  height             INTEGER,
  sha256             TEXT NOT NULL,
  alt_text           TEXT,
  caption            TEXT,
  wordpress_media_id INTEGER,
  uploaded_at        TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE wordpress_objects (
  id                  INTEGER PRIMARY KEY,
  site_id             INTEGER REFERENCES sites(id) ON DELETE CASCADE,
  job_id              INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
  object_type         TEXT NOT NULL,
  wordpress_id        INTEGER NOT NULL,
  status              TEXT,
  link                TEXT,
  -- 用來偵測遠端在我們載入之後是否被別人改過（計畫 §8.4）。
  remote_hash         TEXT,
  remote_modified_gmt TEXT,
  last_synced_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (site_id, object_type, wordpress_id)
);

CREATE TABLE approvals (
  id            INTEGER PRIMARY KEY,
  job_id        INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  revision_id   INTEGER NOT NULL REFERENCES revisions(id) ON DELETE CASCADE,
  -- 核准綁定的是內容 hash；內容一改 hash 就對不上，核准立即失效。
  content_hash  TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('publish', 'restore')),
  -- 只有本機 UI 能建立核准（計畫 §5）；MCP／Agent 一律被 DB 擋下。
  created_by    TEXT NOT NULL DEFAULT 'ui' CHECK (created_by = 'ui'),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at    TEXT,
  revoke_reason TEXT
);

CREATE INDEX idx_approvals_active ON approvals (job_id, kind, revoked_at);

CREATE TABLE publish_events (
  id          INTEGER PRIMARY KEY,
  job_id      INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  revision_id INTEGER REFERENCES revisions(id) ON DELETE SET NULL,
  approval_id INTEGER REFERENCES approvals(id) ON DELETE SET NULL,
  actor       TEXT NOT NULL CHECK (actor IN ('ui', 'mcp', 'system')),
  event_type  TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('started', 'succeeded', 'failed', 'rejected')),
  detail_json TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE snapshots (
  id                   INTEGER PRIMARY KEY,
  job_id               INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
  site_id              INTEGER REFERENCES sites(id) ON DELETE CASCADE,
  wordpress_object_id  INTEGER REFERENCES wordpress_objects(id) ON DELETE SET NULL,
  -- 快照本體存檔案，不塞進 DB。
  payload_path         TEXT NOT NULL,
  payload_hash         TEXT NOT NULL,
  taken_at             TEXT NOT NULL DEFAULT (datetime('now')),
  restored_at          TEXT
);
`,
};
