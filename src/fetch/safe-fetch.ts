/**
 * 安全抓取的核心（security.md「取回器」）：DNS 前檢查 → 在連線用的解析裡查位址 → 自己處理跳轉、每跳重檢
 * → Content-Type、壓縮格式、大小（壓縮前與解壓後）→ 解碼。逾時涵蓋到本體讀完。
 * 失敗一律回 FetchFailure，不丟例外。
 */
import { brotliDecompressSync, gunzipSync, inflateRawSync, inflateSync } from 'node:zlib';
import { isBlockedAddress } from './address-guard.js';
import { checkUrlFormat, type ExfiltrationGuard } from './url-guard.js';
import {
  BlockedAddressError,
  failure,
  type FetchFailure,
  type FetchLimits,
  type FetchOutcome,
  type Resolver,
  type Transport,
  type TransportResponse,
  type UrlOrigin,
} from './types.js';

export interface SafeFetchContext {
  readonly resolver: Resolver;
  readonly transport: Transport;
  readonly limits: FetchLimits;
  readonly guard: ExfiltrationGuard;
  readonly userAgent: string;
}

export interface RequestPolicy {
  /** 原本網址的來源；跳轉一律照 `agent` 全套檢查。 */
  readonly origin: UrlOrigin;
  /** 只有我們組的維基百科 API 收 `application/json`。 */
  readonly acceptJson: boolean;
  /** 維基 API 不跟跳轉。 */
  readonly followRedirects: boolean;
  readonly acceptLanguage?: string;
}

const ALLOWED_TYPES = new Set(['text/html', 'text/plain', 'application/xhtml+xml']);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** DNS 解析前的全部檢查：網址格式＋外洩檢查。通過才可以扣額度、發請求。 */
export function preflight(
  raw: string | URL,
  origin: UrlOrigin,
  guard: ExfiltrationGuard,
  hop = 0,
): { ok: true; url: URL } | FetchFailure {
  const format = checkUrlFormat(raw);
  if (!format.ok) return failure(format.code, hop);
  const leak = guard.check(format.url, hop > 0 ? 'agent' : origin);
  if (!leak.ok) return failure(leak.code, hop);
  return { ok: true, url: format.url };
}

class TimeoutError extends Error {}
class TooLargeError extends Error {}
class DnsFailedError extends Error {
  readonly code = 'ENOTFOUND';
}

/** 傳給傳輸層的解析：查到的每個位址都過位址檢查，任何一個不合格就整個拒絕。 */
function guardedLookup(resolver: Resolver): Resolver {
  return async (hostname) => {
    let addresses;
    try {
      addresses = await resolver(hostname);
    } catch {
      throw new DnsFailedError('dns failed');
    }
    if (addresses.length === 0) throw new DnsFailedError('no address');
    if (addresses.some((a) => isBlockedAddress(a.address))) throw new BlockedAddressError();
    return addresses;
  };
}

/** 對已通過 preflight 的網址發請求（含跳轉）。呼叫前要先扣好額度。 */
export async function guardedRequest(
  ctx: SafeFetchContext,
  start: URL,
  policy: RequestPolicy,
): Promise<FetchOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new TimeoutError('timeout')), ctx.limits.timeoutMs);
  const aborted = new Promise<never>((_, reject) => {
    controller.signal.addEventListener('abort', () => reject(new TimeoutError('timeout')), { once: true });
  });
  aborted.catch(() => undefined);
  const lookup = guardedLookup(ctx.resolver);

  let url = start;
  let hop = 0;
  try {
    for (;;) {
      let response: TransportResponse;
      try {
        response = await Promise.race([
          ctx.transport({ url, headers: requestHeaders(ctx, policy), signal: controller.signal, lookup }),
          aborted,
        ]);
      } catch (err) {
        return mapError(err, hop, controller.signal);
      }

      if (REDIRECT_STATUSES.has(response.status)) {
        response.discard();
        if (!policy.followRedirects) return failure('http-status', hop, { status: response.status });
        const location = response.headers['location'];
        if (!location) return failure('redirect-invalid', hop);
        if (hop + 1 > ctx.limits.maxRedirects) return failure('too-many-redirects', hop + 1);
        let next: URL;
        try {
          next = new URL(location, url);
        } catch {
          return failure('invalid-url', hop + 1);
        }
        const checked = preflight(next, 'agent', ctx.guard, hop + 1);
        if (!checked.ok) return checked;
        url = checked.url;
        hop += 1;
        continue;
      }

      if (response.status < 200 || response.status > 299) {
        response.discard();
        return failure('http-status', hop, { status: response.status });
      }

      const contentType = parseContentType(response.headers['content-type']);
      const allowed = ALLOWED_TYPES.has(contentType.type) || (policy.acceptJson && contentType.type === 'application/json');
      if (!allowed) {
        response.discard();
        return failure('content-type', hop, { detail: contentType.type || '沒有標示' });
      }

      const encoding = (response.headers['content-encoding'] ?? 'identity').trim().toLowerCase();
      if (!['identity', '', 'gzip', 'x-gzip', 'deflate', 'br'].includes(encoding)) {
        response.discard();
        return failure('encoding', hop);
      }

      const declared = Number(response.headers['content-length']);
      if (Number.isFinite(declared) && declared > ctx.limits.maxBytes) {
        response.discard();
        return failure('too-large', hop);
      }

      let raw: Buffer;
      try {
        raw = await readCapped(response, ctx.limits.maxBytes, aborted);
      } catch (err) {
        response.discard();
        if (err instanceof TooLargeError) return failure('too-large', hop);
        return mapError(err, hop, controller.signal);
      }

      let bytes: Buffer;
      try {
        bytes = decompress(raw, encoding, ctx.limits.maxBytes);
      } catch (err) {
        if (err instanceof RangeError || (err as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE') {
          return failure('too-large', hop);
        }
        return failure('encoding', hop);
      }

      return {
        ok: true,
        finalUrl: url.href,
        contentType: contentType.type,
        body: decodeBody(bytes, contentType),
      };
    }
  } finally {
    clearTimeout(timer);
  }
}

