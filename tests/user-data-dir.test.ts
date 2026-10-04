import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  DataDirError,
  dataPaths,
  fromStoredPath,
  legacyDataPaths,
  resolveDataDir,
  toStoredPath,
} from '../src/config/paths.js';
import {
  acquireMoveLock,
  DataMoveError,
  LOCK_FILE,
  MARKER_FILE,
  moveLegacyData,
  moveNotice,
  prepareUserData,
} from '../src/config/user-data.js';
import { openDatabase, type DatabaseSync } from '../src/db/index.js';
import { runMigrations } from '../src/db/migrate.js';
import { migrations } from '../src/db/migrations/index.js';

/**
 * 使用者資料搬出程式資料夾（D-035，P8-T003）。
 *
 * **全部在暫存目錄**：舊根目錄、新資料目錄都是 mkdtemp 出來的，而且故意含空白（像「My Programs」）。
 * 不碰真的 `~/Library/Application Support/Galley/`，也不碰專案根目錄的 `.env`、`data/`。
 */

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `galley ${label} `));
  dirs.push(dir);
  return dir;
}

const mode = (path: string): number => statSync(path).mode & 0o777;

/** 標記檔不存在、或還是 migrating（沒搬完）：下次啟動一定會重搬。 */
function expectNotDone(dataDir: string): void {
  const file = join(dataDir, MARKER_FILE);
  if (!existsSync(file)) return;
  expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ state: 'migrating' });
}

/** 做一份「P8-T003 之前」的程式資料夾：.env、站台設定檔、DB（絕對路徑）、稿件、圖片、備份。 */
function seedLegacyRoot(root: string): void {
  writeFileSync(join(root, '.env'), 'WORDPRESS_APP_PASSWORD="abcd efgh"\n', { mode: 0o600 });
  writeFileSync(join(root, '.env.example'), 'WORDPRESS_URL=\n'); // 程式本身的，不搬
  mkdirSync(join(root, 'config', 'examples'), { recursive: true });
  writeFileSync(join(root, 'config', 'publish-targets.json'), '{"targets":[]}\n');
  writeFileSync(join(root, 'config', 'publish-targets.example.json'), '{}');
  mkdirSync(join(root, 'data'));
  writeFileSync(join(root, 'data', '.gitkeep'), '');
  mkdirSync(join(root, 'drafts', 'job-a'), { recursive: true });
  writeFileSync(join(root, 'drafts', 'job-a', 'note.txt'), 'draft');
  mkdirSync(join(root, 'generated-images', 'job-a', 'candidates'), { recursive: true });
  writeFileSync(join(root, 'generated-images', 'job-a', 'sha.png'), 'png');
  writeFileSync(join(root, 'generated-images', 'job-a', 'candidates', 'c.png'), 'cand');
  mkdirSync(join(root, 'backups'));
  writeFileSync(join(root, 'backups', '.gitkeep'), '');
  writeFileSync(join(root, 'backups', 'publish-targets-old.json'), '{}');

  const db = openDatabase(join(root, 'data', 'publisher.sqlite'));
  runMigrations(db, migrations.slice(0, 9)); // 停在 009：還是舊的絕對路徑
  db.prepare("INSERT INTO jobs (id, uuid, state, workspace_path) VALUES (1, 'job-a', 'SOURCE', ?)").run(join(root, 'drafts', 'job-a'));
  db.prepare(
    "INSERT INTO media_assets (id, job_id, local_path, mime_type, byte_size, sha256) VALUES (1, 1, ?, 'image/png', 3, 'sha')",
  ).run(join(root, 'generated-images', 'job-a', 'sha.png'));
  db.exec("INSERT INTO image_briefs (id, job_id, brief_key, purpose, prompt, aspect_ratio, alt_text) VALUES (1, 1, 'k', 'p', 'p', '1:1', 'a')");
  db.prepare(
    "INSERT INTO image_candidates (id, job_id, image_brief_id, local_path, mime_type, byte_size, sha256) VALUES (1, 1, 1, ?, 'image/png', 4, 'c')",
  ).run(join(root, 'generated-images', 'job-a', 'candidates', 'c.png'));
  // 故意不 close：WAL 裡還有沒 checkpoint 的資料，搬家要拿到一致的完整內容。
  openHandles.push(db);
}

