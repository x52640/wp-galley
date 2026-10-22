import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server/app.js';
import { loadConfig } from '../src/config/env.js';
import { loadTemplateRegistry } from '../src/templates/registry.js';
import { paths } from '../src/config/paths.js';
import {
  createTargetRegistry,
  loadPublishTargets,
  PublishTargetSchema,
  type PublishTargetRegistry,
} from '../src/wordpress/targets.js';
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

async function buildWith(
  wordpress: WordPressClient | null,
  targets?: PublishTargetRegistry,
): Promise<FastifyInstance> {
  db = createTestDatabase();
  app = await buildApp({
    config: loadConfig({ APP_HOST: '127.0.0.1', APP_PORT: '3000', LOG_LEVEL: 'silent' }),
    db: db.handle,
    templates: await loadTemplateRegistry(paths.templates),
    agents: new AgentRegistry({ adapters: [] }),
    targets: targets ?? (await loadPublishTargets(join(paths.config, 'examples', 'remusplus.json'))),
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

    expect(body).toMatchObject({ configured: true, reachable: true, authenticated: true, problems: [], targetIssues: [] });
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

describe('GET /api/wordpress/terms', () => {
  const TERMS = [
    { id: 11, name: '隨筆', slug: 'essay', parent: 0, count: 3 },
    { id: 12, name: '經濟學', slug: '%E7%B6%93%E6%BF%9F%E5%AD%B8', parent: 0, count: 1 },
  ];

  it('列出指定分類法的既有項目', async () => {
    mock = await startMockWordPress(() => ({ body: TERMS, headers: { 'X-WP-TotalPages': '1' } }));
    const instance = await buildWith(
      new WordPressClient({
        baseUrl: mock.url,
        username: 'ai_publisher',
        appPassword: APP_PASSWORD,
        sleepImpl: async () => {},
      }),
    );

    const res = await instance.inject({
      method: 'GET',
      url: '/api/wordpress/terms?taxonomy=read-think-tag',
      headers,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().terms.map((term: { name: string }) => term.name)).toEqual(['隨筆', '經濟學']);
    expect(mock.requests[0]!.path).toContain('/wp-json/wp/v2/read-think-tag');
  });

  it('沒設定的分類法一律拒絕，不會變成任意 REST 代理', async () => {
    mock = await startMockWordPress(() => ({ body: [] }));
    const instance = await buildWith(
      new WordPressClient({
        baseUrl: mock.url,
        username: 'ai_publisher',
        appPassword: APP_PASSWORD,
        sleepImpl: async () => {},
      }),
    );

    for (const taxonomy of ['users', 'post', '../users/me', '']) {
      const res = await instance.inject({
        method: 'GET',
        url: `/api/wordpress/terms?taxonomy=${encodeURIComponent(taxonomy)}`,
        headers,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_FAILED');
    }
    // 一個請求都沒有送到 WordPress。
    expect(mock.requests).toHaveLength(0);
  });

  it('WordPress 沒設定時說設定問題，不是 404', async () => {
    const instance = await buildWith(null);
    const res = await instance.inject({
      method: 'GET',
      url: '/api/wordpress/terms?taxonomy=diary-category',
      headers,
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('WORDPRESS_UNAVAILABLE');
  });
});

describe('POST /api/wordpress/terms', () => {
  /** 舊設定檔可能還留著 allowCreateTerms（D-050 之前的開關）；不寫、寫 false、寫 true 都一樣能手動建立。 */
  function targetsWithCreate(legacy?: boolean): PublishTargetRegistry {
    return createTargetRegistry([
      PublishTargetSchema.parse({
        key: 'diary',
        displayName: '日•記',
        contentType: 'diary',
        postType: 'diary',
        restBase: 'diary',
        templateId: 'diary-v1',
        taxonomy: 'diary-category',
        allowCreate: true,
        allowUpdate: true,
        ...(legacy === undefined ? {} : { allowCreateTerms: legacy }),
      }),
    ]);
  }

  function createHandler() {
    return (req: { method: string }) => {
      if (req.method === 'POST') {
        return { status: 201, body: { id: 99, name: '新分類', slug: 'new', parent: 0, count: 0 } };
      }
      return { body: [{ id: 11, name: '隨筆', slug: 'essay', parent: 0, count: 3 }], headers: { 'X-WP-TotalPages': '1' } };
    };
  }

  function clientFor(url: string): WordPressClient {
    return new WordPressClient({ baseUrl: url, username: 'ai_publisher', appPassword: APP_PASSWORD, sleepImpl: async () => {} });
  }

  // D-050：手動建立不再看 allowCreateTerms，只要發布目標有分類法就能建。
  it.each([
    ['沒寫', undefined],
    ['舊檔寫 false', false],
    ['舊檔寫 true', true],
  ] as const)('設定檔 allowCreateTerms %s：照樣建得起來', async (_name, legacy) => {
    mock = await startMockWordPress(createHandler());
    const instance = await buildWith(clientFor(mock.url), targetsWithCreate(legacy));

    const res = await instance.inject({
      method: 'POST',
      url: '/api/wordpress/terms',
      headers,
      payload: { taxonomy: 'diary-category', name: '新分類' },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ id: 99, name: '新分類' });
    const posts = mock.requests.filter((request) => request.method === 'POST');
    expect(posts).toHaveLength(1);
    expect(posts[0]!.path.split('?')[0]).toBe('/wp-json/wp/v2/diary-category');
  });

  it('作者站台範例（設定檔沒有這個欄位）也建得起來', async () => {
    mock = await startMockWordPress(createHandler());
    const instance = await buildWith(clientFor(mock.url));
    const res = await instance.inject({
      method: 'POST',
      url: '/api/wordpress/terms',
      headers,
      payload: { taxonomy: 'read-think-tag', name: '新分類' },
    });
    expect(res.statusCode).toBe(201);
  });

  // 路由只給本機發布台自己的畫面：外站網頁、同機其他埠、沙箱 iframe 送來的都擋，而且一個請求都不送到 WordPress。
  it.each([
    ['外站網頁（Origin 是別的網域）', { origin: 'https://evil.example' }],
    ['同一台機器其他埠的網頁', { origin: 'http://127.0.0.1:8080' }],
    ['沙箱 iframe／file://（Origin: null）', { origin: 'null' }],
    ['瀏覽器說是跨站', { 'sec-fetch-site': 'cross-site' }],
    ['瀏覽器說是同 site 不同源', { 'sec-fetch-site': 'same-site' }],
  ])('來源防護：%s → 403，不打 WordPress', async (_name, extra) => {
    mock = await startMockWordPress(createHandler());
    const instance = await buildWith(clientFor(mock.url), targetsWithCreate());
    const res = await instance.inject({
      method: 'POST',
      url: '/api/wordpress/terms',
      headers: { ...headers, ...extra },
      payload: { taxonomy: 'diary-category', name: '新分類' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('CROSS_ORIGIN_BLOCKED');
    expect(mock.requests).toHaveLength(0);
  });

  it('非本機 Host（DNS rebinding）→ 403，不打 WordPress', async () => {
    mock = await startMockWordPress(createHandler());
    const instance = await buildWith(clientFor(mock.url), targetsWithCreate());
    const res = await instance.inject({
      method: 'POST',
      url: '/api/wordpress/terms',
      headers: { host: 'evil.example:3000' },
      payload: { taxonomy: 'diary-category', name: '新分類' },
    });
    expect(res.statusCode).toBe(403);
    expect(mock.requests).toHaveLength(0);
  });

  it('發布台自己的畫面（同源，經 Vite proxy 也是）照常', async () => {
    mock = await startMockWordPress(createHandler());
    const instance = await buildWith(clientFor(mock.url), targetsWithCreate());
    const res = await instance.inject({
      method: 'POST',
      url: '/api/wordpress/terms',
      headers: { host: '127.0.0.1:5173', origin: 'http://127.0.0.1:5173', 'sec-fetch-site': 'same-origin' },
      payload: { taxonomy: 'diary-category', name: '新分類' },
    });
    expect(res.statusCode).toBe(201);
  });

  it('沒有分類法的發布目標不能建（不給任意 REST 代理）', async () => {
    mock = await startMockWordPress(createHandler());
    const instance = await buildWith(
      clientFor(mock.url),
      createTargetRegistry([
        PublishTargetSchema.parse({
          key: 'page', displayName: '頁面', contentType: 'article', postType: 'page', restBase: 'pages',
          templateId: 'article-v1', taxonomy: null, allowCreate: true, allowUpdate: true, allowCreateTerms: true,
        }),
      ]),
    );
    const res = await instance.inject({
      method: 'POST',
      url: '/api/wordpress/terms',
      headers,
      payload: { taxonomy: 'pages', name: '新分類' },
    });
    expect(res.statusCode).toBe(400);
    expect(mock.requests).toHaveLength(0);
  });

  it('建得起來，而且同名的既有項目直接沿用（不建第二個）', async () => {
    mock = await startMockWordPress((req) => {
      if (req.method === 'POST') {
        return { status: 201, body: { id: 99, name: '新分類', slug: 'new', parent: 0, count: 0 } };
      }
      return { body: [{ id: 11, name: '隨筆', slug: 'essay', parent: 0, count: 3 }], headers: { 'X-WP-TotalPages': '1' } };
    });
    const instance = await buildWith(
      new WordPressClient({
        baseUrl: mock.url,
        username: 'ai_publisher',
        appPassword: APP_PASSWORD,
        sleepImpl: async () => {},
      }),
      targetsWithCreate(),
    );

    const created = await instance.inject({
      method: 'POST',
      url: '/api/wordpress/terms',
      headers,
      payload: { taxonomy: 'diary-category', name: '新分類' },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ id: 99, name: '新分類' });

    const existing = await instance.inject({
      method: 'POST',
      url: '/api/wordpress/terms',
      headers,
      payload: { taxonomy: 'diary-category', name: '隨筆' },
    });
    expect(existing.statusCode).toBe(200);
    expect(existing.json()).toMatchObject({ id: 11 });
    // 只有第一次真的送出建立請求。
    expect(mock.requests.filter((request) => request.method === 'POST')).toHaveLength(1);
  });

  it('未知的分類法一樣拒絕', async () => {
    mock = await startMockWordPress(() => ({ body: [] }));
    const instance = await buildWith(
      new WordPressClient({
        baseUrl: mock.url,
        username: 'ai_publisher',
        appPassword: APP_PASSWORD,
        sleepImpl: async () => {},
      }),
      targetsWithCreate(),
    );

    const res = await instance.inject({
      method: 'POST',
      url: '/api/wordpress/terms',
      headers,
      payload: { taxonomy: 'post_tag', name: '任意' },
    });
    expect(res.statusCode).toBe(400);
    expect(mock.requests).toHaveLength(0);
  });
});
