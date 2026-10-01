/**
 * 在 worker_threads 裡抽文字（P6-T002 審查）：parse5 處理深層巢狀是平方級、同步執行，
 * 2 MB 的惡意網頁就能卡住整個後端數分鐘；放進 worker，超過時間上限就 terminate()。
 *
 * worker 檔案路徑：跟本檔同資料夾、同副檔名。
 * - build 後（dist/fetch/*.js）：載入 `extract-worker.js`，純 Node。
 * - tsx 開發與 Vitest（src/fetch/*.ts）：載入 `extract-worker.ts`，worker 帶 `--import tsx`（tsx 已是開發依賴）。
 */
import { Worker } from 'node:worker_threads';
import { extractText } from './extract-text.js';

export type ExtractOutcome = { ok: true; text: string } | { ok: false; code: 'too-complex' | 'extract-failed' };

const IS_TS = import.meta.url.endsWith('.ts');
const WORKER_URL = new URL(`./extract-worker.${IS_TS ? 'ts' : 'js'}`, import.meta.url);

/** worker 的資源上限：記憶體與 stack；超過時 worker 自己結束，回 extract-failed。 */
export const EXTRACT_RESOURCE_LIMITS = Object.freeze({
  maxOldGenerationSizeMb: 256,
  maxYoungGenerationSizeMb: 32,
  stackSizeMb: 4,
});

export async function extractTextIsolated(
  body: string,
  contentType: string,
  timeoutMs: number,
): Promise<ExtractOutcome> {
  // 純文字是線性處理，不必開 worker。
  if (contentType !== 'text/html' && contentType !== 'application/xhtml+xml') {
    try {
      return { ok: true, text: extractText(body, contentType) };
    } catch {
      return { ok: false, code: 'extract-failed' };
    }
  }

  return new Promise<ExtractOutcome>((resolve) => {
    let settled = false;
    let worker: Worker;
    const finish = (outcome: ExtractOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker?.terminate().catch(() => undefined);
      resolve(outcome);
    };
    const timer = setTimeout(() => finish({ ok: false, code: 'too-complex' }), timeoutMs);
    try {
      worker = new Worker(WORKER_URL, {
        workerData: { body, contentType },
        execArgv: IS_TS ? ['--import', 'tsx'] : [],
        resourceLimits: EXTRACT_RESOURCE_LIMITS,
        stdout: true,
        stderr: true,
      });
    } catch {
      finish({ ok: false, code: 'extract-failed' });
      return;
    }
    worker.once('message', (msg: { ok: boolean; text?: unknown }) => {
      if (msg.ok && typeof msg.text === 'string') finish({ ok: true, text: msg.text });
      else finish({ ok: false, code: 'extract-failed' });
    });
    worker.once('error', () => finish({ ok: false, code: 'extract-failed' }));
    worker.once('exit', () => finish({ ok: false, code: 'extract-failed' }));
  });
}
