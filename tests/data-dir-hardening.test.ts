import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { DataDirError, fromStoredMediaPath, isSafeStoreRoot } from '../src/config/paths.js';
import {
  acquireMoveLock,
  DataMoveError,
  LOCK_FILE,
  MARKER_FILE,
  markDatabaseCreated,
  moveLegacyData,
  prepareUserData,
} from '../src/config/user-data.js';
import { openDatabase } from '../src/db/index.js';
import { runMigrations } from '../src/db/migrate.js';
import { migrations } from '../src/db/migrations/index.js';
import { AgentError, MediaError } from '../src/core/errors.js';
import { coreInternals, createCoreFixture, TINY_PNG, type CoreFixture } from './helpers/core-fixture.js';
import { FakeAdapter } from './helpers/fake-adapter.js';

/**
 * 資料目錄補審修正（D-039，P8-T004）。**全部在暫存目錄**，不碰真的資料目錄、主目錄的 data/ 與 .env；
 * 一律 FakeAdapter、假 WordPress，不呼叫真實 CLI、不連真站。
 */

const dirs: string[] = [];
let fixture: CoreFixture | null = null;
afterEach(async () => {
  await fixture?.cleanup();
  fixture = null;
  for (const dir of dirs.splice(0)) {
    // 測試裡改過權限的資料夾先改回來才刪得掉。
    try {
      chmodSync(dir, 0o700);
    } catch {
      // 已經不在
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `galley ${label} `));
  dirs.push(dir);
  return dir;
}

/** 暫存目錄所在的檔案系統不分大小寫（macOS 預設）：大小寫混用的回歸測試只在這種環境有意義。 */
function caseInsensitiveTmp(): boolean {
  const probe = mkdtempSync(join(tmpdir(), 'galley-case-'));
  try {
    return existsSync(probe.toUpperCase().replace(tmpdir().toUpperCase(), tmpdir()));
  } finally {
    rmSync(probe, { recursive: true, force: true });
  }
}
const CASE_INSENSITIVE = caseInsensitiveTmp();

const marker = (dataDir: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(dataDir, MARKER_FILE), 'utf8')) as Record<string, unknown>;

// ── 1. 媒體路徑限縮在 generated-images/ ───────────────────────────────

