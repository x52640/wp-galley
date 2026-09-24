import { z } from 'zod';
import { createSecretScrubber } from './secrets.js';

/**
 * 設定載入與驗證。
 *
 * 兩條硬規則寫在這裡，不放在啟動流程裡：
 * 1. APP_HOST 只接受 loopback（計畫 §2「僅監聽 127.0.0.1」）——填別的值直接啟動失敗。
 * 2. 任何驗證錯誤訊息都會經過秘密遮蔽，避免把 Application Password 印進終端機。
 */

/** 允許綁定的位址。0.0.0.0 與 :: 會讓服務暴露到區網，明確排除。 */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

/**
 * 網址的主機名是不是本機（`localhost`、`127.x.x.x`、`::1`，IPv6 可帶中括號）。
 *
 * 設定精靈（src/wordpress/setup.ts）與啟動設定共用這一個判斷（P5-T023）：http 的 WordPress 網址只准本機測試站，
 * 其他一律要 https——Application Password 走明碼等於送給路上每一台機器。放在 config 層是因為依賴方向：
 * wordpress 可以 import config，反過來不行。
 */
export function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '');
  return host === 'localhost' || host === '::1' || /^127\.\d+\.\d+\.\d+$/.test(host);
}

export class ConfigError extends Error {
  override readonly name = 'ConfigError';
  constructor(
    message: string,
    readonly issues: string[] = [],
  ) {
    super(message);
  }
}

const EnvSchema = z.object({
  APP_HOST: z
    .string()
    .default('127.0.0.1')
    .refine((host) => LOOPBACK_HOSTS.has(host), {
      message: `APP_HOST 只能是 loopback 位址（${[...LOOPBACK_HOSTS].join(' / ')}）；本服務不得對外開放`,
    }),
  APP_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  WORDPRESS_URL: z.string().trim().default(''),
  WORDPRESS_USERNAME: z.string().trim().default(''),
  WORDPRESS_APP_PASSWORD: z.string().default(''),
  LOG_LEVEL: z.enum(['silent', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export interface WordPressConfig {
  readonly url: string;
  readonly username: string;
  readonly appPassword: string;
}

export interface AppConfig {
  readonly appHost: string;
  readonly appPort: number;
  readonly logLevel: z.infer<typeof EnvSchema>['LOG_LEVEL'];
  readonly nodeEnv: z.infer<typeof EnvSchema>['NODE_ENV'];
  /** 未設定時為 null；階段 4 之前一律是 null。 */
  readonly wordpress: WordPressConfig | null;
}

export interface RedactedConfig {
  readonly appHost: string;
  readonly appPort: number;
  readonly logLevel: string;
  readonly nodeEnv: string;
  readonly wordpress: {
    readonly url: string;
    readonly username: string;
    readonly appPasswordConfigured: boolean;
  } | null;
}

function normalizeWordPressUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ConfigError('WORDPRESS_URL 不是合法網址');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ConfigError('WORDPRESS_URL 必須是 http 或 https');
  }
  if (parsed.protocol === 'http:' && !isLoopbackHostname(parsed.hostname)) {
    throw new ConfigError(
      'WORDPRESS_URL 用 http 只准本機測試站（localhost、127.0.0.1、::1）；其他網站一定要 https，' +
        '不然應用程式密碼會用明碼送出去。把網址改成 https:// 開頭再啟動',
    );
  }
  return parsed.origin + parsed.pathname.replace(/\/+$/, '');
}

export function loadConfig(source: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env): AppConfig {
  // 先建立 scrubber：即使驗證失敗，錯誤訊息也不會帶出密碼。
  const scrub = createSecretScrubber([source['WORDPRESS_APP_PASSWORD']]);

  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`);
    throw new ConfigError(scrub(`設定不合法：\n- ${issues.join('\n- ')}`), scrub(issues));
  }

  const env = parsed.data;
  const wpFields = [env.WORDPRESS_URL, env.WORDPRESS_USERNAME, env.WORDPRESS_APP_PASSWORD];
  const filled = wpFields.filter((value) => value.length > 0).length;

  let wordpress: WordPressConfig | null = null;
  if (filled > 0) {
    if (filled < wpFields.length) {
      throw new ConfigError(
        'WORDPRESS_URL、WORDPRESS_USERNAME、WORDPRESS_APP_PASSWORD 必須一起填寫；半套設定會在發布時才爆炸',
      );
    }
    wordpress = {
      url: normalizeWordPressUrl(env.WORDPRESS_URL),
      username: env.WORDPRESS_USERNAME,
      appPassword: env.WORDPRESS_APP_PASSWORD,
    };
  }

  return {
    appHost: env.APP_HOST,
    appPort: env.APP_PORT,
    logLevel: env.LOG_LEVEL,
    nodeEnv: env.NODE_ENV,
    wordpress,
  };
}

/** 可安全送進 log、HTTP response 或 MCP output 的設定摘要。 */
export function redactConfig(config: AppConfig): RedactedConfig {
  return {
    appHost: config.appHost,
    appPort: config.appPort,
    logLevel: config.logLevel,
    nodeEnv: config.nodeEnv,
    wordpress: config.wordpress
      ? {
          url: config.wordpress.url,
          username: config.wordpress.username,
          appPasswordConfigured: config.wordpress.appPassword.length > 0,
        }
      : null,
  };
}

/** 目前設定中所有需要從輸出中抹除的秘密。 */
export function collectSecrets(config: AppConfig): string[] {
  return config.wordpress ? [config.wordpress.appPassword] : [];
}
