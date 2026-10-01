/**
 * 維基百科（factcheck.md「維基百科」、security.md「取回器」的數量與外洩檢查）。
 * 回應用 tests/fixtures/fetch/ 的 JSON，假 DNS／假傳輸，不連網。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createSourceFetcher } from '../src/fetch/index.js';
import type { Resolver, Transport, TransportRequest } from '../src/fetch/types.js';
import {
  buildExtractUrl,
  buildSearchUrl,
  parseExtractResponse,
  parseSearchResponse,
  parseWikipediaArticleUrl,
} from '../src/fetch/wikipedia.js';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/fetch/${name}`, import.meta.url), 'utf8');
const SECRET = 'abcdEFGHijklMNOPqrstUVWX';
const UA = 'Galley/0.1.0 (+https://github.com/x52640/wp-galley)';
const resolver: Resolver = async () => [{ address: '208.80.154.224', family: 4 }];

function wikiTransport(route: (url: URL) => { body: string; type?: string; status?: number }) {
  const calls: TransportRequest[] = [];
  const transport: Transport = async (req) => {
    calls.push(req);
    await req.lookup(req.url.hostname);
    const r = route(req.url);
    return {
      status: r.status ?? 200,
      headers: { 'content-type': r.type ?? 'application/json; charset=utf-8' },
      body: (async function* () {
        yield Buffer.from(r.body);
      })(),
      discard: () => undefined,
    };
  };
  return { transport, calls };
}

const defaultRoute = (url: URL) =>
  url.pathname.startsWith('/w/rest.php')
    ? { body: fixture('wiki-search-zh.json') }
    : { body: fixture('wiki-extract-zh.json') };

function make(route = defaultRoute, articleText = '臺北市立動物園是位於臺灣臺北市文山區的動物園，很大。') {
  const t = wikiTransport(route);
  const f = createSourceFetcher({
    articleText,
    containsSecret: (s) => s.includes(SECRET),
    userAgent: UA,
    resolver,
    transport: t.transport,
  });
  return { f, calls: t.calls };
}

describe('網址', () => {
  it('搜尋用語言站自己的 REST 端點，取第一筆', () => {
    const url = buildSearchUrl('zh', '臺北市立動物園 開幕');
    expect(url.origin).toBe('https://zh.wikipedia.org');
    expect(url.pathname).toBe('/w/rest.php/v1/search/page');
    expect(url.searchParams.get('q')).toBe('臺北市立動物園 開幕');
    expect(url.searchParams.get('limit')).toBe('1');
  });

  it('內文用 action API extracts 純文字；中文加 zh-tw 變體', () => {
    const zh = buildExtractUrl('zh', '臺北市立動物園');
    expect(zh.pathname).toBe('/w/api.php');
    expect(Object.fromEntries(zh.searchParams)).toMatchObject({
      action: 'query',
      prop: 'extracts',
      explaintext: '1',
      formatversion: '2',
      titles: '臺北市立動物園',
      variant: 'zh-tw',
    });
    expect(buildExtractUrl('en', 'Taipei Zoo').searchParams.has('variant')).toBe(false);
  });

  it('不用 api.wikimedia.org', () => {
    expect(buildSearchUrl('en', 'x').hostname).toBe('en.wikipedia.org');
    expect(buildExtractUrl('en', 'x').hostname).toBe('en.wikipedia.org');
  });

  it('認得條目網址（含手機版、zh-tw 路徑、底線）', () => {
    expect(parseWikipediaArticleUrl(new URL('https://zh.wikipedia.org/wiki/%E8%87%BA%E5%8C%97'))).toEqual({ lang: 'zh', title: '臺北' });
    expect(parseWikipediaArticleUrl(new URL('https://en.m.wikipedia.org/wiki/Taipei_Zoo'))).toEqual({ lang: 'en', title: 'Taipei Zoo' });
    expect(parseWikipediaArticleUrl(new URL('https://zh.wikipedia.org/zh-tw/Taipei'))).toEqual({ lang: 'zh', title: 'Taipei' });
    expect(parseWikipediaArticleUrl(new URL('https://en.wikipedia.org/wiki/Special:Search'))).toBeNull();
    expect(parseWikipediaArticleUrl(new URL('https://wikipedia.org.evil.test/wiki/X'))).toBeNull();
    expect(parseWikipediaArticleUrl(new URL('https://example.com/wiki/X'))).toBeNull();
  });

  it('解析錄好的回應', () => {
    expect(parseSearchResponse(JSON.parse(fixture('wiki-search-zh.json')))).toBe('臺北市立動物園');
    expect(parseSearchResponse(JSON.parse(fixture('wiki-search-empty.json')))).toBeNull();
    expect(parseExtractResponse(JSON.parse(fixture('wiki-extract-zh.json')))?.text).toContain('1914年開幕');
    expect(parseExtractResponse(JSON.parse(fixture('wiki-extract-missing.json')))).toBeNull();
    expect(() => parseSearchResponse({})).toThrow();
  });
});

describe('查詢', () => {
  it('搜尋＋內文：帶可識別的 User-Agent，中文帶 Accept-Language: zh-TW', async () => {
    const { f, calls } = make();
    const search = await f.searchWikipedia('zh', '臺北市立動物園');
    expect(search).toEqual({ ok: true, title: '臺北市立動物園' });
    const page = await f.wikipediaExtract('zh', '臺北市立動物園');
    expect(page).toMatchObject({
      ok: true,
      kind: 'wikipedia',
      title: '臺北市立動物園',
      url: 'https://zh.wikipedia.org/wiki/%E8%87%BA%E5%8C%97%E5%B8%82%E7%AB%8B%E5%8B%95%E7%89%A9%E5%9C%92',
    });
    expect(page.ok && page.text).toContain('圓山動物園');
    for (const c of calls) {
      expect(c.headers['user-agent']).toBe(UA);
      expect(c.headers['accept-language']).toBe('zh-TW');
      expect(c.headers['accept']).toBe('application/json');
    }
    expect(f.budget.usage).toMatchObject({ wikipediaCalls: 2, attempts: 0 });
  });

  it('我們組的維基網址不做文章片段檢查（搜尋字串本來就來自文章）', async () => {
    const { f } = make();
    expect(await f.searchWikipedia('zh', '臺北市立動物園是位於臺灣臺北市文山區的動物園')).toMatchObject({ ok: true });
  });

  it('搜尋字串含密碼 → 不發請求', async () => {
    const { f, calls } = make();
    expect(await f.searchWikipedia('zh', `x ${SECRET}`)).toMatchObject({ ok: false, code: 'secret' });
    expect(calls).toHaveLength(0);
    expect(f.budget.usage.wikipediaCalls).toBe(0);
  });

  it('沒有結果、條目不存在、格式不對都回結構化原因', async () => {
    expect(await make(() => ({ body: fixture('wiki-search-empty.json') })).f.searchWikipedia('zh', 'x')).toMatchObject({
      ok: false,
      code: 'wikipedia-not-found',
    });
    expect(await make(() => ({ body: fixture('wiki-extract-missing.json') })).f.wikipediaExtract('zh', 'x')).toMatchObject({
      ok: false,
      code: 'wikipedia-not-found',
    });
    expect(await make(() => ({ body: 'not json' })).f.wikipediaExtract('zh', 'x')).toMatchObject({
      ok: false,
      code: 'wikipedia-bad-response',
    });
    expect(await make(() => ({ body: '<p>x</p>', type: 'text/html' })).f.wikipediaExtract('zh', 'x')).toMatchObject({
      ok: false,
      code: 'wikipedia-bad-response',
    });
  });

  it('不合法的語言代碼不發請求', async () => {
    const { f, calls } = make();
    expect(await f.searchWikipedia('zh.evil.test/', 'x')).toMatchObject({ ok: false, code: 'invalid-url' });
    expect(calls).toHaveLength(0);
  });

  it('維基 API 不跟跳轉', async () => {
    const t: Transport = async () => ({
      status: 302,
      headers: { location: 'https://evil.test/' },
      body: (async function* () {})(),
      discard: () => undefined,
    });
    const f = createSourceFetcher({ articleText: '', containsSecret: () => false, userAgent: UA, resolver, transport: t });
    expect(await f.wikipediaExtract('en', 'X')).toMatchObject({ ok: false, code: 'http-status', status: 302 });
  });
});

describe('額度', () => {
  it('維基 API 第 31 次被拒', async () => {
    const { f, calls } = make();
    for (let i = 0; i < 30; i += 1) expect(await f.searchWikipedia('zh', `q${i}`)).toMatchObject({ ok: true });
    expect(await f.searchWikipedia('zh', 'q30')).toMatchObject({ ok: false, code: 'budget-wikipedia' });
    expect(calls).toHaveLength(30);
  });

  it('Agent 給的維基條目網址改走 API：扣 API 額度、不扣 12 次網址嘗試', async () => {
    const { f, calls } = make();
    const out = await f.fetchUrl('https://zh.wikipedia.org/wiki/%E8%87%BA%E5%8C%97%E5%B8%82%E7%AB%8B%E5%8B%95%E7%89%A9%E5%9C%92', 'agent');
    expect(out).toMatchObject({ ok: true, kind: 'wikipedia', title: '臺北市立動物園' });
    expect(calls[0]!.url.pathname).toBe('/w/api.php');
    expect(f.budget.usage).toMatchObject({ wikipediaCalls: 1, attempts: 0 });
  });

  it('Agent 給的維基條目網址仍先過 Agent 網址的全套檢查（例如文章片段）', async () => {
    const { f, calls } = make();
    const out = await f.fetchUrl(`https://zh.wikipedia.org/wiki/${encodeURIComponent('臺北市立動物園是位於臺灣臺北市')}`, 'agent');
    expect(out).toMatchObject({ ok: false, code: 'article-text' });
    expect(calls).toHaveLength(0);
  });
});
