import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  destinationOptions,
  diagnoseConnection,
  mergeSiteTargets,
  normalizeSiteUrl,
  setupTargetJson,
  SetupConflictError,
} from '../src/wordpress/setup.js';
import { paths } from '../src/config/paths.js';
import { startMockWordPress, wpError, type MockWordPress } from './helpers/mock-wordpress.js';
import {
  GOOD_PASSWORD,
  GOOD_PASSWORD_BARE,
  indexBody,
  meBody,
  siteHandler,
  TAXONOMIES_BODY,
  TYPES_BODY,
  type SiteBehaviour,
} from './helpers/setup-site.js';

/**
 * 設定精靈的連線診斷（P8-T002）。每一種失敗都要有中文訊息、講得出下一步。
 * 一律對著本機假站台（或假 fetch）跑，不連真的 WordPress。
 */

let mock: MockWordPress | null = null;
afterEach(async () => {
  await mock?.close();
  mock = null;
});

async function run(behaviour: SiteBehaviour = {}, input: { username?: string; appPassword?: string } = {}) {
  mock = await startMockWordPress(siteHandler(behaviour));
  const outcome = await diagnoseConnection(
    { url: mock.url, username: input.username ?? 'ming', appPassword: input.appPassword ?? GOOD_PASSWORD },
    { timeoutMs: 2000 },
  );
  return outcome;
}

function expectActionable(problem: { title: string; detail: string; next: string } | null): void {
  expect(problem).not.toBeNull();
  expect(problem!.title).toMatch(/[一-鿿]/);
  expect(problem!.detail.length).toBeGreaterThan(5);
  expect(problem!.next).toMatch(/[一-鿿]/);
}

describe('網址整理', () => {
  it.each([
    ['example.com', 'https://example.com'],
    ['https://example.com/', 'https://example.com'],
    ['https://example.com/wp-admin/', 'https://example.com'],
    ['https://example.com/blog/wp-admin/post-new.php', 'https://example.com/blog'],
    ['https://example.com/wp-login.php', 'https://example.com'],
    ['https://example.com/wp-json/', 'https://example.com'],
    ['  https://Example.com/blog/  ', 'https://example.com/blog'],
  ])('%s → %s', (raw, expected) => {
    expect(normalizeSiteUrl(raw)).toBe(expected);
  });

  it.each(['', 'ftp://example.com', 'https://user:pw@example.com', 'http://'])('看不懂的網址：%s', (raw) => {
    expect(normalizeSiteUrl(raw)).toBeNull();
  });
});

describe('測試連線：成功', () => {
  it('全部通過，給回整理過的網址、身分，只發 GET', async () => {
    const outcome = await run();
    expect(outcome.result.ok).toBe(true);
    expect(outcome.result.problem).toBeNull();
    expect(outcome.result.identity).toEqual({ name: '編輯小明', slug: 'ming', roles: ['editor'] });
    expect(outcome.result.checks.map((check) => check.state)).toEqual(['ok', 'ok', 'ok', 'ok', 'ok', 'ok']);
    expect(outcome.result.checks[0]!.label).toBe('本機測試站（http）');
    expect(outcome.credentials).toEqual({ url: mock!.url, username: 'ming', appPassword: GOOD_PASSWORD_BARE });
    // 只讀：不建立、不修改任何東西。
    expect(mock!.requests.every((request) => request.method === 'GET')).toBe(true);
    expect(mock!.requests.map((request) => request.path.split('?')[0])).toEqual([
      '/wp-json/',
      '/wp-json/wp/v2/users/me',
      '/wp-json/wp/v2/types',
      '/wp-json/wp/v2/taxonomies',
    ]);
    // 第一個（匿名）請求不帶帳號密碼。
    expect(mock!.requests[0]!.authorization).toBeNull();
  });

  it('密碼有沒有空白都可以', async () => {
    const outcome = await run({}, { appPassword: GOOD_PASSWORD_BARE });
    expect(outcome.result.ok).toBe(true);
  });

  it('結果裡找不到密碼（有空白、沒空白都沒有）', async () => {
    const outcome = await run();
    const text = JSON.stringify(outcome.result);
    expect(text).not.toContain(GOOD_PASSWORD);
    expect(text).not.toContain(GOOD_PASSWORD_BARE);
  });

  it('管理員帳號：通過，但提醒權限過大', async () => {
    const outcome = await run({ me: { body: meBody(['administrator']) } });
    expect(outcome.result.ok).toBe(true);
    expect(outcome.result.warnings.join('')).toContain('管理員');
  });

  it('作者帳號：通過，但講明不能發頁面', async () => {
    const outcome = await run({
      me: { body: meBody(['author'], { edit_posts: true, publish_posts: true, upload_files: true }) },
    });
    expect(outcome.result.ok).toBe(true);
    expect(outcome.result.warnings.join('')).toContain('不能發頁面');
  });

  it('沒有 capabilities 時退回角色判斷', async () => {
    const outcome = await run({ me: { body: meBody(['editor'], undefined) } });
    expect(outcome.result.ok).toBe(true);
  });

  it('沒登入時 REST 被安全外掛關掉，但登入後可以用：通過並標黃', async () => {
    const outcome = await run({ index: wpError('rest_login_required', '需要登入', 401) });
    expect(outcome.result.ok).toBe(true);
    expect(outcome.result.checks.find((check) => check.key === 'rest')!.state).toBe('warn');
    expect(outcome.result.warnings.join('')).toContain('不影響');
  });
});

