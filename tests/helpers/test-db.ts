import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../../src/db/index.js';
import { runMigrations } from '../../src/db/migrate.js';
import type { DatabaseSync } from 'node:sqlite';

export interface TestDatabase {
  handle: DatabaseSync;
  dir: string;
  cleanup: () => void;
}

/** 每個測試檔用自己的暫存資料庫，不碰專案的 data/。 */
export function createTestDatabase(): TestDatabase {
  const dir = mkdtempSync(join(tmpdir(), 'wp-publisher-test-'));
  const handle = openDatabase(join(dir, 'test.sqlite'));
  runMigrations(handle);
  return {
    handle,
    dir,
    cleanup: () => {
      handle.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
