/**
 * 安全抓取（security.md「取回器」）：檢查順序、在連線用的解析裡查位址、rebinding、跳轉、代理、
 * 請求標頭、回應（Content-Type、大小、壓縮炸彈、逾時）、數量上限。
 * 一律用假 DNS／假傳輸；代理與真實傳輸的測試只連 127.0.0.1 上的本機測試伺服器。
 */
import { spawn } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { createServer as createHttpsServer, type Server as HttpsServer } from 'node:https';
import { createServer as createNetServer, type AddressInfo, type Server as NetServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSourceFetcher, type SourceFetcherOptions } from '../src/fetch/index.js';
import { createHttpsTransport } from '../src/fetch/transport.js';
import type { ResolvedAddress, Resolver, Transport, TransportRequest } from '../src/fetch/types.js';

const SECRET = 'abcdEFGHijklMNOPqrstUVWX';
const ARTICLE = '台北市立動物園在一九一四年開幕，是台灣最大的動物園。';
const PUBLIC: ResolvedAddress[] = [{ address: '93.184.216.34', family: 4 }];

interface FakeReply {
  status?: number;
  headers?: Record<string, string>;
  body?: string | Buffer | (() => AsyncIterable<Uint8Array>);
}

/** 假傳輸：先呼叫 request.lookup（模擬連線前的解析），再照網址回假回應。 */
function fakeTransport(reply: (url: URL) => FakeReply | Promise<FakeReply>) {
  const calls: TransportRequest[] = [];
  const connected: string[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const transport: Transport = async (req) => {
    calls.push(req);
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      const addrs = await req.lookup(req.url.hostname);
      connected.push(addrs[0]!.address);
      const r = await reply(req.url);
      const body = r.body ?? '<p>hi</p>';
      return {
        status: r.status ?? 200,
        headers: { 'content-type': 'text/html; charset=utf-8', ...r.headers },
        body:
          typeof body === 'function'
            ? body()
            : (async function* () {
                yield Buffer.isBuffer(body) ? body : Buffer.from(body);
              })(),
        discard: () => undefined,
      };
    } finally {
      inFlight -= 1;
    }
  };
  return { transport, calls, connected, get maxInFlight() { return maxInFlight; } };
}

function countingResolver(map: (host: string, n: number) => ResolvedAddress[] = () => PUBLIC) {
  const calls: string[] = [];
  const resolver: Resolver = async (host) => {
    calls.push(host);
    return map(host, calls.length);
  };
  return { resolver, calls };
}

function fetcher(opts: Partial<SourceFetcherOptions> & { transport: Transport; resolver: Resolver }) {
  return createSourceFetcher({
    articleText: ARTICLE,
    containsSecret: (t) => t.includes(SECRET),
    userAgent: 'Galley/test (+https://github.com/x52640/wp-galley)',
    ...opts,
  });
}

describe('檢查順序：格式與外洩檢查在 DNS 前', () => {
  const cases: Array<[string, string]> = [
    ['http://example.com/', 'protocol'],
    ['https://example.com:8443/', 'port'],
    ['https://user@example.com/', 'credentials'],
    ['https://127.0.0.1/', 'host'],
    ['https://localhost/', 'host'],
    ['https://intranet/', 'host'],
    ['https://example.com/台北市立動物園在一九一四年開幕', 'article-text'],
    [`https://example.com/?k=${SECRET}`, 'secret'],
    [`https://example.com/${'a'.repeat(300)}`, 'too-long'],
    [`https://example.com/?${'a'.repeat(121)}`, 'query-too-long'],
  ];
  it.each(cases)('%s → %s，假 DNS 與傳輸都沒被呼叫、不扣額度', async (url, code) => {
    const dns = countingResolver();
    const t = fakeTransport(() => ({}));
    const f = fetcher({ resolver: dns.resolver, transport: t.transport });
    const out = await f.fetchUrl(url, 'agent');
    expect(out).toMatchObject({ ok: false, code, hop: 0 });
    expect(out.ok ? '' : out.reason).not.toContain(SECRET);
    expect(dns.calls).toEqual([]);
    expect(t.calls).toEqual([]);
    expect(f.budget.usage.attempts).toBe(0);
  });

  it('失敗原因是白話', async () => {
    const f = fetcher({ resolver: countingResolver().resolver, transport: fakeTransport(() => ({})).transport });
    const out = await f.fetchUrl('https://example.com/台北市立動物園在一九一四年開幕', 'agent');
    expect(out).toMatchObject({ ok: false, reason: '網址含文章原句，沒抓' });
  });
});

