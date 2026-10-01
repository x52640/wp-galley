/**
 * 取回器共用型別與白話失敗原因（D-034，P6-T002）。
 * 安全硬性要求的家：docs/specs/security.md「取回器」。
 *
 * 本資料夾只 import Node 內建與 parse5；文章文字、containsSecret、User-Agent 由呼叫方傳入。
 */

/** 一次查證的上限（security.md「取回器」的數字）。測試可以調小，正式一律用預設。 */
export interface FetchLimits {
  /** 整個網址最長幾字（Agent 給的網址、每一跳跳轉、我們組的維基網址都算）。 */
  readonly maxUrlLength: number;
  /** 查詢字串最長幾字（只對 Agent 給的網址與跳轉）。 */
  readonly maxQueryLength: number;
  /** 文章連續幾字算「文章片段」。 */
  readonly articleFragmentLength: number;
  /** 最多跳幾次。 */
  readonly maxRedirects: number;
  /** 壓縮前與解壓後各自的上限（bytes）。 */
  readonly maxBytes: number;
  /** 單次抓取（含所有跳轉、含本體讀完）的逾時。 */
  readonly timeoutMs: number;
  /** 一次查證最多嘗試幾個網址（不含維基 API）。 */
  readonly maxAttempts: number;
  /** 同時幾個請求（含維基 API）。 */
  readonly maxConcurrent: number;
  /** 同一主機最多幾個網址。 */
  readonly maxPerHost: number;
  /** 維基百科 API 最多幾次（搜尋與 extracts 各算一次）。 */
  readonly maxWikipediaCalls: number;
}

export const DEFAULT_FETCH_LIMITS: FetchLimits = Object.freeze({
  maxUrlLength: 300,
  maxQueryLength: 120,
  articleFragmentLength: 12,
  maxRedirects: 3,
  maxBytes: 2 * 1024 * 1024,
  timeoutMs: 10_000,
  maxAttempts: 12,
  maxConcurrent: 3,
  maxPerHost: 3,
  maxWikipediaCalls: 30,
});

/** 網址從哪來；決定外洩檢查做哪些項目（security.md「外洩檢查」）。 */
export type UrlOrigin =
  /** 第一趟 Agent 給的網址：全部檢查。 */
  | 'agent'
  /** 文章裡本來就有的連結：不做「文章片段」，其餘照做。 */
  | 'article-link'
  /** 我們自己組的維基百科 API 網址：只過 containsSecret 與長度。 */
  | 'wikipedia-api';

export type FetchFailureCode =
  | 'invalid-url'
  | 'protocol'
  | 'port'
  | 'credentials'
  | 'host'
  | 'too-long'
  | 'query-too-long'
  | 'article-text'
  | 'secret'
  | 'blocked-address'
  | 'dns'
  | 'too-many-redirects'
  | 'redirect-invalid'
  | 'http-status'
  | 'content-type'
  | 'encoding'
  | 'too-large'
  | 'timeout'
  | 'network'
  | 'budget-attempts'
  | 'budget-host'
  | 'budget-wikipedia'
  | 'wikipedia-not-found'
  | 'wikipedia-bad-response';

export interface FetchFailure {
  readonly ok: false;
  readonly code: FetchFailureCode;
  /** 給畫面的白話原因（P6-T005 顯示在來源旁）。不含密碼。 */
  readonly reason: string;
  /** 失敗發生在第幾跳（0＝原本的網址）。 */
  readonly hop: number;
  readonly status?: number;
}

export interface FetchSuccess {
  readonly ok: true;
  /** 最後實際抓到內容的網址（跳轉之後、去掉 #）。 */
  readonly finalUrl: string;
  /** 小寫、不含參數的 Content-Type，例如 `text/html`。 */
  readonly contentType: string;
  /** 解碼後的本體文字（還沒抽文字）。 */
  readonly body: string;
}

export type FetchOutcome = FetchSuccess | FetchFailure;

/** DNS 解析：回傳該主機名的**所有**位址。測試一律注入假的。 */
export interface ResolvedAddress {
  readonly address: string;
  readonly family: 4 | 6;
}
export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>;

/** 傳輸層請求。`lookup` 是已經過位址檢查的解析，傳輸**只能**用它決定連到哪。 */
export interface TransportRequest {
  readonly url: URL;
  readonly headers: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
  readonly lookup: Resolver;
}

export interface TransportResponse {
  readonly status: number;
  /** 標頭名稱一律小寫。 */
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly body: AsyncIterable<Uint8Array>;
  /** 不讀本體就結束時呼叫（跳轉、狀態碼不對）。 */
  readonly discard: () => void;
}

export type Transport = (request: TransportRequest) => Promise<TransportResponse>;

/** 位址檢查失敗時，guarded lookup 丟的錯誤；傳輸層不該吞掉它。 */
export class BlockedAddressError extends Error {
  readonly code = 'EBLOCKEDADDRESS';
  constructor() {
    super('blocked address');
    this.name = 'BlockedAddressError';
  }
}

const REASONS: Record<FetchFailureCode, string> = {
  'invalid-url': '網址格式不對，沒抓',
  protocol: '不是 https 網址，沒抓',
  port: '網址指定了 443 以外的連接埠，沒抓',
  credentials: '網址裡帶帳號密碼，沒抓',
  host: '網址指向本機或不是一般網域（IP、localhost、沒有點的名稱），沒抓',
  'too-long': '網址太長，沒抓',
  'query-too-long': '網址的查詢字串太長，沒抓',
  'article-text': '網址含文章原句，沒抓',
  secret: '網址含 WordPress 應用程式密碼，沒抓',
  'blocked-address': '這個網域指向本機或內部網路的位址，沒抓',
  dns: '找不到這個網域',
  'too-many-redirects': '跳轉太多次，沒抓',
  'redirect-invalid': '網站要求跳轉但沒給新網址',
  'http-status': '網站回應錯誤',
  'content-type': '不是網頁或純文字，沒抓',
  encoding: '網站用了不支援的壓縮格式，沒抓',
  'too-large': '網頁太大，沒抓完',
  timeout: '網站太久沒回應完，沒抓完',
  network: '連不上網站',
  'budget-attempts': '這次查證抓的網址已達上限，沒再抓',
  'budget-host': '同一個網站這次已抓到上限，沒再抓',
  'budget-wikipedia': '這次查證查維基百科已達上限，沒再查',
  'wikipedia-not-found': '維基百科沒有找到這個條目',
  'wikipedia-bad-response': '維基百科的回應看不懂',
};

export function failure(
  code: FetchFailureCode,
  hop = 0,
  extra: { status?: number; detail?: string } = {},
): FetchFailure {
  let reason = REASONS[code];
  if (code === 'http-status' && extra.status !== undefined) reason = `網站回應 HTTP ${extra.status}，沒抓`;
  if (code === 'content-type' && extra.detail) reason = `不是網頁或純文字（${extra.detail}），沒抓`;
  if (hop > 0 && isUrlCheck(code)) reason = `跳轉到的${reason}`;
  return {
    ok: false,
    code,
    reason,
    hop,
    ...(extra.status !== undefined ? { status: extra.status } : {}),
  };
}

function isUrlCheck(code: FetchFailureCode): boolean {
  return [
    'invalid-url',
    'protocol',
    'port',
    'credentials',
    'host',
    'too-long',
    'query-too-long',
    'article-text',
    'secret',
  ].includes(code);
}