const openHandles: DatabaseSync[] = [];
afterEach(() => {
  for (const db of openHandles.splice(0)) db.close();
});

/** 不存在的程式資料夾：沒有 `.git`，不算 worktree。 */
const NOT_A_CHECKOUT = '/nonexistent/galley-program';

describe('資料目錄在哪', () => {
  it('macOS 預設 ~/Library/Application Support/Galley', () => {
    expect(resolveDataDir({}, 'darwin', '/Users/me', NOT_A_CHECKOUT)).toBe('/Users/me/Library/Application Support/Galley');
  });

  it('其他平台：$XDG_DATA_HOME/galley，沒設就 ~/.local/share/galley', () => {
    expect(resolveDataDir({ XDG_DATA_HOME: '/data/xdg' }, 'linux', '/home/me', NOT_A_CHECKOUT)).toBe('/data/xdg/galley');
    expect(resolveDataDir({}, 'linux', '/home/me', NOT_A_CHECKOUT)).toBe('/home/me/.local/share/galley');
    // 規範說 XDG_DATA_HOME 必須是絕對路徑，相對的要忽略。
    expect(resolveDataDir({ XDG_DATA_HOME: 'rel' }, 'linux', '/home/me', NOT_A_CHECKOUT)).toBe('/home/me/.local/share/galley');
  });

  it('GALLEY_DATA_DIR 覆寫（絕對路徑）；相對路徑直接報錯，不猜', () => {
    expect(resolveDataDir({ GALLEY_DATA_DIR: '/tmp/My Galley' }, 'darwin', '/Users/me', NOT_A_CHECKOUT)).toBe('/tmp/My Galley');
    expect(resolveDataDir({ GALLEY_DATA_DIR: '/tmp/x/' }, 'linux', '/home/me', NOT_A_CHECKOUT)).toBe('/tmp/x');
    expect(() => resolveDataDir({ GALLEY_DATA_DIR: 'relative/dir' }, 'darwin', '/Users/me', NOT_A_CHECKOUT)).toThrow(DataDirError);
    expect(() => resolveDataDir({ GALLEY_DATA_DIR: 'relative/dir' }, 'darwin', '/Users/me', NOT_A_CHECKOUT)).toThrow(/GALLEY_DATA_DIR/);
  });

  it('程式資料夾是 git worktree（.git 是檔案）：預設改用 <程式資料夾>/.galley-data，不共用全機那個', () => {
    const worktree = tempDir('worktree');
    writeFileSync(join(worktree, '.git'), 'gitdir: /somewhere/.git/worktrees/x\n');
    expect(resolveDataDir({}, 'darwin', '/Users/me', worktree)).toBe(join(worktree, '.galley-data'));
    // GALLEY_DATA_DIR 仍然優先。
    expect(resolveDataDir({ GALLEY_DATA_DIR: '/tmp/x' }, 'darwin', '/Users/me', worktree)).toBe('/tmp/x');
    // 主 checkout（.git 是資料夾）照舊。
    const main = tempDir('main');
    mkdirSync(join(main, '.git'));
    expect(resolveDataDir({}, 'darwin', '/Users/me', main)).toBe('/Users/me/Library/Application Support/Galley');
  });

  it('測試行程（VITEST）沒設 GALLEY_DATA_DIR 時絕不指到真的家目錄', () => {
    const dir = resolveDataDir();
    expect(dir.startsWith(join(homedir(), 'Library'))).toBe(false);
    expect(dir.startsWith(join(homedir(), '.local'))).toBe(false);
    expect(dir.startsWith(tmpdir())).toBe(true);
  });

  it('資料目錄底下的配置；舊位置是程式根目錄底下的原路徑', () => {
    const p = dataPaths('/d');
    expect(p).toMatchObject({
      dir: '/d',
      envFile: '/d/.env',
      siteConfigFile: '/d/publish-targets.json',
      data: '/d/data',
      databaseFile: '/d/data/publisher.sqlite',
      drafts: '/d/drafts',
      generatedImages: '/d/generated-images',
      backups: '/d/backups',
    });
    expect(legacyDataPaths('/r')).toMatchObject({
      envFile: '/r/.env',
      siteConfigFile: '/r/config/publish-targets.json',
      databaseFile: '/r/data/publisher.sqlite',
      drafts: '/r/drafts',
    });
  });
});

