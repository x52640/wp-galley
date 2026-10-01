/**
 * 代理測試的子行程（tests/safe-fetch.test.ts 啟動）：啟動時就帶 NODE_USE_ENV_PROXY=1 與 HTTPS_PROXY。
 * - `transport`：用取回器的預設傳輸連 https://example.test:<port>/，解析固定給 127.0.0.1（本機測試伺服器）。
 * - `control`：對照組，用全域 fetch 連同一個網址；環境變數生效的話它會先去連代理埠。
 * 只連 127.0.0.1，不連外。結果以 JSON 印到 stdout。
 */
import { readFileSync } from 'node:fs';
import { createHttpsTransport } from '../../../src/fetch/transport.js';

const [mode, port] = process.argv.slice(2);
const url = new URL(`https://example.test:${port}/`);

if (mode === 'transport') {
  const cert = readFileSync(new URL('./test-cert.pem', import.meta.url));
  const transport = createHttpsTransport({ ca: cert });
  const res = await transport({
    url,
    headers: { 'user-agent': 'proxy-child' },
    signal: AbortSignal.timeout(5000),
    lookup: async () => [{ address: '127.0.0.1', family: 4 }],
  });
  let body = '';
  for await (const chunk of res.body) body += Buffer.from(chunk).toString();
  process.stdout.write(JSON.stringify({ status: res.status, body }));
} else {
  let failed = false;
  try {
    await fetch(url, { signal: AbortSignal.timeout(3000) });
  } catch {
    failed = true;
  }
  process.stdout.write(JSON.stringify({ failed }));
}
