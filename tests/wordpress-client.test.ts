import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { WordPressClient } from '../src/wordpress/client.js';
import { WordPressError, wordpressErrorCodes } from '../src/wordpress/errors.js';
import { startMockWordPress, wpError, type MockWordPress } from './helpers/mock-wordpress.js';

const APP_PASSWORD = 'abcd EFGH 1234 ijkl MNOP 5678';
const USERNAME = 'ai_publisher';

let mock: MockWordPress | null = null;

afterEach(async () => {
  await mock?.close();
  mock = null;
});

/** 測試一律把重試延遲換成 no-op，不然每個重試測試都要真的等半秒。 */
function clientFor(server: MockWordPress, overrides: Partial<ConstructorParameters<typeof WordPressClient>[0]> = {}) {
  return new WordPressClient({
    baseUrl: server.url,
    username: USERNAME,
    appPassword: APP_PASSWORD,
    sleepImpl: async () => {},
    ...overrides,
  });
}

async function expectWordPressError(promise: Promise<unknown>): Promise<WordPressError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(WordPressError);
    return error as WordPressError;
  }
  throw new Error('預期要丟出 WordPressError，但成功了');
}

describe('請求組成', () => {
  it('用 Basic 認證，帳號密碼照原樣送出', async () => {
    mock = await startMockWordPress(() => ({ body: { ok: true } }));
    await clientFor(mock).request('/wp/v2/users/me');

    const auth = mock.requests[0]!.authorization!;
    expect(auth.startsWith('Basic ')).toBe(true);
    const decoded = Buffer.from(auth.slice('Basic '.length), 'base64').toString('utf8');
    // WordPress 自己會在驗證前去掉非英數字元，所以空格照送沒問題。
    expect(decoded).toBe(`${USERNAME}:${APP_PASSWORD}`);
  });

  it('路徑接在 /wp-json 後面，query 會被編碼', async () => {
    mock = await startMockWordPress(() => ({ body: [] }));
    await clientFor(mock).request('/wp/v2/diary', {
      query: { per_page: 100, status: 'draft', search: '日 記', skipped: undefined },
    });

    const path = mock.requests[0]!.path;
    expect(path.startsWith('/wp-json/wp/v2/diary?')).toBe(true);
    expect(path).toContain('per_page=100');
    expect(path).toContain('status=draft');
    expect(path).toContain('search=%E6%97%A5+%E8%A8%98');
    expect(path).not.toContain('skipped');
  });

  it('有 body 才送 Content-Type，並序列化成 JSON', async () => {
    mock = await startMockWordPress(() => ({ status: 201, body: { id: 1 } }));
    const client = clientFor(mock);

    await client.request('/wp/v2/diary', { method: 'POST', body: { title: '20260828' } });
    expect(mock.requests[0]!.contentType).toBe('application/json');
    expect(JSON.parse(mock.requests[0]!.body)).toEqual({ title: '20260828' });

    await client.request('/wp/v2/diary');
    expect(mock.requests[1]!.contentType).toBeNull();
    expect(mock.requests[1]!.body).toBe('');
  });

  it('回傳分頁標頭', async () => {
    mock = await startMockWordPress(() => ({
      body: [],
      headers: { 'x-wp-total': '108', 'x-wp-totalpages': '36' },
    }));
    const result = await clientFor(mock).request('/wp/v2/diary');
    expect(result.totalItems).toBe(108);
    expect(result.totalPages).toBe(36);
  });
});

describe('回應驗證', () => {
  it('通過 schema 就回傳型別化的資料', async () => {
    mock = await startMockWordPress(() => ({ body: { id: 7, slug: 'ai_publisher' } }));
    const schema = z.object({ id: z.number(), slug: z.string() });
    const { data } = await clientFor(mock).request('/wp/v2/users/me', { schema });
    expect(data.id).toBe(7);
  });

  it('結構對不上就報 SCHEMA_MISMATCH，不讓壞資料流進系統', async () => {
    mock = await startMockWordPress(() => ({ body: { id: '不是數字' } }));
    const schema = z.object({ id: z.number() });
    const error = await expectWordPressError(clientFor(mock).request('/wp/v2/users/me', { schema }));
    expect(error.code).toBe(wordpressErrorCodes.SCHEMA_MISMATCH);
    expect(error.retryable).toBe(false);
  });

  it('回應不是 JSON 時給出可行動的訊息，而不是解析錯誤', async () => {
    // 安全外掛、快取層或維護模式擋在前面時就是這樣。
    mock = await startMockWordPress(() => ({ body: '<html><body>Access denied</body></html>' }));
    const error = await expectWordPressError(clientFor(mock).request('/wp/v2/users/me'));
    expect(error.code).toBe(wordpressErrorCodes.BAD_RESPONSE);
    expect(error.message).toContain('安全外掛');
  });
});

