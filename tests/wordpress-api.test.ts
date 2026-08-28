import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server/app.js';
import { loadConfig } from '../src/config/env.js';
import { loadTemplateRegistry } from '../src/templates/registry.js';
import { paths } from '../src/config/paths.js';
import { createTestDatabase } from './helpers/test-db.js';
import { AgentRegistry } from '../src/agents/registry.js';
import { WordPressClient } from '../src/wordpress/client.js';
import { startMockWordPress, type MockWordPress } from './helpers/mock-wordpress.js';

const APP_PASSWORD = 'abcd EFGH 1234 ijkl MNOP 5678';
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

async function buildWith(wordpress: WordPressClient | null): Promise<FastifyInstance> {
  db = createTestDatabase();
  app = await buildApp({
    config: loadConfig({ APP_HOST: '127.0.0.1', APP_PORT: '3000', LOG_LEVEL: 'silent' }),
    db: db.handle,
    templates: await loadTemplateRegistry(paths.templates),
    agents: new AgentRegistry({ adapters: [] }),
    wordpress,
  });
  await app.ready();
  return app;
}

describe('GET /api/wordpress', () => {
  it('沒設定時回報 configured: false 並指向 .env', async () => {
    const instance = await buildWith(null);
    const res = await instance.inject({ method: 'GET', url: '/api/wordpress', headers });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.configured).toBe(false);
    expect(body.problems[0]).toContain('.env');
  });

  it('連線正常時回報身分與內容類型', async () => {
    mock = await startMockWordPress((req) => {
      if (req.path.includes('/users/me')) {
        return { body: { id: 7, name: 'AI Romulus', slug: 'ai_publisher', roles: ['editor'] } };
      }
      if (req.path.includes('/types')) {
        return {
          body: {
            'read-think': {
              slug: 'read-think',
              name: '思想•讀•鑰',
              rest_base: 'read-think',
              taxonomies: ['read-think-tag'],
              supports: { thumbnail: true },
            },
            diary: {
              slug: 'diary',
              name: '日•記',
              rest_base: 'diary',
              taxonomies: ['diary-category'],
              supports: { thumbnail: true },
            },
          },
        };
      }
      return {
        body: {
          'read-think-tag': {
            slug: 'read-think-tag',
            name: '標籤',
            rest_base: 'read-think-tag',
            types: ['read-think'],
            hierarchical: true,
          },
          'diary-category': {
            slug: 'diary-category',
            name: '日記分類',
            rest_base: 'diary-category',
            types: ['diary'],
            hierarchical: true,
          },
        },
      };
    });

    const instance = await buildWith(
      new WordPressClient({
        baseUrl: mock.url,
        username: 'ai_publisher',
        appPassword: APP_PASSWORD,
        sleepImpl: async () => {},
      }),
    );
    const res = await instance.inject({ method: 'GET', url: '/api/wordpress', headers });
    const body = res.json();

    expect(body).toMatchObject({ configured: true, reachable: true, authenticated: true, problems: [] });
    expect(body.identity.user.slug).toBe('ai_publisher');
    expect(body.targets.map((t: { postType: string }) => t.postType)).toEqual(['read-think', 'diary']);
  });

  it('回應絕不含 Application Password', async () => {
    // 就算 WordPress 把密碼回顯在錯誤訊息裡也一樣。
    mock = await startMockWordPress(() => ({
      status: 401,
      body: { code: 'incorrect_password', message: `密碼 ${APP_PASSWORD} 無效`, data: { status: 401 } },
    }));

    const instance = await buildWith(
      new WordPressClient({
        baseUrl: mock.url,
        username: 'ai_publisher',
        appPassword: APP_PASSWORD,
        sleepImpl: async () => {},
      }),
    );
    const res = await instance.inject({ method: 'GET', url: '/api/wordpress', headers });

    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain(APP_PASSWORD);
    expect(res.json().authenticated).toBe(false);
  });

  it('守門仍然生效：非 loopback 的 Host 會被擋掉', async () => {
    const instance = await buildWith(null);
    const res = await instance.inject({
      method: 'GET',
      url: '/api/wordpress',
      headers: { host: 'evil.example.com' },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });
});
