import { afterEach, describe, expect, it } from 'vitest';
import { WordPressClient } from '../src/wordpress/client.js';
import { listTerms, resolveTerms } from '../src/wordpress/terms.js';
import { startMockWordPress, type MockResponse, type MockWordPress } from './helpers/mock-wordpress.js';

/** 這些就是 www.remusplus.com 的 read-think-tag 實際項目。 */
const REAL_TERMS = [
  { id: 42, name: '隨筆', slug: 'essay', parent: 0, count: 6 },
  { id: 45, name: '藝術', slug: 'art', parent: 0, count: 3 },
  { id: 43, name: '讀書心得', slug: 'reading-note', parent: 0, count: 3 },
  // 正式站這一個的 slug 是 URL 編碼過的中文。
  { id: 49, name: '經濟學', slug: '%e7%b6%93%e6%bf%9f%e5%ad%b8', parent: 0, count: 2 },
];

let mock: MockWordPress | null = null;

afterEach(async () => {
  await mock?.close();
  mock = null;
});

function clientFor(server: MockWordPress): WordPressClient {
  return new WordPressClient({
    baseUrl: server.url,
    username: 'ai_publisher',
    appPassword: 'abcd EFGH 1234 ijkl MNOP 5678',
    sleepImpl: async () => {},
  });
}

describe('列出分類項目', () => {
  it('把分頁全部抓完', async () => {
    const many = Array.from({ length: 150 }, (_, i) => ({
      id: i + 1,
      name: `項目${i}`,
      slug: `term-${i}`,
      parent: 0,
      count: 0,
    }));
    mock = await startMockWordPress((req): MockResponse => {
      const page = Number(new URL(`http://x${req.path}`).searchParams.get('page'));
      return {
        body: many.slice((page - 1) * 100, page * 100),
        headers: { 'x-wp-total': '150', 'x-wp-totalpages': '2' },
      };
    });

    const terms = await listTerms(clientFor(mock), 'read-think-tag');
    expect(terms).toHaveLength(150);
    expect(mock.requests).toHaveLength(2);
  });
});

describe('解析分類項目', () => {
  it('用中文名稱對得上', async () => {
    mock = await startMockWordPress(() => ({ body: REAL_TERMS }));
    const result = await resolveTerms(clientFor(mock), 'read-think-tag', ['隨筆', '藝術']);
    expect(result.ids).toEqual([42, 45]);
    expect(result.unknown).toEqual([]);
  });

  it('用英文 slug 也對得上', async () => {
    mock = await startMockWordPress(() => ({ body: REAL_TERMS }));
    const result = await resolveTerms(clientFor(mock), 'read-think-tag', ['essay', 'READING-NOTE']);
    expect(result.ids).toEqual([42, 43]);
  });

  it('URL 編碼過的中文 slug 也對得上', async () => {
    // 正式站的「經濟學」slug 是 %e7%b6%93%e6%bf%9f%e5%ad%b8。
    mock = await startMockWordPress(() => ({ body: REAL_TERMS }));
    const result = await resolveTerms(clientFor(mock), 'read-think-tag', ['經濟學']);
    expect(result.ids).toEqual([49]);
  });

  it('前後空白與重複會被清掉，順序照使用者給的', async () => {
    mock = await startMockWordPress(() => ({ body: REAL_TERMS }));
    const result = await resolveTerms(clientFor(mock), 'read-think-tag', [
      '  藝術  ',
      '藝術',
      '隨筆',
      '',
    ]);
    expect(result.ids).toEqual([45, 42]);
  });

  it('對不上的名稱原樣回報，不會被靜默丟掉', async () => {
    mock = await startMockWordPress(() => ({ body: REAL_TERMS }));
    const result = await resolveTerms(clientFor(mock), 'read-think-tag', ['隨筆', '量子力學']);
    expect(result.ids).toEqual([42]);
    expect(result.unknown).toEqual(['量子力學']);
    expect(result.created).toEqual([]);
  });

  it('預設不建立新項目——避免 Agent 生出一堆近義詞', async () => {
    mock = await startMockWordPress(() => ({ body: REAL_TERMS }));
    await resolveTerms(clientFor(mock), 'read-think-tag', ['經濟', '經濟學思考']);
    // 只有一次 GET，沒有任何 POST。
    expect(mock.requests.every((r) => r.method === 'GET')).toBe(true);
  });

  it('明確允許時才建立，並回報建了哪些', async () => {
    mock = await startMockWordPress((req): MockResponse => {
      if (req.method === 'POST') {
        const name = JSON.parse(req.body).name as string;
        return { status: 201, body: { id: 99, name, slug: 'new-term', parent: 0, count: 0 } };
      }
      return { body: REAL_TERMS };
    });

    const result = await resolveTerms(clientFor(mock), 'read-think-tag', ['隨筆', '量子力學'], {
      allowCreate: true,
    });
    expect(result.ids).toEqual([42, 99]);
    expect(result.unknown).toEqual([]);
    expect(result.created.map((t) => t.name)).toEqual(['量子力學']);
  });

  it('建立分類項目不重試——重試會建出兩個同名項目', async () => {
    mock = await startMockWordPress((req): MockResponse =>
      req.method === 'POST' ? { status: 500, body: {} } : { body: REAL_TERMS },
    );
    await expect(
      resolveTerms(clientFor(mock), 'read-think-tag', ['量子力學'], { allowCreate: true }),
    ).rejects.toThrow();
    expect(mock.requests.filter((r) => r.method === 'POST')).toHaveLength(1);
  });

  it('沒有要解析的名稱時完全不連線', async () => {
    mock = await startMockWordPress(() => ({ body: REAL_TERMS }));
    const result = await resolveTerms(clientFor(mock), 'read-think-tag', ['', '   ']);
    expect(result.ids).toEqual([]);
    expect(mock.requests).toHaveLength(0);
  });

  it('可以傳入已抓好的清單，避免重複請求', async () => {
    mock = await startMockWordPress(() => ({ body: [] }));
    const result = await resolveTerms(clientFor(mock), 'read-think-tag', ['隨筆'], {
      existing: REAL_TERMS,
    });
    expect(result.ids).toEqual([42]);
    expect(mock.requests).toHaveLength(0);
  });
});