describe('位址：在連線用的解析裡檢查', () => {
  const privateCases: Array<[string, ResolvedAddress[]]> = [
    ['127.0.0.1', [{ address: '127.0.0.1', family: 4 }]],
    ['10.x', [{ address: '10.20.30.40', family: 4 }]],
    ['169.254.169.254', [{ address: '169.254.169.254', family: 4 }]],
    ['::1', [{ address: '::1', family: 6 }]],
    ['::ffff:127.0.0.1', [{ address: '::ffff:127.0.0.1', family: 6 }]],
    ['64:ff9b::7f00:1', [{ address: '64:ff9b::7f00:1', family: 6 }]],
    ['64:ff9b:1::1', [{ address: '64:ff9b:1::1', family: 6 }]],
    ['2002:7f00:1::', [{ address: '2002:7f00:1::', family: 6 }]],
    ['0.0.0.0', [{ address: '0.0.0.0', family: 4 }]],
    ['CGNAT 100.64.1.1', [{ address: '100.64.1.1', family: 4 }]],
    ['多個位址其中一個是私有', [PUBLIC[0]!, { address: '192.168.0.1', family: 4 }]],
  ];
  it.each(privateCases)('evil.test → %s：拒絕、沒連線', async (_label, addrs) => {
    const dns = countingResolver(() => addrs);
    const t = fakeTransport(() => ({}));
    const f = fetcher({ resolver: dns.resolver, transport: t.transport });
    const out = await f.fetchUrl('https://evil.test/', 'agent');
    expect(out).toMatchObject({ ok: false, code: 'blocked-address' });
    expect(t.connected).toEqual([]);
  });

  it('取回器自己不先解析：解析只發生在傳輸要連線的那一次', async () => {
    const dns = countingResolver();
    // 傳輸不呼叫 lookup → 一次解析都不該有
    const lazy: Transport = async () => ({
      status: 200,
      headers: { 'content-type': 'text/plain' },
      body: (async function* () { yield Buffer.from('ok'); })(),
      discard: () => undefined,
    });
    const f = fetcher({ resolver: dns.resolver, transport: lazy });
    expect(await f.fetchUrl('https://example.com/', 'agent')).toMatchObject({ ok: true });
    expect(dns.calls).toEqual([]);
  });

  it('DNS rebinding：第二次解析換成私有位址就擋（每次連線各自檢查）', async () => {
    const dns = countingResolver((_h, n) => (n === 1 ? PUBLIC : [{ address: '127.0.0.1', family: 4 }]));
    const t = fakeTransport(() => ({}));
    const f = fetcher({ resolver: dns.resolver, transport: t.transport });
    expect(await f.fetchUrl('https://rebind.test/a', 'agent')).toMatchObject({ ok: true });
    expect(await f.fetchUrl('https://rebind.test/b', 'agent')).toMatchObject({ ok: false, code: 'blocked-address' });
    expect(t.connected).toEqual(['93.184.216.34']);
  });

  it('DNS 查不到 → dns', async () => {
    const resolver: Resolver = async () => {
      throw Object.assign(new Error('nope'), { code: 'ENOTFOUND' });
    };
    const f = fetcher({ resolver, transport: fakeTransport(() => ({})).transport });
    expect(await f.fetchUrl('https://nope.test/', 'agent')).toMatchObject({ ok: false, code: 'dns' });
  });
});