describe('媒體路徑只能落在 generated-images/ 底下', () => {
  function layout(): { dataDir: string; media: string } {
    const dataDir = tempDir('data');
    const media = join(dataDir, 'generated-images');
    mkdirSync(join(media, 'j'), { recursive: true });
    writeFileSync(join(media, 'j', 'a.png'), 'png');
    writeFileSync(join(dataDir, '.env'), 'SECRET=1\n');
    mkdirSync(join(dataDir, 'data'), { recursive: true });
    writeFileSync(join(dataDir, 'data', 'publisher.sqlite'), 'db');
    return { dataDir, media };
  }

  it('相對與絕對路徑在 generated-images/ 裡：照用', () => {
    const { dataDir, media } = layout();
    expect(fromStoredMediaPath(dataDir, media, 'generated-images/j/a.png')).toBe(join(media, 'j', 'a.png'));
    expect(fromStoredMediaPath(dataDir, media, join(media, 'j', 'a.png'))).toBe(join(media, 'j', 'a.png'));
  });

  it('指到資料目錄其他檔、或含 .. 段：一律當成找不到', () => {
    const { dataDir, media } = layout();
    for (const stored of [
      '.env',
      'data/publisher.sqlite',
      'drafts/x/a.png',
      'generated-images/../.env',
      'generated-images/j/../../.env',
      'generated-images/j/../a.png', // 就算解析後還在裡面，有 .. 段就拒絕
      'generated-images',
      join(dataDir, '.env'),
      join(media, '..', '.env'),
      '/etc/hosts',
    ]) {
      expect(fromStoredMediaPath(dataDir, media, stored), stored).toBeNull();
    }
  });

  it('舊根目錄容錯也只對應到 generated-images/ 裡，而且那裡真的有檔', () => {
    const { dataDir, media } = layout();
    expect(fromStoredMediaPath(dataDir, media, '/old clone/generated-images/j/a.png')).toBe(join(media, 'j', 'a.png'));
    expect(fromStoredMediaPath(dataDir, media, '/old clone/generated-images/j/none.png')).toBeNull();
    // drafts/ 段不再對應（媒體只在 generated-images/）。
    expect(fromStoredMediaPath(dataDir, media, '/old clone/drafts/x/a.png')).toBeNull();
    // 舊的別處絕對路徑：不讀。
    expect(fromStoredMediaPath(dataDir, media, '/old clone/elsewhere/a.png')).toBeNull();
    expect(fromStoredMediaPath(dataDir, media, '/old clone/generated-images/../.env')).toBeNull();
  });

  it('generated-images/ 裡的符號連結指到外面：當成找不到', () => {
    const { dataDir, media } = layout();
    symlinkSync(join(dataDir, '.env'), join(media, 'j', 'link.png'));
    expect(fromStoredMediaPath(dataDir, media, 'generated-images/j/link.png')).toBeNull();
  });

  it('媒體資料夾本身被換成指到資料目錄（或其上層、或別的存放位置）的符號連結：整個當成不見了', () => {
    const { dataDir, media } = layout();
    rmSync(media, { recursive: true });
    for (const pointTo of [dataDir, dirname(dataDir), join(dataDir, 'data')]) {
      rmSync(media, { force: true });
      symlinkSync(pointTo, media);
      expect(fromStoredMediaPath(dataDir, media, 'generated-images/.env'), pointTo).toBeNull();
      expect(fromStoredMediaPath(dataDir, media, 'generated-images/publisher.sqlite'), pointTo).toBeNull();
    }
    // 指到一個含 .env 的別處資料夾也不行。
    const elsewhere = tempDir('elsewhere');
    writeFileSync(join(elsewhere, '.env'), 'SECRET=1\n');
    writeFileSync(join(elsewhere, 'a.png'), 'png');
    rmSync(media, { force: true });
    symlinkSync(elsewhere, media);
    expect(fromStoredMediaPath(dataDir, media, 'generated-images/a.png')).toBeNull();
    expect(isSafeStoreRoot(dataDir, media)).toBe(false);
  });

  it.skipIf(!CASE_INSENSITIVE)('不分大小寫的檔案系統：媒體資料夾連到大小寫不同的 data/ 也擋得下', () => {
    const { dataDir, media } = layout();
    rmSync(media, { recursive: true });
    symlinkSync(join(dataDir, 'DATA'), media);
    expect(fromStoredMediaPath(dataDir, media, 'generated-images/publisher.sqlite')).toBeNull();
    expect(isSafeStoreRoot(dataDir, media)).toBe(false);
  });

  it('fail closed：懸空的符號連結、經過目錄連結的不存在檔、檔案不存在，一律 null', () => {
    const { dataDir, media } = layout();
    const outside = tempDir('outside');
    symlinkSync(join(outside, 'gone.png'), join(media, 'j', 'dangling.png'));
    symlinkSync(outside, join(media, 'dirlink'));
    expect(fromStoredMediaPath(dataDir, media, 'generated-images/j/dangling.png')).toBeNull();
    expect(fromStoredMediaPath(dataDir, media, 'generated-images/dirlink/new.png')).toBeNull();
    writeFileSync(join(outside, 'real.png'), 'x');
    expect(fromStoredMediaPath(dataDir, media, 'generated-images/dirlink/real.png')).toBeNull();
    expect(fromStoredMediaPath(dataDir, media, 'generated-images/j/missing.png')).toBeNull();
  });

  it('資料目錄本身是透過符號連結進來的：照常可用', () => {
    const { dataDir } = layout();
    const alias = join(tempDir('alias'), 'Galley');
    symlinkSync(dataDir, alias);
    expect(fromStoredMediaPath(alias, join(alias, 'generated-images'), 'generated-images/j/a.png')).toBe(
      join(alias, 'generated-images', 'j', 'a.png'),
    );
  });
});

// ── 1（CoreService）＋ 2. Agent 工作目錄 ──────────────────────────────

const SOURCE = '今天讀完這本書。\n\n想到很多事。';
const P = (text: string): string => `<p class="wp-block-paragraph">${text}</p>`;
const BRIEF = { key: 'cover', purpose: '封面', prompt: '木桌上的舊筆記本', aspectRatio: '16:9', altText: '舊筆記本', placement: '精選圖片' };

