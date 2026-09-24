import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { buildApp } from '../src/server/app.js';
import { ConfigError, loadConfig } from '../src/config/env.js';
import { createSecretScrubber } from '../src/config/secrets.js';
import { loadTemplateRegistry } from '../src/templates/registry.js';
import { loadPublishTargets } from '../src/wordpress/targets.js';
import { paths } from '../src/config/paths.js';
import { AgentRegistry } from '../src/agents/registry.js';
import { WordPressClient } from '../src/wordpress/client.js';
import { createTestDatabase } from './helpers/test-db.js';
import { FakeAdapter } from './helpers/fake-adapter.js';
import { startMockWordPress, type MockWordPress } from './helpers/mock-wordpress.js';

/**
 * P5-T023（D-023）：審查 #6 #7 #10 #4。
 * 一律合成密碼、FakeAdapter、本機假 WordPress；不讀 .env。
 */

const PASSWORD_BARE = 'Zq7vXk2mPa9LwR4tBn6cYd8e';
const PASSWORD_SPACED = 'Zq7v Xk2m Pa9L wR4t Bn6c Yd8e';
const headers = { host: '127.0.0.1:3000' };

let app: FastifyInstance | null = null;
let db: ReturnType<typeof createTestDatabase> | null = null;
let mock: MockWordPress | null = null;

afterEach(async () => {
  await app?.close();
  db?.cleanup();
  await mock?.close();
  app = null;
  db = null;
  mock = null;
});

interface BuildOptions {
  readonly wordpressUrl?: string;
  readonly client?: WordPressClient | null;
  readonly lines?: string[];
  readonly agents?: AgentRegistry;
  readonly beforeReady?: (instance: FastifyInstance) => void;
}

async function build(options: BuildOptions = {}): Promise<FastifyInstance> {
  db = createTestDatabase();
  const env: Record<string, string> = { APP_HOST: '127.0.0.1', APP_PORT: '3000', LOG_LEVEL: options.lines ? 'info' : 'silent' };
  if (options.wordpressUrl !== undefined) {
    env['WORDPRESS_URL'] = options.wordpressUrl;
    env['WORDPRESS_USERNAME'] = 'tester';
    // 設定裡是有空白的樣子；遮蔽器要連沒空白的一起認。
    env['WORDPRESS_APP_PASSWORD'] = PASSWORD_SPACED;
  }
  const lines = options.lines;
  app = await buildApp({
    config: loadConfig(env),
    db: db.handle,
    templates: await loadTemplateRegistry(paths.templates),
    agents: options.agents ?? new AgentRegistry({ adapters: [] }),
    targets: await loadPublishTargets(join(paths.config, 'examples', 'remusplus.json')),
    wordpress: options.client ?? null,
    ...(lines ? { logStream: { write: (line: string) => void lines.push(line) } } : {}),
  });
  options.beforeReady?.(app);
  await app.ready();
  return app;
}

