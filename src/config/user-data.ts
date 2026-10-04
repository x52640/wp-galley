import {
  chmodSync,
  closeSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { randomBytes } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  dataPaths,
  ensureDataDir,
  ensureDataDirectories,
  legacyDataPaths,
  projectRoot,
  resolveDataDir,
  type DataPaths,
} from './paths.js';

/**
 * 第一次啟動把使用者資料從程式資料夾**複製**到資料目錄（D-035，P8-T003）。
 * `npm start`、`npm run dev`、`npm run migrate` 都走 `prepareUserData`，同一段。
 *
 * - **有沒有搬過看標記檔**（`<資料目錄>/.galley-data.json`，記 `createdAt` 與 `migratedFrom`＝舊根目錄或 null＝全新），
 *   不看 DB 在不在。標記檔是搬家（或全新建立）的**最後一步**才寫，任何一步失敗都不會有它，下次啟動整個重來
 *   （舊位置為準，覆蓋上次的半成品）。
 * - 已經搬過、但目前這份程式的舊位置還有一份**不是從這裡搬過去的** DB（例如別的 checkout 先建了資料目錄）：
 *   不搬、不擋啟動，回 `warning` 讓啟動訊息大聲講兩邊路徑。
 * - 沒有標記檔、但資料目錄已經有 DB（手動放的）：不覆蓋，補上標記（migratedFrom null），同樣警告。
 * - 只複製、不刪舊的（舊的就是備份）；`.env` 複製後維持 0600。
 * - SQLite 用 `VACUUM INTO` 拿一致的快照（不會是寫入中途的半份），唯讀打開快照做 `integrity_check`、確認有
 *   `schema_migrations`，通過才改名成 `publisher.sqlite`。暫存檔名帶 pid＋亂數，不碰別的行程的暫存檔。
 * - 整段在鎖檔（`<資料目錄>/.migrating.lock`，記 pid）裡做：兩個行程同時啟動只有一個搬，另一個停下來說明；
 *   鎖檔的 pid 已經不在（上次當掉）就接手。
 *
 * 純函式、路徑全部可注入：測試用暫存目錄，不碰真的資料目錄。
 */

/** 搬過（或全新建立過）的標記。 */
export const MARKER_FILE = '.galley-data.json';
/** 搬家期間的鎖。 */
export const LOCK_FILE = '.migrating.lock';
/** 鎖檔還沒寫進 pid（對方剛建立）的寬限時間。 */
const LOCK_GRACE_MS = 60_000;

export class DataMoveError extends Error {
  override readonly name = 'DataMoveError';
}

export type MoveOutcome =
  /** 資料目錄就是程式資料夾（`GALLEY_DATA_DIR` 指回去）：沒東西要搬。 */
  | { readonly kind: 'same-dir' }
  /** 已經搬過（有標記檔）。`warning`：這份程式的舊位置還有沒搬過去的 DB。 */
  | { readonly kind: 'already'; readonly warning: string | null }
  /** 舊位置沒東西（新 clone）：只建新目錄。 */
  | { readonly kind: 'fresh' }
  /** 這次搬了。`copied` 是舊位置被複製的路徑（給使用者確認後自己刪）。 */
  | { readonly kind: 'moved'; readonly copied: readonly string[]; readonly envFile: string | null };
/** git 的佔位檔：不算「有東西」，也不搬。 */
const PLACEHOLDERS = new Set(['.gitkeep', '.gitignore']);
/** `data/` 裡由 DB 那一步處理的檔。 */
const DB_SUFFIXES = ['', '-wal', '-shm', '-journal'];

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function contentOf(dir: string, skip: ReadonlySet<string> = PLACEHOLDERS): string[] {
  try {
    if (!statSync(dir).isDirectory()) return [];
    return readdirSync(dir).filter((name) => !skip.has(name));
  } catch {
    return [];
  }
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface Marker {
  readonly migratedFrom: string | null;
}

/** 讀標記檔。沒有是 null；壞掉的當成「搬過、來源不明」。 */
function readMarker(dataDir: string): Marker | null {
  const file = join(dataDir, MARKER_FILE);
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { migratedFrom?: unknown };
    return { migratedFrom: typeof parsed.migratedFrom === 'string' ? parsed.migratedFrom : null };
  } catch {
    return { migratedFrom: null };
  }
}

/** 寫標記檔（暫存檔＋改名）。搬家的最後一步。 */
function writeMarker(dataDir: string, migratedFrom: string | null): void {
  const file = join(dataDir, MARKER_FILE);
  const temp = `${file}.${process.pid}-${randomBytes(4).toString('hex')}`;
  try {
    writeFileSync(temp, `${JSON.stringify({ createdAt: new Date().toISOString(), migratedFrom }, null, 2)}\n`);
    renameSync(temp, file);
  } catch (error) {
    rmSync(temp, { force: true });
    throw new DataMoveError(`寫入資料目錄的標記檔 ${file} 失敗：${reason(error)}`);
  }
}