function reviewResult(imageBriefs: unknown[] = []) {
  return {
    ok: true as const,
    data: {
      title: '20260828',
      summary: '看過了',
      correctedSource: SOURCE,
      changes: [],
      observations: [],
      templateData: { title: '20260828', body: P('今天讀完這本書。') },
      imageBriefs,
    },
    meta: { runId: 'fake', agentId: 'codex' as const, model: null, durationMs: 1, stderrTail: '' },
  };
}

async function setup(): Promise<{ f: CoreFixture; codex: FakeAdapter; dataDir: string; mediaDir: string; draftsDir: string }> {
  const codex = new FakeAdapter('codex', 'Codex', { result: reviewResult([BRIEF]), image: {} });
  fixture = await createCoreFixture({ adapters: [codex] });
  const ctx = coreInternals(fixture.core);
  return { f: fixture, codex, dataDir: ctx.dataDir, mediaDir: ctx.mediaDir, draftsDir: ctx.draftsDir };
}

describe('CoreService 讀刪媒體檔只在媒體資料夾裡', () => {
  it('候選圖路徑被改成資料目錄的其他檔：送不出去、用不了；刪媒體不刪那個檔', async () => {
    const { f, dataDir } = await setup();
    const secret = join(dataDir, '.env');
    writeFileSync(secret, 'WORDPRESS_APP_PASSWORD="x"\n');
    const uuid = f.core.createJob({ targetKey: 'diary', sourceText: SOURCE, title: '20260828' }).uuid;
    await f.core.runAgentReview(uuid, { provider: 'codex', task: 'images' });
    const candidate = await f.core.generateBriefImage(uuid, f.core.getJob(uuid).imageBriefs[0]!.id);

    for (const tampered of ['.env', secret, 'media/../.env']) {
      f.db.handle.prepare('UPDATE image_candidates SET local_path = ? WHERE id = ?').run(tampered, candidate.id);
      expect(() => f.core.imageCandidateFile(uuid, candidate.id)).toThrow(MediaError);
      await expect(f.core.useImageCandidate(uuid, candidate.id)).rejects.toThrow(/不見了/);
    }

    const asset = await f.core.addMedia(uuid, { bytes: TINY_PNG, mimeType: 'image/png', filename: 'x' });
    f.db.handle.prepare('UPDATE media_assets SET local_path = ? WHERE id = ?').run('.env', asset.id);
    f.core.removeMedia(uuid, asset.id);
    expect(readFileSync(secret, 'utf8')).toContain('WORDPRESS_APP_PASSWORD');
  });
});

describe('刪媒體不經過符號連結刪到外面', () => {
  it('DB 路徑經過指到外面的目錄連結：外面的檔不刪；媒體資料夾本身指到資料目錄：.env 不刪', async () => {
    const { f, dataDir, mediaDir } = await setup();
    const uuid = f.core.createJob({ targetKey: 'diary', sourceText: SOURCE, title: '20260828' }).uuid;
    const outside = tempDir('outside');
    writeFileSync(join(outside, 'victim.png'), 'keep');
    mkdirSync(mediaDir, { recursive: true });
    symlinkSync(outside, join(mediaDir, 'dirlink'));

    const first = await f.core.addMedia(uuid, { bytes: TINY_PNG, mimeType: 'image/png', filename: 'x' });
    f.db.handle.prepare('UPDATE media_assets SET local_path = ? WHERE id = ?').run('media/dirlink/victim.png', first.id);
    f.core.removeMedia(uuid, first.id);
    expect(readFileSync(join(outside, 'victim.png'), 'utf8')).toBe('keep');

    const second = await f.core.addMedia(uuid, { bytes: TINY_PNG, mimeType: 'image/png', filename: 'y' });
    writeFileSync(join(dataDir, '.env'), 'SECRET=1\n');
    rmSync(mediaDir, { recursive: true, force: true });
    symlinkSync(dataDir, mediaDir);
    f.db.handle.prepare('UPDATE media_assets SET local_path = ? WHERE id = ?').run('media/.env', second.id);
    f.core.removeMedia(uuid, second.id);
    expect(existsSync(join(dataDir, '.env'))).toBe(true);
  });
});

