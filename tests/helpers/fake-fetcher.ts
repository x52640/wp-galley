import { FetchBudget } from '../../src/fetch/budget.js';
import { DEFAULT_FETCH_LIMITS, failure, type FetchFailureCode } from '../../src/fetch/types.js';
import type { SourceFetcher, SourceOutcome } from '../../src/fetch/index.js';
import type { FactCheckFetcherFactory } from '../../src/core/service.js';

/**
 * AI 查證測試用的假取回器（P6-T004）。**不連任何網路**：每個網址、每次維基百科查詢都照這裡給的表回答。
 *
 * - `pages`：網址 → 抓到的文字（可指定跳轉後的最終網址），或失敗原因代碼（`{ fail: 'too-large' }`）。表裡沒有的網址回 `dns`。
 * - `wikipedia`：`<lang>:<搜尋字串>` → 條目標題與純文字；沒有的回「維基百科沒有找到這個條目」。
 * - `hang`：抓這個網址時一直等，直到使用者按停止（signal abort）才回逾時——測「抓取中停止」。
 * - `onFetch`：每次抓取前呼叫（測「抓網頁階段」的鎖與互斥）。
 */
export interface FakeFetcherOptions {
  readonly pages?: Readonly<Record<string, { readonly text: string; readonly finalUrl?: string } | { readonly fail: FetchFailureCode }>>;
  readonly wikipedia?: Readonly<Record<string, { readonly title: string; readonly text: string }>>;
  readonly hang?: (url: string) => boolean;
  readonly onFetch?: (url: string) => void | Promise<void>;
}

export interface FakeFetcherCall {
  readonly kind: 'url' | 'wikipedia-search' | 'wikipedia-extract';
  readonly target: string;
  readonly origin?: 'agent' | 'article-link';
}

export interface FakeFetcher {
  readonly factory: FactCheckFetcherFactory;
  /** 每一次抓取／查詢（依發生順序）。 */
  readonly calls: FakeFetcherCall[];
  /** 每次查證建立時拿到的輸入（文章文字、signal）。 */
  readonly created: { articleText: string; signal: AbortSignal; containsSecret: (text: string) => boolean }[];
}

export function createFakeFetcher(options: FakeFetcherOptions = {}): FakeFetcher {
  const calls: FakeFetcherCall[] = [];
  const created: FakeFetcher['created'] = [];

  const factory: FactCheckFetcherFactory = (input) => {
    created.push({ articleText: input.articleText, signal: input.signal, containsSecret: input.containsSecret });
    const waitForAbort = (): Promise<void> =>
      new Promise((resolve) => {
        if (input.signal.aborted) resolve();
        else input.signal.addEventListener('abort', () => resolve(), { once: true });
      });

    const fetcher: SourceFetcher = {
      budget: new FetchBudget(DEFAULT_FETCH_LIMITS),
      async fetchUrl(url, origin): Promise<SourceOutcome> {
        calls.push({ kind: 'url', target: url, origin });
        await options.onFetch?.(url);
        if (options.hang?.(url)) {
          await waitForAbort();
          return failure('timeout');
        }
        const page = options.pages?.[url];
        if (!page) return failure('dns');
        if ('fail' in page) return failure(page.fail);
        return { ok: true, kind: 'web', url: page.finalUrl ?? url, text: page.text };
      },
      async searchWikipedia(lang, query) {
        calls.push({ kind: 'wikipedia-search', target: `${lang}:${query}` });
        const entry = options.wikipedia?.[`${lang}:${query}`];
        return entry ? { ok: true, title: entry.title } : failure('wikipedia-not-found');
      },
      async wikipediaExtract(lang, title): Promise<SourceOutcome> {
        calls.push({ kind: 'wikipedia-extract', target: `${lang}:${title}` });
        const entry = Object.entries(options.wikipedia ?? {}).find(
          ([key, value]) => key.startsWith(`${lang}:`) && value.title === title,
        )?.[1];
        if (!entry) return failure('wikipedia-not-found');
        return {
          ok: true,
          kind: 'wikipedia',
          url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(entry.title)}`,
          title: entry.title,
          text: entry.text,
        };
      },
    };
    return fetcher;
  };

  return { factory, calls, created };
}
