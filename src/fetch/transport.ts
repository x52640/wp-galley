/**
 * 預設傳輸與預設 DNS 解析：只在正式啟動時用，測試一律注入假的（或對本機測試伺服器）。
 *
 * - 連線位址只從 `request.lookup` 來（safe-fetch 傳入的是已檢查過位址的解析），檢查過的就是實際連的位址。
 * - 不經任何代理：每次用自己建的 `https.Agent`，不用 `https.globalAgent`（Node 在 `NODE_USE_ENV_PROXY=1`
 *   時會讓 global agent 與全域 fetch 吃 `HTTP(S)_PROXY`），也不用全域 `fetch`。
 */
import { promises as dns, type LookupAddress } from 'node:dns';
import https from 'node:https';
import type { LookupFunction } from 'node:net';
import type { Resolver, Transport, TransportResponse } from './types.js';

export const defaultResolver: Resolver = async (hostname) => {
  const results = await dns.lookup(hostname, { all: true, verbatim: true });
  return results.map((r) => ({ address: r.address, family: r.family === 6 ? 6 : 4 }));
};

export interface HttpsTransportOptions {
  /** 只給測試：信任本機測試伺服器的自簽憑證。正式不傳，用系統預設 CA。 */
  readonly ca?: string | Buffer;
}

export function createHttpsTransport(options: HttpsTransportOptions = {}): Transport {
  return (request) =>
    new Promise<TransportResponse>((resolve, reject) => {
      const lookup: LookupFunction = (hostname, lookupOptions, callback) => {
        request.lookup(hostname).then(
          (addresses) => {
            const list: LookupAddress[] = addresses.map((a) => ({ address: a.address, family: a.family }));
            if (list.length === 0) {
              const err = Object.assign(new Error('no address'), { code: 'ENOTFOUND' });
              callback(err, '', 4);
              return;
            }
            if (lookupOptions.all) {
              callback(null, list);
            } else {
              const first = list[0]!;
              callback(null, first.address, first.family);
            }
          },
          (err: NodeJS.ErrnoException) => callback(err, '', 4),
        );
      };

      // 每次一個新的 Agent：不共用連線（下一次可能已經解析到不同位址），也不吃環境變數的代理。
      const agent = new https.Agent({ keepAlive: false, maxSockets: 1 });
      const req = https.request(
        request.url,
        {
          method: 'GET',
          headers: request.headers,
          agent,
          lookup,
          signal: request.signal,
          ...(options.ca !== undefined ? { ca: options.ca } : {}),
        },
        (res) => {
          const headers: Record<string, string | undefined> = {};
          for (const [key, value] of Object.entries(res.headers)) {
            headers[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value;
          }
          resolve({
            status: res.statusCode ?? 0,
            headers,
            body: res,
            discard: () => {
              res.destroy();
              agent.destroy();
            },
          });
          res.once('close', () => agent.destroy());
        },
      );
      req.once('error', (err) => {
        agent.destroy();
        reject(err);
      });
      req.end();
    });
}
