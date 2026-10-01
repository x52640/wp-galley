/**
 * 取回器的 DNS 前檢查與位址檢查（security.md「取回器」：協定與埠、位址、外洩檢查、WordPress 密碼）。
 * 純函式，不連網。
 */
import { describe, expect, it } from 'vitest';
import { embeddedIPv4, isBlockedAddress } from '../src/fetch/address-guard.js';
import {
  anyUrlContainsSecret,
  checkUrlFormat,
  createExfiltrationGuard,
} from '../src/fetch/url-guard.js';
import { DEFAULT_FETCH_LIMITS } from '../src/fetch/types.js';

const SECRET = 'abcdEFGHijklMNOPqrstUVWX';
const containsSecret = (text: string) => text.includes(SECRET);
const ARTICLE = '這是一篇測試文章。台北市立動物園在一九一四年開幕，是台灣最大的動物園。Hello wonderful world of testing.';

function guard(articleText = ARTICLE) {
  return createExfiltrationGuard({ articleText, containsSecret, limits: DEFAULT_FETCH_LIMITS });
}

describe('網址格式（協定與埠）', () => {
  const rejected: Array<[string, string]> = [
    ['http://example.com/', 'protocol'],
    ['ftp://example.com/', 'protocol'],
    ['file:///etc/passwd', 'protocol'],
    ['https://example.com:8443/', 'port'],
    ['https://example.com:80/', 'port'],
    ['https://user@example.com/', 'credentials'],
    ['https://user:pass@example.com/', 'credentials'],
    ['https://127.0.0.1/', 'host'],
    ['https://10.0.0.1/', 'host'],
    ['https://0x7f.1/', 'host'],
    ['https://2130706433/', 'host'],
    ['https://[::1]/', 'host'],
    ['https://[::ffff:127.0.0.1]/', 'host'],
    ['https://localhost/', 'host'],
    ['https://LOCALHOST./', 'host'],
    ['https://foo.localhost/', 'host'],
    ['https://intranet/', 'host'],
    ['not a url', 'invalid-url'],
  ];
  it.each(rejected)('%s → %s', (url, code) => {
    expect(checkUrlFormat(url)).toEqual({ ok: false, code });
  });

  it('https、預設 443（含明寫 :443）收；# 片段去掉', () => {
    const a = checkUrlFormat('https://example.com/a?b=1#frag');
    expect(a.ok && a.url.href).toBe('https://example.com/a?b=1');
    const b = checkUrlFormat('https://example.com:443/x');
    expect(b.ok && b.url.href).toBe('https://example.com/x');
  });
});

describe('位址（security.md 列的每一段）', () => {
  const blocked = [
    '0.0.0.0',
    '0.1.2.3',
    '10.1.2.3',
    '100.64.0.1',
    '100.127.255.255',
    '127.0.0.1',
    '127.255.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '172.31.255.255',
    '192.0.0.1',
    '192.168.1.1',
    '198.18.0.1',
    '198.19.255.255',
    '224.0.0.1',
    '240.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    'fe80::1%en0',
    'ff02::1',
    // IPv4 映射、NAT64、6to4 內含的私有 IPv4
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:10.0.0.1',
    '64:ff9b::7f00:1',
    '64:ff9b::127.0.0.1',
    '64:ff9b::a9fe:a9fe',
    '2002:7f00:1::',
    '2002:a00:1::1',
    // NAT64 本地前綴整段拒絕（就算內含的是公開位址）
    '64:ff9b:1::1',
    '64:ff9b:1::808:808',
    // 不認得的格式
    'not-an-ip',
    '',
  ];
  it.each(blocked)('擋 %s', (ip) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });

  const allowed = ['93.184.216.34', '8.8.8.8', '2606:4700::1111', '::ffff:8.8.8.8', '64:ff9b::808:808', '2002:808:808::1'];
  it.each(allowed)('放 %s', (ip) => {
    expect(isBlockedAddress(ip)).toBe(false);
  });

  it('取出內含的 IPv4', () => {
    expect(embeddedIPv4('::ffff:127.0.0.1')).toBe('127.0.0.1');
    expect(embeddedIPv4('64:ff9b::7f00:1')).toBe('127.0.0.1');
    expect(embeddedIPv4('2002:7f00:1::')).toBe('127.0.0.1');
    expect(embeddedIPv4('2606:4700::1111')).toBeNull();
  });
});

