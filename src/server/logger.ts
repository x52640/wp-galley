import type { FastifyBaseLogger } from 'fastify';
import type { AppConfig } from '../config/env.js';
import { collectSecrets } from '../config/env.js';
import { createSecretScrubber } from '../config/secrets.js';

/**
 * 結構化 log 設定（Fastify 內建 pino）。
 *
 * 兩層防護：
 * 1. redact：把常見會夾帶憑證的欄位整個換掉。
 * 2. formatters.log：把已知秘密的字面值從任何 log 物件中抹掉。
 */
export function buildLoggerOptions(config: AppConfig) {
  if (config.logLevel === 'silent') return false as const;

  const scrub = createSecretScrubber(collectSecrets(config));

  return {
    level: config.logLevel,
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
