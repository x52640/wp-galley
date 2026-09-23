import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { approveJob, createCoreFixture, type CoreFixture } from './helpers/core-fixture.js';
import type { MockResponse, RecordedRequest } from './helpers/mock-wordpress.js';
import { startMockWordPress, type MockWordPress } from './helpers/mock-wordpress.js';
import {
  createTargetRegistry,
  loadPublishTargets,
  PublishTargetSchema,
  SITE_CONFIG_MISSING_MESSAGE,
  startupNotice,
  taxonomyRestBaseOf,
} from '../src/wordpress/targets.js';
import { paths } from '../src/config/paths.js';
import { buildApp } from '../src/server/app.js';
import { loadConfig } from '../src/config/env.js';
import { loadTemplateRegistry } from '../src/templates/registry.js';
import { AgentRegistry } from '../src/agents/registry.js';
import { WordPressClient } from '../src/wordpress/client.js';
import { createTestDatabase } from './helpers/test-db.js';
import { RemoteChangedError } from '../src/wordpress/posts.js';

/**
 * 通用站台（D-016，P8-T001）：發到核心的 post／page。
 *
 * 一律連本機假站台，不碰真實 WordPress。假站台照核心的真實形狀回：
 * 分類法 slug 是 `category`，但端點與文章欄位都叫 `categories`。
 */

const exampleTargets = (): Promise<ReturnType<typeof createTargetRegistry>> =>
  loadPublishTargets(join(paths.config, 'publish-targets.example.json'));

interface GenericSite {
  handler: (request: RecordedRequest) => MockResponse;
  payloads: { path: string; body: Record<string, unknown> }[];
  posts: Map<number, Record<string, unknown>>;
}

function genericSite(): GenericSite {
  let nextId = 700;
  const posts = new Map<number, Record<string, unknown>>();
  posts.set(777, {
    id: 777,
    status: 'draft',
    link: 'https://generic.test/?p=777',
    slug: 'fixed',
    title: { raw: '固定文章', rendered: '固定文章' },
    content: { raw: '<p>遠端</p>', rendered: '<p>遠端</p>' },
    featured_media: 0,
    date_gmt: '2026-09-23T00:00:00',
    modified_gmt: '2026-09-23T00:00:00',
    categories: [21],
    tags: [],
  });
  const payloads: GenericSite['payloads'] = [];

  const handler = (request: RecordedRequest): MockResponse => {
    const path = request.path.split('?')[0] ?? '';

    if (path === '/wp-json/wp/v2/categories') {
      return {
        body: [
          { id: 1, name: '未分類', slug: 'uncategorized', parent: 0, count: 3 },
          { id: 21, name: '教學', slug: 'tutorial', parent: 0, count: 5 },
        ],
        headers: { 'X-WP-TotalPages': '1' },
      };
    }

    const collection = /^\/wp-json\/wp\/v2\/(posts|pages)$/.exec(path);
    if (collection && request.method === 'POST') {
      const body = JSON.parse(request.body || '{}') as Record<string, unknown>;
      payloads.push({ path, body });
      nextId += 1;
      const post = {
        id: nextId,
        status: 'draft',
        link: `https://generic.test/?p=${nextId}`,
        slug: String(body['slug'] ?? `post-${nextId}`),
        title: { raw: String(body['title'] ?? ''), rendered: String(body['title'] ?? '') },
        content: { raw: String(body['content'] ?? ''), rendered: String(body['content'] ?? '') },
        featured_media: Number(body['featured_media'] ?? 0),
        date_gmt: '2026-09-23T00:00:00',
        modified_gmt: '2026-09-23T00:00:00',
        // 核心的欄位名稱是 REST 名稱，不是分類法 slug。
        ...(collection[1] === 'posts' ? { categories: body['categories'] ?? [1], tags: [] } : {}),
      };
      posts.set(nextId, post);
      return { status: 201, body: post };
    }

    const single = /^\/wp-json\/wp\/v2\/(?:posts|pages)\/(\d+)$/.exec(path);
    if (single) {
      const id = Number(single[1]);
      const existing = posts.get(id);
      if (!existing) return { status: 404, body: { code: 'rest_post_invalid_id', message: 'no', data: { status: 404 } } };
      if (request.method === 'POST') {
        const body = JSON.parse(request.body || '{}') as Record<string, unknown>;
        payloads.push({ path, body });
        const merged = {
          ...existing,
          ...(body['status'] === undefined ? {} : { status: String(body['status']) }),
          ...(body['content'] === undefined
            ? {}
            : { content: { raw: String(body['content']), rendered: String(body['content']) } }),
          ...(body['categories'] === undefined ? {} : { categories: body['categories'] }),
        };
        posts.set(id, merged);
        return { body: merged };
      }
      return { body: existing };
    }

    return { status: 404, body: { code: 'rest_no_route', message: `找不到端點 ${path}`, data: { status: 404 } } };
  };

  return { handler, payloads, posts };
}

