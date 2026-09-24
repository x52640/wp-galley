import { describe, expect, it, afterEach, beforeEach } from 'vitest';
import { createTestDatabase, type TestDatabase } from './helpers/test-db.js';
import { runMigrations, listAppliedMigrations } from '../src/db/migrate.js';
import { migrations } from '../src/db/migrations/index.js';
import { openDatabase, type DatabaseSync } from '../src/db/index.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let db: TestDatabase;

beforeEach(() => {
  db = createTestDatabase();
});

afterEach(() => {
  db.cleanup();
});

const EXPECTED_TABLES = [
  'sites',
  'publish_targets',
  'templates',
  'jobs',
  'revisions',
  'agent_runs',
  'media_assets',
  'wordpress_objects',
  'approvals',
  'publish_events',
  'snapshots',
];

describe('migrations', () => {
  it('建立計畫第 11 節列出的所有資料表', () => {
    const rows = db.handle
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as { name: string }[];
    const names = rows.map((r) => r.name);
    for (const table of EXPECTED_TABLES) {
      expect(names).toContain(table);
    }
  });

  it('重複執行不會出錯也不會重複套用', () => {
    const before = listAppliedMigrations(db.handle);
    runMigrations(db.handle);
    runMigrations(db.handle);
    expect(listAppliedMigrations(db.handle)).toEqual(before);
  });

  it('開啟 foreign_keys 強制參照完整性', () => {
    const [row] = db.handle.prepare('PRAGMA foreign_keys').all() as { foreign_keys: number }[];
    expect(row?.foreign_keys).toBe(1);
    expect(() =>
      db.handle.prepare('INSERT INTO jobs (uuid, state, target_id) VALUES (?, ?, ?)').run('j1', 'SOURCE', 9999),
    ).toThrow();
  });

  it('jobs.state 只接受狀態機定義的值', () => {
    const insert = db.handle.prepare('INSERT INTO jobs (uuid, state) VALUES (?, ?)');
    expect(() => insert.run('ok-1', 'SOURCE')).not.toThrow();
    expect(() => insert.run('bad-1', 'WHATEVER')).toThrow();
  });

  it('approvals 只允許 created_by = ui，MCP 無法在 DB 層建立核准', () => {
    db.handle.prepare('INSERT INTO jobs (uuid, state) VALUES (?, ?)').run('job-a', 'RENDERED');
    const jobId = (db.handle.prepare('SELECT id FROM jobs WHERE uuid = ?').get('job-a') as { id: number }).id;
    db.handle
      .prepare('INSERT INTO revisions (job_id, revision_number, content_hash, origin) VALUES (?, ?, ?, ?)')
      .run(jobId, 1, 'hash-1', 'source');
    const revId = (db.handle.prepare('SELECT id FROM revisions WHERE job_id = ?').get(jobId) as { id: number }).id;

    const insert = db.handle.prepare(
      'INSERT INTO approvals (job_id, revision_id, content_hash, kind, created_by) VALUES (?, ?, ?, ?, ?)',
    );
    expect(() => insert.run(jobId, revId, 'hash-1', 'publish', 'ui')).not.toThrow();
    expect(() => insert.run(jobId, revId, 'hash-1', 'publish', 'mcp')).toThrow();
    expect(() => insert.run(jobId, revId, 'hash-1', 'publish', 'agent')).toThrow();
  });

  it('同一 job 的 revision_number 不可重複', () => {
    db.handle.prepare('INSERT INTO jobs (uuid, state) VALUES (?, ?)').run('job-b', 'SOURCE');
    const jobId = (db.handle.prepare('SELECT id FROM jobs WHERE uuid = ?').get('job-b') as { id: number }).id;
    const insert = db.handle.prepare(
      'INSERT INTO revisions (job_id, revision_number, content_hash, origin) VALUES (?, ?, ?, ?)',
    );
    insert.run(jobId, 1, 'h1', 'source');
    expect(() => insert.run(jobId, 1, 'h2', 'agent_review')).toThrow();
  });

  it('006：配圖需求多一欄錨點，舊資料是 NULL（P5-T016）', () => {
    expect(listAppliedMigrations(db.handle).map((row) => row.id)).toContain('006');
    const columns = db.handle.prepare('PRAGMA table_info(image_briefs)').all() as { name: string; notnull: number }[];
    const anchor = columns.find((column) => column.name === 'anchor');
    expect(anchor).toBeDefined();
    expect(anchor?.notnull).toBe(0);
  });
});

