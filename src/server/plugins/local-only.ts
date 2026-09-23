import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppError, errorCodes } from '../errors.js';

/**
 * 本機限定守門。
 *
 * 只綁 127.0.0.1 還不夠：瀏覽器裡的惡意網頁可以用 DNS rebinding 把自己的網域
 * 解析到 127.0.0.1，然後對這個服務發請求。所以除了檢查連線來源，還要檢查
 * Host 與 Origin header。
 */

const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/** 允許的 Origin：本機後端自己，加上開發時的 Vite dev server。 */
const ALLOWED_ORIGIN_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false;
  const normalized = address.startsWith('::ffff:') ? address.slice(7) : address;
  return normalized === '127.0.0.1' || normalized === '::1' || normalized.startsWith('127.');
}

/** 從 Host header 取出 hostname（去掉 port，保留 IPv6 的中括號）。 */
export function hostnameFromHostHeader(host: string): string {
  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    return end === -1 ? host : host.slice(0, end + 1);
  }
  const colon = host.indexOf(':');
  return colon === -1 ? host : host.slice(0, colon);
}

/** Host header 是否指向本機。空值或非 loopback 名稱一律不通過。 */
export function isAllowedHost(host: string | undefined): boolean {
  if (!host) return false;
  return LOOPBACK_HOSTNAMES.has(hostnameFromHostHeader(host));
}

/** Origin 是否為本機。沒有 Origin（同源請求或非瀏覽器）視為通過。 */
export function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin || origin === 'null') return true;
  try {
    return ALLOWED_ORIGIN_HOSTNAMES.has(new URL(origin).hostname);
  } catch {
    return false;
  }
}

/** 唯一允許被 iframe 嵌入的路徑：`/api/jobs/<uuid>/preview`。 */
const PREVIEW_PATH = /^\/api\/jobs\/[^/?#]+\/preview(?:[?#]|$)/;

export function isPreviewPath(url: string): boolean {
  return PREVIEW_PATH.test(url);
}

function checkRequest(request: FastifyRequest): void {
  // 1. 連線來源必須是 loopback。app.inject() 沒有真實 socket，此時跳過。
  const remote = request.socket?.remoteAddress;
  if (remote !== undefined && !isLoopbackAddress(remote)) {
    throw new AppError(errorCodes.NON_LOCAL_CLIENT, '本服務只接受本機連線。', 403);
  }

  // 2. Host 必須是 loopback 名稱，擋 DNS rebinding。
  if (!isAllowedHost(request.headers.host)) {
    throw new AppError(
      errorCodes.NON_LOCAL_HOST,
      '只接受以 127.0.0.1 或 localhost 存取本服務。',
      403,
    );
  }

  // 3. 有 Origin 時必須也是本機，擋跨站請求。
  if (!isAllowedOrigin(request.headers.origin)) {
    throw new AppError(errorCodes.CROSS_ORIGIN_BLOCKED, '不接受跨站請求。', 403);
  }

  // 4. 會改東西的請求再嚴一點（P8-T002）：見 isAllowedWriteSource。
  if (!SAFE_METHODS.has(request.method) && !isAllowedWriteSource({ ...request.headers })) {
    throw new AppError(errorCodes.CROSS_ORIGIN_BLOCKED, '不接受從其他網頁送來的修改請求。', 403);
  }
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * 會改東西的請求（POST／PUT／DELETE…）只接受發布台自己的畫面或非瀏覽器的本機程式。
 *
 * isAllowedOrigin 放行 `Origin: null`（同源的舊瀏覽器、非瀏覽器），但沙箱 iframe 與 `file://` 頁面
 * 送出的也是 null——外站把自己塞進沙箱 iframe，就能發不帶 body 的 POST（不需要 preflight 的
 * 「簡單請求」）。瀏覽器會附上 `Sec-Fetch-Site`，它說不是同源就擋；舊瀏覽器沒有這個標頭時，
 * 至少把 null 擋掉。
 *
 * 有 Origin 時還要**跟 Host 同源**（同一個 host:port）：isAllowedOrigin 放行任何本機埠，
 * 但 localhost:8080 上別人的開發中網站不該能改發布台的東西。發布台自己的畫面一律同源——
 * 由後端直接提供時是 :3000 對 :3000；經 Vite dev server 時 proxy 不改 Host（changeOrigin: false），
 * 瀏覽器看到的、送出的都是 :5173。
 */
export function isAllowedWriteSource(headers: {
  readonly origin?: string | undefined;
  readonly host?: string | undefined;
  readonly 'sec-fetch-site'?: string | string[] | undefined;
}): boolean {
  if (headers.origin === 'null') return false;
  if (headers.origin !== undefined) {
    let origin: URL;
    try {
      origin = new URL(headers.origin);
    } catch {
      return false;
    }
    if (origin.protocol !== 'http:' || headers.host === undefined || origin.host !== headers.host.toLowerCase()) {
      return false;
    }
  }
  const site = headers['sec-fetch-site'];
  if (site === undefined) return true;
  const value = Array.isArray(site) ? site[0] : site;
  return value === 'same-origin' || value === 'none';
}

/**
 * 直接掛在 root instance 上，不透過 app.register()。
 * Fastify 的 plugin 會建立封裝範圍，在裡面加的 hook 套不到父層註冊的路由——
 * 守門機制絕不能有這種漏網之魚。
 */
export function applyLocalOnlyGuard(app: FastifyInstance): void {
  app.addHook('onRequest', async (request) => {
    checkRequest(request);
  });

  app.addHook('onSend', async (request, reply, payload) => {
    // 本機工具不應該被任何外部頁面嵌入或索引。
    //
    // 例外只有校樣預覽：UI 必須用 iframe 載入它（校樣要套模板自己的 preview.css，
    // 跟介面的 CSS 完全隔離）。`X-Frame-Options: DENY` 連同源都擋，所以這一條路徑
    // 改用 CSP 的 frame-ancestors，把可以嵌入的頁面限制在 loopback ——
    // 保護沒有變鬆，只是換成表達得出「同源可以、外站不行」的那個標頭。
    if (isPreviewPath(request.url)) {
      reply.header(
        'Content-Security-Policy',
        // CSP 的 host-source 不接受 IPv6 字面值，`http://[::1]:*` 會讓瀏覽器把
        // 整條指令丟掉。跑在 ::1 上時 Origin 會是 http://localhost:<port>，
        // 由下面那一項涵蓋。
        "frame-ancestors 'self' http://127.0.0.1:* http://localhost:*",
      );
    } else {
      reply.header('X-Frame-Options', 'DENY');
    }
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Cache-Control', 'no-store');
    return payload;
  });
}