const ARTICLE_BODY =
  '<p>第一段。</p>' +
  '<h2>大章節</h2>' +
  '<figure class="wp-block-image size-large"><img src="https://generic.test/a.jpg" alt="示意" /></figure>' +
  '<ul><li>一</li></ul>';

let fixture: CoreFixture | null = null;
afterEach(async () => {
  await fixture?.cleanup();
  fixture = null;
});

describe('taxonomyRestBase', () => {
  it('不寫就等於 taxonomy（作者站台不用改）；沒有分類法就是 null', async () => {
    const remus = await loadPublishTargets(join(paths.config, 'examples', 'remusplus.json'));
    expect(taxonomyRestBaseOf(remus.get('read-think'))).toBe('read-think-tag');
    expect(taxonomyRestBaseOf(remus.get('diary'))).toBe('diary-category');

    const generic = await exampleTargets();
    expect(generic.get('post').taxonomy).toBe('category');
    expect(taxonomyRestBaseOf(generic.get('post'))).toBe('categories');
    expect(taxonomyRestBaseOf(generic.get('page'))).toBeNull();
  });

  it('沒有 taxonomy 卻寫 taxonomyRestBase、或格式不對，都擋', () => {
    const base = { key: 'x', displayName: 'X', contentType: 'article', postType: 'post', restBase: 'posts', templateId: 'article-v1' };
    expect(() => PublishTargetSchema.parse({ ...base, taxonomyRestBase: 'categories' })).toThrow(/taxonomyRestBase/);
    expect(() =>
      PublishTargetSchema.parse({ ...base, taxonomy: 'category', taxonomyRestBase: '../users/me' }),
    ).toThrow();
  });
});

describe('發到通用站的文章（post）', () => {
  it('正文是核心預設區塊：沒有 fontSize、沒有字級 class、圖片不自動置中；分類走 categories', async () => {
    const site = genericSite();
    fixture = await createCoreFixture({ targets: await exampleTargets(), handler: site.handler });
    const { core } = fixture;

    const uuid = core.createJob({
      targetKey: 'post',
      sourceText: '',
      templateData: { title: '通用文章', body: ARTICLE_BODY, category: '教學' },
    }).uuid;
    approveJob(core, uuid);
    await core.publish(uuid, { status: 'draft' });

    const created = site.payloads.find((entry) => entry.path === '/wp-json/wp/v2/posts');
    expect(created).toBeDefined();
    const content = String(created!.body['content']);
    expect(content).toBe(
      '<!-- wp:paragraph -->\n<p>第一段。</p>\n<!-- /wp:paragraph -->\n\n' +
        '<!-- wp:heading -->\n<h2 class="wp-block-heading">大章節</h2>\n<!-- /wp:heading -->\n\n' +
        '<!-- wp:image {"sizeSlug":"large","linkDestination":"none"} -->\n' +
        '<figure class="wp-block-image size-large"><img src="https://generic.test/a.jpg" alt="示意"/></figure>\n' +
        '<!-- /wp:image -->\n\n' +
        '<!-- wp:list -->\n<ul class="wp-block-list"><!-- wp:list-item -->\n<li>一</li>\n<!-- /wp:list-item --></ul>\n<!-- /wp:list -->',
    );
    expect(content).not.toContain('fontSize');
    expect(content).not.toContain('has-medium-font-size');
    expect(content).not.toContain('aligncenter');

    // 分類：用 REST 名稱 categories 查、用 categories 欄位寫；從來沒打過 /wp/v2/category。
    expect(created!.body['categories']).toEqual([21]);
    expect(created!.body).not.toHaveProperty('category');
    expect(fixture.requests.some((r) => r.path.startsWith('/wp-json/wp/v2/category?') || r.path === '/wp-json/wp/v2/category')).toBe(false);

    // 存下來的遠端快照讀的也是 categories，下一次更新的衝突比對才對得上。
    const row = fixture.db.handle.prepare('SELECT remote_snapshot_json FROM wordpress_objects').get() as {
      remote_snapshot_json: string;
    };
    expect(JSON.parse(row.remote_snapshot_json).terms).toEqual([21]);
  });

  it('更新既有文章：衝突比對讀的是 categories——遠端改了分類就中止', async () => {
    const site = genericSite();
    const fixedPost = PublishTargetSchema.parse({
      key: 'fixed-post',
      displayName: '固定文章',
      contentType: 'article',
      postType: 'post',
      restBase: 'posts',
      templateId: 'article-v1',
      taxonomy: 'category',
      taxonomyRestBase: 'categories',
      fixedObjectId: 777,
      allowUpdate: true,
    });
    fixture = await createCoreFixture({ targets: createTargetRegistry([fixedPost]), handler: site.handler });
    const { core } = fixture;
    const uuid = core.createJob({
      targetKey: 'fixed-post',
      sourceText: '',
      templateData: { title: '固定文章', body: '<p>新內容。</p>', category: '教學' },
    }).uuid;
    approveJob(core, uuid);

    // 第一次：存下比對基準（刻意擋一次），基準裡的分類要讀到 [21]。
    await expect(core.publish(uuid, { status: 'draft' })).rejects.toThrow(/比對基準/);
    const row = fixture.db.handle.prepare('SELECT remote_snapshot_json FROM wordpress_objects').get() as {
      remote_snapshot_json: string;
    };
    expect(JSON.parse(row.remote_snapshot_json).terms).toEqual([21]);

    // 有人在後台把分類改了：讀錯欄位的話兩邊都是 []，就會無聲覆蓋掉。
    site.posts.set(777, { ...site.posts.get(777)!, categories: [1] });
    await expect(core.publish(uuid, { status: 'draft' })).rejects.toThrow(RemoteChangedError);
    expect(site.payloads).toHaveLength(0);
  });
});