describe('Agent 工作目錄要實體路徑也在 drafts/ 裡', () => {
  it.skipIf(!CASE_INSENSITIVE)('不分大小寫的檔案系統：drafts/ 連到大小寫不同的 data/ 也不跑 Agent', async () => {
    const { f, codex, dataDir, draftsDir } = await setup();
    const uuid = f.core.createJob({ targetKey: 'diary', sourceText: SOURCE, title: '20260828' }).uuid;
    mkdirSync(join(dataDir, 'data'), { recursive: true });
    writeFileSync(join(dataDir, 'data', 'publisher.sqlite'), 'db');
    rmSync(draftsDir, { recursive: true, force: true });
    symlinkSync(join(dataDir, 'DATA'), draftsDir);
    const before = codex.calls.length;
    await expect(f.core.runAgentReview(uuid, { provider: 'codex' })).rejects.toThrow(AgentError);
    expect(codex.calls.length).toBe(before);
    expect(readdirSync(join(dataDir, 'data'))).toEqual(['publisher.sqlite']);
  });

  it('drafts/ 本身被換成指到資料目錄的符號連結：不跑 Agent', async () => {
    const { f, codex, dataDir, draftsDir } = await setup();
    const uuid = f.core.createJob({ targetKey: 'diary', sourceText: SOURCE, title: '20260828' }).uuid;
    rmSync(draftsDir, { recursive: true, force: true });
    symlinkSync(dataDir, draftsDir);
    const before = codex.calls.length;
    await expect(f.core.runAgentReview(uuid, { provider: 'codex' })).rejects.toThrow(AgentError);
    expect(codex.calls.length).toBe(before);
    expect(existsSync(join(dataDir, uuid))).toBe(false);
  });

  it('工作目錄被換成指到外面的符號連結：不在那裡跑，也不在外面建東西', async () => {
    const { f, codex, draftsDir } = await setup();
    const outside = tempDir('outside');
    const uuid = f.core.createJob({ targetKey: 'diary', sourceText: SOURCE, title: '20260828' }).uuid;
    rmSync(join(draftsDir, uuid), { recursive: true, force: true });
    symlinkSync(outside, join(draftsDir, uuid));
    const before = codex.calls.length;

    await expect(f.core.runAgentReview(uuid, { provider: 'codex' })).rejects.toThrow(AgentError);
    expect(codex.calls.length).toBe(before);
    expect(readdirSync(outside)).toEqual([]);
  });

  it('DB 記的路徑經過指到外面的符號連結：改用 drafts/<uuid>，外面不會被建資料夾', async () => {
    const { f, codex, draftsDir } = await setup();
    const outside = tempDir('outside');
    const uuid = f.core.createJob({ targetKey: 'diary', sourceText: SOURCE, title: '20260828' }).uuid;
    symlinkSync(outside, join(draftsDir, 'link'));
    f.db.handle.prepare('UPDATE jobs SET workspace_path = ? WHERE uuid = ?').run('drafts/link/x', uuid);
    // fixture 的 drafts 是 <dataDir>/drafts，DB 存的相對路徑以資料目錄解析。
    await f.core.runAgentReview(uuid, { provider: 'codex' });
    expect(codex.calls.at(-1)!.request.workspaceDir).toBe(join(draftsDir, uuid));
    expect(readdirSync(outside)).toEqual([]);
  });

  it('drafts/ 本身是透過符號連結進來的（使用者自己放的）：照常可用', async () => {
    const { f, codex, draftsDir } = await setup();
    const uuid = f.core.createJob({ targetKey: 'diary', sourceText: SOURCE, title: '20260828' }).uuid;
    // 暫存目錄在 macOS 本身就經過 /var → /private/var 的符號連結；實體路徑兩邊都要先解析再比。
    await f.core.runAgentReview(uuid, { provider: 'codex' });
    expect(codex.calls.at(-1)!.request.workspaceDir).toBe(join(draftsDir, uuid));
  });
});

// ── 3. 搬家鎖不自動接手 ─────────────────────────────────────────────

