import type { FastifyBaseLogger } from 'fastify';
import type { AppConfig } from '../config/env.js';
import { collectSecrets } from '../config/env.js';
import { createSecretScrubber, type Scrubber } from '../config/secrets.js';

/**
 * 結構化 log 設定（Fastify 內建 pino）。
 *
 * 三層防護：
 * 1. redact：把常見會夾帶憑證的欄位整個換掉。
 * 2. formatters.log：把已知秘密的字面值從任何 log 物件中抹掉。
 * 3. hooks.logMethod：訊息字串（`log.warn(obj, msg)` 的 msg）、printf 參數（字串、物件、Error）、
 *    當第一個參數的 Error 也抹掉（P5-T023，審查 #6）——formatters.log 只看得到物件，msg 原樣寫出。
 */
export function buildLoggerOptions(
  config: AppConfig,
  /**
   * 設定精靈會在執行中換掉 Application Password，所以正式啟動時傳入可更新的遮蔽器
   * （createMutableScrubber），新密碼當場就會被抹掉。沒給就照設定建一個固定的。
   */
  scrubber?: Scrubber,
  /** 測試用：把 log 收到這裡，驗證裡面沒有秘密。正式啟動不給（寫到 stdout）。 */
  stream?: { write(line: string): void },
) {
  if (config.logLevel === 'silent') return false as const;

  const scrub = scrubber ?? createSecretScrubber(collectSecrets(config));

  return {
    level: config.logLevel,
    ...(stream === undefined ? {} : { stream }),
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers["set-cookie"]',
        '*.appPassword',
        '*.password',
        '*.WORDPRESS_APP_PASSWORD',
      ],
      censor: '[REDACTED]',
    },
    formatters: {
      log: (object: Record<string, unknown>) => scrub(object),
    },
    hooks: {
      // 第一個參數是物件時（合併進 log 的欄位，例如 Fastify 的 { req }）留給 formatters.log——這裡先 walk
      // 會把 req 這類物件拆成普通物件，serializer 就認不得了。例外是 Error：pino 會拿它的 message 當 msg，
      // formatters.log 碰不到 msg。遮蔽器複製 Error 時保留型別、name、stack，pino 照樣當 Error 序列化。
      // 其他參數（訊息字串、%s／%j／%o 的 printf 參數，含物件與 Error）一律先遮蔽，格式化後才不會漏。
      logMethod(this: unknown, args: unknown[], method: (...args: unknown[]) => void) {
        method.apply(
          this,
          args.map((arg, index) =>
            index === 0 && arg !== null && typeof arg === 'object' && !(arg instanceof Error) ? arg : scrub(arg),
          ),
        );
      },
    },
    serializers: {
      req: (request: { method: string; url: string; id: string }) => ({
        id: request.id,
        method: request.method,
        url: request.url,
      }),
    },
  };
}

export type Logger = FastifyBaseLogger;