describe('發到通用站的頁面（page）', () => {
  it('打 /wp/v2/pages，不送任何分類', async () => {
    const site = genericSite();
    fixture = await createCoreFixture({ targets: await exampleTargets(), handler: site.handler });
    const { core } = fixture;

    const uuid = core.createJob({
      targetKey: 'page',
      sourceText: '',
      templateData: { title: '關於', body: '<p>關於我們。</p>' },
    }).uuid;
    approveJob(core, uuid);
    await core.publish(uuid, { status: 'draft' });

    expect(site.payloads).toHaveLength(1);
    expect(site.payloads[0]!.path).toBe('/wp-json/wp/v2/pages');
    expect(site.payloads[0]!.body['content']).toBe('<!-- wp:paragraph -->\n<p>關於我們。</p>\n<!-- /wp:paragraph -->');
    expect(site.payloads[0]!.body).not.toHaveProperty('categories');
    expect(site.payloads[0]!.body).not.toHaveProperty('category');
    expect(fixture.requests.some((r) => r.path.includes('categor'))).toBe(false);
  });
});

describe('作者站台照舊', () => {
  it('日記發出去仍是 medium 段落（blockDefaults 不寫＝作者站台慣例）', async () => {
    fixture = await createCoreFixture();
    const { core } = fixture;
    const uuid = core.createJob({
      targetKey: 'diary',
      sourceText: '',
      templateData: { title: '20260923', body: '<p class="wp-block-paragraph">今天。</p>' },
    }).uuid;
    approveJob(core, uuid);
    await core.publish(uuid, { status: 'draft' });

    const request = fixture.requests.find((r) => r.method === 'POST' && r.path === '/wp-json/wp/v2/diary');
    expect(JSON.parse(request!.body).content).toBe(
      '<!-- wp:paragraph {"fontSize":"medium"} -->\n<p class="has-medium-font-size">今天。</p>\n<!-- /wp:paragraph -->',
    );
  });
});

describe('還沒有站台設定', () => {
  const missing = () => loadPublishTargets('/nope/publish-targets.json');

  it('建稿直接講下一步該做什麼', async () => {
    fixture = await createCoreFixture({ targets: await missing(), wordpress: 'none' });
    expect(() => fixture!.core.createJob({ targetKey: 'post', sourceText: '內容' })).toThrow(
      SITE_CONFIG_MISSING_MESSAGE,
    );
  });

  it('啟動訊息：沒設定時有一句，有設定時沒有', async () => {
    expect(startupNotice(await missing())).toContain(SITE_CONFIG_MISSING_MESSAGE);
    expect(startupNotice(await exampleTargets())).toBeNull();
  });

  it('設定檔在但 key 打錯，訊息照舊列出可用的 key', async () => {
    fixture = await createCoreFixture({ targets: await exampleTargets(), wordpress: 'none' });
    expect(() => fixture!.core.createJob({ targetKey: 'diary', sourceText: '內容' })).toThrow(/可用的是 post、page/);
  });
});

