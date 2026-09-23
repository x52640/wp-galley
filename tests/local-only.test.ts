import { join } from 'node:path';
import { describe, expect, it, afterAll, beforeAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server/app.js';
import { isAllowedHost, isAllowedOrigin, isAllowedWriteSource, isLoopbackAddress } from '../src/server/plugins/local-only.js';
import { loadConfig } from '../src/config/env.js';
import { createTestDatabase } from './helpers/test-db.js';
import { AgentRegistry } from '../src/agents/registry.js';
import { FakeAdapter } from './helpers/fake-adapter.js';
import { loadTemplateRegistry } from '../src/templates/registry.js';
import { paths } from '../src/config/paths.js';
import { loadPublishTargets } from '../src/wordpress/targets.js';

let app: FastifyInstance;
const db = createTestDatabase();

beforeAll(async () => {
  app = await buildApp({
    config: loadConfig({ APP_HOST: '127.0.0.1', APP_PORT: '3000', LOG_LEVEL: 'silent' }),
    db: db.handle,
    templates: await loadTemplateRegistry(paths.templates),
    // 測試一律用假 adapter，不碰真實 CLI、不消耗訂閱額度。
    agents: new AgentRegistry({ adapters: [new FakeAdapter('codex', 'Codex')] }),
    targets: await loadPublishTargets(join(paths.config, 'examples', 'remusplus.json')),
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  db.cleanup();
});

describe('本機限定守門', () => {
  it('允許 127.0.0.1 的 Host', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health', headers: { host: '127.0.0.1:3000' } });
    expect(res.statusCode).toBe(200);
  });

  it('允許 localhost 的 Host', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health', headers: { host: 'localhost:3000' } });
    expect(res.statusCode).toBe(200);
  });

  it('允許 [::1] 的 Host', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health', headers: { host: '[::1]:3000' } });
    expect(res.statusCode).toBe(200);
  });

  it.each(['evil.com', 'publisher.local', '192.168.1.10:3000', 'localhost.evil.com'])(
    '擋掉非 loopback 的 Host（DNS rebinding 防護）：%s',
    async (host) => {
      const res = await app.inject({ method: 'GET', url: '/api/health', headers: { host } });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('NON_LOCAL_HOST');
    },
  );

  it('擋掉跨站 Origin', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { host: '127.0.0.1:3000', origin: 'https://evil.com' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('CROSS_ORIGIN_BLOCKED');
  });

  it('允許本機 Vite 開發伺服器的 Origin', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:5173' },
    });
    expect(res.statusCode).toBe(200);
  });
});

// app.inject() 會自動補上 Host，無法模擬「沒有 Host」；這些邊界直接測純函式。
describe('守門判斷函式', () => {
  it('沒有 Host 就不通過', () => {
    expect(isAllowedHost(undefined)).toBe(false);
    expect(isAllowedHost('')).toBe(false);
  });

  it('只認 loopback 名稱', () => {
    expect(isAllowedHost('127.0.0.1:3000')).toBe(true);
    expect(isAllowedHost('[::1]:3000')).toBe(true);
    expect(isAllowedHost('localhost')).toBe(true);
    expect(isAllowedHost('localhost.evil.com')).toBe(false);
    expect(isAllowedHost('0.0.0.0:3000')).toBe(false);
  });

  it('沒有 Origin 視為同源；不合法的 Origin 不通過', () => {
    expect(isAllowedOrigin(undefined)).toBe(true);
    expect(isAllowedOrigin('null')).toBe(true);
    expect(isAllowedOrigin('not a url')).toBe(false);
    expect(isAllowedOrigin('http://localhost:5173')).toBe(true);
    expect(isAllowedOrigin('https://evil.com')).toBe(false);
  });

  it('辨識 IPv4-mapped IPv6 的 loopback', () => {
    expect(isLoopbackAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isLoopbackAddress('::1')).toBe(true);
    expect(isLoopbackAddress('192.168.1.5')).toBe(false);
    expect(isLoopbackAddress(undefined)).toBe(false);
  });
});

/**
 * 會改東西的請求（P8-T002）：沙箱 iframe、file:// 頁面送的是 `Origin: null`，原本會被放行；
 * 瀏覽器附的 Sec-Fetch-Site 說不是同源也要擋。GET 照舊（校樣 iframe 之類不受影響）。
 */
describe('修改請求的來源', () => {
  it.each([
    ['Origin: null', { origin: 'null' }],
    ['Sec-Fetch-Site: cross-site', { 'sec-fetch-site': 'cross-site' }],
    ['Sec-Fetch-Site: same-site（其他本機埠）', { origin: 'http://localhost:8080', 'sec-fetch-site': 'same-site' }],
  ])('POST 擋掉 %s', async (_name, extra) => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/jobs/does-not-exist/render',
      headers: { host: '127.0.0.1:3000', ...extra },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('CROSS_ORIGIN_BLOCKED');
  });

  it('DELETE 也擋', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/jobs/does-not-exist',
      headers: { host: '127.0.0.1:3000', origin: 'null' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('GET 不受影響', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { host: '127.0.0.1:3000', origin: 'null', 'sec-fetch-site': 'cross-site' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('發布台自己的畫面（same-origin）與非瀏覽器（沒有這兩個標頭）照常', () => {
    expect(isAllowedWriteSource({ 'sec-fetch-site': 'same-origin', origin: 'http://127.0.0.1:5173', host: '127.0.0.1:5173' })).toBe(true);
    expect(isAllowedWriteSource({ origin: 'http://127.0.0.1:3000', host: '127.0.0.1:3000' })).toBe(true);
    expect(isAllowedWriteSource({ origin: 'http://[::1]:3000', host: '[::1]:3000' })).toBe(true);
    expect(isAllowedWriteSource({ 'sec-fetch-site': 'none' })).toBe(true);
    expect(isAllowedWriteSource({})).toBe(true);
    expect(isAllowedWriteSource({ origin: 'null' })).toBe(false);
  });

  it('Origin 要跟 Host 同源：其他本機埠、localhost 對 127.0.0.1、https 都不行', () => {
    expect(isAllowedWriteSource({ origin: 'http://127.0.0.1:8080', host: '127.0.0.1:3000' })).toBe(false);
    expect(isAllowedWriteSource({ origin: 'http://localhost:3000', host: '127.0.0.1:3000' })).toBe(false);
    expect(isAllowedWriteSource({ origin: 'https://127.0.0.1:3000', host: '127.0.0.1:3000' })).toBe(false);
    expect(isAllowedWriteSource({ origin: 'not a url', host: '127.0.0.1:3000' })).toBe(false);
  });

  it('POST 從其他本機埠來的擋掉，GET 照舊', async () => {
    const post = await app.inject({
      method: 'POST',
      url: '/api/jobs/does-not-exist/render',
      headers: { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:8080' },
    });
    expect(post.statusCode).toBe(403);
    const get = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:8080' },
    });
    expect(get.statusCode).toBe(200);
  });
});