/** 已經搬過時，這份程式的舊位置還有一份沒搬過去的 DB：要大聲講。 */
function leftoverWarning(legacyRoot: string, legacyDb: string, dataDir: string, marker: Marker): string | null {
  if (!isFile(legacyDb) || marker.migratedFrom === legacyRoot) return null;
  return [
    '注意：這份程式的資料夾裡還有一份舊資料庫，但它沒有搬到資料目錄。',
    `  舊資料庫：${legacyDb}`,
    `  資料目錄：${dataDir}（${marker.migratedFrom === null ? '是全新建立的、或別的程式資料夾先建的' : `資料是從 ${marker.migratedFrom} 搬來的`}）`,
    '發布台現在用的是資料目錄裡的資料，舊資料庫裡的稿件不會出現。',
    '要改用舊資料：先關掉發布台、把資料目錄整個移走（或改名），再啟動一次就會從這裡重新搬；',
    '確定不要舊資料：把程式資料夾裡的 data/ 刪掉或移走，這個提醒就會消失。',
  ].join('\n');
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** 拿搬家的鎖；回傳放掉鎖的函式。拿不到（別的行程正在搬）就丟 DataMoveError。 */
function acquireLock(dataDir: string): () => void {
  const file = join(dataDir, LOCK_FILE);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(file, 'wx');
      try {
        writeSync(fd, String(process.pid));
      } finally {
        closeSync(fd);
      }
      return () => rmSync(file, { force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw new DataMoveError(`建立搬家的鎖檔 ${file} 失敗：${reason(error)}`);
      }
    }
    let pid = Number.NaN;
    let young = false;
    try {
      pid = Number(readFileSync(file, 'utf8').trim());
      young = Date.now() - statSync(file).mtimeMs < LOCK_GRACE_MS;
    } catch {
      continue; // 剛好被對方放掉了，再試一次
    }
    const busy = Number.isInteger(pid) && pid > 0 ? isAlive(pid) : young;
    if (busy) {
      throw new DataMoveError(
        `另一個發布台${Number.isInteger(pid) && pid > 0 ? `（pid ${pid}）` : ''}正在搬資料到 ${dataDir}。` +
          `等它跑完再啟動；確定沒有別的發布台在跑的話，刪掉 ${file} 再試。`,
      );
    }
    rmSync(file, { force: true }); // 上次當掉留下的鎖：接手
  }
  throw new DataMoveError(`拿不到搬家的鎖 ${file}，請再啟動一次`);
}

export function moveLegacyData(options: { legacyRoot: string; dataDir: string }): MoveOutcome {
  const legacyRoot = resolve(options.legacyRoot);
  const dataDir = resolve(options.dataDir);
  if (legacyRoot === dataDir) return { kind: 'same-dir' };

  const target = dataPaths(dataDir);
  const legacy = legacyDataPaths(legacyRoot);
  const marker = readMarker(dataDir);
  if (marker !== null) {
    return { kind: 'already', warning: leftoverWarning(legacyRoot, legacy.databaseFile, dataDir, marker) };
  }

  try {
    ensureDataDir(dataDir);
  } catch (error) {
    throw new DataMoveError(`建立資料目錄 ${dataDir} 失敗：${reason(error)}`);
  }
  const release = acquireLock(dataDir);
  try {
    return moveLocked(legacyRoot, dataDir, target, legacy);
  } finally {
    release();
  }
}

function moveLocked(
  legacyRoot: string,
  dataDir: string,
  target: DataPaths,
  legacy: ReturnType<typeof legacyDataPaths>,
): MoveOutcome {
  // 拿鎖之前別的行程可能剛搬完。
  const marker = readMarker(dataDir);
  if (marker !== null) {
    return { kind: 'already', warning: leftoverWarning(legacyRoot, legacy.databaseFile, dataDir, marker) };
  }
  // 沒有標記、卻已經有 DB（手動放的）：絕不覆蓋。
  if (existsSync(target.databaseFile)) {
    writeMarker(dataDir, null);
    return {
      kind: 'already',
      warning: leftoverWarning(legacyRoot, legacy.databaseFile, dataDir, { migratedFrom: null }),
    };
  }

  const dbName = basename(legacy.databaseFile);
  const dataSkip = new Set([...PLACEHOLDERS, ...DB_SUFFIXES.map((suffix) => `${dbName}${suffix}`)]);

  const files = [
    { from: legacy.envFile, to: target.envFile, secret: true },
    { from: legacy.siteConfigFile, to: target.siteConfigFile, secret: false },
  ].filter((item) => isFile(item.from));
  const dirs = [
    { from: legacy.drafts, to: target.drafts, skip: PLACEHOLDERS },
    { from: legacy.generatedImages, to: target.generatedImages, skip: PLACEHOLDERS },
    { from: legacy.backups, to: target.backups, skip: PLACEHOLDERS },
    { from: legacy.data, to: target.data, skip: dataSkip },
  ].filter((item) => contentOf(item.from, item.skip).length > 0);
  const hasDatabase = isFile(legacy.databaseFile);

  if (files.length === 0 && dirs.length === 0 && !hasDatabase) {
    writeMarker(dataDir, null);
    return { kind: 'fresh' };
  }

  for (const item of files) {
    try {
      copyFileSync(item.from, item.to);
      if (item.secret) chmodSync(item.to, 0o600);
    } catch (error) {
      throw new DataMoveError(`複製 ${item.from} 到 ${item.to} 失敗：${reason(error)}`);
    }
  }

  for (const item of dirs) {
    try {
      cpSync(item.from, item.to, {
        recursive: true,
        force: true,
        preserveTimestamps: true,
        // 只濾掉最上層的佔位檔與 DB 檔；子資料夾裡的照搬。
        filter: (source) => dirname(source) !== item.from || !item.skip.has(basename(source)),
      });
    } catch (error) {
      throw new DataMoveError(`複製 ${item.from} 到 ${item.to} 失敗：${reason(error)}`);
    }
  }

  if (hasDatabase) snapshotDatabase(legacy.databaseFile, target.databaseFile);
  writeMarker(dataDir, legacyRoot);

  const copied = [...files.map((item) => item.from), ...dirs.map((item) => item.from)];
  if (hasDatabase && !dirs.some((item) => item.from === legacy.data)) copied.push(legacy.data);
  return {
    kind: 'moved',
    copied,
    envFile: files.some((item) => item.secret) ? legacy.envFile : null,
  };
}

