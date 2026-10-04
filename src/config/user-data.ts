import {
  chmodSync,
  closeSync,
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
  DataDirError,
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
 * - **有沒有搬過看標記檔**（`<資料目錄>/.galley-data.json`，記 `createdAt`、`state`、`migratedFrom`＝舊根目錄或 null＝全新），
 *   不看 DB 在不在。開始複製前先寫 `state: 'migrating'`，全部做完的最後一步才改成 `done`；
 *   停在 `migrating`（中途失敗、或寫 done 前當掉）的下次啟動整份重搬（舊位置為準，覆蓋新位置的半成品）。
 * - 已經搬過、但目前這份程式的舊位置還有一份**不是從這裡搬過去的** DB（例如別的 checkout 先建了資料目錄）：
 *   不搬、不擋啟動，回 `warning` 讓啟動訊息大聲講兩邊路徑。
 * - **沒有**標記檔、但資料目錄已經有 DB（手動放的）：不覆蓋，補上標記（migratedFrom null），同樣警告。
 * - 讀不到的舊資料（權限、I/O 錯誤）不當成沒有：停止搬家並說明。只有「不存在」才算沒有。
 * - 順序：**先快照 DB、再複製資料夾**、最後 `.env` 與站台設定檔。搬家途中舊行程若還在寫，資料夾只會是 DB 引用的超集。
 * - 只複製、不刪舊的（舊的就是備份）；`.env` 先用 0600 建暫存檔寫入再改名，沒有可讀的空窗。
 * - SQLite 用 `VACUUM INTO` 拿一致的快照（不會是寫入中途的半份），唯讀打開快照做 `integrity_check`、確認有
 *   `schema_migrations`，通過才改名成 `publisher.sqlite`。暫存檔名帶 pid＋亂數，不碰別的行程的暫存檔。
 * - 整段在鎖檔（`<資料目錄>/.migrating.lock`，記 pid）裡做，規則見 `acquireMoveLock`。
 * - 標記檔另記 `databaseCreated`（資料目錄裡有沒有過資料庫）。有過、現在卻不見了（或是空檔）就停止啟動，
 *   不默默建一個空的（P8-T004，見 `assertDatabasePresent`）。
 *
 * 純函式、路徑全部可注入：測試用暫存目錄，不碰真的資料目錄。
 */

/** 搬過（或全新建立過）的標記。 */
export const MARKER_FILE = '.galley-data.json';
/** 搬家期間的鎖。 */
export const LOCK_FILE = '.migrating.lock';

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

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}

/** 是不是一般檔案。不存在算 false；其他錯誤（權限、I/O）不吞，停止搬家並說明。 */
function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch (error) {
    if (errorCode(error) === 'ENOENT' || errorCode(error) === 'ENOTDIR') return false;
    throw new DataMoveError(`讀不到 ${path}：${reason(error)}`);
  }
}

/**
 * 資料夾裡要搬的東西。不存在算空的；**其他錯誤（權限、I/O）不吞**——讀不到不等於沒東西，
 * 當成空的略過、寫上完成標記之後就永遠不會再搬了。
 */
function contentOf(dir: string, skip: ReadonlySet<string> = PLACEHOLDERS): string[] {
  try {
    if (!statSync(dir).isDirectory()) return [];
    return readdirSync(dir).filter((name) => !skip.has(name));
  } catch (error) {
    if (errorCode(error) === 'ENOENT' || errorCode(error) === 'ENOTDIR') return [];
    throw new DataMoveError(`讀不到 ${dir}，沒辦法確認裡面有沒有要搬的東西：${reason(error)}`);
  }
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface Marker {
  /** `migrating`：開始搬了但還沒搬完（下次啟動整份重搬）；`done`：搬完或全新建立。 */
  readonly state: 'migrating' | 'done';
  readonly migratedFrom: string | null;
  /** 資料目錄裡有過資料庫（搬過來的、手動放的、或啟動時建過的）。之後不見了就停止啟動。 */
  readonly databaseCreated: boolean;
  /** 第一次寫標記的時間；改寫時保留。 */
  readonly createdAt?: string;
}

/**
 * 讀標記檔。沒有是 null；壞掉的當成「搬過、來源不明、有過資料庫」（保守：資料庫不見就停下來問人）；
 * 沒有 state 的（舊格式）當成 done；沒有 databaseCreated 的（P8-T004 之前）：搬過來的當成有過，全新的當成沒有。
 */
function readMarker(dataDir: string): Marker | null {
  const file = join(dataDir, MARKER_FILE);
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as {
      state?: unknown;
      migratedFrom?: unknown;
      databaseCreated?: unknown;
      createdAt?: unknown;
    };
    const migratedFrom = typeof parsed.migratedFrom === 'string' ? parsed.migratedFrom : null;
    return {
      state: parsed.state === 'migrating' ? 'migrating' : 'done',
      migratedFrom,
      databaseCreated: typeof parsed.databaseCreated === 'boolean' ? parsed.databaseCreated : migratedFrom !== null,
      ...(typeof parsed.createdAt === 'string' ? { createdAt: parsed.createdAt } : {}),
    };
  } catch {
    return { state: 'done', migratedFrom: null, databaseCreated: true };
  }
}