describe('#6 log 的字串訊息也過遮蔽器', () => {
  it('錯誤訊息參數裡的密碼不進 log（實際擷取 log 輸出）', async () => {
    const lines: string[] = [];
    const instance = await build({ wordpressUrl: 'https://example.test', lines });
    for (const secret of [PASSWORD_BARE, PASSWORD_SPACED]) {
      const res = await instance.inject({
        method: 'GET',
        url: `/api/wordpress/terms?taxonomy=${encodeURIComponent(secret)}`,
        headers,
      });
      expect(res.statusCode).toBe(400);
    }
    // 直接用 logger 的各種寫法：純字串、物件＋訊息、printf 參數。
    instance.log.info(`手動 ${PASSWORD_BARE}`);
    instance.log.warn({ a: 1 }, `物件加訊息 ${PASSWORD_SPACED}`);
    instance.log.error('printf %s', PASSWORD_BARE);
    // 非字串的 printf 參數、Error 當第一個參數（pino 拿 message 當 msg）也要遮（審查補充）。
    instance.log.info('json %j', { pw: PASSWORD_BARE });
    instance.log.info('obj %o', { deep: { pw: PASSWORD_SPACED } });
    instance.log.error('err %s', new Error(`boom ${PASSWORD_BARE}`));
    instance.log.error(new Error(`first ${PASSWORD_BARE}`));
    instance.log.error({ err: new Error(`inside ${PASSWORD_BARE}`) }, 'with err');

    const log = lines.join('');
    expect(log).toContain('手動 [REDACTED]');
    expect(log).toContain('first [REDACTED]');
    // Error 還是被當成 Error 序列化（有 stack）。
    expect(log).toMatch(/"stack":"Error: first \[REDACTED\]/);
    expect(log).toContain('物件加訊息 [REDACTED]');
    expect(log).not.toContain(PASSWORD_BARE);
    expect(log).not.toContain(PASSWORD_SPACED);
  });
});

describe('#7 所有 HTTP 回應送出前都過遮蔽器', () => {
  it('200 的 JSON（WordPress 回來的分類名稱含密碼）被遮蔽，Content-Length 正確', async () => {
    mock = await startMockWordPress(() => ({
      body: [{ id: 1, name: `外掛回顯 ${PASSWORD_BARE}`, slug: 'x', parent: 0, count: 0 }],
      headers: { 'X-WP-TotalPages': '1' },
    }));
    const instance = await build({
      wordpressUrl: mock.url,
      client: new WordPressClient({ baseUrl: mock.url, username: 'tester', appPassword: PASSWORD_SPACED, sleepImpl: async () => {} }),
    });
    const res = await instance.inject({ method: 'GET', url: '/api/wordpress/terms?taxonomy=read-think-tag', headers });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain(PASSWORD_BARE);
    expect(res.json().terms[0].name).toBe('外掛回顯 [REDACTED]');
    expect(Number(res.headers['content-length'])).toBe(Buffer.byteLength(res.body));
  });

  it('預覽 HTML 與 job 詳情也被遮蔽（密碼是內容存進去之後才設定的）', async () => {
    const instance = await build();
    const created = await instance.inject({
      method: 'POST',
      url: '/api/jobs',
      headers,
      payload: { targetKey: 'diary', sourceText: `舊稿裡有 ${PASSWORD_BARE} 這串`, title: '20260828' },
    });
    expect(created.statusCode).toBe(201);
    const uuid = created.json().job.uuid as string;
    instance.ctx.secrets.add([PASSWORD_BARE]);

    const preview = await instance.inject({ method: 'GET', url: `/api/jobs/${uuid}/preview`, headers });
    expect(preview.statusCode).toBe(200);
    expect(preview.headers['content-type']).toContain('text/html');
    expect(preview.body).toContain('[REDACTED]');
    expect(preview.body).not.toContain(PASSWORD_BARE);
    expect(Number(preview.headers['content-length'])).toBe(Buffer.byteLength(preview.body));

    const detail = await instance.inject({ method: 'GET', url: `/api/jobs/${uuid}`, headers });
    expect(detail.body).not.toContain(PASSWORD_BARE);
    expect(() => detail.json()).not.toThrow();
  });

  it('二進位回應（圖片）原封不動', async () => {
    const bytes = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]), Buffer.from(PASSWORD_BARE)]);
    const instance = await build({
      wordpressUrl: 'https://example.test',
      beforeReady: (i) => {
        i.get('/api/__test/binary', async (_request, reply) => reply.type('image/png').send(bytes));
      },
    });
    const res = await instance.inject({ method: 'GET', url: '/api/__test/binary', headers });
    expect(res.statusCode).toBe(200);
    expect(Buffer.compare(res.rawPayload, bytes)).toBe(0);
  });
});

