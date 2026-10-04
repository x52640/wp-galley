import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'dotenv';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp, type SetupFiles } from '../src/server/app.js';
import { loadConfig } from '../src/config/env.js';
import { loadTemplateRegistry } from '../src/templates/registry.js';
import { paths } from '../src/config/paths.js';
import { loadPublishTargets } from '../src/wordpress/targets.js';
import { AgentRegistry } from '../src/agents/registry.js';
import { REDACTED } from '../src/config/secrets.js';
import { createTestDatabase, type TestDatabase } from './helpers/test-db.js';
import { FakeAdapter } from './helpers/fake-adapter.js';
import { startMockWordPress, type MockWordPress } from './helpers/mock-wordpress.js';
import { GOOD_PASSWORD, GOOD_PASSWORD_BARE, meBody, siteHandler, type SiteBehaviour } from './helpers/setup-site.js';

/**
 * 設定精靈的 HTTP 路由（P8-T002）。
 *
 * 檔案一律寫在暫存資料夾（setupFiles 注入），絕不碰專案真的 .env 與 config/publish-targets.json；
 * WordPress 一律是本機假站台。
 */

const headers = { host: '127.0.0.1:3000', 'content-type': 'application/json' };
const EXAMPLE_ENV = readFileSync(join(paths.root, '.env.example'), 'utf8');

let app: FastifyInstance | null = null;
let db: TestDatabase | null = null;
let mock: MockWordPress | null = null;
const dirs: string[] = [];

afterEach(async () => {
  await app?.close();
  db?.cleanup();
  await mock?.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  app = null;
  db = null;
  mock = null;
});

function tempFiles(): SetupFiles {
  const dir = mkdtempSync(join(tmpdir(), 'wp-publisher-setup-'));
  dirs.push(dir);
  mkdirSync(join(dir, 'config'));
  writeFileSync(join(dir, '.env.example'), EXAMPLE_ENV);
  return {
    envFile: join(dir, '.env'),
    envExampleFile: join(dir, '.env.example'),
    siteConfigFile: join(dir, 'config', 'publish-targets.json'),
    backupsDir: join(dir, 'backups'),
    rootDir: dir,
  };
}

async function build(
  options: {
    files?: SetupFiles | null;
    env?: Record<string, string>;
    site?: SiteBehaviour;
  } = {},
): Promise<{ app: FastifyInstance; files: SetupFiles | null }> {
  mock = await startMockWordPress(siteHandler(options.site));
  db = createTestDatabase();
  const files = options.files === undefined ? tempFiles() : options.files;
  app = await buildApp({
    config: loadConfig({ APP_HOST: '127.0.0.1', APP_PORT: '3000', LOG_LEVEL: 'silent', ...options.env }),
    db: db.handle,
    // 工作區與圖片寫進暫存目錄，不寫進資料目錄（P8-T003）。
    dataDir: db.dir,
    templates: await loadTemplateRegistry(paths.templates),
    agents: new AgentRegistry({
      adapters: [
        new FakeAdapter('codex', 'Codex', { image: {} }),
        new FakeAdapter('claude', 'Claude Code', {
          status: { installed: false, available: false, loginState: 'unknown', unavailableReason: '找不到 claude' },
        }),
      ],
    }),
    targets: files ? await loadPublishTargets(files.siteConfigFile) : await loadPublishTargets(join(paths.config, 'examples', 'remusplus.json')),
    ...(files ? { setupFiles: files } : {}),
  });
  await app.ready();
  return { app, files };
}

async function testConnection(instance: FastifyInstance, password = GOOD_PASSWORD) {
  return instance.inject({
    method: 'POST',
    url: '/api/setup/wordpress/test',
    headers,
    payload: { url: mock!.url, username: 'ming', appPassword: password },
  });
}

/** 第三步的讀取：會打真的站，所以是 POST＋JSON。 */
function check(instance: FastifyInstance) {
  return instance.inject({ method: 'POST', url: '/api/setup/destinations/check', headers, payload: {} });
}

async function connect(instance: FastifyInstance): Promise<void> {
  const tested = await testConnection(instance);
  const save = await instance.inject({
    method: 'POST',
    url: '/api/setup/wordpress',
    headers,
    payload: { testId: tested.json().testId },
  });
  expect(save.statusCode).toBe(200);
}