/** 寫標記檔（暫存檔＋改名）。開始複製前寫 migrating，最後一步改成 done。 */
function writeMarker(dataDir: string, marker: Marker): void {
  const file = join(dataDir, MARKER_FILE);
  const temp = `${file}.${process.pid}-${randomBytes(4).toString('hex')}`;
  const { createdAt = new Date().toISOString(), ...rest } = marker;
  try {
    writeFileSync(temp, `${JSON.stringify({ createdAt, ...rest }, null, 2)}\n`);
    renameSync(temp, file);
  } catch (error) {
    rmSync(temp, { force: true });
    throw new DataMoveError(`寫入資料目錄的標記檔 ${file} 失敗：${reason(error)}`);
  }
}

/**
 * 已經搬過時，這份程式的舊位置還有一份沒搬過去的 DB：要大聲講。
 * 先比 `migratedFrom`（就是從這裡搬的就不探舊位置）；探舊位置出任何錯（權限、I/O）只略過警告，不擋啟動——
 * 已經搬完了，舊位置讀不讀得到跟現在用的資料無關。
 */
function leftoverWarning(legacyRoot: string, legacyDb: string, dataDir: string, marker: Marker): string | null {
  if (marker.migratedFrom === legacyRoot) return null;
  try {
    if (!statSync(legacyDb).isFile()) return null;
  } catch {
    return null;
  }
  return [
    '注意：這份程式的資料夾裡還有一份舊資料庫，但它沒有搬到資料目錄。',
    `  舊資料庫：${legacyDb}`,
    `  資料目錄：${dataDir}（${marker.migratedFrom === null ? '是全新建立的、或別的程式資料夾先建的' : `資料是從 ${marker.migratedFrom} 搬來的`}）`,
    '發布台現在用的是資料目錄裡的資料，舊資料庫裡的稿件不會出現。',
    '要改用舊資料：先關掉發布台、把資料目錄整個移走（或改名），再啟動一次就會從這裡重新搬；',
    '確定不要舊資料：把程式資料夾裡的 data/ 刪掉或移走，這個提醒就會消失。',
  ].join('\n');
}

function readQuietly(file: string): string | null {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

/**
 * 拿搬家的鎖（`<資料目錄>/.migrating.lock`，內容是 pid）；回傳放掉鎖的函式。
 *
 * - 鎖檔已經存在就**停止並說明**（pid、建立時間、確定沒在跑時要刪哪個檔），**不自動接手**，也不猜它是不是過期的
 *   （P8-T004）：檔案系統上沒有可靠的原子接手；這條路只有沒搬完的安裝會走，讓人手動刪鎖的成本很低。
 * - 放鎖時只刪內容是自己 pid 的鎖。
 */
export function acquireMoveLock(dataDir: string): () => void {
  const file = join(dataDir, LOCK_FILE);
  const mine = String(process.pid);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const fd = openSync(file, 'wx', 0o600);
      try {
        writeSync(fd, mine);
      } finally {
        closeSync(fd);
      }
      return () => {
        if (readQuietly(file) === mine) rmSync(file, { force: true });
      };
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') {
        throw new DataMoveError(`建立搬家的鎖檔 ${file} 失敗：${reason(error)}`);
      }
    }

    let created: Date;
    try {
      created = statSync(file).mtime;
    } catch (error) {
      if (errorCode(error) === 'ENOENT') continue; // 剛好被對方放掉了，再試一次
      throw new DataMoveError(`讀不到搬家的鎖檔 ${file}：${reason(error)}`);
    }
    const pid = Number((readQuietly(file) ?? '').trim());
    const owner = Number.isInteger(pid) && pid > 0 ? `pid ${pid}，` : '';
    throw new DataMoveError(
      [
        `資料目錄 ${dataDir} 有一把搬家的鎖（${owner}建立於 ${created.toISOString()}）。`,
        '可能是另一個發布台正在搬資料，也可能是上次搬到一半被中斷留下的；發布台不自己判斷是哪一種。',
        `等另一個發布台跑完再啟動；確定沒有別的發布台在跑${owner === '' ? '' : `（例如用「活動監視器」查不到 pid ${pid}）`}，刪掉這個檔再啟動：`,
        `  ${file}`,
      ].join('\n'),
    );
  }
  throw new DataMoveError(`拿不到搬家的鎖 ${file}，請再啟動一次`);
}

