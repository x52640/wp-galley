/**
 * 抽文字的 worker 入口（由 extract-runner.ts 啟動）。在獨立執行緒裡跑，卡住或爆掉都不影響後端主執行緒；
 * 時間與記憶體上限由啟動它的那邊管。
 */
import { parentPort, workerData } from 'node:worker_threads';
import { extractText } from './extract-text.js';

const { body, contentType } = workerData as { body: string; contentType: string };
try {
  parentPort?.postMessage({ ok: true, text: extractText(body, contentType) });
} catch {
  parentPort?.postMessage({ ok: false });
}
