import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * 本機假 WordPress。
 *
 * 用真的 HTTP server 而不是把 fetch 換掉，因為要驗的東西有一半在傳輸層：
 * Authorization 標頭有沒有正確組出來、跳轉怎麼處理、非 JSON 回應會怎樣、
 * Retry-After 有沒有被讀到。換掉 fetch 就全部測不到。
 *
 * 測試絕不連真的網站（計畫 §14）。真實連線只在階段收尾時手動驗收一次。
 */

export interface MockResponse {
  readonly status?: number;
  /** 物件會被 JSON 序列化；字串原樣送出（用來模擬安全外掛回的 HTML）。 */
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
  /** 延遲回應，用來測逾時。 */
  readonly delayMs?: number;
}

export interface RecordedRequest {
  readonly method: string;
  readonly path: string;
  readonly authorization: string | null;
  readonly contentType: string | null;
  readonly body: string;
}

export interface MockWordPress {
  readonly url: string;
  readonly requests: RecordedRequest[];
  close(): Promise<void>;
}

type Handler = (request: RecordedRequest, callIndex: number) => MockResponse;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

export async function startMockWordPress(handler: Handler): Promise<MockWordPress> {
  const requests: RecordedRequest[] = [];

  const server: Server = createServer((req, res) => {
    void (async () => {
      const recorded: RecordedRequest = {
        method: req.method ?? 'GET',
        path: req.url ?? '/',
        authorization: req.headers.authorization ?? null,
        contentType: req.headers['content-type'] ?? null,
        body: await readBody(req),
      };
      requests.push(recorded);

      const result = handler(recorded, requests.length - 1);
      const send = (): void => {
        const isString = typeof result.body === 'string';
        const payload =
          result.body === undefined ? '' : isString ? (result.body as string) : JSON.stringify(result.body);
        res.writeHead(result.status ?? 200, {
          'Content-Type': isString ? 'text/html' : 'application/json',
          ...result.headers,
        });
        res.end(payload);
      };

      if (result.delayMs) setTimeout(send, result.delayMs);
      else send();
    })();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** WordPress REST 的標準錯誤格式。 */
export function wpError(code: string, message: string, status: number): MockResponse {
  return { status, body: { code, message, data: { status } } };
}