describe('連線診斷看設定檔裡的 target', () => {
  let app: FastifyInstance | null = null;
  let mock: MockWordPress | null = null;
  let db: ReturnType<typeof createTestDatabase> | null = null;

  afterEach(async () => {
    await app?.close();
    await mock?.close();
    db?.cleanup();
    app = null;
    mock = null;
    db = null;
  });

  function coreSite(request: RecordedRequest): MockResponse {
    const path = request.path.split('?')[0] ?? '';
    if (path === '/wp-json/wp/v2/users/me') {
      return { body: { id: 3, name: 'Bot', slug: 'bot', roles: ['editor'], capabilities: {} } };
    }
    if (path === '/wp-json/wp/v2/types') {
      return {
        body: {
          post: { slug: 'post', name: '文章', rest_base: 'posts', taxonomies: ['category', 'post_tag'], supports: { thumbnail: true } },
          page: { slug: 'page', name: '頁面', rest_base: 'pages', taxonomies: [], supports: { thumbnail: true } },
        },
      };
    }
    if (path === '/wp-json/wp/v2/taxonomies') {
      return {
        body: {
          category: { slug: 'category', name: '分類', rest_base: 'categories', types: ['post'], hierarchical: true },
          post_tag: { slug: 'post_tag', name: '標籤', rest_base: 'tags', types: ['post'], hierarchical: false },
        },
      };
    }
    if (path === '/wp-json/wp/v2/categories') {
      return { body: [{ id: 21, name: '教學', slug: 'tutorial', parent: 0, count: 5 }], headers: { 'X-WP-TotalPages': '1' } };
    }
    return { status: 404, body: { code: 'rest_no_route', message: path, data: { status: 404 } } };
  }

  async function build(targets?: ReturnType<typeof createTargetRegistry>): Promise<FastifyInstance> {
    mock = await startMockWordPress(coreSite);
    db = createTestDatabase();
    app = await buildApp({
      config: loadConfig({ APP_HOST: '127.0.0.1', APP_PORT: '3000', LOG_LEVEL: 'silent' }),
      db: db.handle,
      templates: await loadTemplateRegistry(paths.templates),
      agents: new AgentRegistry({ adapters: [] }),
      targets: targets ?? (await exampleTargets()),
      wordpress: new WordPressClient({
        baseUrl: mock.url,
        username: 'bot',
        appPassword: 'abcd EFGH 1234 ijkl MNOP 5678',
        sleepImpl: async () => {},
      }),
    });
    await app.ready();
    return app;
  }

  it('通用設定只檢查 post 與 page，不會報找不到 read-think／diary', async () => {
    const instance = await build();
    const res = await instance.inject({ method: 'GET', url: '/api/wordpress', headers: { host: '127.0.0.1:3000' } });
    const body = res.json();
    expect(body.problems).toEqual([]);
    expect(body.targetIssues).toEqual([]);
    expect(body.targets.map((t: { postType: string }) => t.postType)).toEqual(['post', 'page']);
  });

  it('post 掛 category 卻沒寫 taxonomyRestBase：診斷直接講要加什麼', async () => {
    const post = PublishTargetSchema.parse({
      key: 'post', displayName: '文章', contentType: 'article', postType: 'post', restBase: 'posts',
      templateId: 'article-v1', taxonomy: 'category',
    });
    const instance = await build(createTargetRegistry([post]));
    const res = await instance.inject({ method: 'GET', url: '/api/wordpress', headers: { host: '127.0.0.1:3000' } });
    expect(res.json().targetIssues).toEqual([
      {
        targetKey: 'post',
        message: '分類法 category 的 REST 名稱是 categories，請在設定檔加上 taxonomyRestBase: "categories"',
      },
    ]);
  });

  it('分類項目 API：畫面用 slug category 問，後端打 /wp/v2/categories', async () => {
    const instance = await build();
    const res = await instance.inject({
      method: 'GET',
      url: '/api/wordpress/terms?taxonomy=category',
      headers: { host: '127.0.0.1:3000' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().terms.map((term: { name: string }) => term.name)).toEqual(['教學']);
    expect(mock!.requests.at(-1)!.path).toContain('/wp-json/wp/v2/categories');
  });
});