describe('搬家鎖存在就停下來說明，不猜它是不是過期的', () => {
  it('pid 已經不在的鎖：照樣停下，訊息有 pid、建立時間、要刪的檔；鎖檔原封不動', () => {
    const dataDir = tempDir('lock');
    writeFileSync(join(dataDir, LOCK_FILE), '2147483646'); // 不可能存在的 pid
    let message = '';
    try {
      acquireMoveLock(dataDir);
    } catch (error) {
      expect(error).toBeInstanceOf(DataMoveError);
      message = (error as Error).message;
    }
    expect(message).toContain('2147483646');
    expect(message).toContain(join(dataDir, LOCK_FILE));
    expect(message).toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(readFileSync(join(dataDir, LOCK_FILE), 'utf8')).toBe('2147483646');
    expect(readdirSync(dataDir)).toEqual([LOCK_FILE]);
  });

  it('搬家時遇到留下的鎖：不搬、不寫標記；刪掉鎖之後就能搬', () => {
    const legacy = tempDir('legacy');
    writeFileSync(join(legacy, '.env'), 'WORDPRESS_URL=http://x\n', { mode: 0o600 });
    const dataDir = join(tempDir('home'), 'Galley');
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, LOCK_FILE), '2147483646');
    expect(() => moveLegacyData({ legacyRoot: legacy, dataDir })).toThrow(DataMoveError);
    expect(existsSync(join(dataDir, MARKER_FILE))).toBe(false);
    rmSync(join(dataDir, LOCK_FILE));
    expect(moveLegacyData({ legacyRoot: legacy, dataDir }).kind).toBe('moved');
    expect(existsSync(join(dataDir, LOCK_FILE))).toBe(false);
  });
});

// ── 4. 已搬完但資料庫不見 ───────────────────────────────────────────

function seedLegacyWithDatabase(root: string): void {
  mkdirSync(join(root, 'data'), { recursive: true });
  const db = openDatabase(join(root, 'data', 'publisher.sqlite'));
  runMigrations(db, migrations, { legacyRoot: root });
  db.close();
}

describe('已經有過資料庫、現在卻不見了：停止啟動，不默默建空的', () => {
  it('搬過來的資料庫被移走：prepareUserData 丟錯、講資料庫應該在哪與怎麼重新開始；不建新 DB', () => {
    const legacy = tempDir('legacy');
    seedLegacyWithDatabase(legacy);
    const dataDir = join(tempDir('home'), 'Galley');
    const env = { GALLEY_DATA_DIR: dataDir };
    expect(prepareUserData({ legacyRoot: legacy, env }).outcome.kind).toBe('moved');
    expect(marker(dataDir)).toMatchObject({ databaseCreated: true });

    const db = join(dataDir, 'data', 'publisher.sqlite');
    rmSync(db);
    let message = '';
    try {
      prepareUserData({ legacyRoot: legacy, env });
    } catch (error) {
      expect(error).toBeInstanceOf(DataDirError);
      message = (error as Error).message;
    }
    expect(message).toContain(db);
    expect(message).toMatch(/重新開始/);
    expect(existsSync(db)).toBe(false);
  });

  it('資料庫變成空檔也一樣擋', () => {
    const legacy = tempDir('legacy');
    seedLegacyWithDatabase(legacy);
    const dataDir = join(tempDir('home'), 'Galley');
    const env = { GALLEY_DATA_DIR: dataDir };
    prepareUserData({ legacyRoot: legacy, env });
    writeFileSync(join(dataDir, 'data', 'publisher.sqlite'), '');
    expect(() => prepareUserData({ legacyRoot: legacy, env })).toThrow(DataDirError);
  });

  it('全新安裝：還沒建過 DB 時照常；建過（markDatabaseCreated）之後不見了就擋', () => {
    const legacy = tempDir('empty');
    const dataDir = join(tempDir('home'), 'Galley');
    const env = { GALLEY_DATA_DIR: dataDir };
    const first = prepareUserData({ legacyRoot: legacy, env });
    expect(first.outcome.kind).toBe('fresh');
    expect(marker(dataDir)).toMatchObject({ migratedFrom: null, databaseCreated: false });
    expect(() => prepareUserData({ legacyRoot: legacy, env })).not.toThrow(); // 還是沒建過，照常

    const db = openDatabase(first.paths.databaseFile);
    runMigrations(db, migrations, { legacyRoot: legacy });
    db.close();
    markDatabaseCreated(dataDir);
    expect(marker(dataDir)).toMatchObject({ state: 'done', migratedFrom: null, databaseCreated: true });

    rmSync(first.paths.databaseFile);
    expect(() => prepareUserData({ legacyRoot: legacy, env })).toThrow(DataDirError);
  });

  it('舊格式標記（沒有 databaseCreated）：套完 migration 後補記；搬過來的（migratedFrom 有值）當成建過', () => {
    const dataDir = join(tempDir('home'), 'Galley');
    const legacy = tempDir('empty');
    const env = { GALLEY_DATA_DIR: dataDir };
    mkdirSync(join(dataDir, 'data'), { recursive: true });
    writeFileSync(join(dataDir, 'data', 'publisher.sqlite'), 'x');
    writeFileSync(join(dataDir, MARKER_FILE), JSON.stringify({ createdAt: '2026-10-04T00:00:00.000Z', state: 'done', migratedFrom: null }));
    prepareUserData({ legacyRoot: legacy, env });
    // 啟動前段只讀不寫；套完 migration 後那次才補記。
    expect(marker(dataDir)['databaseCreated']).toBeUndefined();
    markDatabaseCreated(dataDir);
    expect(marker(dataDir)).toMatchObject({ databaseCreated: true, createdAt: '2026-10-04T00:00:00.000Z' });

    const other = join(tempDir('home'), 'Galley');
    mkdirSync(other, { recursive: true });
    writeFileSync(join(other, MARKER_FILE), JSON.stringify({ state: 'done', migratedFrom: '/old clone' }));
    expect(() => prepareUserData({ legacyRoot: legacy, env: { GALLEY_DATA_DIR: other } })).toThrow(DataDirError);
    expect(existsSync(join(other, 'data', 'publisher.sqlite'))).toBe(false);
  });

  it('舊格式的全新標記、資料目錄不可寫：照常啟動（補記留到套完 migration 後，失敗也只警告）', () => {
    const dataDir = join(tempDir('home'), 'Galley');
    const legacy = tempDir('empty');
    for (const sub of ['data', 'drafts', 'generated-images', 'backups']) mkdirSync(join(dataDir, sub), { recursive: true });
    writeFileSync(join(dataDir, 'data', 'publisher.sqlite'), 'x');
    writeFileSync(join(dataDir, MARKER_FILE), JSON.stringify({ state: 'done', migratedFrom: null }));
    chmodSync(dataDir, 0o500);
    try {
      expect(() => prepareUserData({ legacyRoot: legacy, env: { GALLEY_DATA_DIR: dataDir } })).not.toThrow();
      expect(() => markDatabaseCreated(dataDir)).toThrow(DataMoveError); // 呼叫端（main／cli-migrate）接住只警告
    } finally {
      chmodSync(dataDir, 0o700);
    }
  });

  it('舊位置只有 .env（沒有 DB）搬過來：還沒建過 DB，照常啟動', () => {
    const legacy = tempDir('legacy');
    writeFileSync(join(legacy, '.env'), 'WORDPRESS_URL=http://x\n', { mode: 0o600 });
    const dataDir = join(tempDir('home'), 'Galley');
    const env = { GALLEY_DATA_DIR: dataDir };
    expect(prepareUserData({ legacyRoot: legacy, env }).outcome.kind).toBe('moved');
    expect(() => prepareUserData({ legacyRoot: legacy, env })).not.toThrow();
  });
});

