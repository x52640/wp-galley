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

export interface MigrationOptions {
  /**
   * 舊的程式資料夾（P8-T003 之前資料放在這裡）。migration 010 把 DB 裡以它開頭的絕對路徑改成相對資料目錄。
   * 不給就不改（測試、全新的 DB）。
   */
  readonly legacyRoot?: string;
}

/**
 * migration 要的、每台機器不一樣的參數，放進只活在這條連線的暫存表（`temp.migration_env`），
 * SQL 本身維持固定（checksum 才不會因機器而異）。
 */
function withMigrationEnv<T>(db: DatabaseSync, options: MigrationOptions, fn: () => T): T {
  db.exec('CREATE TEMP TABLE IF NOT EXISTS migration_env (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  db.exec('DELETE FROM temp.migration_env');
  if (options.legacyRoot !== undefined) {
    // 去掉尾端斜線，但根目錄 `/` 本身不算（不會有人把程式放在那裡，給了也不改任何東西）。
    const root = options.legacyRoot.replace(/\/+$/, '');
    if (root !== '') db.prepare("INSERT INTO temp.migration_env (key, value) VALUES ('legacy_root', ?)").run(root);
  }
  try {
    return fn();
  } finally {
    db.exec('DROP TABLE IF EXISTS temp.migration_env');
  }
}

/**
 * 冪等地套用所有 migration。已套用過的會比對 checksum：
 * 若有人事後改了已發布的 migration，這裡會直接報錯，而不是產生一個
 * 與別人不同的資料庫結構。
 */
export function runMigrations(
  db: DatabaseSync,
  list: readonly Migration[] = migrations,
  options: MigrationOptions = {},
): AppliedMigration[] {
  db.exec(BOOTSTRAP);
  withMigrationEnv(db, options, () => applyPending(db, list));
  return listAppliedMigrations(db);
}

function applyPending(db: DatabaseSync, list: readonly Migration[]): void {
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
}
