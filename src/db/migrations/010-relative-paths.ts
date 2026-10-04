import type { Migration } from '../migrate.js';

/**
 * DB 改存相對資料目錄的路徑（D-035，P8-T003）。
 *
 * 以前 `jobs.workspace_path`、`media_assets.local_path`、`image_candidates.local_path` 存的是絕對路徑
 * （`<程式資料夾>/drafts/<uuid>` 之類）。資料搬到資料目錄後，這些路徑要改成相對資料目錄
 * （`drafts/<uuid>`），讀的時候以資料目錄解析；以後再搬也不會壞。
 *
 * 舊程式根目錄每台機器不一樣，不能寫死在 SQL 裡（checksum 會跟著變）：由 `runMigrations` 的
 * `legacyRoot` 放進暫存表 `temp.migration_env`，這裡用子查詢讀。沒給（測試、全新的 DB）就什麼都不改。
 *
 * 只改「舊根目錄＋`/`」開頭的值；別處的絕對路徑（使用者自己設過）、已經相對的、NULL 原樣不動。
 * 比對用 `substr` 不用 `LIKE`：路徑裡的 `%`、`_` 不能被當成萬用字元，大小寫也不能被忽略。
 */
const PREFIX = `(SELECT value || '/' FROM temp.migration_env WHERE key = 'legacy_root')`;
const CUT = `(SELECT length(value) + 2 FROM temp.migration_env WHERE key = 'legacy_root')`;

function relativize(table: string, column: string): string {
  return `
UPDATE ${table}
SET ${column} = substr(${column}, ${CUT})
WHERE ${PREFIX} IS NOT NULL
  AND length(${column}) >= ${CUT}
  AND substr(${column}, 1, length(${PREFIX})) = ${PREFIX};`;
}

export const migration010: Migration = {
  id: '010',
  name: 'relative-paths',
  sql: [
    relativize('jobs', 'workspace_path'),
    relativize('media_assets', 'local_path'),
    relativize('image_candidates', 'local_path'),
  ].join('\n'),
};
