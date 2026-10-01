/**
 * 取回器入口（D-034，P6-T002）：一次查證建一個 `createSourceFetcher`，共用同一份額度。
 * 安全硬性要求：docs/specs/security.md「取回器」；來源與抽文字：docs/specs/factcheck.md「② 候選來源與抓取」。
 *
 * 只 import Node 內建與 parse5。文章文字、containsSecret、User-Agent 由呼叫方傳入；
 * DNS 解析與傳輸可注入，測試一律注入假的。
 */
import { FetchBudget } from './budget.js';
import { extractText } from './extract-text.js';
import { guardedRequest, preflight, type SafeFetchContext } from './safe-fetch.js';
import { createHttpsTransport, defaultResolver } from './transport.js';
import { createExfiltrationGuard } from './url-guard.js';
import {
  articleUrl,
  buildExtractUrl,
  buildSearchUrl,
  isWikipediaLang,
  parseExtractResponse,
  parseSearchResponse,
  parseWikipediaArticleUrl,
  wikipediaAcceptLanguage,
} from './wikipedia.js';
import {
  DEFAULT_FETCH_LIMITS,
  failure,
  type FetchFailure,
  type FetchLimits,
  type Resolver,
  type Transport,
} from './types.js';

export { anyUrlContainsSecret } from './url-guard.js';
export { truncateSources, DEFAULT_TRUNCATE_LIMITS } from './extract-text.js';
export { DEFAULT_FETCH_LIMITS } from './types.js';
export type * from './types.js';

export interface SourceFetcherOptions {
  /** 目前這一版的純文字（外洩檢查的「文章片段」用）。 */
  readonly articleText: string;
  /** src/config 的遮蔽器判斷（含去空白）；這裡不 import config。 */
  readonly containsSecret: (text: string) => boolean;
  /** 例如 `Galley/0.1.0 (+https://github.com/x52640/wp-galley)`，版本由呼叫方給。 */
  readonly userAgent: string;
  readonly resolver?: Resolver;
  readonly transport?: Transport;
  /** 只給測試調小；正式一律預設。 */
  readonly limits?: Partial<FetchLimits>;
}

export interface FetchedSource {
  readonly ok: true;
  readonly kind: 'web' | 'wikipedia';
  /** 給畫面與 Agent 的網址：網頁是跳轉後的最終網址，維基是條目網址。 */
  readonly url: string;
  /** 維基條目標題；網頁沒有。 */
  readonly title?: string;
  /** 抽好的純文字（還沒截斷；截斷用 truncateSources 對整次查證的所有來源一起做）。 */
  readonly text: string;
}

export type SourceOutcome = FetchedSource | FetchFailure;

export interface SourceFetcher {
  /** 抓 Agent 給的網址或文章裡的連結。維基條目網址自動改走 API（扣 API 額度，不扣網址嘗試）。 */
  fetchUrl(url: string, origin: 'agent' | 'article-link'): Promise<SourceOutcome>;
  /** 用搜尋字串查維基百科，取第一筆的標題。 */
  searchWikipedia(lang: string, query: string): Promise<{ ok: true; title: string } | FetchFailure>;
  /** 拿維基條目的純文字。 */
  wikipediaExtract(lang: string, title: string): Promise<SourceOutcome>;
  readonly budget: FetchBudget;
}

export function createSourceFetcher(options: SourceFetcherOptions): SourceFetcher {
  const limits: FetchLimits = { ...DEFAULT_FETCH_LIMITS, ...options.limits };
  const guard = createExfiltrationGuard({
    articleText: options.articleText,
    containsSecret: options.containsSecret,
    limits,
  });
  const ctx: SafeFetchContext = {
    resolver: options.resolver ?? defaultResolver,
    transport: options.transport ?? createHttpsTransport(),
    limits,
    guard,
    userAgent: options.userAgent,
  };
  const budget = new FetchBudget(limits);

  async function wikipediaJson(lang: string, url: URL): Promise<{ ok: true; json: unknown } | FetchFailure> {
    const checked = preflight(url, 'wikipedia-api', guard);
    if (!checked.ok) return checked;
    const taken = budget.takeWikipediaCall();
    if (!taken.ok) return failure(taken.code);
    const acceptLanguage = wikipediaAcceptLanguage(lang);
    const outcome = await budget.withSlot(() =>
      guardedRequest(ctx, checked.url, {
        origin: 'wikipedia-api',
        acceptJson: true,
        followRedirects: false,
        ...(acceptLanguage ? { acceptLanguage } : {}),
      }),
    );
    if (!outcome.ok) return outcome;
    if (outcome.contentType !== 'application/json') return failure('wikipedia-bad-response');
    try {
      return { ok: true, json: JSON.parse(outcome.body) as unknown };
    } catch {
      return failure('wikipedia-bad-response');
    }
  }

  async function wikipediaExtract(lang: string, title: string): Promise<SourceOutcome> {
    if (!isWikipediaLang(lang)) return failure('invalid-url');
    const res = await wikipediaJson(lang, buildExtractUrl(lang, title));
    if (!res.ok) return res;
    let page;
    try {
      page = parseExtractResponse(res.json);
    } catch {
      return failure('wikipedia-bad-response');
    }
    if (!page) return failure('wikipedia-not-found');
    return { ok: true, kind: 'wikipedia', url: articleUrl(lang, page.title), title: page.title, text: page.text };
  }

  return {
    budget,
    wikipediaExtract,

    async searchWikipedia(lang, query) {
      if (!isWikipediaLang(lang)) return failure('invalid-url');
      const res = await wikipediaJson(lang, buildSearchUrl(lang, query));
      if (!res.ok) return res;
      let title;
      try {
        title = parseSearchResponse(res.json);
      } catch {
        return failure('wikipedia-bad-response');
      }
      if (!title) return failure('wikipedia-not-found');
      return { ok: true, title };
    },

    async fetchUrl(raw, origin) {
      // 1. DNS 前的全部檢查（格式＋外洩）：不合格的連 DNS 查詢都不發，也不扣額度。
      const checked = preflight(raw, origin, guard);
      if (!checked.ok) return checked;

      // 2. 維基條目網址改走 API。
      const wiki = parseWikipediaArticleUrl(checked.url);
      if (wiki) return wikipediaExtract(wiki.lang, wiki.title);

      // 3. 額度，再發請求。
      const taken = budget.takeUrlAttempt(checked.url.hostname);
      if (!taken.ok) return failure(taken.code);
      const outcome = await budget.withSlot(() =>
        guardedRequest(ctx, checked.url, { origin, acceptJson: false, followRedirects: true }),
      );
      if (!outcome.ok) return outcome;
      return { ok: true, kind: 'web', url: outcome.finalUrl, text: extractText(outcome.body, outcome.contentType) };
    },
  };
}
