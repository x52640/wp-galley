/**
 * 在 worker_threads 裡抽文字（P6-T002 審查）：parse5 處理深層巢狀是平方級、同步執行，
 * 2 MB 的惡意網頁就能卡住整個後端數分鐘；放進 worker，超過時間上限就 terminate()。
 *
 * 並行：整個行程最多 `maxConcurrentExtracts` 個 worker 同時存活（ExtractPool），多的排隊。
 *
 * worker 檔案路徑：跟本檔同資料夾、同副檔名。
 * - build 後（dist/fetch/*.js）：載入 `extract-worker.js`，純 Node。
 * - tsx 開發與 Vitest（src/fetch/*.ts）：載入 `extract-worker.ts`，worker 帶 `--import tsx`（tsx 已是開發依賴）。
 */
import { Worker } from 'node:worker_threads';
import { extractText } from './extract-text.js';
import { DEFAULT_FETCH_LIMITS } from './types.js';

export type ExtractOutcome = { ok: true; text: string } | { ok: false; code: 'too-complex' | 'extract-failed' };

const IS_TS = import.meta.url.endsWith('.ts');
const WORKER_URL = new URL(`./extract-worker.${IS_TS ? 'ts' : 'js'}`, import.meta.url);

/** worker 的資源上限：記憶體與 stack；超過時 worker 自己結束，回 extract-failed。 */
export const EXTRACT_RESOURCE_LIMITS = Object.freeze({
  maxOldGenerationSizeMb: 256,
  maxYoungGenerationSizeMb: 32,
  stackSizeMb: 4,
});

/**
 * 抽文字 worker 的並行上限：超過就排隊。名額在 worker 真的結束（'exit'：正常退出或 terminate() 完成）後才釋放，
 * 回傳的 Promise 也等到那時才完成——呼叫方拿到結果時，這個 worker 一定已經不在了。
 */
export class ExtractPool {
  private live = 0;
  private maxLiveSeen = 0;
  private running = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  get stats(): { live: number; maxLive: number; queued: number } {
    return { live: this.live, maxLive: this.maxLiveSeen, queued: this.waiting.length };
  }

  async run(body: string, contentType: string, timeoutMs: number): Promise<ExtractOutcome> {
    // 純文字是線性處理，不必開 worker。
    if (contentType !== 'text/html' && contentType !== 'application/xhtml+xml') {
      try {
        return { ok: true, text: extractText(body, contentType) };
      } catch {
        return { ok: false, code: 'extract-failed' };
      }
    }
    if (this.running >= this.limit) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    } else {
      this.running += 1;
    }
    try {
      return await this.runWorker(body, contentType, timeoutMs);
    } finally {
      const next = this.waiting.shift();
      if (next) next(); // 名額直接交給下一個
      else this.running -= 1;
    }
  }

  private runWorker(body: string, contentType: string, timeoutMs: number): Promise<ExtractOutcome> {
    return new Promise<ExtractOutcome>((resolve) => {
      let outcome: ExtractOutcome | null = null;
      let worker: Worker;
      try {
        worker = new Worker(WORKER_URL, {
          workerData: { body, contentType },
          execArgv: IS_TS ? ['--import', 'tsx'] : [],
          resourceLimits: EXTRACT_RESOURCE_LIMITS,
          stdout: true,
          stderr: true,
        });
      } catch {
        resolve({ ok: false, code: 'extract-failed' });
        return;
      }
      this.live += 1;
      this.maxLiveSeen = Math.max(this.maxLiveSeen, this.live);

      const decide = (result: ExtractOutcome) => {
        if (outcome !== null) return;
        outcome = result;
        clearTimeout(timer);
        void worker.terminate().catch(() => undefined);
      };
      const timer = setTimeout(() => decide({ ok: false, code: 'too-complex' }), timeoutMs);
      worker.once('message', (msg: { ok: boolean; text?: unknown }) => {
        decide(msg.ok && typeof msg.text === 'string' ? { ok: true, text: msg.text } : { ok: false, code: 'extract-failed' });
      });
      worker.once('error', () => decide({ ok: false, code: 'extract-failed' }));
      // 只有 'exit' 才算結束：這時才扣存活數、交回結果（名額在 run() 的 finally 釋放）。
      worker.once('exit', () => {
        clearTimeout(timer);
        this.live -= 1;
        resolve(outcome ?? { ok: false, code: 'extract-failed' });
      });
    });
  }
}

/** 整個行程共用一個：多次查證同時跑也不會超過上限。 */
export const sharedExtractPool = new ExtractPool(DEFAULT_FETCH_LIMITS.maxConcurrentExtracts);

/** 用共用的 pool 抽文字。 */
export function extractTextIsolated(body: string, contentType: string, timeoutMs: number): Promise<ExtractOutcome> {
  return sharedExtractPool.run(body, contentType, timeoutMs);
}
