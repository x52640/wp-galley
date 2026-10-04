import { describe, expect, it, afterEach, beforeEach } from 'vitest';
import { createTestDatabase, type TestDatabase } from './helpers/test-db.js';
import { runMigrations, listAppliedMigrations } from '../src/db/migrate.js';
import { migrations } from '../src/db/migrations/index.js';
import { migration009 } from '../src/db/migrations/009-factcheck.js';
import { migration010 } from '../src/db/migrations/010-relative-paths.js';
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

describe('009：AI 查證的紀錄與結果（P6-T004）', () => {
  function at008(): { handle: DatabaseSync; cleanup: () => void } {
    const dir = mkdtempSync(join(tmpdir(), 'wp-publisher-m009-'));
    const handle = openDatabase(join(dir, 'test.sqlite'));
    runMigrations(handle, migrations.slice(0, 8));
    handle.exec(`
      INSERT INTO jobs (id, uuid, state) VALUES (1, 'j', 'SOURCE');
      INSERT INTO revisions (id, job_id, revision_number, origin, content_hash) VALUES (1, 1, 1, 'source', 'c1');
      INSERT INTO agent_runs (id, job_id, provider, purpose, status) VALUES (1, 1, 'claude', 'review', 'succeeded');
    `);
    return { handle, cleanup: () => { handle.close(); rmSync(dir, { recursive: true, force: true }); } };
  }
  const list = (): readonly (typeof migrations)[number][] => [...migrations.slice(0, 8), migration009];

  it('從 008 升上來：舊資料不動、兩張表建好，重跑不重複套用', () => {
    const { handle, cleanup } = at008();
    try {
      const before = handle.prepare('SELECT * FROM agent_runs').all();
      runMigrations(handle, list());
      const applied = listAppliedMigrations(handle);
      expect(applied.map((row) => row.id)).toContain('009');
      runMigrations(handle, list());
      expect(listAppliedMigrations(handle)).toEqual(applied);
      expect(handle.prepare('SELECT * FROM agent_runs').all()).toEqual(before);
      const names = (handle.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map(
        (row) => row.name,
      );
      expect(names).toEqual(expect.arrayContaining(['factcheck_runs', 'factcheck_findings']));
    } finally {
      cleanup();
    }
  });

  it('CHECK 擋掉契約外的值；刪稿件連帶刪掉查證', () => {
    const { handle, cleanup } = at008();
    try {
      runMigrations(handle, list());
      const run = handle.prepare(
        'INSERT INTO factcheck_runs (job_id, revision_id, scope, provider, status, stage, find_agent_run_id) VALUES (1, 1, ?, ?, ?, ?, 1)',
      );
      expect(() => run.run('article', 'claude', 'running', 'find')).not.toThrow();
      expect(() => run.run('whole', 'claude', 'running', 'find')).toThrow();
      expect(() => run.run('article', 'gpt', 'running', 'find')).toThrow();
      expect(() => run.run('article', 'claude', 'timeout', 'find')).toThrow();
      expect(() => run.run('article', 'claude', 'running', 'search')).toThrow();

      const finding = handle.prepare(
        'INSERT INTO factcheck_findings (run_id, job_id, ordinal, excerpt, claim, verdict, agent_verdict, evidence, sources_json, status) VALUES (1, 1, 0, ?, ?, ?, ?, ?, ?, ?)',
      );
      expect(() => finding.run('e', 'c', 'contradicted', 'contradicted', 'x', '[]', 'open')).not.toThrow();
      expect(() => finding.run('e', 'c', 'wrong', 'contradicted', 'x', '[]', 'open')).toThrow();
      expect(() => finding.run('e', 'c', 'supported', 'contradicted', 'x', '[]', 'closed')).toThrow();

      handle.prepare('DELETE FROM jobs WHERE id = 1').run();
      expect(handle.prepare('SELECT COUNT(*) AS n FROM factcheck_runs').get()).toEqual({ n: 0 });
      expect(handle.prepare('SELECT COUNT(*) AS n FROM factcheck_findings').get()).toEqual({ n: 0 });
    } finally {
      cleanup();
    }
  });
});

describe('010：DB 改存相對資料目錄的路徑（P8-T003）', () => {
  const ROOT = '/Users/someone/My Programs/wp_galley%old';
  function at009(): { handle: DatabaseSync; cleanup: () => void } {
    const dir = mkdtempSync(join(tmpdir(), 'wp-publisher-m010-'));
    const handle = openDatabase(join(dir, 'test.sqlite'));
    runMigrations(handle, migrations.slice(0, 9));
    const job = handle.prepare('INSERT INTO jobs (id, uuid, state, workspace_path) VALUES (?, ?, ?, ?)');
    job.run(1, 'a', 'SOURCE', `${ROOT}/drafts/a`);
    job.run(2, 'b', 'SOURCE', '/elsewhere/drafts/b'); // 使用者自己設過別處
    job.run(3, 'c', 'SOURCE', 'drafts/c'); // 已經是相對的
    job.run(4, 'd', 'SOURCE', null);
    job.run(5, 'e', 'SOURCE', `${ROOT}-other/drafts/e`); // 前綴相似但不是同一個資料夾
    job.run(6, 'f', 'SOURCE', `${ROOT.replace('%', 'X')}/drafts/f`); // % 不能當萬用字元
    const media = handle.prepare(
      "INSERT INTO media_assets (id, job_id, local_path, mime_type, byte_size, sha256) VALUES (?, 1, ?, 'image/png', 1, 's')",
    );
    media.run(1, `${ROOT}/generated-images/a/s.png`);
    media.run(2, '/elsewhere/x.png');
    handle.exec(`
      INSERT INTO image_briefs (id, job_id, brief_key, purpose, prompt, aspect_ratio, alt_text)
        VALUES (1, 1, 'k', 'p', 'p', '1:1', 'a');
    `);
    const candidate = handle.prepare(
      "INSERT INTO image_candidates (id, job_id, image_brief_id, local_path, mime_type, byte_size, sha256) VALUES (?, 1, 1, ?, 'image/png', 1, 's')",
    );
    candidate.run(1, `${ROOT}/generated-images/a/candidates/s.png`);
    candidate.run(2, 'generated-images/a/candidates/t.png');
    return { handle, cleanup: () => { handle.close(); rmSync(dir, { recursive: true, force: true }); } };
  }
  const list = (): readonly (typeof migrations)[number][] => [...migrations.slice(0, 9), migration010];
  const column = (handle: DatabaseSync, sql: string): unknown[] =>
    (handle.prepare(sql).all() as { v: unknown }[]).map((row) => row.v);

  it('舊程式根目錄開頭的三個欄位改成相對；別處、已相對、NULL、相似前綴原樣不動', () => {
    const { handle, cleanup } = at009();
    try {
      runMigrations(handle, list(), { legacyRoot: ROOT });
      expect(column(handle, 'SELECT workspace_path AS v FROM jobs ORDER BY id')).toEqual([
        'drafts/a',
        '/elsewhere/drafts/b',
        'drafts/c',
        null,
        `${ROOT}-other/drafts/e`,
        `${ROOT.replace('%', 'X')}/drafts/f`,
      ]);
      expect(column(handle, 'SELECT local_path AS v FROM media_assets ORDER BY id')).toEqual([
        'generated-images/a/s.png',
        '/elsewhere/x.png',
      ]);
      expect(column(handle, 'SELECT local_path AS v FROM image_candidates ORDER BY id')).toEqual([
        'generated-images/a/candidates/s.png',
        'generated-images/a/candidates/t.png',
      ]);
      // 暫存的參數表用完就收掉，不留在 DB 裡。
      expect(() => handle.prepare('SELECT * FROM temp.migration_env').all()).toThrow();
    } finally {
      cleanup();
    }
  });

  it('根目錄尾端多一個斜線也一樣；沒給舊根目錄就什麼都不改，重跑不重複套用', () => {
    const a = at009();
    try {
      runMigrations(a.handle, list(), { legacyRoot: `${ROOT}/` });
      expect(column(a.handle, 'SELECT workspace_path AS v FROM jobs WHERE id = 1')).toEqual(['drafts/a']);
    } finally {
      a.cleanup();
    }
    const b = at009();
    try {
      runMigrations(b.handle, list());
      expect(column(b.handle, 'SELECT workspace_path AS v FROM jobs WHERE id = 1')).toEqual([`${ROOT}/drafts/a`]);
      const applied = listAppliedMigrations(b.handle);
      expect(applied.map((row) => row.id)).toContain('010');
      // 已套用：之後再給舊根目錄也不會再跑一次。
      runMigrations(b.handle, list(), { legacyRoot: ROOT });
      expect(listAppliedMigrations(b.handle)).toEqual(applied);
      expect(column(b.handle, 'SELECT workspace_path AS v FROM jobs WHERE id = 1')).toEqual([`${ROOT}/drafts/a`]);
    } finally {
      b.cleanup();
    }
  });
});