describe('GET /api/setup', () => {
  it('什麼都沒設定：needsSetup', async () => {
    const { app } = await build();
    const body = (await app.inject({ method: 'GET', url: '/api/setup', headers })).json();
    expect(body).toEqual({ needsSetup: true, wordpress: null, siteConfig: { exists: false, targets: [] }, canWrite: true });
  });

  it('連線與站台設定都有：不打擾，也不回密碼', async () => {
    const { app } = await build({
      files: null,
      env: { WORDPRESS_URL: 'https://example.com', WORDPRESS_USERNAME: 'ming', WORDPRESS_APP_PASSWORD: GOOD_PASSWORD },
    });
    const res = await app.inject({ method: 'GET', url: '/api/setup', headers });
    expect(res.json()).toMatchObject({ needsSetup: false, wordpress: { url: 'https://example.com', username: 'ming' }, canWrite: false });
    expect(res.json().siteConfig.targets.map((target: { key: string }) => target.key)).toEqual(['read-think', 'diary']);
    expect(res.body).not.toContain(GOOD_PASSWORD);
  });
});

describe('第一步：測試連線與儲存', () => {
  it('測試通過：回 testId，回應裡沒有密碼；還沒寫任何檔', async () => {
    const { app, files } = await build();
    const res = await testConnection(app);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.testId).toBe('string');
    expect(res.body).not.toContain(GOOD_PASSWORD);
    expect(res.body).not.toContain(GOOD_PASSWORD_BARE);
    expect(existsSync(files!.envFile)).toBe(false);
  });

  it('測試失敗：講原因，沒有 testId', async () => {
    const { app } = await build();
    const res = await testConnection(app, 'zzzz zzzz zzzz zzzz zzzz zzzz');
    expect(res.json()).toMatchObject({ ok: false, testId: null, problem: { kind: 'wrong-password' } });
  });

  it('儲存：只送 testId；.env 以範例為底、0600；當場生效（不用重啟）', async () => {
    const { app, files } = await build();
    const tested = await testConnection(app);
    const save = await app.inject({ method: 'POST', url: '/api/setup/wordpress', headers, payload: { testId: tested.json().testId } });
    expect(save.statusCode).toBe(200);
    expect(save.json()).toMatchObject({ saved: true, restartRequired: false, status: { wordpress: { url: mock!.url, username: 'ming' } } });
    expect(save.body).not.toContain(GOOD_PASSWORD_BARE);

    const env = parse(readFileSync(files!.envFile, 'utf8'));
    expect(env).toMatchObject({ WORDPRESS_URL: mock!.url, WORDPRESS_USERNAME: 'ming', WORDPRESS_APP_PASSWORD: GOOD_PASSWORD_BARE, APP_HOST: '127.0.0.1' });
    expect(statSync(files!.envFile).mode & 0o777).toBe(0o600);

    // 就地換掉：診斷路由已經在用新的連線去問假站台。
    const before = mock!.requests.length;
    const probe = await app.inject({ method: 'GET', url: '/api/wordpress', headers });
    expect(probe.json()).toMatchObject({ configured: true, authenticated: true });
    expect(mock!.requests.length).toBeGreaterThan(before);
    expect(probe.body).not.toContain(GOOD_PASSWORD_BARE);

    // 遮蔽器當場認得新密碼（log、錯誤回應、CoreService 都用這一個）。
    expect(app.ctx.secrets.scrub(`x ${GOOD_PASSWORD_BARE} y`)).toBe(`x ${REDACTED} y`);
    expect(app.ctx.secrets.scrub(`x ${GOOD_PASSWORD} y`)).toBe(`x ${REDACTED} y`);
  });

  it('既有 .env 的其他行保留', async () => {
    const files = tempFiles();
    writeFileSync(files.envFile, '# 作者的設定\nAPP_PORT=3000\nWORDPRESS_URL=https://old.example.com\nWORDPRESS_USERNAME=old\nWORDPRESS_APP_PASSWORD=oldoldoldoldoldoldoldold\nLOG_LEVEL=debug\n');
    const { app } = await build({ files });
    await connect(app);
    const text = readFileSync(files.envFile, 'utf8');
    expect(text.startsWith('# 作者的設定\nAPP_PORT=3000\n')).toBe(true);
    expect(parse(text)).toMatchObject({ LOG_LEVEL: 'debug', WORDPRESS_URL: mock!.url });
    expect(text).not.toContain('old.example.com');
  });

  it('testId 對不上或已經用過：409，請重測', async () => {
    const { app } = await build();
    const bad = await app.inject({ method: 'POST', url: '/api/setup/wordpress', headers, payload: { testId: 'nope' } });
    expect(bad.statusCode).toBe(409);
    expect(bad.json().error.message).toContain('測試連線');

    const tested = await testConnection(app);
    const payload = { testId: tested.json().testId };
    expect((await app.inject({ method: 'POST', url: '/api/setup/wordpress', headers, payload })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/setup/wordpress', headers, payload })).statusCode).toBe(409);
  });

  it('沒有注入檔案路徑：只能測試、不能存（503），絕不退回專案的 .env', async () => {
    const { app } = await build({ files: null });
    const tested = await testConnection(app);
    expect(tested.json().ok).toBe(true);
    const save = await app.inject({ method: 'POST', url: '/api/setup/wordpress', headers, payload: { testId: tested.json().testId } });
    expect(save.statusCode).toBe(503);
  });
});

describe('寫入路由擋其他網頁（CSRF）', () => {
  // 網址用假站台自己：被擋的話假站台一個請求都收不到，這個斷言才有意義。
  const payload = () => ({ url: mock!.url, username: 'ming', appPassword: GOOD_PASSWORD });

  it.each([
    ['外站 Origin', { origin: 'https://evil.example' }, 403],
    ['沙箱 iframe（Origin: null）', { origin: 'null' }, 403],
    ['Sec-Fetch-Site: cross-site', { 'sec-fetch-site': 'cross-site' }, 403],
    ['其他本機埠（same-site）', { origin: 'http://localhost:8080', 'sec-fetch-site': 'same-site' }, 403],
    ['其他本機埠（舊瀏覽器沒有 Sec-Fetch-Site）', { origin: 'http://127.0.0.1:8080' }, 403],
  ])('%s → %i', async (_name, extra, statusCode) => {
    const { app } = await build();
    const res = await app.inject({ method: 'POST', url: '/api/setup/wordpress/test', headers: { ...headers, ...extra }, payload: payload() });
    expect(res.statusCode).toBe(statusCode);
    expect(res.json().error.code).toBe('CROSS_ORIGIN_BLOCKED');
    expect(mock!.requests).toHaveLength(0);
  });

  it('不是 JSON（表單、text/plain 這種不用 preflight 的簡單請求）→ 415', async () => {
    const { app } = await build();
    const res = await app.inject({
      method: 'POST',
      url: '/api/setup/wordpress/test',
      headers: { host: '127.0.0.1:3000', 'content-type': 'text/plain' },
      payload: JSON.stringify(payload()),
    });
    expect(res.statusCode).toBe(415);
    expect(mock!.requests).toHaveLength(0);
  });

  it.each([
    ['由後端直接提供', '127.0.0.1:3000', 'http://127.0.0.1:3000'],
    ['經 Vite proxy（不改 Host）', '127.0.0.1:5173', 'http://127.0.0.1:5173'],
    ['IPv6', '[::1]:3000', 'http://[::1]:3000'],
  ])('發布台自己的畫面照常：%s', async (_name, host, origin) => {
    const { app } = await build();
    const res = await app.inject({
      method: 'POST',
      url: '/api/setup/wordpress/test',
      headers: { ...headers, host, origin, 'sec-fetch-site': 'same-origin' },
      payload: payload(),
    });
    expect(res.statusCode).toBe(200);
  });

  it.each([
    ['POST /api/setup/agents', '/api/setup/agents'],
    ['POST /api/setup/destinations/check', '/api/setup/destinations/check'],
  ])('有副作用的讀取也吃同一套守門：%s', async (_name, url) => {
    const { app } = await build();
    const cross = await app.inject({ method: 'POST', url, headers: { ...headers, origin: 'http://localhost:8080' }, payload: {} });
    expect(cross.statusCode).toBe(403);
    const plain = await app.inject({ method: 'POST', url, headers: { host: '127.0.0.1:3000', 'content-type': 'text/plain' }, payload: '{}' });
    expect(plain.statusCode).toBe(415);
    // 舊的 GET 已經拿掉。
    expect((await app.inject({ method: 'GET', url: url.replace('/check', ''), headers })).statusCode).toBe(404);
    expect(mock!.requests).toHaveLength(0);
  });
});

describe('第二步：Agent', () => {
  it('帶安裝／登入指令，只有 Codex 標成能生圖', async () => {
    const { app } = await build();
    const body = (await app.inject({ method: 'POST', url: '/api/setup/agents', headers, payload: {} })).json();
    const codex = body.agents.find((agent: { id: string }) => agent.id === 'codex');
    const claude = body.agents.find((agent: { id: string }) => agent.id === 'claude');
    expect(codex).toMatchObject({ available: true, canGenerateImages: true, loginCommand: 'codex login' });
    expect(codex.installCommand).toContain('@openai/codex');
    expect(claude).toMatchObject({ installed: false, canGenerateImages: false, loginCommand: 'claude auth login' });
  });
});

describe('第三步：發到哪裡', () => {
  it('還沒連線：503，叫人先做第一步', async () => {
    const { app } = await build();
    const res = await check(app);
    expect(res.statusCode).toBe(503);
    expect(res.json().error.message).toContain('第一步');
  });

  it('沒有設定檔：寫出跟範例同格式的檔，當場可以建稿', async () => {
    const { app, files } = await build();
    await connect(app);

    const options = (await check(app)).json();
    expect(options.existing).toEqual([]);
    expect(options.options.map((option: { key: string; available: boolean; taxonomyRestBase: string | null }) => [option.key, option.available, option.taxonomyRestBase])).toEqual([
      ['post', true, 'categories'],
      ['page', true, null],
    ]);

    const save = await app.inject({ method: 'POST', url: '/api/setup/destinations', headers, payload: { include: ['post', 'page'], replace: [] } });
    expect(save.statusCode).toBe(200);
    expect(save.json()).toMatchObject({ saved: true, restartRequired: false, backupFile: null, status: { needsSetup: false } });
    expect(readFileSync(files!.siteConfigFile, 'utf8')).toBe(readFileSync(join(paths.config, 'publish-targets.example.json'), 'utf8'));

    // 不用重啟：發布目標與建稿立刻可用。
    const created = await app.inject({ method: 'POST', url: '/api/jobs', headers, payload: { targetKey: 'post', sourceText: '第一段。' } });
    expect(created.statusCode).toBe(201);
    const status = (await app.inject({ method: 'GET', url: '/api/setup', headers })).json();
    expect(status.siteConfig.targets.map((target: { key: string }) => target.key)).toEqual(['post', 'page']);
  });

  it('已經有作者站台的設定：原樣保留，新的加在後面，先備份', async () => {
    const files = tempFiles();
    const remus = readFileSync(join(paths.config, 'examples', 'remusplus.json'), 'utf8');
    writeFileSync(files.siteConfigFile, remus);
    const { app } = await build({ files });
    await connect(app);

    const options = (await check(app)).json();
    expect(options.existing.map((target: { key: string }) => target.key)).toEqual(['read-think', 'diary']);

    const save = await app.inject({ method: 'POST', url: '/api/setup/destinations', headers, payload: { include: ['post'], replace: [] } });
    expect(save.statusCode).toBe(200);
    const written = JSON.parse(readFileSync(files.siteConfigFile, 'utf8'));
    expect(written.targets.slice(0, 2)).toEqual(JSON.parse(remus).targets);
    expect(written.targets.map((target: { key: string }) => target.key)).toEqual(['read-think', 'diary', 'post']);

    const backupFile = save.json().backupFile as string;
    // 完整路徑（P8-T003）：資料目錄在 ~/Library 底下，只給 backups/… 使用者找不到檔。
    expect(backupFile.startsWith(`${files.backupsDir}/`)).toBe(true);
    expect(backupFile.slice(files.backupsDir.length + 1)).toMatch(/^publish-targets-\d{8}-\d{6}-\d{3}-[0-9a-f]{6}\.json$/);
    expect(readFileSync(backupFile, 'utf8')).toBe(remus);
  });

  it('同 key 已存在：沒勾取代就 409、檔案不動；勾了才換', async () => {
    const files = tempFiles();
    const mine = { targets: [{ key: 'post', displayName: '我的文章', contentType: 'article', postType: 'post', restBase: 'posts', templateId: 'article-v1', taxonomy: null, allowCreate: true }] };
    writeFileSync(files.siteConfigFile, JSON.stringify(mine));
    const { app } = await build({ files });
    await connect(app);

    const options = (await check(app)).json();
    expect(options.options[0].existing).toMatchObject({ key: 'post', displayName: '我的文章' });

    const refused = await app.inject({ method: 'POST', url: '/api/setup/destinations', headers, payload: { include: ['post'], replace: [] } });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.message).toContain('我的文章');
    expect(readFileSync(files.siteConfigFile, 'utf8')).toBe(JSON.stringify(mine));
    expect(existsSync(files.backupsDir)).toBe(false);

    const replaced = await app.inject({ method: 'POST', url: '/api/setup/destinations', headers, payload: { include: ['post'], replace: ['post'] } });
    expect(replaced.statusCode).toBe(200);
    expect(JSON.parse(readFileSync(files.siteConfigFile, 'utf8')).targets[0]).toMatchObject({ displayName: '文章', taxonomyRestBase: 'categories' });
    expect(readdirSync(files.backupsDir)).toHaveLength(1);
  });

  it('壞掉的設定檔不覆寫', async () => {
    const files = tempFiles();
    // 啟動時壞掉的檔會直接啟動失敗；這裡模擬「啟動後才被手動改壞」。
    const { app } = await build({ files });
    writeFileSync(files.siteConfigFile, '{ not json');
    await connect(app);
    const res = await app.inject({ method: 'POST', url: '/api/setup/destinations', headers, payload: { include: ['post'], replace: [] } });
    expect(res.statusCode).toBe(409);
    expect(readFileSync(files.siteConfigFile, 'utf8')).toBe('{ not json');
  });

  it('帳號不能發頁面：選頁面被拒，講原因', async () => {
    const { app, files } = await build({
      site: { me: { body: meBody(['author'], { edit_posts: true, publish_posts: true, upload_files: true }) } },
    });
    // author 的 users/me 不驗密碼（覆寫了 me），照樣能連。
    await connect(app);
    const res = await app.inject({ method: 'POST', url: '/api/setup/destinations', headers, payload: { include: ['page'], replace: [] } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toContain('publish_pages');
    expect(existsSync(files!.siteConfigFile)).toBe(false);
  });
});

describe('遮蔽器只收像密碼的東西', () => {
  it('格式不對的（多半是打錯欄位）不加進全域遮蔽器；24 個英數字的才加', async () => {
    const { app } = await build();
    await testConnection(app, 'https://my-site.example');
    expect(app.ctx.secrets.scrub('x https://my-site.example y')).toBe('x https://my-site.example y');

    await testConnection(app, 'zzzz zzzz zzzz zzzz zzzz zzzz');
    expect(app.ctx.secrets.scrub('x zzzzzzzzzzzzzzzzzzzzzzzz y')).toBe(`x ${REDACTED} y`);
    expect(app.ctx.secrets.scrub('x zzzz zzzz zzzz zzzz zzzz zzzz y')).toBe(`x ${REDACTED} y`);
  });

  it('整趟測試＋儲存（含失敗與錯誤回應）的 log 裡都找不到密碼', async () => {
    const lines: string[] = [];
    mock = await startMockWordPress(siteHandler());
    db = createTestDatabase();
    const files = tempFiles();
    app = await buildApp({
      config: loadConfig({ APP_HOST: '127.0.0.1', APP_PORT: '3000', LOG_LEVEL: 'trace' }),
      db: db.handle,
      dataDir: db.dir,
      templates: await loadTemplateRegistry(paths.templates),
      agents: new AgentRegistry({ adapters: [] }),
      targets: await loadPublishTargets(files.siteConfigFile),
      setupFiles: files,
      logStream: { write: (line) => void lines.push(line) },
    });
    await app.ready();

    await testConnection(app, 'wxyz wxyz wxyz wxyz wxyz wxyz'); // 錯的密碼
    await connect(app);
    await app.inject({ method: 'POST', url: '/api/setup/wordpress', headers, payload: { testId: 'stale' } }); // 409
    await app.inject({ method: 'GET', url: '/api/wordpress', headers });

    const log = lines.join('');
    expect(log.length).toBeGreaterThan(0);
    expect(log).toContain('設定精靈：已儲存 WordPress 連線');
    for (const secret of [GOOD_PASSWORD, GOOD_PASSWORD_BARE, 'wxyzwxyzwxyzwxyzwxyzwxyz', 'wxyz wxyz wxyz wxyz wxyz wxyz']) {
      expect(log).not.toContain(secret);
    }
    // 請求本體不進 log，Authorization 標頭也不會。
    expect(log).not.toMatch(/Basic [A-Za-z0-9+/=]{20,}/);
  });
});

describe('換站', () => {
  it('舊站上有發過文或傳過圖：測試結果帶 siteChange，沒確認就 409、確認了才存', async () => {
    const files = tempFiles();
    const { app } = await build({ files });
    await connect(app);
    // 在目前這個站上記一張上傳過的圖。
    const siteId = (app.ctx.db.prepare('SELECT id FROM sites WHERE key = ?').get(mock!.url) as { id: number }).id;
    app.ctx.db
      .prepare("INSERT INTO wordpress_objects (site_id, object_type, wordpress_id, status) VALUES (?, 'media', 5, 'inherit')")
      .run(siteId);

    // 同一個假站台換一個寫法的網址（localhost）就是「另一個站」。
    const otherUrl = mock!.url.replace('127.0.0.1', 'localhost');
    const tested = await app.inject({
      method: 'POST',
      url: '/api/setup/wordpress/test',
      headers,
      payload: { url: otherUrl, username: 'ming', appPassword: GOOD_PASSWORD },
    });
    expect(tested.json().siteChange).toEqual({ from: mock!.url, to: otherUrl, publishedJobs: 0, uploadedMedia: 1 });

    const refused = await app.inject({ method: 'POST', url: '/api/setup/wordpress', headers, payload: { testId: tested.json().testId } });
    expect(refused.statusCode).toBe(409);
    expect(parse(readFileSync(files.envFile, 'utf8')).WORDPRESS_URL).toBe(mock!.url);

    const saved = await app.inject({
      method: 'POST',
      url: '/api/setup/wordpress',
      headers,
      payload: { testId: tested.json().testId, confirmSiteChange: true },
    });
    expect(saved.statusCode).toBe(200);
    expect(parse(readFileSync(files.envFile, 'utf8')).WORDPRESS_URL).toBe(otherUrl);
  });

  it('同一個站重測、或舊站上什麼都沒有：不帶 siteChange', async () => {
    const { app } = await build();
    await connect(app);
    expect((await testConnection(app)).json().siteChange).toBeNull();
  });

  it('有上傳或發布在跑（或另一個儲存正在進行）：存檔 409，檔案不動', async () => {
    const files = tempFiles();
    const { app } = await build({ files });
    const tested = await testConnection(app);
    expect(app.ctx.core.tryBeginReconfigure()).toBeNull(); // 模擬另一個儲存正在進行
    const res = await app.inject({ method: 'POST', url: '/api/setup/wordpress', headers, payload: { testId: tested.json().testId } });
    expect(res.statusCode).toBe(409);
    expect(existsSync(files.envFile)).toBe(false);
    app.ctx.core.endReconfigure();
    const ok = await app.inject({ method: 'POST', url: '/api/setup/wordpress', headers, payload: { testId: tested.json().testId } });
    expect(ok.statusCode).toBe(200);
  });

  it('同一秒存兩次站台設定：兩份備份都在，不互相覆蓋', async () => {
    const files = tempFiles();
    writeFileSync(files.siteConfigFile, readFileSync(join(paths.config, 'examples', 'remusplus.json'), 'utf8'));
    const { app } = await build({ files });
    await connect(app);
    const payload = { include: ['post'], replace: ['post'] };
    expect((await app.inject({ method: 'POST', url: '/api/setup/destinations', headers, payload })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/setup/destinations', headers, payload })).statusCode).toBe(200);
    expect(readdirSync(files.backupsDir)).toHaveLength(2);
  });
});

describe('停用不要的類型（P5-T032，D-032）', () => {
  const REMUS = () => readFileSync(join(paths.config, 'examples', 'remusplus.json'), 'utf8');

  async function withRemus(): Promise<{ app: FastifyInstance; files: SetupFiles }> {
    const files = tempFiles();
    writeFileSync(files.siteConfigFile, REMUS());
    const built = await build({ files });
    return { app: built.app, files };
  }

  function saveDisabled(instance: FastifyInstance, disabled: string[], include: string[] = []) {
    return instance.inject({ method: 'POST', url: '/api/setup/destinations', headers, payload: { include, replace: [], disabled } });
  }

  it('舊檔沒有停用標記：全部視為啟用', async () => {
    const { app } = await withRemus();
    const status = (await app.inject({ method: 'GET', url: '/api/setup', headers })).json();
    expect(status.siteConfig.targets.map((target: { key: string; disabled: boolean }) => [target.key, target.disabled])).toEqual([
      ['read-think', false],
      ['diary', false],
    ]);
  });

  it('停用：只加那一個標記、其他原樣，先備份，當場生效（不用連 WordPress）', async () => {
    const { app, files } = await withRemus();
    const res = await saveDisabled(app, ['diary']);
    expect(res.statusCode).toBe(200);
    expect(mock!.requests).toHaveLength(0);

    const original = JSON.parse(REMUS());
    const written = JSON.parse(readFileSync(files.siteConfigFile, 'utf8'));
    expect(written.targets[0]).toEqual(original.targets[0]);
    // 欄位順序也不動：停用標記接在最後。
    expect(Object.keys(written.targets[1])).toEqual([...Object.keys(original.targets[1]), 'disabled']);
    expect(written.targets[1]).toEqual({ ...original.targets[1], disabled: true });

    const backupFile = res.json().backupFile as string;
    expect(readFileSync(backupFile, 'utf8')).toBe(REMUS());

    // 回應與 listTargets 都帶停用狀態；停用的照樣列出來（舊稿件要靠它顯示類型名稱）。
    expect(res.json().status.siteConfig.targets.map((target: { key: string; disabled: boolean }) => [target.key, target.disabled])).toEqual([
      ['read-think', false],
      ['diary', true],
    ]);
    const probe = (await app.inject({ method: 'GET', url: '/api/wordpress', headers })).json();
    expect(probe.publishTargets.find((target: { key: string }) => target.key === 'diary')).toMatchObject({ disabled: true });

    // 建稿當場就擋；沒停用的照常。
    const refused = await app.inject({ method: 'POST', url: '/api/jobs', headers, payload: { targetKey: 'diary', sourceText: '一段。' } });
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error.message).toContain('停用');
    const created = await app.inject({ method: 'POST', url: '/api/jobs', headers, payload: { targetKey: 'read-think', sourceText: '一段。' } });
    expect(created.statusCode).toBe(201);
  });

  it('再啟用：拿掉標記，檔案回到一字不差的原樣；再備份一次', async () => {
    const { app, files } = await withRemus();
    expect((await saveDisabled(app, ['diary'])).statusCode).toBe(200);
    const res = await saveDisabled(app, []);
    expect(res.statusCode).toBe(200);
    expect(readFileSync(files.siteConfigFile, 'utf8')).toBe(REMUS());
    expect(readdirSync(files.backupsDir)).toHaveLength(2);
    const created = await app.inject({ method: 'POST', url: '/api/jobs', headers, payload: { targetKey: 'diary', sourceText: '一段。' } });
    expect(created.statusCode).toBe(201);
  });

  it('全部停用：400，檔案不動、沒有備份', async () => {
    const { app, files } = await withRemus();
    const res = await saveDisabled(app, ['read-think', 'diary']);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toContain('至少');
    expect(readFileSync(files.siteConfigFile, 'utf8')).toBe(REMUS());
    expect(existsSync(files.backupsDir)).toBe(false);
  });

  it('設定檔裡沒有的 key：400，檔案不動', async () => {
    const { app, files } = await withRemus();
    const res = await saveDisabled(app, ['nope']);
    expect(res.statusCode).toBe(400);
    expect(readFileSync(files.siteConfigFile, 'utf8')).toBe(REMUS());
  });

  it('什麼都沒變：不寫檔、不備份', async () => {
    const { app, files } = await withRemus();
    const res = await saveDisabled(app, []);
    expect(res.statusCode).toBe(200);
    expect(res.json().backupFile).toBeNull();
    expect(existsSync(files.backupsDir)).toBe(false);
  });

  it('include 與 disabled 都沒給：400', async () => {
    const { app } = await withRemus();
    const res = await app.inject({ method: 'POST', url: '/api/setup/destinations', headers, payload: { include: [], replace: [] } });
    expect(res.statusCode).toBe(400);
  });

  it('加文章＋停用日記同一次存：一份備份，兩件事都做', async () => {
    const { app, files } = await withRemus();
    await connect(app);
    const res = await saveDisabled(app, ['diary'], ['post']);
    expect(res.statusCode).toBe(200);
    const written = JSON.parse(readFileSync(files.siteConfigFile, 'utf8'));
    expect(written.targets.map((target: { key: string; disabled?: boolean }) => [target.key, target.disabled])).toEqual([
      ['read-think', undefined],
      ['diary', true],
      ['post', undefined],
    ]);
    expect(readdirSync(files.backupsDir)).toHaveLength(1);
  });

  it('檢查回應帶每個類型進行中的稿件數（已發布、已取消的不算）', async () => {
    const { app } = await withRemus();
    await connect(app);
    const make = async (targetKey: string) =>
      (await app.inject({ method: 'POST', url: '/api/jobs', headers, payload: { targetKey, sourceText: '一段。' } })).json().job.uuid as string;
    await make('diary');
    await make('diary');
    const cancelled = await make('diary');
    app.ctx.core.cancelJob(cancelled);
    const options = (await check(app)).json();
    expect(options.openJobs).toEqual({ diary: 2 });
  });
});

describe('停用狀態不被別的操作默默打開（P5-T032 審查 low #2）', () => {
  it('取代一個停用的 target：換成精靈的設定，但仍然停用', async () => {
    const files = tempFiles();
    const mine = { targets: [
      { key: 'read-think', displayName: '長文', contentType: 'longform', postType: 'read-think', restBase: 'read-think', templateId: 'longform-v1', taxonomy: null, allowCreate: true },
      { key: 'post', displayName: '我的文章', contentType: 'article', postType: 'post', restBase: 'posts', templateId: 'article-v1', taxonomy: null, allowCreate: true, disabled: true },
    ] };
    writeFileSync(files.siteConfigFile, JSON.stringify(mine));
    const { app } = await build({ files });
    await connect(app);
    const res = await app.inject({ method: 'POST', url: '/api/setup/destinations', headers, payload: { include: ['post'], replace: ['post'] } });
    expect(res.statusCode).toBe(200);
    const written = JSON.parse(readFileSync(files.siteConfigFile, 'utf8'));
    expect(written.targets[1]).toMatchObject({ displayName: '文章', taxonomyRestBase: 'categories', disabled: true });
  });

  it('沒帶 disabled 只加文章：別處剛停用的類型維持停用', async () => {
    const files = tempFiles();
    writeFileSync(files.siteConfigFile, readFileSync(join(paths.config, 'examples', 'remusplus.json'), 'utf8'));
    const { app } = await build({ files });
    await connect(app);
    // 另一個分頁先停用日記。
    expect((await app.inject({ method: 'POST', url: '/api/setup/destinations', headers, payload: { include: [], replace: [], disabled: ['diary'] } })).statusCode).toBe(200);
    // 舊分頁（沒動開關）只加文章。
    expect((await app.inject({ method: 'POST', url: '/api/setup/destinations', headers, payload: { include: ['post'], replace: [] } })).statusCode).toBe(200);
    const written = JSON.parse(readFileSync(files.siteConfigFile, 'utf8'));
    expect(written.targets.find((target: { key: string }) => target.key === 'diary').disabled).toBe(true);
  });
});

describe('Codex 審查（PR #9）', () => {
  const postTarget = (extra: Record<string, unknown> = {}) => ({
    key: 'post', displayName: '我的文章', contentType: 'article', postType: 'post', restBase: 'posts', templateId: 'article-v1', taxonomy: null, allowCreate: true, ...extra,
  });

  it('#1 沒有變更也把磁碟上的設定同步進記憶體（啟動後手改過檔）', async () => {
    const files = tempFiles();
    const remus = readFileSync(join(paths.config, 'examples', 'remusplus.json'), 'utf8');
    writeFileSync(files.siteConfigFile, remus);
    const { app } = await build({ files });
    // 啟動後有人手改：把日記停用。記憶體裡還是啟用的。
    const edited = JSON.parse(remus);
    edited.targets[1].disabled = true;
    writeFileSync(files.siteConfigFile, JSON.stringify(edited, null, 2));

    const res = await app.inject({ method: 'POST', url: '/api/setup/destinations', headers, payload: { include: [], replace: [], disabled: ['diary'] } });
    expect(res.statusCode).toBe(200);
    expect(res.json().backupFile).toBeNull();
    expect(existsSync(files.backupsDir)).toBe(false);
    expect(res.json().status.siteConfig.targets[1]).toMatchObject({ key: 'diary', disabled: true });
    const refused = await app.inject({ method: 'POST', url: '/api/jobs', headers, payload: { targetKey: 'diary', sourceText: '一段。' } });
    expect(refused.statusCode).toBe(400);
  });

  it('#2 沒帶 disabled 也不准寫出全部停用（取代唯一一個停用的 target）', async () => {
    const files = tempFiles();
    const mine = JSON.stringify({ targets: [postTarget({ disabled: true })] });
    writeFileSync(files.siteConfigFile, mine);
    const { app } = await build({ files });
    await connect(app);
    const res = await app.inject({ method: 'POST', url: '/api/setup/destinations', headers, payload: { include: ['post'], replace: ['post'] } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toContain('至少');
    expect(readFileSync(files.siteConfigFile, 'utf8')).toBe(mine);
    expect(existsSync(files.backupsDir)).toBe(false);
  });

  it('#3 長 key（原設定 schema 合法）也能停用', async () => {
    const files = tempFiles();
    const longKey = `a${'-b'.repeat(80)}`; // 161 字元，設定檔 schema 沒有長度上限
    writeFileSync(files.siteConfigFile, JSON.stringify({ targets: [postTarget(), postTarget({ key: longKey, displayName: '長' })] }));
    const { app, } = await build({ files });
    const res = await app.inject({ method: 'POST', url: '/api/setup/destinations', headers, payload: { include: [], replace: [], disabled: [longKey] } });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(readFileSync(files.siteConfigFile, 'utf8')).targets[1].disabled).toBe(true);
  });
});