/**
 * 一致地複製 SQLite：`VACUUM INTO` 暫存檔 → 唯讀開啟做 integrity_check、確認有 schema_migrations → 改名。
 * 暫存檔名帶 pid＋亂數，只清自己的。失敗就清掉暫存檔再丟錯。
 */
function snapshotDatabase(from: string, to: string): void {
  const temp = `${to}.moving-${process.pid}-${randomBytes(4).toString('hex')}`;
  const cleanup = (): void => {
    for (const suffix of DB_SUFFIXES) rmSync(`${temp}${suffix}`, { force: true });
  };
  let source: DatabaseSync | null = null;
  try {
    mkdirSync(dirname(to), { recursive: true });
    source = new DatabaseSync(from);
    source.prepare('VACUUM INTO ?').run(temp);
    source.close();
    source = null;

    // 不存在或是空檔就不算（唯讀開啟也不會替它建一個空檔）。
    if (!isFile(temp) || statSync(temp).size === 0) throw new Error('快照檔沒有產生');
    const copy = new DatabaseSync(temp, { readOnly: true });
    try {
      const rows = copy.prepare('PRAGMA integrity_check').all() as { integrity_check: string }[];
      const result = rows.map((row) => row.integrity_check).join('; ');
      if (result !== 'ok') throw new Error(`integrity_check 沒通過：${result}`);
      const table = copy.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get();
      if (table === undefined) throw new Error('快照裡沒有 schema_migrations 表，不是發布台的資料庫');
    } finally {
      copy.close();
    }
    renameSync(temp, to);
  } catch (error) {
    try {
      source?.close();
    } catch {
      // 已經在處理錯誤，關不掉也不蓋掉原本的原因
    }
    cleanup();
    throw new DataMoveError(`複製資料庫 ${from} 到 ${to} 失敗：${reason(error)}`);
  }
}

/** 搬完印給使用者看的話；沒搬就是 null。 */
export function moveNotice(outcome: MoveOutcome, dataDir: string): string | null {
  if (outcome.kind !== 'moved') return null;
  const lines = [
    `你的資料已經複製到新的資料目錄：${dataDir}`,
    '舊資料還留在原處、沒有刪。確認發布台一切正常（舊稿件、舊圖都在）之後，可以自己刪掉這些：',
    ...outcome.copied.map((path) => `  ${path}`),
  ];
  if (outcome.envFile !== null) {
    lines.push(`注意：${outcome.envFile} 裡有 WordPress 應用程式密碼，不刪的話密碼會在電腦上多留一份。`);
  }
  return lines.join('\n');
}

export interface PreparedUserData {
  readonly paths: DataPaths;
  readonly outcome: MoveOutcome;
  /** 搬完的說明（印給使用者）。 */
  readonly notice: string | null;
  /** 舊位置還有沒搬過去的資料庫（啟動不擋，但要大聲印出來）。 */
  readonly warning: string | null;
}

/**
 * 啟動共用的一段：找出資料目錄、需要就搬家、建好底下的資料夾。
 * 丟 `DataDirError`（GALLEY_DATA_DIR 不對）或 `DataMoveError`（搬家失敗）時，呼叫端要停止啟動。
 */
export function prepareUserData(
  options: { legacyRoot?: string; env?: NodeJS.ProcessEnv } = {},
): PreparedUserData {
  const dir = resolveDataDir(options.env ?? process.env);
  const outcome = moveLegacyData({ legacyRoot: options.legacyRoot ?? projectRoot, dataDir: dir });
  const paths = dataPaths(dir);
  ensureDataDirectories(paths);
  return { paths, outcome, notice: moveNotice(outcome, dir), warning: outcome.kind === 'already' ? outcome.warning : null };
}
