/**
 * 網址檢查（security.md「取回器」的「協定與埠」「外洩檢查」）。
 * 全部是純函式，在 DNS 解析**之前**做完：不合格的網址連 DNS 查詢都不發。
 */
import { isIP } from 'node:net';
import { domainToUnicode } from 'node:url';
import type { FetchFailureCode, FetchLimits, UrlOrigin } from './types.js';

export type UrlCheck = { ok: true; url: URL } | { ok: false; code: FetchFailureCode };

/** 協定、埠、帳密、主機。成功時回傳去掉 `#` 的 URL（片段不會送出，也不參與後面的檢查）。 */
export function checkUrlFormat(raw: string | URL): UrlCheck {
  let url: URL;
  try {
    url = new URL(typeof raw === 'string' ? raw.trim() : raw.href);
  } catch {
    return { ok: false, code: 'invalid-url' };
  }
  if (url.protocol !== 'https:') return { ok: false, code: 'protocol' };
  // WHATWG URL 會把 :443 正規化成空字串；其他任何埠都拒絕。
  if (url.port !== '') return { ok: false, code: 'port' };
  if (url.username !== '' || url.password !== '') return { ok: false, code: 'credentials' };
  if (!isAllowedHostname(url.hostname)) return { ok: false, code: 'host' };
  url.hash = '';
  return { ok: true, url };
}

function isAllowedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (host === '') return false;
  // IPv6 字面值在 URL 裡是 [..]；IPv4 字面值（含 0x7f.1 之類）WHATWG 已正規化成點分十進位。
  if (host.startsWith('[') || isIP(host) !== 0) return false;
  if (host === 'localhost' || host.endsWith('.localhost')) return false;
  if (!host.includes('.')) return false;
  // 全數字的最後一段（例如 1.2.3.4 以外的怪寫法被 URL 解析放過）也當成 IP。
  if (/^[0-9]+$/.test(host.split('.').pop() ?? '')) return false;
  return true;
}

export interface ExfiltrationGuardOptions {
  /** 文章目前內容的純文字。 */
  readonly articleText: string;
  /** 已知 WordPress 密碼（由呼叫方傳入 src/config 的遮蔽器判斷）。 */
  readonly containsSecret: (text: string) => boolean;
  readonly limits: Pick<FetchLimits, 'maxUrlLength' | 'maxQueryLength' | 'articleFragmentLength'>;
}

export interface ExfiltrationGuard {
  /** 這個網址能不能送出去。`origin` 決定做哪些項目；跳轉一律當 `agent`（伺服器選的，不是使用者寫的）。 */
  check(url: URL, origin: UrlOrigin): { ok: true } | { ok: false; code: FetchFailureCode };
}

/**
 * 正規化：NFKC、小寫，空白與網址常見的分字符號（`-`、`_`、`+`）視為同一個空白並摺疊。
 * 文章句子被轉成網址 slug（`台灣-的-選舉`、`hello_world`）時一樣對得上。
 */
export function normalizeForMatch(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\-_+]+/gu, ' ')
    .trim();
}

/** 把網址解碼成人看的樣子：主機名 punycode 解回 Unicode，路徑與查詢字串做 percent-decode（最多三層）。 */
export function decodedUrlForms(url: URL): string[] {
  const host = domainToUnicode(url.hostname) || url.hostname;
  const rest = url.pathname + url.search;
  const forms = new Set<string>([url.href, `${host}${rest}`]);
  let current = rest;
  for (let i = 0; i < 3; i += 1) {
    const next = safeDecode(current.replace(/\+/g, ' '));
    if (next === current) break;
    current = next;
    forms.add(`${host}${current}`);
  }
  return [...forms];
}

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    // 有不合法的 % 序列：逐段解，解不了的保留原樣。
    return text.replace(/(%[0-9a-f]{2})+/gi, (m) => {
      try {
        return decodeURIComponent(m);
      } catch {
        return m;
      }
    });
  }
}

export function createExfiltrationGuard(options: ExfiltrationGuardOptions): ExfiltrationGuard {
  const { limits, containsSecret } = options;
  const n = limits.articleFragmentLength;
  const article = Array.from(normalizeForMatch(options.articleText));
  const fragments = new Set<string>();
  for (let i = 0; i + n <= article.length; i += 1) {
    fragments.add(article.slice(i, i + n).join(''));
  }

  const hasArticleFragment = (text: string): boolean => {
    const chars = Array.from(normalizeForMatch(text));
    for (let i = 0; i + n <= chars.length; i += 1) {
      if (fragments.has(chars.slice(i, i + n).join(''))) return true;
    }
    return false;
  };

  return {
    check(url, origin) {
      const forms = decodedUrlForms(url);
      // 密碼：原樣、解碼後、去掉所有空白都要比（containsSecret 本身也會去空白再比一次）。
      if (forms.some((f) => containsSecret(f) || containsSecret(f.replace(/\s+/g, '')))) {
        return { ok: false, code: 'secret' };
      }
      if (origin === 'wikipedia-api') {
        // 我們組的網址：中文標題 percent-encode 後很長，用解碼後的字數算。
        const decoded = forms[forms.length - 1] ?? url.href;
        if (Array.from(decoded).length > limits.maxUrlLength) return { ok: false, code: 'too-long' };
        return { ok: true };
      }
      if (url.href.length > limits.maxUrlLength) return { ok: false, code: 'too-long' };
      if (url.search.length > limits.maxQueryLength) return { ok: false, code: 'query-too-long' };
      if (origin === 'agent' && n > 0 && fragments.size > 0 && forms.some(hasArticleFragment)) {
        return { ok: false, code: 'article-text' };
      }
      return { ok: true };
    },
  };
}

/**
 * 第一趟產出的候選網址在任何抓取之前整批檢查（security.md「WordPress 密碼」）：
 * 任一含已知密碼就回 true，呼叫方要讓整次查證失敗、一個都不抓。
 */
export function anyUrlContainsSecret(
  urls: readonly string[],
  containsSecret: (text: string) => boolean,
): boolean {
  return urls.some((raw) => {
    const forms = [raw, safeDecode(raw), safeDecode(safeDecode(raw))];
    try {
      forms.push(...decodedUrlForms(new URL(raw)));
    } catch {
      // 不是合法網址也照樣比原字串
    }
    return forms.some((f) => containsSecret(f) || containsSecret(f.replace(/\s+/g, '')));
  });
}