describe('跳轉', () => {
  const redirect = (to: string): FakeReply => ({ status: 302, headers: { location: to } });

  it('3 跳以內照跟，每跳重新解析與檢查', async () => {
    const dns = countingResolver();
    const t = fakeTransport((u) => {
      const n = Number(u.pathname.slice(1));
      return n < 3 ? redirect(`/${n + 1}`) : { body: '<p>final</p>' };
    });
    const f = fetcher({ resolver: dns.resolver, transport: t.transport });
    const out = await f.fetchUrl('https://a.test/0', 'agent');
    expect(out).toMatchObject({ ok: true, url: 'https://a.test/3', text: 'final' });
    expect(dns.calls).toHaveLength(4);
    expect(f.budget.usage.attempts).toBe(1);
  });

  it('第 4 跳被拒', async () => {
    const t = fakeTransport((u) => redirect(`/${Number(u.pathname.slice(1)) + 1}`));
    const f = fetcher({ resolver: countingResolver().resolver, transport: t.transport });
    expect(await f.fetchUrl('https://a.test/0', 'agent')).toMatchObject({ ok: false, code: 'too-many-redirects', hop: 4 });
    expect(t.calls).toHaveLength(4);
  });

  it('跳到 http: 被拒，不發請求', async () => {
    const t = fakeTransport(() => redirect('http://a.test/plain'));
    const f = fetcher({ resolver: countingResolver().resolver, transport: t.transport });
    expect(await f.fetchUrl('https://a.test/', 'agent')).toMatchObject({
      ok: false,
      code: 'protocol',
      hop: 1,
      reason: '跳轉到的不是 https 網址，沒抓',
    });
    expect(t.calls).toHaveLength(1);
  });

  it('跳到解析成私有位址的主機被拒', async () => {
    const dns = countingResolver((h) => (h === 'internal.test' ? [{ address: '10.0.0.5', family: 4 }] : PUBLIC));
    const t = fakeTransport(() => redirect('https://internal.test/'));
    const f = fetcher({ resolver: dns.resolver, transport: t.transport });
    expect(await f.fetchUrl('https://a.test/', 'agent')).toMatchObject({ ok: false, code: 'blocked-address', hop: 1 });
    expect(t.connected).toEqual(['93.184.216.34']);
  });

  it('跳轉網址夾帶文章片段被拒（文章連結的跳轉也一樣）', async () => {
    const t = fakeTransport(() => redirect(`https://b.test/?d=${encodeURIComponent('台北市立動物園在一九一四年')}`));
    const f = fetcher({ resolver: countingResolver().resolver, transport: t.transport });
    expect(await f.fetchUrl('https://a.test/', 'article-link')).toMatchObject({ ok: false, code: 'article-text', hop: 1 });
    expect(t.calls).toHaveLength(1);
  });

  it('跳轉網址含密碼被拒、不抓', async () => {
    const t = fakeTransport(() => redirect(`https://b.test/?k=${SECRET}`));
    const f = fetcher({ resolver: countingResolver().resolver, transport: t.transport });
    const out = await f.fetchUrl('https://a.test/', 'agent');
    expect(out).toMatchObject({ ok: false, code: 'secret', hop: 1 });
    expect(JSON.stringify(out)).not.toContain(SECRET);
    expect(t.calls).toHaveLength(1);
  });

  it('跳轉沒有 Location → redirect-invalid', async () => {
    const t = fakeTransport(() => ({ status: 301 }));
    const f = fetcher({ resolver: countingResolver().resolver, transport: t.transport });
    expect(await f.fetchUrl('https://a.test/', 'agent')).toMatchObject({ ok: false, code: 'redirect-invalid' });
  });
});

describe('請求', () => {
  it('只送 GET 該有的標頭：User-Agent、Accept、Accept-Encoding；沒有 Cookie、Authorization', async () => {
    const t = fakeTransport(() => ({}));
    const f = fetcher({ resolver: countingResolver().resolver, transport: t.transport });
    await f.fetchUrl('https://a.test/', 'agent');
    const headers = t.calls[0]!.headers;
    expect(Object.keys(headers).sort()).toEqual(['accept', 'accept-encoding', 'user-agent']);
    expect(headers['user-agent']).toContain('Galley/');
  });
});

