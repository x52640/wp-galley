import { z } from 'zod';
import { createSecretScrubber, type Scrubber } from '../config/secrets.js';
import {
  mapWordPressError,
  WordPressError,
  wordpressErrorCodes,
  type WordPressErrorBody,
} from './errors.js';

/**
 * WordPress REST 客戶端。
 *
 * 唯一一個會拿著 Application Password 的模組，所以有兩條規矩：
 *
 * 1. **密碼只出現在 Authorization 標頭。** 不進 log、不進錯誤訊息、不進回傳值。
 *    保險起見所有往外丟的字串都先過 scrubber，就算上游哪天不小心把它塞進訊息裡
 *    也會被抹掉。
 * 2. **不 import 任何 HTTP 框架。** 依賴方向是 server → wordpress。這層只用
 *    Node 內建的 fetch，才能在測試裡對著假的 WordPress 跑，也才能被 MCP 重用。
 *
 * 重試策略寫在 errors.ts 的 `retryable`：網路錯誤、429、5xx 會退避重試；
 * 認證與權限錯誤一次都不重試——重試只會讓安全外掛把帳號鎖掉。
 */

/** 預設值。全部可以在建構時覆寫，測試會把延遲關掉。 */
const DEFAULTS = {
  timeoutMs: 30_000,
  maxRetries: 3,
  /** 第 n 次重試前等 baseDelayMs * 2^(n-1) 毫秒。 */
  baseDelayMs: 500,
  maxDelayMs: 10_000,
} as const;

export interface WordPressClientOptions {
  readonly baseUrl: string;
  readonly username: string;
  readonly appPassword: string;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  readonly baseDelayMs?: number;
  /** 測試用：換掉 fetch 與 sleep，避免真的連線或真的等待。 */
  readonly fetchImpl?: typeof fetch;
  readonly sleepImpl?: (ms: number) => Promise<void>;
  /** 每次重試前呼叫，讓上層可以記錄。收到的資訊已經過 scrubber。 */
  readonly onRetry?: (info: RetryInfo) => void;
}

export interface RetryInfo {
  readonly attempt: number;
  readonly maxRetries: number;
  readonly delayMs: number;
  readonly reason: string;
  readonly method: string;
  readonly path: string;
}

export interface RequestOptions<T> {
  readonly method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly query?: Record<string, string | number | boolean | undefined>;
  readonly body?: unknown;
  /**
   * 直接送出的位元組（媒體上傳用）。跟 body 互斥——WordPress 的媒體端點吃的是
   * 檔案本體，不是 JSON。Content-Disposition 由呼叫端放進 headers。
   */
  readonly rawBody?: { readonly bytes: Uint8Array; readonly contentType: string };
  /** 驗證回應。WordPress 或外掛改版時要炸在這裡，不要讓壞資料流進系統。 */
  readonly schema?: z.ZodType<T>;
  /** 覆寫這次請求的重試次數，例如發布請求想設成 0。 */
  readonly maxRetries?: number;
  readonly headers?: Record<string, string>;
  readonly signal?: AbortSignal;
}

/** 回應本體的上限。WordPress 的 JSON 再大也到不了這裡；超過就是有東西不對，不要把記憶體吃光。 */
export const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;

export class ResponseTooLargeError extends Error {
  override readonly name = 'ResponseTooLargeError';
}

/**
 * 讀回應本體，超過 maxBytes 就中止並丟 ResponseTooLargeError。
 * 呼叫端的逾時（AbortSignal）要在讀完之前一直有效——標頭到了、本體慢慢滴的伺服器也要能被切斷。
 */
