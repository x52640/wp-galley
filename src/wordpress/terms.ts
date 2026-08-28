import type { WordPressClient } from './client.js';
import { TermListSchema, type Term } from './schemas.js';

/**
 * 分類項目（term）的查詢與解析。
 *
 * **預設不建立新項目**，這是刻意的。Agent 很容易生出「經濟」「經濟學」
 * 「經濟學思考」這種近義詞，自動建立幾個月後分類就變垃圾場。所以流程是：
 * 對不上既有項目的名稱會被原樣回報，由使用者在 UI 上決定要對應到哪個既有項目、
 * 還是明確地建立新項目。
 *
 * 三個名詞不要混淆（WordPress 自己的命名也很混亂）：
 * - taxonomy（分類法）：`read-think-tag`、`diary-category`，是容器
 * - term（分類項目）：「隨筆」「藝術」，是實際貼上去的標籤
 * - post type（內容類型）：`read-think`、`diary`，是文章的種類
 *
 * 另外：`read-think-tag` 名字叫 tag 但 hierarchical 是 true，行為其實是分類。
 * 判斷行為一律看 hierarchical，不要看名字。
 */

/** WordPress 的 per_page 上限是 100。 */
const PAGE_SIZE = 100;

export async function listTerms(client: WordPressClient, restBase: string): Promise<Term[]> {
  const all: Term[] = [];
  for (let page = 1; ; page += 1) {
    const { data, totalPages } = await client.request(`/wp/v2/${restBase}`, {
      query: { per_page: PAGE_SIZE, page, context: 'edit', orderby: 'name', order: 'asc' },
      schema: TermListSchema,
    });
    all.push(...data);
    if (data.length < PAGE_SIZE || totalPages === null || page >= totalPages) break;
  }
  return all;
}

/** 比對用的正規化：去空白、轉小寫、全形空白也算空白。 */
function normalize(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

export interface ResolvedTerm {
  readonly requested: string;
  readonly term: Term;
}

export interface TermResolution {
  /** 對得上的項目。 */
  readonly resolved: readonly ResolvedTerm[];
  /** 對不上的名稱，原樣保留讓使用者處理。 */
  readonly unknown: readonly string[];
  /** 這次實際建立的項目；allowCreate 為 false 時永遠是空的。 */
  readonly created: readonly Term[];
  /** 可以直接送進 REST 的 term id 陣列。 */
  readonly ids: readonly number[];
}

export interface ResolveTermsOptions {
  /**
   * 允許建立不存在的項目。**預設 false**，而且只該由使用者在 UI 上明確開啟，
   * 絕不能讓 Agent 或 MCP 自己決定。
   */
  readonly allowCreate?: boolean;
  /** 已經抓過的項目清單，避免重複請求。 */
  readonly existing?: readonly Term[];
}

export async function resolveTerms(
  client: WordPressClient,
  restBase: string,
  names: readonly string[],
  options: ResolveTermsOptions = {},
): Promise<TermResolution> {
  // 先去重，順序保留使用者給的順序。
  const wanted: string[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    const key = normalize(name);
    if (key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    wanted.push(name.trim());
  }
  if (wanted.length === 0) return { resolved: [], unknown: [], created: [], ids: [] };

  const existing = options.existing ?? (await listTerms(client, restBase));

  // 名稱與 slug 都拿來比對：使用者可能填「隨筆」也可能填「essay」。
  const byKey = new Map<string, Term>();
  for (const term of existing) {
    byKey.set(normalize(term.name), term);
    byKey.set(normalize(term.slug), term);
    // slug 可能是 URL 編碼過的中文（正式站的「經濟學」就是），解碼後也要對得上。
    try {
      byKey.set(normalize(decodeURIComponent(term.slug)), term);
    } catch {
      // slug 不是合法的百分比編碼就跳過，不影響其他比對。
    }
  }

  const resolved: ResolvedTerm[] = [];
  const unknown: string[] = [];
  const created: Term[] = [];

  for (const name of wanted) {
    const match = byKey.get(normalize(name));
    if (match) {
      resolved.push({ requested: name, term: match });
      continue;
    }
    if (!options.allowCreate) {
      unknown.push(name);
      continue;
    }
    const term = await createTerm(client, restBase, name);
    created.push(term);
    resolved.push({ requested: name, term });
    byKey.set(normalize(term.name), term);
  }

  return {
    resolved,
    unknown,
    created,
    ids: resolved.map((entry) => entry.term.id),
  };
}

/**
 * 建立分類項目。故意不 export 給一般流程用——只有 resolveTerms 在
 * allowCreate 為 true 時才會走到這裡。
 */
async function createTerm(client: WordPressClient, restBase: string, name: string): Promise<Term> {
  const { data } = await client.request(`/wp/v2/${restBase}`, {
    method: 'POST',
    body: { name },
    schema: TermListSchema.element,
    // 建立東西不重試：重試可能建出兩個同名項目。
    maxRetries: 0,
  });
  return data;
}