describe('回應', () => {
  const run = async (reply: FakeReply, limits = {}) => {
    const t = fakeTransport(() => reply);
    const f = fetcher({ resolver: countingResolver().resolver, transport: t.transport, limits });
    return f.fetchUrl('https://a.test/', 'agent');
  };

  it('text/html 抽文字、text/plain 原樣', async () => {
    expect(await run({ body: '<p>Hello <b>you</b></p><script>x()</script>' })).toMatchObject({ ok: true, text: 'Hello you' });
    expect(await run({ headers: { 'content-type': 'text/plain' }, body: ' a  b ' })).toMatchObject({ ok: true, text: 'a  b' });
  });

  it('Big5 網頁照 charset 解碼', async () => {
    const big5 = Buffer.from([0xa4, 0xa4, 0xa4, 0xe5]); // 「中文」
    expect(await run({ headers: { 'content-type': 'text/html; charset=big5' }, body: big5 })).toMatchObject({ ok: true, text: '中文' });
  });

  it('錯誤 Content-Type 被拒', async () => {
    expect(await run({ headers: { 'content-type': 'image/png' } })).toMatchObject({ ok: false, code: 'content-type' });
    expect(await run({ headers: { 'content-type': 'application/pdf' } })).toMatchObject({ ok: false, code: 'content-type' });
    expect(await run({ headers: { 'content-type': '' } })).toMatchObject({ ok: false, code: 'content-type' });
  });

  it('Agent 給的網址回 JSON 被拒（只有維基 API 收 JSON）', async () => {
    expect(await run({ headers: { 'content-type': 'application/json' }, body: '{}' })).toMatchObject({
      ok: false,
      code: 'content-type',
    });
  });

  it('HTTP 狀態不是 2xx → http-status', async () => {
    expect(await run({ status: 404 })).toMatchObject({ ok: false, code: 'http-status', status: 404, reason: '網站回應 HTTP 404，沒抓' });
  });

  it('超大本體（沒宣告長度，邊讀邊算）', async () => {
    const out = await run(
      {
        body: () =>
          (async function* () {
            for (let i = 0; i < 100; i += 1) yield Buffer.alloc(64 * 1024, 0x61);
          })(),
      },
      {},
    );
    expect(out).toMatchObject({ ok: false, code: 'too-large' });
  });

  it('Content-Length 宣告超過上限，直接拒', async () => {
    expect(await run({ headers: { 'content-length': String(3 * 1024 * 1024) } })).toMatchObject({ ok: false, code: 'too-large' });
  });

  it('壓縮炸彈：壓縮後很小、解壓後超過 2 MB', async () => {
    const bomb = gzipSync(Buffer.alloc(3 * 1024 * 1024, 0x61));
    expect(bomb.length).toBeLessThan(64 * 1024);
    expect(await run({ headers: { 'content-encoding': 'gzip' }, body: bomb })).toMatchObject({ ok: false, code: 'too-large' });
  });

  it('gzip 正常解壓', async () => {
    expect(await run({ headers: { 'content-encoding': 'gzip' }, body: gzipSync('<p>壓縮</p>') })).toMatchObject({ ok: true, text: '壓縮' });
  });

  it('不支援的壓縮格式被拒', async () => {
    expect(await run({ headers: { 'content-encoding': 'zstd' } })).toMatchObject({ ok: false, code: 'encoding' });
  });

  it('標頭先到、本體一直不來 → 逾時（涵蓋本體）', async () => {
    const out = await run(
      {
        body: () =>
          (async function* () {
            yield Buffer.from('<p>start');
            await new Promise(() => undefined);
          })(),
      },
      { timeoutMs: 50 },
    );
    expect(out).toMatchObject({ ok: false, code: 'timeout' });
  });

  it('標頭一直不來 → 逾時', async () => {
    const t: Transport = () => new Promise(() => undefined);
    const f = fetcher({ resolver: countingResolver().resolver, transport: t, limits: { timeoutMs: 50 } });
    expect(await f.fetchUrl('https://a.test/', 'agent')).toMatchObject({ ok: false, code: 'timeout' });
  });

  it('深層 <div>：抽文字超過時間上限 → too-complex（白話原因），不卡住、不丟例外', async () => {
    const out = await run({ body: '<div>'.repeat(400_000) }, { extractTimeoutMs: 1_000 });
    expect(out).toMatchObject({ ok: false, code: 'too-complex', reason: '網頁結構太複雜，沒讀' });
  }, 10_000);

  it('深層 <span>：正常抽出，不丟例外', async () => {
    expect(await run({ body: `${'<span>'.repeat(10_000)}深處` })).toMatchObject({ ok: true, text: '深處' });
  });

  it('傳輸丟例外 → 結構化的 network，不丟到呼叫方', async () => {
    const t: Transport = async () => {
      throw new Error('ECONNRESET');
    };
    const f = fetcher({ resolver: countingResolver().resolver, transport: t });
    expect(await f.fetchUrl('https://a.test/', 'agent')).toMatchObject({ ok: false, code: 'network' });
  });
});