describe('DB 存的路徑：寫相對、讀時以資料目錄解析', () => {
  it('資料目錄裡的寫成相對；外面的維持絕對', () => {
    expect(toStoredPath('/a b/Galley', '/a b/Galley/drafts/x')).toBe('drafts/x');
    expect(toStoredPath('/a b/Galley', '/elsewhere/x.png')).toBe('/elsewhere/x.png');
    expect(toStoredPath('/a b/Galley', '/a b/Galley-other/x')).toBe('/a b/Galley-other/x');
  });

  it('別的根目錄留下的絕對路徑：取最後一個 drafts／generated-images 段，資料目錄裡有那個檔才換過去', () => {
    const dataDir = tempDir('data');
    mkdirSync(join(dataDir, 'generated-images', 'j', 'candidates'), { recursive: true });
    writeFileSync(join(dataDir, 'generated-images', 'j', 'candidates', 'c.png'), 'x');
    mkdirSync(join(dataDir, 'drafts', 'u'), { recursive: true });
    expect(fromStoredPath(dataDir, '/old clone/generated-images/j/candidates/c.png')).toBe(
      join(dataDir, 'generated-images', 'j', 'candidates', 'c.png'),
    );
    // 路徑裡出現兩次時取最後一個。
    expect(fromStoredPath(dataDir, '/home/drafts/old clone/generated-images/j/candidates/c.png')).toBe(
      join(dataDir, 'generated-images', 'j', 'candidates', 'c.png'),
    );
    expect(fromStoredPath(dataDir, '/old clone/drafts/u')).toBe(join(dataDir, 'drafts', 'u'));
    // 資料目錄裡沒有：照原路徑。
    expect(fromStoredPath(dataDir, '/old clone/generated-images/j/none.png')).toBe('/old clone/generated-images/j/none.png');
    expect(fromStoredPath(dataDir, '/elsewhere/x.png')).toBe('/elsewhere/x.png');
  });

  it('相對的以資料目錄解析；舊的絕對路徑照舊能用', () => {
    expect(fromStoredPath('/a b/Galley', 'generated-images/j/s.png')).toBe('/a b/Galley/generated-images/j/s.png');
    expect(fromStoredPath('/a b/Galley', '/old root/generated-images/j/s.png')).toBe('/old root/generated-images/j/s.png');
  });
});

