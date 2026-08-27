import { describe, expect, it, afterEach, beforeEach } from 'vitest';
import { createTestDatabase, type TestDatabase } from './helpers/test-db.js';
import { runMigrations, listAppliedMigrations } from '../src/db/migrate.js';

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
});
