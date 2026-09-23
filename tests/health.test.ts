import { join } from 'node:path';
import { describe, expect, it, afterAll, beforeAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server/app.js';
import { loadConfig } from '../src/config/env.js';
import { createTestDatabase } from './helpers/test-db.js';
import { AgentRegistry } from '../src/agents/registry.js';
import { FakeAdapter } from './helpers/fake-adapter.js';
import { loadTemplateRegistry } from '../src/templates/registry.js';
import { paths } from '../src/config/paths.js';
import { loadPublishTargets, SITE_CONFIG_MISSING_MESSAGE } from '../src/wordpress/targets.js';

const SECRET = 'aaaa bbbb cccc dddd';
const db = createTestDatabase();
let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({
    config: loadConfig({
      APP_HOST: '127.0.0.1',
      APP_PORT: '3000',
      LOG_LEVEL: 'silent',
      WORDPRESS_URL: 'https://example.com',
      WORDPRESS_USERNAME: 'bot',
      WORDPRESS_APP_PASSWORD: SECRET,
    }),
    db: db.handle,
    templates: await loadTemplateRegistry(paths.templates),
    // 測試一律用假 adapter，不碰真實 CLI、不消耗訂閱額度。
    agents: new AgentRegistry({ adapters: [new FakeAdapter('codex', 'Codex')] }),
    targets: await loadPublishTargets(join(paths.config, 'examples', 'remusplus.json')),
  });
  // 必須在 ready() 之前註冊。
  app.get('/api/__boom', async () => {
    throw new Error(`崩潰了，密碼是 ${SECRET}`);
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  db.cleanup();
});

const localHeaders = { host: '127.0.0.1:3000' };

describe('GET /api/health', () => {
  it('回報服務狀態', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health', headers: localHeaders });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ok');
    expect(body.stage).toBe(3);
    expect(body.templates).toHaveLength(3);
    expect(body.database.ok).toBe(true);
    expect(body.database.migrations).toBeGreaterThan(0);
  });

  it('只回報 WordPress 是否已設定，絕不回傳 Application Password', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health', headers: localHeaders });
    expect(res.body).not.toContain(SECRET);
    expect(res.json().wordpress).toEqual({
      url: 'https://example.com',
      username: 'bot',
      appPasswordConfigured: true,
    });
  });
});

describe('錯誤格式', () => {
  it('未知路由回傳統一錯誤結構', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/nope', headers: localHeaders });
    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.error.code).toBe('NOT_FOUND');
    expect(typeof body.error.message).toBe('string');
    expect(typeof body.error.requestId).toBe('string');
  });

  it('內部錯誤不外洩堆疊與秘密', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/__boom', headers: localHeaders });
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain(SECRET);
    expect(res.body).not.toContain('at ');
    expect(res.json().error.code).toBe('INTERNAL_ERROR');
  });
});

describe('還沒有站台設定（本機 config/publish-targets.json 不存在）', () => {
  const emptyDb = createTestDatabase();
  let bare: FastifyInstance;

  beforeAll(async () => {
    const targets = await loadPublishTargets(join(emptyDb.dir, 'publish-targets.json'));
    expect(targets.setupRequired).toBe(SITE_CONFIG_MISSING_MESSAGE);
    bare = await buildApp({
      config: loadConfig({ APP_HOST: '127.0.0.1', APP_PORT: '3000', LOG_LEVEL: 'silent' }),
      db: emptyDb.handle,
      templates: await loadTemplateRegistry(paths.templates),
      agents: new AgentRegistry({ adapters: [new FakeAdapter('codex', 'Codex')] }),
      targets,
    });
    await bare.ready();
  });

  afterAll(async () => {
    await bare.close();
    emptyDb.cleanup();
  });

  it('伺服器照樣起得來，健康檢查正常', async () => {
    const res = await bare.inject({ method: 'GET', url: '/api/health', headers: localHeaders });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('ok');
  });

  it('發布目標清單是空的，連線診斷照樣回得來', async () => {
    const res = await bare.inject({ method: 'GET', url: '/api/wordpress', headers: localHeaders });
    expect(res.statusCode).toBe(200);
    expect(res.json().publishTargets).toEqual([]);
  });

  it('建稿被拒絕（4xx），不是 500', async () => {
    const res = await bare.inject({
      method: 'POST',
      url: '/api/jobs',
      headers: { ...localHeaders, 'content-type': 'application/json' },
      payload: { targetKey: 'post', sourceText: '內容' },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
  });
});