// ── 5. 舊位置讀不到不擋已搬完的啟動 ─────────────────────────────────

describe('已搬完時探舊位置出錯：只略過警告，不擋啟動', () => {
  it('從這裡搬過去的：不探舊位置；從別處來的：探不到（權限）就不警告', () => {
    const legacy = tempDir('legacy');
    seedLegacyWithDatabase(legacy);
    const dataDir = join(tempDir('home'), 'Galley');
    expect(moveLegacyData({ legacyRoot: legacy, dataDir }).kind).toBe('moved');

    chmodSync(legacy, 0o000);
    try {
      const same = moveLegacyData({ legacyRoot: legacy, dataDir });
      expect(same).toEqual({ kind: 'already', warning: null });

      // 另一份資料目錄，標記說是從別處搬來的：探這份程式的舊位置會遇到權限錯誤，略過警告。
      const other = join(tempDir('home'), 'Galley');
      mkdirSync(join(other, 'data'), { recursive: true });
      writeFileSync(join(other, 'data', 'publisher.sqlite'), 'x');
      writeFileSync(join(other, MARKER_FILE), JSON.stringify({ state: 'done', migratedFrom: '/old clone', databaseCreated: true }));
      expect(moveLegacyData({ legacyRoot: legacy, dataDir: other })).toEqual({ kind: 'already', warning: null });
      expect(() => prepareUserData({ legacyRoot: legacy, env: { GALLEY_DATA_DIR: other } })).not.toThrow();
    } finally {
      chmodSync(legacy, 0o700);
    }
  });
});