/** 搬家的各步驟（測試用來確認順序）。 */
export type MoveStep = 'database' | 'folders' | 'files';

export interface MoveOptions {
  readonly legacyRoot: string;
  readonly dataDir: string;
  /** 每一步做完時呼叫（測試用）。 */
  readonly onStep?: (step: MoveStep) => void;
}

export function moveLegacyData(options: MoveOptions): MoveOutcome {
  const legacyRoot = resolve(options.legacyRoot);
  const dataDir = resolve(options.dataDir);
  if (legacyRoot === dataDir) return { kind: 'same-dir' };

  const legacy = legacyDataPaths(legacyRoot);
  const marker = readMarker(dataDir);
  if (marker?.state === 'done') {
    return { kind: 'already', warning: leftoverWarning(legacyRoot, legacy.databaseFile, dataDir, marker) };
  }

  try {
    ensureDataDir(dataDir);
  } catch (error) {
    throw new DataMoveError(`建立資料目錄 ${dataDir} 失敗：${reason(error)}`);
  }
  const release = acquireMoveLock(dataDir);
  try {
    return moveLocked(legacyRoot, dataDir, options.onStep ?? (() => undefined));
  } finally {
    release();
  }
}

function moveLocked(legacyRoot: string, dataDir: string, onStep: (step: MoveStep) => void): MoveOutcome {
  const target = dataPaths(dataDir);
  const legacy = legacyDataPaths(legacyRoot);
  // 拿鎖之前別的行程可能剛搬完。
  const marker = readMarker(dataDir);
  if (marker?.state === 'done') {
    return { kind: 'already', warning: leftoverWarning(legacyRoot, legacy.databaseFile, dataDir, marker) };
  }
  // 沒有標記、卻已經有 DB：手動放的，絕不覆蓋。（標記是 migrating 的是上次沒搬完的半成品，照下面整份重搬。）
  if (marker === null && existsSync(target.databaseFile)) {
    const adopted: Marker = { state: 'done', migratedFrom: null, databaseCreated: true };
    writeMarker(dataDir, adopted);
    return { kind: 'already', warning: leftoverWarning(legacyRoot, legacy.databaseFile, dataDir, adopted) };
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
    writeMarker(dataDir, { state: 'done', migratedFrom: null, databaseCreated: false });
    return { kind: 'fresh' };
  }

  // 開始複製前先標 migrating：之後任何一步失敗（含最後寫 done 失敗），下次啟動都整份重搬。
  writeMarker(dataDir, { state: 'migrating', migratedFrom: legacyRoot, databaseCreated: false });

  // 先快照 DB、再複製資料夾：搬家途中舊行程若還在寫，資料夾只會是 DB 引用到的東西的超集。
  if (hasDatabase) snapshotDatabase(legacy.databaseFile, target.databaseFile);
  onStep('database');

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
  onStep('folders');

  for (const item of files) {
    try {
      copyPrivately(item.from, item.to, item.secret ? 0o600 : 0o644);
    } catch (error) {
      throw new DataMoveError(`複製 ${item.from} 到 ${item.to} 失敗：${reason(error)}`);
    }
  }
  onStep('files');

  writeMarker(dataDir, { state: 'done', migratedFrom: legacyRoot, databaseCreated: hasDatabase });

  const copied = [...files.map((item) => item.from), ...dirs.map((item) => item.from)];
  if (hasDatabase && !dirs.some((item) => item.from === legacy.data)) copied.push(legacy.data);
  return {
    kind: 'moved',
    copied,
    envFile: files.some((item) => item.secret) ? legacy.envFile : null,
  };
}

