import type { FastifyBaseLogger } from 'fastify';
import type { AppConfig } from '../config/env.js';
import { collectSecrets } from '../config/env.js';
import { createSecretScrubber, type Scrubber } from '../config/secrets.js';

/**
 * 結構化 log 設定（Fastify 內建 pino）。
 *
 * 兩層防護：
 * 1. redact：把常見會夾帶憑證的欄位整個換掉。
 * 2. formatters.log：把已知秘密的字面值從任何 log 物件中抹掉。
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