describe('數量上限（這次查證的額度）', () => {
  it('第 13 個嘗試被拒', async () => {
    const t = fakeTransport(() => ({}));
    const f = fetcher({ resolver: countingResolver().resolver, transport: t.transport });
    for (let i = 0; i < 12; i += 1) {
      expect(await f.fetchUrl(`https://h${i}.test/`, 'agent')).toMatchObject({ ok: true });
    }
    expect(await f.fetchUrl('https://h12.test/', 'agent')).toMatchObject({ ok: false, code: 'budget-attempts' });
    expect(t.calls).toHaveLength(12);
  });

  it('同主機第 4 個被拒（大小寫視為同一主機）', async () => {
    const t = fakeTransport(() => ({}));
    const f = fetcher({ resolver: countingResolver().resolver, transport: t.transport });
    for (const p of ['a', 'b', 'c']) expect(await f.fetchUrl(`https://Same.test/${p}`, 'agent')).toMatchObject({ ok: true });
    expect(await f.fetchUrl('https://same.TEST/d', 'agent')).toMatchObject({ ok: false, code: 'budget-host' });
    expect(await f.fetchUrl('https://other.test/', 'agent')).toMatchObject({ ok: true });
  });

  it('主機名結尾的點視為同一台（e.test. 與 e.test）', async () => {
    const t = fakeTransport(() => ({}));
    const f = fetcher({ resolver: countingResolver().resolver, transport: t.transport });
    for (const h of ['e.test', 'e.test.', 'E.TEST']) expect(await f.fetchUrl(`https://${h}/`, 'agent')).toMatchObject({ ok: true });
    expect(await f.fetchUrl('https://e.test./x', 'agent')).toMatchObject({ ok: false, code: 'budget-host' });
  });

  it('同時不超過 3 個', async () => {
    const release: Array<() => void> = [];
    const t = fakeTransport(() => new Promise<FakeReply>((r) => release.push(() => r({}))));
    const f = fetcher({ resolver: countingResolver().resolver, transport: t.transport });
    const all = Promise.all([0, 1, 2, 3, 4, 5].map((i) => f.fetchUrl(`https://c${i}.test/`, 'agent')));
    for (let round = 0; round < 6; round += 1) {
      await new Promise((r) => setTimeout(r, 5));
      expect(f.budget.usage.active).toBeLessThanOrEqual(3);
      release.shift()?.();
    }
    while (release.length) {
      release.shift()!();
      await new Promise((r) => setTimeout(r, 5));
    }
    const results = await all;
    expect(results.every((r) => r.ok)).toBe(true);
    expect(t.maxInFlight).toBe(3);
  });
});

// --- 真實傳輸（node:https），只連 127.0.0.1 的本機測試伺服器 ---

const fixtures = fileURLToPath(new URL('./fixtures/fetch/', import.meta.url));
const cert = readFileSync(`${fixtures}test-cert.pem`);
const key = readFileSync(`${fixtures}test-key.pem`);