/**
 * 複製一個檔：先用指定權限建暫存檔（`wx`，一建立就是這個權限，沒有可讀的空窗）寫入內容，再改名成目標。
 * `.env` 用 0600：當掉也不會留下 0644 的密碼檔。
 */
function copyPrivately(from: string, to: string, mode: number): void {
  const temp = `${to}.${process.pid}-${randomBytes(4).toString('hex')}.tmp`;
  try {
    writeFileSync(temp, readFileSync(from), { mode, flag: 'wx' });
    chmodSync(temp, mode); // umask 只會更嚴；明確設一次
    renameSync(temp, to);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
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
    // 上次沒搬完的半成品若被開過，旁邊可能留著它的 -wal／-shm：不能讓它們套到新快照上。
    for (const suffix of DB_SUFFIXES.slice(1)) rmSync(`${to}${suffix}`, { force: true });
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
 * 丟 `DataDirError`（GALLEY_DATA_DIR 不對、或有過的資料庫不見了）或 `DataMoveError`（搬家失敗）時，呼叫端要停止啟動。
 */
export function prepareUserData(
  options: { legacyRoot?: string; env?: NodeJS.ProcessEnv } = {},
): PreparedUserData {
  const dir = resolveDataDir(options.env ?? process.env);
  const outcome = moveLegacyData({ legacyRoot: options.legacyRoot ?? projectRoot, dataDir: dir });
  const paths = dataPaths(dir);
  if (outcome.kind !== 'same-dir') assertDatabasePresent(resolve(dir));
  ensureDataDirectories(paths);
  return { paths, outcome, notice: moveNotice(outcome, dir), warning: outcome.kind === 'already' ? outcome.warning : null };
}

/** 資料庫在不在：不存在或是空檔都算不在。 */
function hasDatabaseFile(file: string): boolean {
  try {
    const stat = statSync(file);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

/**
 * 已搬完（標記 `done`）而且有過資料庫（`databaseCreated`），資料庫卻不見了（或是空檔）：丟 `DataDirError`，
 * 呼叫端停止啟動，**不建新 DB、不套 migration**——不然稿件會像全部消失，使用者還會在空的上面繼續寫（P8-T004）。
 * 只讀不寫：標記還沒記 `databaseCreated` 的，由啟動套完 migration 後的 `markDatabaseCreated` 補記（失敗只警告）。
 */
export function assertDatabasePresent(dataDir: string): void {
  const marker = readMarker(dataDir);
  if (marker === null || marker.state !== 'done') return;
  const file = dataPaths(dataDir).databaseFile;
  // 資料庫在：這裡不改寫標記（資料目錄不可寫時不能因此擋住啟動），留給套完 migration 後的 `markDatabaseCreated`。
  if (hasDatabaseFile(file)) return;
  if (!marker.databaseCreated) return; // 全新安裝、還沒建過：照常建
  throw new DataDirError(
    [
      `找不到資料庫（稿件都在裡面）：${file}`,
      '這個資料目錄之前有過資料庫，現在不見了（或變成空檔），可能被移走、刪掉、或被同步／清理工具動過。',
      '為了不讓稿件看起來全部消失、又在空的資料庫上繼續寫，發布台沒有建新的、先停下來。',
      '找得回來：把它放回上面的位置，再啟動。',
      `確定要重新開始：先關掉發布台，把整個資料目錄（${dataDir}）移走或改名，再啟動；`,
      '程式資料夾裡還有舊資料的話會重新搬一次，沒有就建一個全新的。',
    ].join('\n'),
  );
}

/**
 * 啟動時建好（或打開）資料庫、套完 migration 之後呼叫：在標記檔記下「這裡有過資料庫」。
 * 之後它不見了，`prepareUserData` 就會停止啟動而不是默默建空的。已經記過就不寫。
 */
export function markDatabaseCreated(dataDir: string): void {
  const dir = resolve(dataDir);
  const marker = readMarker(dir);
  if (marker === null || marker.state !== 'done' || marker.databaseCreated) return;
  if (!hasDatabaseFile(dataPaths(dir).databaseFile)) return;
  writeMarker(dir, { ...marker, databaseCreated: true });
}
