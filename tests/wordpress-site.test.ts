import { afterEach, describe, expect, it } from 'vitest';
import { WordPressClient } from '../src/wordpress/client.js';
import { probeSite, unconfiguredProbe } from '../src/wordpress/site.js';
import { startMockWordPress, wpError, type MockResponse, type MockWordPress } from './helpers/mock-wordpress.js';

/**
 * 這裡的假回應是照 www.remusplus.com 的真實 REST 回應寫的，
 * 欄位名稱與形狀都一樣（/wp/v2/types 回的是以 slug 為鍵的物件，不是陣列）。
 */

let mock: MockWordPress | null = null;

afterEach(async () => {
  await mock?.close();
  mock = null;
});

const ME = { id: 7, name: 'AI Romulus', slug: 'ai_publisher', roles: ['editor'] };

const TYPES = {
  post: { slug: 'post', name: '文章', rest_base: 'posts', taxonomies: ['category'], supports: { title: true } },
  'read-think': {
    slug: 'read-think',
    name: '思想•讀•鑰',
    rest_base: 'read-think',
    taxonomies: ['read-think-tag'],
    supports: { title: true, editor: true, thumbnail: true },
  },
  diary: {
    slug: 'diary',
    name: '日•記',
    rest_base: 'diary',
    taxonomies: ['diary-category'],
    supports: { title: true, editor: true, thumbnail: true },
  },
};

const TAXONOMIES = {
  category: { slug: 'category', name: '分類', rest_base: 'categories', types: ['post'], hierarchical: true },
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
};

function route(path: string, overrides: Record<string, MockResponse> = {}): MockResponse {
  for (const [fragment, response] of Object.entries(overrides)) {
    if (path.includes(fragment)) return response;
  }
  if (path.includes('/users/me')) return { body: ME };
  if (path.includes('/types')) return { body: TYPES };
  if (path.includes('/taxonomies')) return { body: TAXONOMIES };
  return { status: 404, body: { code: 'rest_no_route', message: 'No route', data: { status: 404 } } };
}

function clientFor(server: MockWordPress): WordPressClient {
  return new WordPressClient({
    baseUrl: server.url,
    username: 'ai_publisher',
    appPassword: 'abcd EFGH 1234 ijkl MNOP 5678',
    sleepImpl: async () => {},
  });
}

describe('站台探查', () => {
  it('一切正常時回報身分、內容類型與零問題', async () => {
    mock = await startMockWordPress((req) => route(req.path));
    const probe = await probeSite(clientFor(mock), ['read-think', 'diary']);

    expect(probe).toMatchObject({ configured: true, reachable: true, authenticated: true, problems: [] });
    expect(probe.identity?.user.slug).toBe('ai_publisher');
    expect(probe.identity?.roles).toEqual(['editor']);
    expect(probe.targets).toEqual([
      {
        postType: 'read-think',
        present: true,
        restBase: 'read-think',
        taxonomies: ['read-think-tag'],
        supportsThumbnail: true,
      },
      {
        postType: 'diary',
        present: true,
        restBase: 'diary',
        taxonomies: ['diary-category'],
        supportsThumbnail: true,
      },
    ]);
  });

  // 迴歸：supports 的值不一定是布林。正式站的 post 是 {"editor":[{"notes":true}]}，
  // 而 /wp/v2/types 一次回傳全部類型，所以 schema 一定要容得下這種形狀。
  // 這個 bug 是拿真實站台實跑時才發現的，單元測試的假資料全都是 true。
  it('supports 的值是陣列時不會讓整份探查失敗', async () => {
    mock = await startMockWordPress((req) =>
      route(req.path, {
        '/types': {
          body: {
            post: { ...TYPES.post, supports: { title: true, editor: [{ notes: true }] } },
            diary: { ...TYPES.diary, supports: { title: true, editor: [{ 'default-mode': 'locked' }], thumbnail: true } },
          },
        },
      }),
    );
    const probe = await probeSite(clientFor(mock), ['diary']);
    expect(probe.problems).toEqual([]);
    expect(probe.targets[0]!.supportsThumbnail).toBe(true);
  });

  it('內容類型不存在時直接指出可能是 show_in_rest 沒開', async () => {
    mock = await startMockWordPress((req) =>
      route(req.path, { '/types': { body: { post: TYPES.post } } }),
    );
    const probe = await probeSite(clientFor(mock), ['read-think']);

    expect(probe.targets[0]!.present).toBe(false);
    expect(probe.problems.join()).toContain('show_in_rest');
  });

  it('分類法沒開 REST 時也會被指出來', async () => {
    mock = await startMockWordPress((req) =>
      route(req.path, { '/taxonomies': { body: { category: TAXONOMIES.category } } }),
    );
    const probe = await probeSite(clientFor(mock), ['diary']);
    expect(probe.problems.join()).toContain('diary-category');
  });

  it('用 Administrator 會被提醒權限過大', async () => {
    mock = await startMockWordPress((req) =>
      route(req.path, { '/users/me': { body: { ...ME, roles: ['administrator'] } } }),
    );
    const probe = await probeSite(clientFor(mock), []);
    expect(probe.authenticated).toBe(true);
    expect(probe.problems.join()).toContain('權限比發布台需要的大');
  });

  it('權限不足的角色也會被指出來', async () => {
    mock = await startMockWordPress((req) =>
      route(req.path, { '/users/me': { body: { ...ME, roles: ['subscriber'] } } }),
    );
    const probe = await probeSite(clientFor(mock), []);
    expect(probe.problems.join()).toContain('可能沒有建立內容的權限');
  });

  it('密碼錯誤：連得上但沒認證，訊息可行動', async () => {
    mock = await startMockWordPress(() => wpError('incorrect_password', '…', 401));
    const probe = await probeSite(clientFor(mock), ['diary']);

    expect(probe.reachable).toBe(true);
    expect(probe.authenticated).toBe(false);
    expect(probe.identity).toBeNull();
    expect(probe.problems[0]).toContain('Application Password');
  });

  it('連不上：reachable 是 false，而不是丟例外', async () => {
    const dead = await startMockWordPress(() => ({ body: {} }));
    const url = dead.url;
    await dead.close();

    const probe = await probeSite(
      new WordPressClient({
        baseUrl: url,
        username: 'x',
        appPassword: 'abcdefgh',
        maxRetries: 0,
        sleepImpl: async () => {},
      }),
      ['diary'],
    );
    expect(probe.reachable).toBe(false);
    expect(probe.authenticated).toBe(false);
  });

  it('沒設定時給的是指示，不是錯誤', () => {
    const probe = unconfiguredProbe();
    expect(probe.configured).toBe(false);
    expect(probe.problems[0]).toContain('.env');
  });
});
