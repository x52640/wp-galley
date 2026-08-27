import { openDatabase } from './index.js';
import { runMigrations } from './migrate.js';
import { databaseFile, ensureRuntimeDirectories } from '../config/paths.js';

ensureRuntimeDirectories();
const db = openDatabase(databaseFile);
const applied = runMigrations(db);
db.close();

console.log(`已套用 ${applied.length} 個 migration：`);
for (const row of applied) console.log(`  ${row.id} ${row.name} (${row.applied_at})`);
console.log(`資料庫：${databaseFile}`);