describe('第一次啟動自動搬家', () => {
  it('複製全部、舊的不刪；.env 維持 0600、資料目錄 0700；DB 完整而且套 migration 後路徑變相對', () => {
    const legacy = tempDir('legacy');
    const dataDir = join(tempDir('home'), 'Application Support', 'Galley');
    seedLegacyRoot(legacy);

    const outcome = moveLegacyData({ legacyRoot: legacy, dataDir });
    expect(outcome.kind).toBe('moved');

    const p = dataPaths(dataDir);
    expect(mode(dataDir)).toBe(0o700);
    expect(readFileSync(p.envFile, 'utf8')).toContain('WORDPRESS_APP_PASSWORD');
    expect(mode(p.envFile)).toBe(0o600);
    expect(readFileSync(p.siteConfigFile, 'utf8')).toBe('{"targets":[]}\n');
    expect(readFileSync(join(p.drafts, 'job-a', 'note.txt'), 'utf8')).toBe('draft');
    expect(readFileSync(join(p.generatedImages, 'job-a', 'candidates', 'c.png'), 'utf8')).toBe('cand');
    expect(readFileSync(join(p.backups, 'publish-targets-old.json'), 'utf8')).toBe('{}');
    // git 的佔位檔、程式本身的範例不搬。
    expect(existsSync(join(p.backups, '.gitkeep'))).toBe(false);
    expect(existsSync(join(dataDir, '.env.example'))).toBe(false);
    expect(existsSync(join(dataDir, 'config'))).toBe(false);
    // 沒有半成品的暫存檔。
    expect(readdirSync(p.data).filter((name) => name.includes('moving'))).toEqual([]);

    // 舊的原封不動（舊的就是備份）。
    expect(existsSync(join(legacy, '.env'))).toBe(true);
    expect(existsSync(join(legacy, 'data', 'publisher.sqlite'))).toBe(true);
    expect(existsSync(join(legacy, 'drafts', 'job-a', 'note.txt'))).toBe(true);

    const db = openDatabase(p.databaseFile);
    try {
      expect(db.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
      runMigrations(db, migrations, { legacyRoot: legacy });
      const job = db.prepare('SELECT workspace_path AS v FROM jobs').get() as { v: string };
      const media = db.prepare('SELECT local_path AS v FROM media_assets').get() as { v: string };
      const candidate = db.prepare('SELECT local_path AS v FROM image_candidates').get() as { v: string };
      expect([job.v, media.v, candidate.v]).toEqual([
        'drafts/job-a',
        'generated-images/job-a/sha.png',
        'generated-images/job-a/candidates/c.png',
      ]);
      // 以資料目錄解析，找得到搬過去的檔。
      expect(readFileSync(fromStoredPath(dataDir, media.v), 'utf8')).toBe('png');
      expect(readFileSync(fromStoredPath(dataDir, candidate.v), 'utf8')).toBe('cand');
    } finally {
      db.close();
    }

    const notice = moveNotice(outcome, dataDir);
    expect(notice).toContain(dataDir);
    expect(notice).toContain(join(legacy, '.env'));
    expect(notice).toContain(join(legacy, 'data'));
    expect(notice).toMatch(/密碼/);
  });

  it('已搬過（有標記檔）就不再搬：不覆蓋新位置改過的設定', () => {
    const legacy = tempDir('legacy');
    const dataDir = join(tempDir('home'), 'Galley');
    seedLegacyRoot(legacy);
    expect(moveLegacyData({ legacyRoot: legacy, dataDir }).kind).toBe('moved');

    writeFileSync(join(dataDir, '.env'), 'CHANGED_IN_WIZARD=1\n');
    expect(moveLegacyData({ legacyRoot: legacy, dataDir }).kind).toBe('already');
    expect(readFileSync(join(dataDir, '.env'), 'utf8')).toBe('CHANGED_IN_WIZARD=1\n');
  });

  it('舊位置沒東西（新 clone 只有 git 佔位檔）：直接建新目錄，權限 0700', () => {
    const legacy = tempDir('legacy');
    mkdirSync(join(legacy, 'data'));
    writeFileSync(join(legacy, 'data', '.gitkeep'), '');
    mkdirSync(join(legacy, 'backups'));
    writeFileSync(join(legacy, 'backups', '.gitignore'), '*\n');
    const dataDir = join(tempDir('home'), 'Galley');

    const outcome = moveLegacyData({ legacyRoot: legacy, dataDir });
    expect(outcome.kind).toBe('fresh');
    expect(mode(dataDir)).toBe(0o700);
    expect(moveNotice(outcome, dataDir)).toBeNull();
  });

  it('資料目錄就是程式資料夾（GALLEY_DATA_DIR 指回去）：什麼都不搬', () => {
    const legacy = tempDir('legacy');
    seedLegacyRoot(legacy);
    expect(moveLegacyData({ legacyRoot: legacy, dataDir: legacy }).kind).toBe('same-dir');
  });

  it('搬到一半失敗：停下來說卡在哪，新位置不會被當成已搬過，修好後下次能重試', () => {
    const legacy = tempDir('legacy');
    const dataDir = join(tempDir('home'), 'Galley');
    seedLegacyRoot(legacy);
    for (const db of openHandles.splice(0)) db.close();
    // 舊 DB 壞掉（不是 SQLite）：複製 DB 那一步一定失敗。
    const good = readFileSync(join(legacy, 'data', 'publisher.sqlite'));
    for (const suffix of ['-wal', '-shm']) rmSync(join(legacy, 'data', `publisher.sqlite${suffix}`), { force: true });
    writeFileSync(join(legacy, 'data', 'publisher.sqlite'), 'not a database at all, just text '.repeat(200));

    let error: unknown;
    try {
      moveLegacyData({ legacyRoot: legacy, dataDir });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(DataMoveError);
    expect((error as Error).message).toMatch(/資料庫/);
    expect((error as Error).message).toContain(join(legacy, 'data', 'publisher.sqlite'));
    expect(existsSync(join(dataDir, 'data', 'publisher.sqlite'))).toBe(false);
    expect(readdirSync(join(dataDir, 'data')).filter((name) => name.includes('moving'))).toEqual([]);
    expectNotDone(dataDir);
    expect(existsSync(join(dataDir, LOCK_FILE))).toBe(false);

    // 修好再跑一次：照常搬完。
    writeFileSync(join(legacy, 'data', 'publisher.sqlite'), good);
    expect(moveLegacyData({ legacyRoot: legacy, dataDir }).kind).toBe('moved');
    const db = openDatabase(join(dataDir, 'data', 'publisher.sqlite'));
    try {
      expect(db.prepare('SELECT count(*) AS n FROM jobs').get()).toEqual({ n: 1 });
    } finally {
      db.close();
    }
  });

  it('複製檔案那一步失敗也一樣：訊息講是哪個、標記停在 migrating（DB 快照已經在也不算搬完）', () => {
    const legacy = tempDir('legacy');
    const dataDir = join(tempDir('home'), 'Galley');
    seedLegacyRoot(legacy);
    chmodSync(join(legacy, 'backups', 'publish-targets-old.json'), 0o000);
    try {
      expect(() => moveLegacyData({ legacyRoot: legacy, dataDir })).toThrow(DataMoveError);
      expect(() => moveLegacyData({ legacyRoot: legacy, dataDir })).toThrow(/backups/);
      expect(JSON.parse(readFileSync(join(dataDir, MARKER_FILE), 'utf8'))).toMatchObject({ state: 'migrating' });
    } finally {
      chmodSync(join(legacy, 'backups', 'publish-targets-old.json'), 0o644);
    }
    expect(moveLegacyData({ legacyRoot: legacy, dataDir }).kind).toBe('moved');
  });

  it('搬完寫標記檔（最後一步）：記建立時間與舊根目錄；全新安裝記 null', () => {
    const legacy = tempDir('legacy');
    const dataDir = join(tempDir('home'), 'Galley');
    seedLegacyRoot(legacy);
    moveLegacyData({ legacyRoot: legacy, dataDir });
    const marker = JSON.parse(readFileSync(join(dataDir, MARKER_FILE), 'utf8')) as Record<string, unknown>;
    expect(marker['migratedFrom']).toBe(legacy);
    expect(marker['state']).toBe('done');
    expect(typeof marker['createdAt']).toBe('string');

    const empty = tempDir('empty');
    const fresh = join(tempDir('home'), 'Galley');
    moveLegacyData({ legacyRoot: empty, dataDir: fresh });
    expect(JSON.parse(readFileSync(join(fresh, MARKER_FILE), 'utf8'))).toMatchObject({ migratedFrom: null });
  });

  it('別的 checkout 先建了資料目錄：不搬、不蓋，但大聲警告兩邊路徑', () => {
    const worktree = tempDir('worktree'); // 沒有舊資料的另一份程式
    const main = tempDir('main');
    seedLegacyRoot(main);
    const dataDir = join(tempDir('home'), 'Galley');

    expect(moveLegacyData({ legacyRoot: worktree, dataDir }).kind).toBe('fresh');
    // 那份程式啟動時建了空 DB。
    mkdirSync(join(dataDir, 'data'), { recursive: true });
    writeFileSync(join(dataDir, 'data', 'publisher.sqlite'), '');

    const outcome = moveLegacyData({ legacyRoot: main, dataDir });
    expect(outcome.kind).toBe('already');
    const warning = outcome.kind === 'already' ? outcome.warning : null;
    expect(warning).toContain(join(main, 'data', 'publisher.sqlite'));
    expect(warning).toContain(dataDir);
    expect(warning).toMatch(/沒有搬/);
    // 舊資料沒被搬進來，也沒被動。
    expect(existsSync(join(dataDir, 'drafts', 'job-a'))).toBe(false);
    expect(existsSync(join(main, 'data', 'publisher.sqlite'))).toBe(true);
    // 從同一個地方搬過來的就不警告。
    const moved = join(tempDir('home'), 'Galley');
    moveLegacyData({ legacyRoot: main, dataDir: moved });
    const again = moveLegacyData({ legacyRoot: main, dataDir: moved });
    expect(again.kind === 'already' ? again.warning : 'x').toBeNull();
  });

  it('沒有標記檔但資料目錄已經有 DB（手動放的）：不覆蓋，補上標記並警告', () => {
    const legacy = tempDir('legacy');
    seedLegacyRoot(legacy);
    const dataDir = join(tempDir('home'), 'Galley');
    mkdirSync(join(dataDir, 'data'), { recursive: true });
    writeFileSync(join(dataDir, 'data', 'publisher.sqlite'), 'mine');
    const outcome = moveLegacyData({ legacyRoot: legacy, dataDir });
    expect(outcome.kind).toBe('already');
    expect(outcome.kind === 'already' ? outcome.warning : null).toContain(legacy);
    expect(readFileSync(join(dataDir, 'data', 'publisher.sqlite'), 'utf8')).toBe('mine');
    expect(existsSync(join(dataDir, MARKER_FILE))).toBe(true);
  });

  it('舊位置只有 .env（沒有 DB）：搬一次就好，新位置修好的 .env 下次啟動不會被蓋回去', () => {
    const legacy = tempDir('legacy');
    writeFileSync(join(legacy, '.env'), 'WORDPRESS_URL=http://broken\n', { mode: 0o600 });
    const dataDir = join(tempDir('home'), 'Galley');
    expect(moveLegacyData({ legacyRoot: legacy, dataDir }).kind).toBe('moved');
    expect(existsSync(join(dataDir, 'data', 'publisher.sqlite'))).toBe(false);
    writeFileSync(join(dataDir, '.env'), 'WORDPRESS_URL=https://fixed.example\n');
    expect(moveLegacyData({ legacyRoot: legacy, dataDir }).kind).toBe('already');
    expect(readFileSync(join(dataDir, '.env'), 'utf8')).toBe('WORDPRESS_URL=https://fixed.example\n');
  });

  it('另一個行程正在搬（鎖檔的 pid 還活著）：停下來說明，不動任何東西', () => {
    const legacy = tempDir('legacy');
    seedLegacyRoot(legacy);
    const dataDir = join(tempDir('home'), 'Galley');
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, LOCK_FILE), String(process.pid));
    expect(() => moveLegacyData({ legacyRoot: legacy, dataDir })).toThrow(DataMoveError);
    expect(() => moveLegacyData({ legacyRoot: legacy, dataDir })).toThrow(/正在搬/);
    expect(existsSync(join(dataDir, MARKER_FILE))).toBe(false);
    expect(existsSync(join(dataDir, 'drafts'))).toBe(false);
  });

  it('上次當掉留下的鎖（pid 已經不在）：接手照搬，搬完鎖檔清掉', () => {
    const legacy = tempDir('legacy');
    seedLegacyRoot(legacy);
    const dataDir = join(tempDir('home'), 'Galley');
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, LOCK_FILE), '2147483646'); // 不可能存在的 pid
    expect(moveLegacyData({ legacyRoot: legacy, dataDir }).kind).toBe('moved');
    expect(existsSync(join(dataDir, LOCK_FILE))).toBe(false);
  });

  it('暫存檔名每個行程不同：不刪別人的暫存檔', () => {
    const legacy = tempDir('legacy');
    seedLegacyRoot(legacy);
    const dataDir = join(tempDir('home'), 'Galley');
    mkdirSync(join(dataDir, 'data'), { recursive: true });
    const other = join(dataDir, 'data', 'publisher.sqlite.moving-99999-abc');
    writeFileSync(other, 'someone else');
    expect(moveLegacyData({ legacyRoot: legacy, dataDir }).kind).toBe('moved');
    expect(readFileSync(other, 'utf8')).toBe('someone else');
  });

  it('舊 DB 是 SQLite 但不是發布台的（沒有 schema_migrations）：不算成功', () => {
    const legacy = tempDir('legacy');
    mkdirSync(join(legacy, 'data'));
    const db = openDatabase(join(legacy, 'data', 'publisher.sqlite'));
    db.exec('CREATE TABLE other (x INTEGER)');
    db.close();
    const dataDir = join(tempDir('home'), 'Galley');
    expect(() => moveLegacyData({ legacyRoot: legacy, dataDir })).toThrow(/schema_migrations/);
    expect(existsSync(join(dataDir, 'data', 'publisher.sqlite'))).toBe(false);
    expectNotDone(dataDir);
  });

  it('讀不到的舊資料夾（權限錯誤）不當成空的：停止搬家並說明，不寫完成標記', () => {
    const legacy = tempDir('legacy');
    const dataDir = join(tempDir('home'), 'Galley');
    seedLegacyRoot(legacy);
    chmodSync(join(legacy, 'generated-images'), 0o000);
    try {
      expect(() => moveLegacyData({ legacyRoot: legacy, dataDir })).toThrow(DataMoveError);
      expect(() => moveLegacyData({ legacyRoot: legacy, dataDir })).toThrow(/generated-images/);
      expectNotDone(dataDir);
    } finally {
      chmodSync(join(legacy, 'generated-images'), 0o755);
    }
    expect(moveLegacyData({ legacyRoot: legacy, dataDir }).kind).toBe('moved');
    expect(readFileSync(join(dataDir, 'generated-images', 'job-a', 'sha.png'), 'utf8')).toBe('png');
  });

  it('標記停在 migrating（上次寫完成標記前當掉）：整份重搬，不採用新位置的半成品', () => {
    const legacy = tempDir('legacy');
    const dataDir = join(tempDir('home'), 'Galley');
    seedLegacyRoot(legacy);
    moveLegacyData({ legacyRoot: legacy, dataDir });
    // 模擬：快照改名成 publisher.sqlite 之後、寫完成標記之前當掉，而且那份是壞的半成品。
    writeFileSync(join(dataDir, MARKER_FILE), JSON.stringify({ state: 'migrating', migratedFrom: legacy }));
    writeFileSync(join(dataDir, 'data', 'publisher.sqlite'), 'half');
    rmSync(join(dataDir, 'drafts'), { recursive: true });

    expect(moveLegacyData({ legacyRoot: legacy, dataDir }).kind).toBe('moved');
    expect(JSON.parse(readFileSync(join(dataDir, MARKER_FILE), 'utf8'))).toMatchObject({ state: 'done', migratedFrom: legacy });
    expect(existsSync(join(dataDir, 'drafts', 'job-a', 'note.txt'))).toBe(true);
    const db = openDatabase(join(dataDir, 'data', 'publisher.sqlite'));
    try {
      expect(db.prepare('SELECT count(*) AS n FROM jobs').get()).toEqual({ n: 1 });
    } finally {
      db.close();
    }
  });

  it('.env 從一開始就是 0600（舊的是 0644 也一樣）', () => {
    const legacy = tempDir('legacy');
    writeFileSync(join(legacy, '.env'), 'A=1\n', { mode: 0o644 });
    chmodSync(join(legacy, '.env'), 0o644);
    const dataDir = join(tempDir('home'), 'Galley');
    moveLegacyData({ legacyRoot: legacy, dataDir });
    expect(mode(join(dataDir, '.env'))).toBe(0o600);
    expect(readFileSync(join(dataDir, '.env'), 'utf8')).toBe('A=1\n');
    expect(readdirSync(dataDir).filter((name) => name.startsWith('.env.'))).toEqual([]);
  });

  it('先快照 DB、再複製資料夾：搬家途中舊位置新增的圖也會被搬到', () => {
    const legacy = tempDir('legacy');
    const dataDir = join(tempDir('home'), 'Galley');
    seedLegacyRoot(legacy);
    // 以快照完成的時間點為界：DB 一定先於資料夾複製（資料夾是 DB 引用的超集）。
    const order: string[] = [];
    const outcome = moveLegacyData({
      legacyRoot: legacy,
      dataDir,
      onStep: (step) => {
        order.push(step);
        if (step === 'database') writeFileSync(join(legacy, 'generated-images', 'job-a', 'late.png'), 'late');
      },
    });
    expect(outcome.kind).toBe('moved');
    expect(order.indexOf('database')).toBeLessThan(order.indexOf('folders'));
    expect(readFileSync(join(dataDir, 'generated-images', 'job-a', 'late.png'), 'utf8')).toBe('late');
  });

  it('鎖只放自己的：鎖檔內容換成別人的 pid 時，放鎖不刪', () => {
    const dataDir = tempDir('lock');
    const release = acquireMoveLock(dataDir);
    expect(readFileSync(join(dataDir, LOCK_FILE), 'utf8')).toBe(String(process.pid));
    writeFileSync(join(dataDir, LOCK_FILE), '12345');
    release();
    expect(readFileSync(join(dataDir, LOCK_FILE), 'utf8')).toBe('12345');
  });

  it('接手過期的鎖：先改名成自己的檔確認還是那把過期的，再建新鎖；不留下改名的殘檔', () => {
    const dataDir = tempDir('lock');
    writeFileSync(join(dataDir, LOCK_FILE), '2147483646');
    const release = acquireMoveLock(dataDir);
    expect(readFileSync(join(dataDir, LOCK_FILE), 'utf8')).toBe(String(process.pid));
    expect(readdirSync(dataDir)).toEqual([LOCK_FILE]);
    release();
    expect(existsSync(join(dataDir, LOCK_FILE))).toBe(false);
  });

  it('prepareUserData：GALLEY_DATA_DIR 覆寫、搬家、建好子目錄（npm start／dev／migrate 共用這一段）', () => {
    const legacy = tempDir('legacy');
    const dataDir = join(tempDir('custom'), 'My Data');
    seedLegacyRoot(legacy);

    const prepared = prepareUserData({ legacyRoot: legacy, env: { GALLEY_DATA_DIR: dataDir } });
    expect(prepared.paths.dir).toBe(dataDir);
    expect(prepared.outcome.kind).toBe('moved');
    for (const dir of [prepared.paths.data, prepared.paths.drafts, prepared.paths.generatedImages, prepared.paths.backups]) {
      expect(statSync(dir).isDirectory()).toBe(true);
    }
    expect(prepared.notice).toContain(dataDir);
    expect(prepareUserData({ legacyRoot: legacy, env: { GALLEY_DATA_DIR: dataDir } }).outcome.kind).toBe('already');
  });
});
