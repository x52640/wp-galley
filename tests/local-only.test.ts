import { join } from 'node:path';
import { describe, expect, it, afterAll, beforeAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server/app.js';
import { isAllowedHost, isAllowedOrigin, isLoopbackAddress } from '../src/server/plugins/local-only.js';
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
    targets: await loadPublishTargets(join(paths.config, 'publish-targets.json')),
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
