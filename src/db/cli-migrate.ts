import { openDatabase } from './index.js';
import { runMigrations } from './migrate.js';
import { migrations } from './migrations/index.js';
import { DataDirError, projectRoot } from '../config/paths.js';
import { DataMoveError, markDatabaseCreated, prepareUserData, type PreparedUserData } from '../config/user-data.js';

// 跟 npm start／npm run dev 走同一段：第一次跑先把舊資料搬到資料目錄（D-035，P8-T003）。
let prepared: PreparedUserData;
try {
  prepared = prepareUserData();
} catch (error) {
  if (error instanceof DataDirError || error instanceof DataMoveError) {
    const retry = error instanceof DataMoveError ? '\n\n舊資料都還在原處，沒有被動到。處理好上面的問題後再跑一次，會從頭再搬一次。' : '';
    console.error(`\n失敗：${error.message}${retry}\n`);
    process.exit(1);
  }
  throw error;
}
if (prepared.notice !== null) console.log(`\n${prepared.notice}\n`);
if (prepared.warning !== null) console.warn(`\n⚠ ${prepared.warning}\n`);

const db = openDatabase(prepared.paths.databaseFile);
const applied = runMigrations(db, migrations, { legacyRoot: projectRoot });
rememberDatabase(prepared.paths.dir);
db.close();

console.log(`已套用 ${applied.length} 個 migration：`);
for (const row of applied) console.log(`  ${row.id} ${row.name} (${row.applied_at})`);
console.log(`資料目錄：${prepared.paths.dir}`);
console.log(`資料庫：${prepared.paths.databaseFile}`);

/** 標記檔記下「這裡有過資料庫」（P8-T004）：之後資料庫不見了，啟動會停下來而不是默默建空的。記不下來只警告。 */
function rememberDatabase(dataDir: string): void {
  try {
    markDatabaseCreated(dataDir);
  } catch (error) {
    console.warn(`\n⚠ ${error instanceof Error ? error.message : String(error)}（不影響這次啟動）\n`);
  }
}