describe('#10 跨站（cross-site／same-site）的 /api 請求一律擋，GET 也擋', () => {
  function withModels(): { agents: AgentRegistry; fake: FakeAdapter } {
    const fake = new FakeAdapter('google', 'Google', { models: [{ id: 'm', displayName: 'M' }] });
    return { agents: new AgentRegistry({ adapters: [fake] }), fake };
  }

  it.each(['cross-site', 'same-site'])('GET /api/agents/:id/models 帶 Sec-Fetch-Site: %s → 403，adapter 沒被叫', async (site) => {
    const { agents, fake } = withModels();
    const instance = await build({ agents });
    const res = await instance.inject({
      method: 'GET',
      url: '/api/agents/google/models',
      headers: { ...headers, 'sec-fetch-site': site },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('CROSS_ORIGIN_BLOCKED');
    expect(fake.listModelsCount).toBe(0);
  });

  it.each([
    '/%61pi/agents/google/models',
    '/%61%70%69/agents/google/models',
    '/api%2Fagents/google/models',
    '/%61pi/no-such-route',
  ])('編碼過的路徑 %s 帶 cross-site 也擋（不能靠 URL 編碼繞過），adapter 沒被叫', async (url) => {
    const { agents, fake } = withModels();
    const instance = await build({ agents });
    const res = await instance.inject({ method: 'GET', url, headers: { ...headers, 'sec-fetch-site': 'cross-site' } });
    expect(res.statusCode).toBe(403);
    expect(fake.listModelsCount).toBe(0);
  });

  it('HEAD 也擋', async () => {
    const instance = await build();
    const res = await instance.inject({ method: 'HEAD', url: '/api/health', headers: { ...headers, 'sec-fetch-site': 'cross-site' } });
    expect(res.statusCode).toBe(403);
  });

  it.each([
    ['same-origin（UI 自己、經 Vite proxy 也是）', { 'sec-fetch-site': 'same-origin', origin: 'http://127.0.0.1:5173', host: '127.0.0.1:5173' }],
    ['none（網址列直接打）', { 'sec-fetch-site': 'none' }],
    ['沒帶（curl、測試）', {}],
  ])('%s 照常', async (_name, extra) => {
    const { agents } = withModels();
    const instance = await build({ agents });
    const res = await instance.inject({ method: 'GET', url: '/api/agents/google/models', headers: { ...headers, ...extra } });
    expect(res.statusCode).toBe(200);
  });

  it('校樣 iframe（同源、Sec-Fetch-Dest: iframe）照常載入', async () => {
    const instance = await build();
    const created = await instance.inject({
      method: 'POST',
      url: '/api/jobs',
      headers,
      payload: { targetKey: 'diary', sourceText: '一段字', title: '20260828' },
    });
    const uuid = created.json().job.uuid as string;
    const res = await instance.inject({
      method: 'GET',
      url: `/api/jobs/${uuid}/preview`,
      headers: { host: '127.0.0.1:5173', 'sec-fetch-site': 'same-origin', 'sec-fetch-dest': 'iframe', 'sec-fetch-mode': 'navigate' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('/api 以外的路徑不受這條影響（外站連結點進首頁）', async () => {
    const instance = await build();
    const res = await instance.inject({ method: 'GET', url: '/', headers: { ...headers, 'sec-fetch-site': 'cross-site' } });
    expect(res.statusCode).not.toBe(403);
  });
});

describe('#10 模型列表 30 秒快取', () => {
  it('30 秒內只叫一次 adapter，過了再叫；同時兩個請求也只叫一次', async () => {
    let now = 1_000_000;
    const fake = new FakeAdapter('google', 'Google', { models: [{ id: 'm', displayName: 'M' }] });
    const registry = new AgentRegistry({ adapters: [fake], now: () => now });
    await Promise.all([registry.listModels('google'), registry.listModels('google')]);
    expect(fake.listModelsCount).toBe(1);
    now += 29_000;
    expect(await registry.listModels('google')).toEqual([{ id: 'm', displayName: 'M' }]);
    expect(fake.listModelsCount).toBe(1);
    now += 2_000;
    await registry.listModels('google');
    expect(fake.listModelsCount).toBe(2);
  });
});

describe('#10 重新偵測（POST /api/setup/agents）清掉模型快取', () => {
  it('detectAll({ refresh: true }) 之後再列模型會重跑', async () => {
    const fake = new FakeAdapter('google', 'Google', { models: [{ id: 'm', displayName: 'M' }] });
    const registry = new AgentRegistry({ adapters: [fake], now: () => 1 });
    await registry.listModels('google');
    await registry.detectAll({ refresh: true });
    await registry.listModels('google');
    expect(fake.listModelsCount).toBe(2);
  });
});

describe('#4 啟動設定：http 只准 loopback', () => {
  const base = { WORDPRESS_USERNAME: 'tester', WORDPRESS_APP_PASSWORD: PASSWORD_SPACED };

  it.each(['http://example.invalid', 'http://192.168.1.5', 'http://localhost.evil.com', 'http://10.0.0.1:8080/wp'])(
    '%s → 啟動設定錯誤，訊息不含密碼',
    (url) => {
      let caught: unknown;
      try {
        loadConfig({ ...base, WORDPRESS_URL: url });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(ConfigError);
      expect((caught as Error).message).toContain('https');
      expect((caught as Error).message).not.toContain(PASSWORD_BARE);
    },
  );

  it.each(['http://localhost:8080', 'http://127.0.0.1', 'http://127.1.2.3:9000/wp', 'http://[::1]:8080', 'https://example.com'])(
    '%s 照常',
    (url) => {
      expect(loadConfig({ ...base, WORDPRESS_URL: url }).wordpress?.url).toBeTruthy();
    },
  );
});

describe('遮蔽器認得有空白與沒空白兩種樣子', () => {
  it('設定的是有空白的，沒空白的也抹掉；反過來也一樣', () => {
    expect(createSecretScrubber([PASSWORD_SPACED])(`a ${PASSWORD_BARE} b`)).toBe('a [REDACTED] b');
    expect(createSecretScrubber([PASSWORD_SPACED])(`a ${PASSWORD_SPACED} b`)).toBe('a [REDACTED] b');
  });
});