export async function readBodyCapped(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new ResponseTooLargeError(`回應超過 ${Math.round(maxBytes / 1024 / 1024)} MB`);
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new ResponseTooLargeError(`回應超過 ${Math.round(maxBytes / 1024 / 1024)} MB`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export interface WordPressResponse<T> {
  readonly data: T;
  readonly status: number;
  /** 只保留我們用得到的標頭，避免整包塞進 log。 */
  readonly totalItems: number | null;
  readonly totalPages: number | null;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export class WordPressClient {
  private readonly baseUrl: string;
  private readonly authHeader: string;
  private readonly scrub: Scrubber;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleepImpl: (ms: number) => Promise<void>;
  private readonly onRetry: ((info: RetryInfo) => void) | undefined;

  constructor(options: WordPressClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    // WordPress 顯示 Application Password 時會插入空格方便閱讀，
    // 它自己驗證前會把非英數字元去掉，所以我們照樣送出去沒問題。
    this.authHeader = `Basic ${Buffer.from(`${options.username}:${options.appPassword}`, 'utf8').toString('base64')}`;
    this.scrub = createSecretScrubber([options.appPassword, this.authHeader]);
    this.timeoutMs = options.timeoutMs ?? DEFAULTS.timeoutMs;
    this.maxRetries = options.maxRetries ?? DEFAULTS.maxRetries;
    this.baseDelayMs = options.baseDelayMs ?? DEFAULTS.baseDelayMs;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleepImpl = options.sleepImpl ?? defaultSleep;
    this.onRetry = options.onRetry;
  }

  /** REST 端點的完整網址。path 例如 `/wp/v2/posts`。 */
  private buildUrl(path: string, query?: RequestOptions<unknown>['query']): string {
    const url = new URL(`${this.baseUrl}/wp-json${path.startsWith('/') ? path : `/${path}`}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  /** 退避延遲。伺服器給了 Retry-After 就聽它的。 */
  private delayFor(attempt: number, retryAfter: number | null): number {
    if (retryAfter !== null) return Math.min(retryAfter * 1000, DEFAULTS.maxDelayMs);
    return Math.min(this.baseDelayMs * 2 ** (attempt - 1), DEFAULTS.maxDelayMs);
  }

  async request<T = unknown>(path: string, options: RequestOptions<T> = {}): Promise<WordPressResponse<T>> {
    const method = options.method ?? 'GET';
    const url = this.buildUrl(path, options.query);
    const maxRetries = options.maxRetries ?? this.maxRetries;

    let lastError: WordPressError | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      if (attempt > 0) {
        const delayMs = this.delayFor(attempt, lastError?.options.retryAfter ?? null);
        this.onRetry?.(
          this.scrub({
            attempt,
            maxRetries,
            delayMs,
            reason: lastError?.message ?? '未知',
            method,
            path,
          }),
        );
        await this.sleepImpl(delayMs);
      }

      try {
        return await this.attempt<T>(url, method, options);
      } catch (error) {
        const wpError = error instanceof WordPressError ? error : this.wrapUnknown(error);
        if (!wpError.retryable || attempt === maxRetries) {
          throw this.withAttempts(wpError, attempt + 1);
        }
        lastError = wpError;
      }
    }

    // 迴圈一定會 return 或 throw，這行只是讓型別完整。
    throw lastError ?? new WordPressError(wordpressErrorCodes.NETWORK, '請求失敗');
  }

  private withAttempts(error: WordPressError, attempts: number): WordPressError {
    return new WordPressError(error.code, error.message, { ...error.options, attempts });
  }

  private wrapUnknown(error: unknown): WordPressError {
    const message = error instanceof Error ? error.message : String(error);
    return new WordPressError(wordpressErrorCodes.NETWORK, this.scrub(`連線失敗：${message}`), {
      status: null,
      retryable: true,
      cause: error,
    });
  }

  private async attempt<T>(url: string, method: string, options: RequestOptions<T>): Promise<WordPressResponse<T>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    // 呼叫端自己的取消訊號也要能中斷請求。
    const onExternalAbort = (): void => controller.abort();
    options.signal?.addEventListener('abort', onExternalAbort, { once: true });

    let response: Response;
    let text: string;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers: {
          Authorization: this.authHeader,
          Accept: 'application/json',
          ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(options.rawBody === undefined ? {} : { 'Content-Type': options.rawBody.contentType }),
          ...options.headers,
        },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        ...(options.rawBody === undefined
          ? {}
          : { body: options.rawBody.bytes as unknown as BodyInit }),
        signal: controller.signal,
        // 跳轉會讓 Authorization 標頭在部分伺服器上被丟掉，導致「密碼明明對卻說沒權限」。
        // 寧可明確報錯，讓使用者去修 WORDPRESS_URL。
        redirect: 'manual',
      });
      // 逾時要涵蓋到本體讀完為止：標頭先到、本體一直不來的伺服器不能把請求卡住。
      text = response.status >= 300 && response.status < 400 ? '' : await readBodyCapped(response, MAX_RESPONSE_BYTES);
    } catch (error) {
      if (error instanceof ResponseTooLargeError) {
        throw new WordPressError(wordpressErrorCodes.BAD_RESPONSE, `WordPress 的${error.message}，不像正常的 REST 回應`, {
          retryable: false,
        });
      }
      throw this.wrapUnknown(error);
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onExternalAbort);
    }

    if (response.status >= 300 && response.status < 400) {
      throw new WordPressError(
        wordpressErrorCodes.BAD_RESPONSE,
        `WORDPRESS_URL 會被轉址（HTTP ${response.status}）。請直接填轉址後的網址——` +
          '轉址時認證資訊可能被丟掉，會出現「密碼正確卻說沒權限」的狀況',
        { status: response.status, retryable: false },
      );
    }

    const body = this.parseJson(text);

    if (!response.ok) {
      const error = mapWordPressError(response.status, body as WordPressErrorBody | null, text);
      const retryAfter = Number(response.headers.get('retry-after'));
      throw new WordPressError(error.code, this.scrub(error.message), {
        ...error.options,
        ...(Number.isFinite(retryAfter) && retryAfter > 0 ? { retryAfter } : {}),
      });
    }

    if (body === null && text.trim().length > 0) {
      throw new WordPressError(
        wordpressErrorCodes.BAD_RESPONSE,
        'WordPress 回應的不是 JSON。通常是安全外掛、快取層或維護模式擋在前面',
        { status: response.status, retryable: false },
      );
    }

    return {
      data: this.validate(body, options.schema),
      status: response.status,
      totalItems: this.intHeader(response, 'x-wp-total'),
      totalPages: this.intHeader(response, 'x-wp-totalpages'),
    };
  }

  private parseJson(text: string): unknown {
    if (text.trim().length === 0) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  private intHeader(response: Response, name: string): number | null {
    const raw = response.headers.get(name);
    if (raw === null) return null;
    const value = Number(raw);
    return Number.isInteger(value) ? value : null;
  }

  /** 沒給 schema 就原樣回傳；給了就一定要通過，資料結構變了要立刻知道。 */
  private validate<T>(body: unknown, schema?: z.ZodType<T>): T {
    if (!schema) return body as T;
    const parsed = schema.safeParse(body);
    if (parsed.success) return parsed.data;

    const issues = parsed.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`);
    throw new WordPressError(
      wordpressErrorCodes.SCHEMA_MISMATCH,
      `WordPress 的回應結構不符預期：${issues.join('；')}`,
      { retryable: false },
    );
  }
}