describe('測試連線：每一種失敗都講得出下一步', () => {
  it('網址不是 https（非本機）：一個請求都不發', async () => {
    let called = 0;
    const outcome = await diagnoseConnection(
      { url: 'http://example.com', username: 'ming', appPassword: GOOD_PASSWORD },
      {
        fetchImpl: (async () => {
          called += 1;
          throw new Error('不該連線');
        }) as typeof fetch,
      },
    );
    expect(called).toBe(0);
    expect(outcome.result.problem?.kind).toBe('not-https');
    expect(outcome.result.problem?.next).toContain('https://');
    expect(outcome.result.checks[0]).toMatchObject({ key: 'https', state: 'fail' });
    expectActionable(outcome.result.problem);
    expect(outcome.credentials).toBeNull();
  });

  it('網址看不懂', async () => {
    const outcome = await diagnoseConnection({ url: 'ftp://x', username: 'ming', appPassword: GOOD_PASSWORD });
    expect(outcome.result.problem?.kind).toBe('invalid-url');
    expectActionable(outcome.result.problem);
  });

  it('密碼格式不對（像登入密碼）：講字數，不連線', async () => {
    const outcome = await diagnoseConnection(
      { url: 'https://example.com', username: 'ming', appPassword: 'hunter2!' },
      { fetchImpl: (async () => { throw new Error('不該連線'); }) as typeof fetch },
    );
    expect(outcome.result.problem?.kind).toBe('password-format');
    expect(outcome.result.problem?.detail).toContain('8 個字元');
    expect(JSON.stringify(outcome.result)).not.toContain('hunter2');
    expectActionable(outcome.result.problem);
  });

  it.each([
    ['ENOTFOUND', 'DNS'],
    ['ECONNREFUSED', '拒絕連線'],
    ['CERT_HAS_EXPIRED', '憑證'],
  ])('連不上（%s）', async (code, phrase) => {
    const outcome = await diagnoseConnection(
      { url: 'https://example.com', username: 'ming', appPassword: GOOD_PASSWORD },
      {
        fetchImpl: (async () => {
          throw Object.assign(new TypeError('fetch failed'), { cause: { code } });
        }) as typeof fetch,
      },
    );
    expect(outcome.result.problem?.kind).toBe('unreachable');
    expect(outcome.result.problem!.title + outcome.result.problem!.detail).toContain(phrase);
    expect(outcome.result.checks.find((check) => check.key === 'reachable')!.state).toBe('fail');
    expectActionable(outcome.result.problem);
  });

  it('逾時', async () => {
    const outcome = await diagnoseConnection(
      { url: 'https://example.com', username: 'ming', appPassword: GOOD_PASSWORD },
      {
        timeoutMs: 1000,
        fetchImpl: (async () => {
          throw Object.assign(new Error('aborted'), { name: 'AbortError' });
        }) as typeof fetch,
      },
    );
    expect(outcome.result.problem?.title).toContain('太久');
    expectActionable(outcome.result.problem);
  });

  it('網址會被轉址：講要改填哪一個', async () => {
    const outcome = await run({ index: { status: 301, headers: { location: 'https://www.example.com/wp-json/' } } });
    expect(outcome.result.problem?.kind).toBe('redirect');
    expect(outcome.result.problem?.next).toContain('https://www.example.com');
    expectActionable(outcome.result.problem);
  });

  it('Location 寫壞了：照樣當轉址講，不會 500', async () => {
    const outcome = await run({ index: { status: 302, headers: { location: 'http://[bad' } } });
    expect(outcome.result.problem?.kind).toBe('redirect');
    expect(outcome.result.problem?.next).toContain('在瀏覽器打開');
  });

  it('/wp-json/ 大得不像話：中止讀取，不吃光記憶體', async () => {
    const huge = 'x'.repeat(9 * 1024 * 1024);
    const outcome = await run({ index: { status: 200, body: `{"a":"${huge}"}`, headers: { 'content-type': 'application/json' } } });
    expect(outcome.result.problem?.kind).toBe('not-wordpress');
    expect(outcome.result.problem?.title).toContain('太大');
  });

  it('標頭到了、本體一直不來：逾時照樣切斷', async () => {
    const outcome = await diagnoseConnection(
      { url: 'https://example.com', username: 'ming', appPassword: GOOD_PASSWORD },
      {
        timeoutMs: 200,
        fetchImpl: (async (_url: string, init: RequestInit) => {
          const body = new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('{"namespaces":'));
              init.signal?.addEventListener('abort', () => controller.error(Object.assign(new Error('aborted'), { name: 'AbortError' })));
            },
          });
          return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
        }) as unknown as typeof fetch,
      },
    );
    expect(outcome.result.problem?.title).toContain('太久');
  });

  it('/wp-json/ 404：不是 WordPress 或永久連結是預設', async () => {
    const outcome = await run({ index: { status: 404, body: '<html>not found</html>' } });
    expect(outcome.result.problem?.kind).toBe('not-wordpress');
    expect(outcome.result.problem?.next).toContain('永久連結');
    expectActionable(outcome.result.problem);
  });

  it('/wp-json/ 回網頁不是資料', async () => {
    const outcome = await run({ index: { status: 200, body: '<html><body>hello</body></html>' } });
    expect(outcome.result.problem?.kind).toBe('not-wordpress');
  });

  it('REST 被防火牆擋（403 網頁）', async () => {
    const outcome = await run({ index: { status: 403, body: '<html>Access denied</html>' } });
    expect(outcome.result.problem?.kind).toBe('rest-blocked');
    expect(outcome.result.problem?.next).toContain('/wp-json/');
    expect(outcome.result.checks.find((check) => check.key === 'rest')!.state).toBe('fail');
    expectActionable(outcome.result.problem);
  });

  it('REST 的 wp/v2 被關掉', async () => {
    const outcome = await run({ index: { body: indexBody({ namespaces: ['oembed/1.0'] }) } });
    expect(outcome.result.problem?.kind).toBe('rest-blocked');
    expect(outcome.result.problem?.detail).toContain('wp/v2');
  });

  it('REST 被安全外掛擋（users/me 403 JSON）', async () => {
    const outcome = await run({ me: wpError('rest_forbidden', 'Sorry', 403) });
    expect(outcome.result.problem?.kind).toBe('rest-blocked');
    expect(outcome.result.problem?.detail).toContain('安全外掛');
    expectActionable(outcome.result.problem);
  });

  it('帳號不存在', async () => {
    const outcome = await run({ me: wpError('invalid_username', 'Unknown username', 401) });
    expect(outcome.result.problem?.kind).toBe('wrong-username');
    expect(outcome.result.problem?.detail).toContain('ming');
    expect(outcome.result.checks.find((check) => check.key === 'auth')!.state).toBe('fail');
    expectActionable(outcome.result.problem);
  });

  it('應用程式密碼不對', async () => {
    const outcome = await run({}, { appPassword: 'zzzz zzzz zzzz zzzz zzzz zzzz' });
    expect(outcome.result.problem?.kind).toBe('wrong-password');
    expect(outcome.result.problem?.next).toContain('應用程式密碼');
    expect(JSON.stringify(outcome.result)).not.toContain('zzzzzzzz');
    expectActionable(outcome.result.problem);
  });

  it('應用程式密碼被停用（WordPress 明講）', async () => {
    const outcome = await run({ me: wpError('application_passwords_disabled', 'disabled', 501) });
    expect(outcome.result.problem?.kind).toBe('app-passwords-disabled');
    expectActionable(outcome.result.problem);
  });

  it('應用程式密碼沒開（首頁沒宣告，WordPress 說沒登入）', async () => {
    const outcome = await run({
      index: { body: indexBody({ appPasswords: false }) },
      me: wpError('rest_not_logged_in', 'You are not currently logged in.', 401),
    });
    expect(outcome.result.problem?.kind).toBe('app-passwords-disabled');
  });

  it('Authorization 標頭被主機拿掉（有開應用程式密碼，WordPress 卻說沒登入）', async () => {
    const outcome = await run({ me: wpError('rest_not_logged_in', 'You are not currently logged in.', 401) });
    expect(outcome.result.problem?.kind).toBe('auth-header-stripped');
    expect(outcome.result.problem?.next).toContain('.htaccess');
    expectActionable(outcome.result.problem);
  });

  it.each([
    [['subscriber'], { read: true }, ''],
    [['contributor'], { edit_posts: true, read: true }, '投稿者'],
  ])('權限不夠發文：%s', async (roles, caps, phrase) => {
    const outcome = await run({ me: { body: meBody(roles, caps as Record<string, boolean>) } });
    expect(outcome.result.problem?.kind).toBe('no-permission');
    expect(outcome.result.problem?.next).toContain('編輯');
    expect(outcome.result.problem?.detail).toContain(phrase);
    expect(outcome.result.identity?.slug).toBe('ming');
    expect(outcome.result.checks.find((check) => check.key === 'permission')!.state).toBe('fail');
    expect(outcome.credentials).toBeNull();
    expectActionable(outcome.result.problem);
  });

  it('文章與頁面都沒開放 REST', async () => {
    const outcome = await run({ types: { body: { attachment: TYPES_BODY.attachment } } });
    expect(outcome.result.problem?.kind).toBe('types-missing');
    expectActionable(outcome.result.problem);
  });

  it('WordPress 自己出錯（5xx）', async () => {
    const outcome = await run({ me: { status: 500, body: { code: 'internal', message: 'boom' } } });
    expect(outcome.result.problem?.kind).toBe('server-error');
    expectActionable(outcome.result.problem);
  });

  it('認證錯誤不重試（重試會被安全外掛鎖帳號）', async () => {
    await run({}, { appPassword: 'zzzz zzzz zzzz zzzz zzzz zzzz' });
    expect(mock!.requests.filter((request) => request.path.includes('/users/me'))).toHaveLength(1);
  });
});