function requestHeaders(ctx: SafeFetchContext, policy: RequestPolicy): Record<string, string> {
  // 只有這幾個：不帶 Cookie、不帶任何認證標頭。
  const headers: Record<string, string> = {
    'user-agent': ctx.userAgent,
    accept: policy.acceptJson
      ? 'application/json'
      : 'text/html,application/xhtml+xml,text/plain;q=0.9',
    'accept-encoding': 'gzip, deflate, br',
  };
  if (policy.acceptLanguage) headers['accept-language'] = policy.acceptLanguage;
  return headers;
}

function mapError(err: unknown, hop: number, signal: AbortSignal): FetchFailure {
  if (err instanceof TimeoutError || signal.aborted) return failure('timeout', hop);
  if (err instanceof BlockedAddressError || (err as { code?: unknown })?.code === 'EBLOCKEDADDRESS') {
    return failure('blocked-address', hop);
  }
  const code = (err as { code?: unknown })?.code;
  if (err instanceof DnsFailedError || code === 'ENOTFOUND' || code === 'EAI_AGAIN' || code === 'ENODATA') {
    return failure('dns', hop);
  }
  return failure('network', hop);
}

async function readCapped(response: TransportResponse, maxBytes: number, aborted: Promise<never>): Promise<Buffer> {
  const iterator = response.body[Symbol.asyncIterator]();
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await Promise.race([iterator.next(), aborted]);
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await iterator.return?.().catch(() => undefined);
      throw new TooLargeError('too large');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

function decompress(raw: Buffer, encoding: string, maxBytes: number): Buffer {
  const opts = { maxOutputLength: maxBytes };
  switch (encoding) {
    case 'gzip':
    case 'x-gzip':
      return gunzipSync(raw, opts);
    case 'deflate':
      try {
        return inflateSync(raw, opts);
      } catch (err) {
        if (err instanceof RangeError) throw err;
        return inflateRawSync(raw, opts);
      }
    case 'br':
      return brotliDecompressSync(raw, opts);
    default:
      return raw;
  }
}

interface ContentType {
  readonly type: string;
  readonly charset: string | undefined;
}

export function parseContentType(header: string | undefined): ContentType {
  if (!header) return { type: '', charset: undefined };
  const [type = '', ...params] = header.split(';');
  let charset: string | undefined;
  for (const p of params) {
    const [k, v] = p.split('=');
    if (k?.trim().toLowerCase() === 'charset' && v) charset = v.trim().replace(/^"|"$/g, '');
  }
  return { type: type.trim().toLowerCase(), charset };
}

function decodeBody(bytes: Buffer, contentType: ContentType): string {
  let charset = contentType.charset;
  if (!charset && contentType.type !== 'application/json') {
    // 沒在標頭講編碼的網頁（台灣舊站常見 Big5）：看前 2 KB 的 <meta charset>。
    const head = bytes.subarray(0, 2048).toString('latin1');
    const meta = /<meta[^>]+charset\s*=\s*["']?\s*([a-z0-9_\-:.]+)/i.exec(head);
    charset = meta?.[1];
  }
  try {
    return new TextDecoder(charset ?? 'utf-8').decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}