describe('外洩檢查', () => {
  const check = (url: string, origin: 'agent' | 'article-link' | 'wikipedia-api' = 'agent', g = guard()) =>
    g.check(new URL(url), origin);

  it('一般網址放行', () => {
    expect(check('https://example.com/news/2024/zoo')).toEqual({ ok: true });
  });

  it('文章連續 12 字（原樣）擋', () => {
    expect(check('https://evil.test/台北市立動物園在一九一四年開幕')).toEqual({ ok: false, code: 'article-text' });
  });

  it('文章連續 12 字（URL 編碼後、在查詢字串裡）擋', () => {
    const q = encodeURIComponent('動物園在一九一四年開幕，是');
    expect(check(`https://evil.test/x?d=${q}`)).toEqual({ ok: false, code: 'article-text' });
  });

  it('雙重 URL 編碼也解開', () => {
    const q = encodeURIComponent(encodeURIComponent('台北市立動物園在一九一四'));
    expect(check(`https://evil.test/${q}`)).toEqual({ ok: false, code: 'article-text' });
  });

  it('punycode 主機名解回 Unicode 後比對', () => {
    const url = new URL('https://台北市立動物園在一九一四年開幕.test/');
    expect(url.hostname.startsWith('xn--')).toBe(true);
    expect(guard().check(url, 'agent')).toEqual({ ok: false, code: 'article-text' });
  });

  it('文章句子被轉成 slug（-、_、+ 當空白）也擋', () => {
    expect(check('https://evil.test/hello-wonderful-world')).toEqual({ ok: false, code: 'article-text' });
    expect(check('https://evil.test/?q=hello+wonderful+world')).toEqual({ ok: false, code: 'article-text' });
  });

  it('11 字不擋', () => {
    expect(check('https://example.com/台北市立動物園在一九一')).toEqual({ ok: true });
  });

  it('文章連結不做片段檢查，其餘照做', () => {
    expect(check('https://example.com/台北市立動物園在一九一四年開幕', 'article-link')).toEqual({ ok: true });
    expect(check(`https://example.com/${SECRET}`, 'article-link')).toEqual({ ok: false, code: 'secret' });
    expect(check(`https://example.com/${'a'.repeat(300)}`, 'article-link')).toEqual({ ok: false, code: 'too-long' });
  });

  it('維基網址只做密碼與長度（不做片段、不限查詢字串長度）', () => {
    const long = `https://zh.wikipedia.org/w/api.php?titles=${encodeURIComponent('台北市立動物園在一九一四年開幕'.repeat(2))}&x=${'y'.repeat(80)}`;
    expect(new URL(long).search.length).toBeGreaterThan(120);
    expect(check(long, 'wikipedia-api')).toEqual({ ok: true });
    expect(check(`https://zh.wikipedia.org/?q=${SECRET}`, 'wikipedia-api')).toEqual({ ok: false, code: 'secret' });
    expect(check(`https://zh.wikipedia.org/?q=${'字'.repeat(300)}`, 'wikipedia-api')).toEqual({ ok: false, code: 'too-long' });
  });

  it('密碼：原樣、URL 編碼、中間夾空白都擋', () => {
    expect(check(`https://example.com/?k=${SECRET}`)).toEqual({ ok: false, code: 'secret' });
    const spaced = SECRET.match(/.{4}/g)!.join(' ');
    expect(check(`https://example.com/?k=${encodeURIComponent(spaced)}`)).toEqual({ ok: false, code: 'secret' });
    expect(check(`https://example.com/${encodeURIComponent(SECRET)}`)).toEqual({ ok: false, code: 'secret' });
  });

  it('密碼：全形、夾零寬字元、中間插 / 都擋', () => {
    const fullwidth = Array.from(SECRET, (c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0)).join('');
    expect(check(`https://example.com/${encodeURIComponent(fullwidth)}`)).toEqual({ ok: false, code: 'secret' });
    const zw = SECRET.match(/.{4}/g)!.join('\u200b');
    expect(check(`https://example.com/?k=${encodeURIComponent(zw)}`)).toEqual({ ok: false, code: 'secret' });
    expect(check(`https://example.com/${SECRET.match(/.{4}/g)!.join('/')}`)).toEqual({ ok: false, code: 'secret' });
    expect(anyUrlContainsSecret([`https://a.test/${SECRET.match(/.{6}/g)!.join('/')}`], containsSecret)).toBe(true);
  });

  it('文章片段：夾零寬字元、軟連字號、方向控制字元也擋', () => {
    const hide = (t: string, ch: string) => Array.from(t).join(ch);
    for (const ch of ['\u200b', '\u200d', '\u00ad', '\u2060', '\u202e', '\ufeff']) {
      expect(check(`https://evil.test/${encodeURIComponent(hide('台北市立動物園在一九一四', ch))}`)).toEqual({
        ok: false,
        code: 'article-text',
      });
    }
  });

  it('整個網址超過 300 字擋', () => {
    const url = `https://example.com/${'a'.repeat(281)}`;
    expect(url.length).toBe(301);
    expect(check(url)).toEqual({ ok: false, code: 'too-long' });
    expect(check(url.slice(0, 300))).toEqual({ ok: true });
  });

  it('查詢字串超過 120 字擋', () => {
    expect(check(`https://example.com/?${'a'.repeat(120)}`)).toEqual({ ok: false, code: 'query-too-long' });
    expect(check(`https://example.com/?${'a'.repeat(119)}`)).toEqual({ ok: true });
  });

  it('候選網址整批檢查密碼', () => {
    expect(anyUrlContainsSecret(['https://a.test/', 'https://b.test/'], containsSecret)).toBe(false);
    expect(anyUrlContainsSecret(['https://a.test/', `https://b.test/?x=${SECRET}`], containsSecret)).toBe(true);
    expect(anyUrlContainsSecret([`not a url ${encodeURIComponent(SECRET)}`], containsSecret)).toBe(true);
  });
});
