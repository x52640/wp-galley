import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { migrations } from './migrations/index.js';

export interface Migration {
  readonly id: string;
  readonly name: string;
  readonly sql: string;
}

export interface AppliedMigration {
  readonly id: string;
  readonly name: string;
  readonly checksum: string;
  readonly applied_at: string;
}

const BOOTSTRAP = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  checksum   TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

function checksum(sql: string): string {
  return createHash('sha256').update(sql).digest('hex');
}

export function listAppliedMigrations(db: DatabaseSync): AppliedMigration[] {
  db.exec(BOOTSTRAP);
  return db.prepare('SELECT id, name, checksum, applied_at FROM schema_migrations ORDER BY id').all() as unknown as AppliedMigration[];
}

export class MigrationError extends Error {
  override readonly name = 'MigrationError';
}

/**
 * 冪等地套用所有 migration。已套用過的會比對 checksum：
 * 若有人事後改了已發布的 migration，這裡會直接報錯，而不是產生一個
 * 與別人不同的資料庫結構。
 */
export function runMigrations(db: DatabaseSync, list: readonly Migration[] = migrations): AppliedMigration[] {
  db.exec(BOOTSTRAP);
  const applied = new Map(listAppliedMigrations(db).map((row) => [row.id, row]));

  for (const migration of list) {
    const sum = checksum(migration.sql);
    const existing = applied.get(migration.id);
    if (existing) {
      if (existing.checksum !== sum) {
        throw new MigrationError(
          `migration ${migration.id} (${migration.name}) 內容已被修改；請新增一個 migration，不要改動已套用的。`,
        );
      }
      continue;
    }

    db.exec('BEGIN');
    try {
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations (id, name, checksum) VALUES (?, ?, ?)').run(
        migration.id,
        migration.name,
        sum,
      );
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw new MigrationError(
        `套用 migration ${migration.id} (${migration.name}) 失敗：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return listAppliedMigrations(db);
}
