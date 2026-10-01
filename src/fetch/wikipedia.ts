/**
 * 維基百科（factcheck.md「維基百科」）：組網址、認條目網址、解析回應。純函式；真正發請求在 index.ts。
 * - 搜尋：`https://<lang>.wikipedia.org/w/rest.php/v1/search/page?q=…&limit=1`
 * - 內文：action API `prop=extracts&explaintext=1`（純文字）
 * - 不用 api.wikimedia.org（2026-07 起逐步停用）。
 * - 中文要繁體：`Accept-Language: zh-TW` 加上 action API 的 `variant=zh-tw`（哪個真的有效未證實，P6-T005 看畫面確認）。
 */

const LANG = /^[a-z]{2,12}(?:-[a-z0-9]{2,10}){0,2}$/;
const HOST = /^([a-z]{2,12}(?:-[a-z0-9]{2,10}){0,2})\.(?:m\.)?wikipedia\.org$/;
/** 搜尋字串最多送幾字（我們組的網址也有長度上限）。 */
export const MAX_WIKIPEDIA_QUERY = 80;

export function isWikipediaLang(lang: string): boolean {
  return LANG.test(lang);
}

/**
 * Agent 或文章給的維基條目網址（`<lang>.wikipedia.org/wiki/…`、手機版 `m.`、`/zh-tw/…` 這類變體路徑）
 * 改走 API；認不得的回 null（當一般網頁抓）。
 */
export function parseWikipediaArticleUrl(url: URL): { lang: string; title: string } | null {
  const host = HOST.exec(url.hostname.toLowerCase());
  if (!host) return null;
  const lang = host[1]!;
  const match = /^\/(?:wiki|zh-[a-z]+)\/(.+)$/.exec(url.pathname);
  let rawTitle = match?.[1];
  if (!rawTitle && url.pathname === '/w/index.php') rawTitle = url.searchParams.get('title') ?? undefined;
  if (!rawTitle) return null;
  let title: string;
  try {
    title = decodeURIComponent(rawTitle);
  } catch {
    return null;
  }
  title = title.replace(/_/g, ' ').trim();
  // 特殊頁、檔案頁、分類頁不是條目：當一般網頁處理（照樣過全套檢查）。
  if (title === '' || /^(special|特殊|file|檔案|文件|category|分類|分类):/i.test(title)) return null;
  return { lang, title };
}

export function wikipediaAcceptLanguage(lang: string): string | undefined {
  return lang === 'zh' ? 'zh-TW' : undefined;
}

export function buildSearchUrl(lang: string, query: string): URL {
  const url = new URL(`https://${lang}.wikipedia.org/w/rest.php/v1/search/page`);
  url.searchParams.set('q', Array.from(query.trim()).slice(0, MAX_WIKIPEDIA_QUERY).join(''));
  url.searchParams.set('limit', '1');
  return url;
}

export function buildExtractUrl(lang: string, title: string): URL {
  const url = new URL(`https://${lang}.wikipedia.org/w/api.php`);
  url.searchParams.set('action', 'query');
  url.searchParams.set('format', 'json');
  url.searchParams.set('formatversion', '2');
  url.searchParams.set('prop', 'extracts');
  url.searchParams.set('explaintext', '1');
  url.searchParams.set('redirects', '1');
  url.searchParams.set('titles', title);
  if (lang === 'zh') url.searchParams.set('variant', 'zh-tw');
  return url;
}

/** 給畫面的條目網址（連結用；不會拿去抓）。 */
export function articleUrl(lang: string, title: string): string {
  return `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
}

/** REST 搜尋回應 → 第一筆的標題；沒有結果回 null；格式不對丟錯。 */
export function parseSearchResponse(json: unknown): string | null {
  const pages = (json as { pages?: unknown })?.pages;
  if (!Array.isArray(pages)) throw new Error('bad search response');
  const first = pages[0] as { title?: unknown } | undefined;
  if (!first) return null;
  if (typeof first.title !== 'string' || first.title === '') throw new Error('bad search response');
  return first.title;
}

/** action API extracts 回應（formatversion=2）→ 標題與純文字；條目不存在回 null；格式不對丟錯。 */
export function parseExtractResponse(json: unknown): { title: string; text: string } | null {
  const pages = (json as { query?: { pages?: unknown } })?.query?.pages;
  if (!Array.isArray(pages)) throw new Error('bad extract response');
  const page = pages[0] as { title?: unknown; extract?: unknown; missing?: unknown; invalid?: unknown } | undefined;
  if (!page || page.missing || page.invalid) return null;
  if (typeof page.title !== 'string') throw new Error('bad extract response');
  const text = typeof page.extract === 'string' ? page.extract.trim() : '';
  if (text === '') return null;
  return { title: page.title, text };
}