describe('錯誤翻譯', () => {
  it('密碼錯誤：分類成認證問題，並提醒重設登入密碼會讓它失效', async () => {
    mock = await startMockWordPress(() =>
      wpError('incorrect_password', '目前使用的密碼是無效的應用程式密碼。', 401),
    );
    const error = await expectWordPressError(clientFor(mock).request('/wp/v2/users/me'));
    expect(error.code).toBe(wordpressErrorCodes.AUTH);
    expect(error.message).toContain('Application Password');
    expect(error.message).toContain('重設 WordPress 登入密碼');
  });

  it('帳號不存在跟密碼錯誤分得開', async () => {
    mock = await startMockWordPress(() => wpError('invalid_username', 'Unknown username.', 401));
    const error = await expectWordPressError(clientFor(mock).request('/wp/v2/users/me'));
    expect(error.message).toContain('WORDPRESS_USERNAME');
  });

  it('端點不存在時提示 show_in_rest', async () => {
    mock = await startMockWordPress(() => wpError('rest_no_route', 'No route was found.', 404));
    const error = await expectWordPressError(clientFor(mock).request('/wp/v2/read-think'));
    expect(error.code).toBe(wordpressErrorCodes.NOT_FOUND);
    expect(error.message).toContain('show_in_rest');
  });

  it('權限不足翻成看得懂的話', async () => {
    mock = await startMockWordPress(() => wpError('rest_cannot_create', 'Sorry, you are not allowed…', 403));
    const error = await expectWordPressError(clientFor(mock).request('/wp/v2/diary', { method: 'POST', body: {} }));
    expect(error.code).toBe(wordpressErrorCodes.FORBIDDEN);
    expect(error.message).toBe('這個帳號沒有建立這種內容的權限');
  });

  it('安全外掛把認證錯誤改成 403 時仍然判定為認證問題', async () => {
    mock = await startMockWordPress(() => wpError('incorrect_password', '…', 403));
    const error = await expectWordPressError(clientFor(mock).request('/wp/v2/users/me'));
    expect(error.code).toBe(wordpressErrorCodes.AUTH);
  });

  it('沒見過的錯誤代碼就用 WordPress 自己的訊息', async () => {
    mock = await startMockWordPress(() => wpError('some_plugin_error', '外掛擋下了這個請求', 400));
    const error = await expectWordPressError(clientFor(mock).request('/wp/v2/diary'));
    expect(error.message).toBe('外掛擋下了這個請求');
    expect(error.options.wordpressCode).toBe('some_plugin_error');
  });
});

