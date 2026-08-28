import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import type { AppConfig } from '../config/env.js';
import { collectSecrets } from '../config/env.js';
import { createSecretScrubber } from '../config/secrets.js';
import { paths } from '../config/paths.js';
import { buildLoggerOptions } from './logger.js';
import { applyLocalOnlyGuard } from './plugins/local-only.js';
import { AppError, errorCodes, toErrorBody } from './errors.js';
import { healthRoutes } from './routes/health.js';
import { templateRoutes } from './routes/templates.js';
import { agentRoutes } from './routes/agents.js';
import { wordpressRoutes } from './routes/wordpress.js';
import { WordPressClient } from '../wordpress/client.js';
import type { PublishTargetRegistry } from '../wordpress/targets.js';
import type { AgentRegistry } from '../agents/registry.js';
import type { TemplateRegistry } from '../templates/registry.js';

export interface AppContext {
  readonly config: AppConfig;
  readonly db: DatabaseSync;
  readonly templates: TemplateRegistry;
  readonly agents: AgentRegistry;
  /** .env 沒設定 WordPress 時是 null；路由要自己處理這個情況。 */
  readonly wordpress: WordPressClient | null;
  readonly targets: PublishTargetRegistry;
  readonly version: string;
  readonly startedAt: string;
}

export interface BuildAppOptions {
  readonly config: AppConfig;
  readonly db: DatabaseSync;
  readonly templates: TemplateRegistry;
  readonly agents: AgentRegistry;
  /** 測試可以注入假的 client；正式啟動時由 config 建立。 */
  readonly wordpress?: WordPressClient | null;
  readonly targets: PublishTargetRegistry;
  readonly version?: string;
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const { config, db } = options;
  const scrub = createSecretScrubber(collectSecrets(config));

  const app = Fastify({
    logger: buildLoggerOptions(config),
    // 本機工具不需要信任 proxy header。
    trustProxy: false,
    bodyLimit: 8 * 1024 * 1024,
  });

  const ctx: AppContext = {
    config,
    db,
    templates: options.templates,
    agents: options.agents,
    wordpress: options.wordpress ?? createWordPressClient(config, app),
    targets: options.targets,
    version: options.version ?? '0.1.0',
    startedAt: new Date().toISOString(),
  };
  app.decorate('ctx', ctx);

  applyLocalOnlyGuard(app);

  app.setNotFoundHandler((request, reply) => {
    const { statusCode, body } = toErrorBody(
      new AppError(errorCodes.NOT_FOUND, `找不到 ${request.method} ${request.url}`, 404),
      String(request.id),
    );
    reply.status(statusCode).send(body);
  });

  app.setErrorHandler((error, request, reply) => {
    const requestId = String(request.id);
    const { statusCode, body } = toErrorBody(error, requestId);
    // 5xx 才記錄完整錯誤；記錄前先抹掉秘密。
    if (statusCode >= 500) {
      request.log.error({ err: scrub(error), requestId }, '請求處理失敗');
    } else {
      request.log.warn({ code: body.error.code, requestId }, body.error.message);
    }
    reply.status(statusCode).send(scrub(body));
  });

  await app.register(healthRoutes);
  await app.register(templateRoutes);
  await app.register(agentRoutes);
  await app.register(wordpressRoutes);

  // 正式啟動時提供已建置的 UI；開發時用 Vite dev server，這裡不存在也不報錯。
  if (existsSync(paths.uiDist)) {
    await app.register(fastifyStatic, { root: paths.uiDist, prefix: '/' });
  }

  return app;
}

/**
 * 設定齊全才建立 client。重試會寫進 server log，方便使用者看到「正在重試」
 * 而不是以為卡住了——RetryInfo 已經在 client 內部過了 scrubber。
 */
function createWordPressClient(config: AppConfig, app: FastifyInstance): WordPressClient | null {
  if (!config.wordpress) return null;
  return new WordPressClient({
    baseUrl: config.wordpress.url,
    username: config.wordpress.username,
    appPassword: config.wordpress.appPassword,
    onRetry: (info) => app.log.warn(info, 'WordPress 請求重試中'),
  });
}

declare module 'fastify' {
  interface FastifyInstance {
    ctx: AppContext;
  }
}