describe('目的地與站台設定檔', () => {
  const editor = { canPublishPosts: true, canPublishPages: true, canUpload: true, roles: ['editor'] };

  it('標準站台產生的設定跟 config/publish-targets.example.json 一字不差', () => {
    const options = destinationOptions(TYPES_BODY as never, TAXONOMIES_BODY as never, editor, []);
    const built = { targets: options.map((option) => setupTargetJson(option)) };
    const example = readFileSync(join(paths.config, 'publish-targets.example.json'), 'utf8');
    expect(`${JSON.stringify(built, null, 2)}\n`).toBe(example);
  });

  it('分類法的 REST 名稱照站上的 rest_base（不寫死 categories）', () => {
    const taxonomies = { category: { ...TAXONOMIES_BODY.category, rest_base: 'topics' } };
    const [post] = destinationOptions(TYPES_BODY as never, taxonomies as never, editor, []);
    expect(post!.taxonomyRestBase).toBe('topics');
    expect(setupTargetJson(post!)).toMatchObject({ taxonomy: 'category', taxonomyRestBase: 'topics', allowCreateTerms: false });
  });

  it('站上沒開放頁面的 REST：頁面選不了，講原因', () => {
    const options = destinationOptions({ post: TYPES_BODY.post } as never, TAXONOMIES_BODY as never, editor, []);
    const page = options.find((option) => option.key === 'page')!;
    expect(page.available).toBe(false);
    expect(page.reason).toContain('沒有開放 REST');
  });

  it('帳號不能發頁面：頁面選不了，講怎麼改', () => {
    const options = destinationOptions(TYPES_BODY as never, TAXONOMIES_BODY as never, { ...editor, canPublishPages: false }, []);
    expect(options.find((option) => option.key === 'page')!.reason).toContain('publish_pages');
  });

  it('合併：既有的 target 原樣保留，新的加在後面', () => {
    const existing = [{ key: 'diary', displayName: '日•記', custom: 1 }];
    const merged = mergeSiteTargets(existing, [{ key: 'post', displayName: '文章' }], []);
    expect(merged).toEqual([{ key: 'diary', displayName: '日•記', custom: 1 }, { key: 'post', displayName: '文章' }]);
  });

  it('合併：同 key 沒說要取代就拒絕，說了才取代', () => {
    const existing = [{ key: 'post', displayName: '我的文章' }];
    expect(() => mergeSiteTargets(existing, [{ key: 'post', displayName: '文章' }], [])).toThrow(SetupConflictError);
    expect(() => mergeSiteTargets(existing, [{ key: 'post', displayName: '文章' }], [])).toThrow(/我的文章/);
    expect(mergeSiteTargets(existing, [{ key: 'post', displayName: '文章' }], ['post'])).toEqual([
      { key: 'post', displayName: '文章' },
    ]);
  });
});