describe('預設傳輸（本機測試伺服器）', () => {
  let server: HttpsServer;
  let proxy: NetServer;
  let serverPort = 0;
  let proxyPort = 0;
  let serverHits = 0;
  let proxyHits = 0;
  const savedEnv = { ...process.env };

  beforeEach(async () => {
    serverHits = 0;
    proxyHits = 0;
    server = createHttpsServer({ key, cert }, (req, res) => {
      serverHits += 1;
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(
        `<p>${req.method} hello ${req.headers['user-agent'] ?? ''} cookie=${req.headers.cookie ?? 'none'} auth=${req.headers.authorization ?? 'none'}</p>`,
      );
    });
    proxy = createNetServer((sock) => {
      proxyHits += 1;
      sock.destroy();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    await new Promise<void>((r) => proxy.listen(0, '127.0.0.1', r));
    serverPort = (server.address() as AddressInfo).port;
    proxyPort = (proxy.address() as AddressInfo).port;
  });

  afterEach(async () => {
    process.env = { ...savedEnv };
    await new Promise((r) => server.close(r));
    await new Promise((r) => proxy.close(r));
  });

  const toLocal: Resolver = async () => [{ address: '127.0.0.1', family: 4 }];

  it('照注入的解析連線，不經 HTTPS_PROXY（同一個行程裡設環境變數）', async () => {
    process.env.HTTPS_PROXY = `http://127.0.0.1:${proxyPort}`;
    process.env.https_proxy = `http://127.0.0.1:${proxyPort}`;
    process.env.NODE_USE_ENV_PROXY = '1';
    const transport = createHttpsTransport({ ca: cert });
    const res = await transport({
      url: new URL(`https://example.test:${serverPort}/`),
      headers: { 'user-agent': 'ua-test' },
      signal: new AbortController().signal,
      lookup: toLocal,
    });
    let body = '';
    for await (const chunk of res.body) body += Buffer.from(chunk).toString();
    expect(res.status).toBe(200);
    expect(body).toContain('GET hello ua-test cookie=none auth=none');
    expect(serverHits).toBe(1);
    expect(proxyHits).toBe(0);
  });

  const runChild = async (mode: 'transport' | 'control'): Promise<Record<string, unknown>> => {
    const child = spawn(process.execPath, ['--import', 'tsx', `${fixtures}proxy-child.ts`, mode, String(serverPort)], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: {
        ...process.env,
        NODE_USE_ENV_PROXY: '1',
        HTTPS_PROXY: `http://127.0.0.1:${proxyPort}`,
        https_proxy: `http://127.0.0.1:${proxyPort}`,
        NO_PROXY: '',
        no_proxy: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    const code = await new Promise<number | null>((r) => child.on('close', r));
    expect(err).toBe('');
    expect(code).toBe(0);
    return JSON.parse(out) as Record<string, unknown>;
  };

  it('子行程啟動時就設 NODE_USE_ENV_PROXY=1 與 HTTPS_PROXY：預設傳輸照樣不經代理', async () => {
    const result = await runChild('transport');
    expect(result).toMatchObject({ status: 200 });
    expect(serverHits).toBe(1);
    expect(proxyHits).toBe(0);
    if (Number(process.versions.node.split('.')[0]) >= 24) {
      // 對照組：同樣的環境下全域 fetch 確實去連了代理——上面的 0 才有意義
      await runChild('control');
      expect(proxyHits).toBeGreaterThanOrEqual(1);
    }
  }, 30_000);

  describe('NODE_TLS_REJECT_UNAUTHORIZED=0 時照樣驗憑證', () => {
    beforeEach(() => {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    });

    const request = (host: string, transport: Transport) =>
      transport({
        url: new URL(`https://${host}:${serverPort}/`),
        headers: {},
        signal: AbortSignal.timeout(5_000),
        lookup: toLocal,
      });

    it('不受信任的憑證（沒給測試 CA）→ 失敗、伺服器沒收到請求', async () => {
      await expect(request('example.test', createHttpsTransport())).rejects.toThrow();
      expect(serverHits).toBe(0);
    });

    it('憑證主機名對不上 → 失敗、伺服器沒收到請求', async () => {
      await expect(request('other.test', createHttpsTransport({ ca: cert }))).rejects.toThrow(/other\.test|altnames|Hostname/i);
      expect(serverHits).toBe(0);
    });

    it('對照：主機名對、CA 對就連得上', async () => {
      const res = await request('example.test', createHttpsTransport({ ca: cert }));
      res.discard();
      expect(res.status).toBe(200);
    });
  });

  it('真實傳輸也走位址檢查：解析到 127.0.0.1 就不連線', async () => {
    const f = createSourceFetcher({
      articleText: '',
      containsSecret: () => false,
      userAgent: 'ua',
      resolver: toLocal,
      transport: createHttpsTransport({ ca: cert }),
    });
    expect(await f.fetchUrl('https://example.test/', 'agent')).toMatchObject({ ok: false, code: 'blocked-address' });
    expect(serverHits).toBe(0);
  });
});

describe('依賴方向', () => {
  it('src/fetch 只 import Node 內建、parse5 與同資料夾的檔', () => {
    const dir = fileURLToPath(new URL('../src/fetch/', import.meta.url));
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
      const source = readFileSync(`${dir}${file}`, 'utf8');
      const specs = [...source.matchAll(/(?:import|export)[^'"]*?from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]!);
      for (const spec of specs) {
        expect(spec.startsWith('node:') || spec === 'parse5' || /^\.\/[\w-]+\.js$/.test(spec), `${file}: ${spec}`).toBe(true);
      }
    }
  });
});