describe('重試', () => {
  it('5xx 會重試，成功就回傳', async () => {
    mock = await startMockWordPress((_req, i) =>
      i < 2 ? { status: 503, body: { code: 'x', message: '暫時無法服務' } } : { body: { ok: true } },
    );
    const result = await clientFor(mock).request('/wp/v2/diary');
    expect(result.status).toBe(200);
    expect(mock.requests).toHaveLength(3);
  });

  it('重試用完就丟出錯誤，並記錄試了幾次', async () => {
    mock = await startMockWordPress(() => ({ status: 500, body: { code: 'x', message: '爆炸' } }));
    const error = await expectWordPressError(clientFor(mock, { maxRetries: 2 }).request('/wp/v2/diary'));
    expect(error.code).toBe(wordpressErrorCodes.SERVER_ERROR);
    expect(error.options.attempts).toBe(3); // 第一次 + 兩次重試
    expect(mock.requests).toHaveLength(3);
  });

  it('認證失敗一次都不重試——重試只會被安全外掛鎖帳號', async () => {
    mock = await startMockWordPress(() => wpError('incorrect_password', '…', 401));
    await expectWordPressError(clientFor(mock).request('/wp/v2/users/me'));
    expect(mock.requests).toHaveLength(1);
  });

  it('權限不足也不重試', async () => {
    mock = await startMockWordPress(() => wpError('rest_forbidden', '…', 403));
    await expectWordPressError(clientFor(mock).request('/wp/v2/diary'));
    expect(mock.requests).toHaveLength(1);
  });

  it('429 會重試，而且照 Retry-After 指定的秒數等待', async () => {
    mock = await startMockWordPress((_req, i) =>
      i === 0
        ? { status: 429, body: { code: 'too_many', message: '太頻繁' }, headers: { 'retry-after': '2' } }
        : { body: { ok: true } },
    );
    const delays: number[] = [];
    await clientFor(mock, { sleepImpl: async (ms) => void delays.push(ms) }).request('/wp/v2/diary');
    expect(delays).toEqual([2000]);
  });

  it('沒有 Retry-After 時用指數退避', async () => {
    mock = await startMockWordPress((_req, i) => (i < 2 ? { status: 500, body: {} } : { body: {} }));
    const delays: number[] = [];
    await clientFor(mock, {
      baseDelayMs: 100,
      sleepImpl: async (ms) => void delays.push(ms),
    }).request('/wp/v2/diary');
    expect(delays).toEqual([100, 200]);
  });

  it('可以針對單一請求關掉重試——發布請求不該重試', async () => {
    mock = await startMockWordPress(() => ({ status: 500, body: {} }));
    await expectWordPressError(clientFor(mock).request('/wp/v2/diary', { method: 'POST', maxRetries: 0 }));
    expect(mock.requests).toHaveLength(1);
  });

  it('重試時通知上層，訊息不含密碼', async () => {
    mock = await startMockWordPress((_req, i) => (i === 0 ? { status: 500, body: {} } : { body: {} }));
    const seen: string[] = [];
    await clientFor(mock, { onRetry: (info) => seen.push(JSON.stringify(info)) }).request('/wp/v2/diary');
    expect(seen).toHaveLength(1);
    expect(seen[0]).not.toContain(APP_PASSWORD);
  });
});

describe('連線問題', () => {
  it('逾時算成可重試的網路錯誤', async () => {
    mock = await startMockWordPress(() => ({ body: {}, delayMs: 200 }));
    const error = await expectWordPressError(
      clientFor(mock, { timeoutMs: 30, maxRetries: 1 }).request('/wp/v2/diary'),
    );
    expect(error.code).toBe(wordpressErrorCodes.NETWORK);
    expect(error.options.attempts).toBe(2);
  });

  it('連不上的時候給的是網路錯誤，不是當掉', async () => {
    const dead = await startMockWordPress(() => ({ body: {} }));
    const url = dead.url;
    await dead.close();

    const client = new WordPressClient({
      baseUrl: url,
      username: USERNAME,
      appPassword: APP_PASSWORD,
      maxRetries: 0,
      sleepImpl: async () => {},
    });
    const error = await expectWordPressError(client.request('/wp/v2/diary'));
    expect(error.code).toBe(wordpressErrorCodes.NETWORK);
  });

  it('遇到轉址就明講，不要跟著跳', async () => {
    // 跟著跳的話，部分伺服器會把 Authorization 丟掉，
    // 症狀是「密碼明明正確卻說沒權限」，非常難查。
    mock = await startMockWordPress(() => ({
      status: 301,
      headers: { location: 'https://elsewhere.example/wp-json/wp/v2/diary' },
    }));
    const error = await expectWordPressError(clientFor(mock).request('/wp/v2/diary'));
    expect(error.code).toBe(wordpressErrorCodes.BAD_RESPONSE);
    expect(error.message).toContain('轉址');
    expect(mock.requests).toHaveLength(1);
  });
});

describe('秘密不外流', () => {
  it('WordPress 把密碼回顯在錯誤訊息裡時也會被抹掉', async () => {
    mock = await startMockWordPress(() => ({
      status: 400,
      body: { code: 'bad', message: `密碼 ${APP_PASSWORD} 不合法`, data: { status: 400 } },
    }));
    const error = await expectWordPressError(clientFor(mock).request('/wp/v2/diary'));
    expect(error.message).not.toContain(APP_PASSWORD);
    expect(error.message).toContain('[REDACTED]');
  });

  it('非 JSON 回應夾帶密碼時也不會漏出去', async () => {
    mock = await startMockWordPress(() => ({
      status: 500,
      body: `<html>debug: ${APP_PASSWORD}</html>`,
    }));
    const error = await expectWordPressError(clientFor(mock, { maxRetries: 0 }).request('/wp/v2/diary'));
    expect(error.message).not.toContain(APP_PASSWORD);
  });
});