describe('007：內容類型多一個 article（P8-T001）', () => {
  /**
   * 重建表最怕的是外鍵：DROP TABLE 會觸發子表的 ON DELETE SET NULL，jobs 與 revisions
   * 會悄悄失去指向。這裡先停在 006 塞一份像真的資料，再套 007，逐列比對。
   */
  function seededAt006(): { handle: DatabaseSync; cleanup: () => void } {
    const dir = mkdtempSync(join(tmpdir(), 'wp-publisher-m007-'));
    const handle = openDatabase(join(dir, 'test.sqlite'));
    runMigrations(handle, migrations.slice(0, 6));
    handle.exec(`
      INSERT INTO sites (id, key, display_name, base_url) VALUES (1, 'remusplus', 'R', 'https://example.test');
      INSERT INTO publish_targets (id, site_id, key, display_name, content_type, endpoint, post_type, template_id, allow_create)
        VALUES (5, 1, 'read-think', '長文', 'longform', 'read-think', 'read-think', 'longform-v1', 1),
               (9, 1, 'diary', '日記', 'diary', 'diary', 'diary', 'diary-v1', 1);
      INSERT INTO templates (id, template_id, version, content_type, strictness, manifest_json, schema_json, hash)
        VALUES (3, 'longform-v1', 1, 'longform', 'hybrid', '{}', '{}', 'h-long'),
               (4, 'diary-v1', 1, 'diary', 'flexible', '{}', '{}', 'h-diary');
      INSERT INTO jobs (id, uuid, target_id, state) VALUES (1, 'j-long', 5, 'PUBLISHED'), (2, 'j-diary', 9, 'SOURCE'), (3, 'j-none', NULL, 'SOURCE');
      INSERT INTO revisions (id, job_id, revision_number, template_row_id, origin, content_hash)
        VALUES (1, 1, 1, 3, 'source', 'c1'), (2, 1, 2, 3, 'manual', 'c2'), (3, 2, 1, 4, 'source', 'c3'), (4, 3, 1, NULL, 'source', 'c4');
    `);
    return { handle, cleanup: () => { handle.close(); rmSync(dir, { recursive: true, force: true }); } };
  }

  function dump(handle: DatabaseSync, table: string): unknown[] {
    return handle.prepare(`SELECT * FROM ${table} ORDER BY id`).all();
  }

  it('每一列原封不動：id、jobs.target_id、revisions.template_row_id 都還在', () => {
    const { handle, cleanup } = seededAt006();
    try {
      const tables = ['sites', 'publish_targets', 'templates', 'jobs', 'revisions'];
      const before = Object.fromEntries(tables.map((t) => [t, dump(handle, t)]));
      runMigrations(handle);
      for (const table of tables) expect(dump(handle, table)).toEqual(before[table]);
      expect(handle.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      expect(handle.prepare('SELECT name FROM sqlite_temp_master').all()).toEqual([]);
    } finally {
      cleanup();
    }
  });

  it('接受 article，不接受契約外的值；首頁仍要綁固定 ID', () => {
    const { handle, cleanup } = seededAt006();
    try {
      runMigrations(handle);
      const target = handle.prepare(
        'INSERT INTO publish_targets (key, display_name, content_type, endpoint, post_type, template_id, fixed_object_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
      );
      expect(() => target.run('post', '文章', 'article', 'posts', 'post', 'article-v1', null)).not.toThrow();
      expect(() => target.run('x', 'X', 'whatever', 'x', 'x', 'x', null)).toThrow();
      expect(() => target.run('home', '首頁', 'homepage', 'pages', 'page', 'x', null)).toThrow();

      const template = handle.prepare(
        'INSERT INTO templates (template_id, version, content_type, strictness, manifest_json, schema_json, hash) VALUES (?, ?, ?, ?, ?, ?, ?)',
      );
      expect(() => template.run('article-v1', 1, 'article', 'hybrid', '{}', '{}', 'h-a')).not.toThrow();
      expect(() => template.run('bad-v1', 1, 'whatever', 'hybrid', '{}', '{}', 'h-b')).toThrow();
      // UNIQUE 還在。
      expect(() => template.run('article-v1', 1, 'article', 'hybrid', '{}', '{}', 'h-a')).toThrow();
    } finally {
      cleanup();
    }
  });

  it('外鍵接回新表：參照不存在的 target 會被擋，刪 target 仍會 SET NULL', () => {
    const { handle, cleanup } = seededAt006();
    try {
      runMigrations(handle);
      expect(() =>
        handle.prepare('INSERT INTO jobs (uuid, state, target_id) VALUES (?, ?, ?)').run('j-bad', 'SOURCE', 999),
      ).toThrow();
      expect(() =>
        handle
          .prepare('INSERT INTO revisions (job_id, revision_number, template_row_id, origin, content_hash) VALUES (?, ?, ?, ?, ?)')
          .run(3, 2, 999, 'manual', 'c5'),
      ).toThrow();
      handle.prepare('DELETE FROM publish_targets WHERE id = 9').run();
      expect(handle.prepare('SELECT target_id FROM jobs WHERE id = 2').get()).toEqual({ target_id: null });
      expect(handle.prepare('SELECT target_id FROM jobs WHERE id = 1').get()).toEqual({ target_id: 5 });
    } finally {
      cleanup();
    }
  });
});

describe('008：使用者在文章上請 AI 配的圖（P5-T018）', () => {
  it('舊的配圖需求補上預設值：origin=agent、anchor_position=after、user_note=NULL', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wp-publisher-m008-'));
    const handle = openDatabase(join(dir, 'test.sqlite'));
    try {
      runMigrations(handle, migrations.slice(0, 7));
      handle.exec(`
        INSERT INTO jobs (id, uuid, state) VALUES (1, 'j', 'SOURCE');
        INSERT INTO image_briefs (id, job_id, brief_key, purpose, prompt, aspect_ratio, alt_text, anchor)
          VALUES (1, 1, 'rainy', 'p', 'q', '4:3', 'a', '路口');
      `);
      runMigrations(handle);
      expect(listAppliedMigrations(handle).map((row) => row.id)).toContain('008');
      expect(
        handle.prepare('SELECT brief_key, anchor, origin, anchor_position, user_note FROM image_briefs').get(),
      ).toEqual({ brief_key: 'rainy', anchor: '路口', origin: 'agent', anchor_position: 'after', user_note: null });

      const insert = handle.prepare(
        'INSERT INTO image_briefs (job_id, brief_key, purpose, prompt, aspect_ratio, alt_text, origin, anchor_position) VALUES (1, ?, ?, ?, ?, ?, ?, ?)',
      );
      expect(() => insert.run('user-a', 'p', 'q', '16:9', '', 'user', 'before')).not.toThrow();
      expect(() => insert.run('user-b', 'p', 'q', '16:9', '', 'robot', 'after')).toThrow();
      expect(() => insert.run('user-c', 'p', 'q', '16:9', '', 'user', 'inside')).toThrow();
    } finally {
      handle.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
