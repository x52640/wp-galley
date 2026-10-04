import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import type { AppConfig } from '../config/env.js';
import { collectSecrets } from '../config/env.js';
import { createMutableScrubber, type MutableScrubber } from '../config/secrets.js';
import { paths } from '../config/paths.js';
import { buildLoggerOptions } from './logger.js';
import { applyLocalOnlyGuard } from './plugins/local-only.js';
import { AppError, errorCodes, toErrorBody } from './errors.js';
import { healthRoutes } from './routes/health.js';
import { templateRoutes } from './routes/templates.js';
import { agentRoutes } from './routes/agents.js';
import { wordpressRoutes } from './routes/wordpress.js';
import { jobRoutes } from './routes/jobs.js';
import { createWordPressClient, siteOf } from './reconfigure.js';
import { setupRoutes } from './routes/setup.js';
import { CoreService } from '../core/service.js';
import type { WordPressClient } from '../wordpress/client.js';
import type { PublishTargetRegistry } from '../wordpress/targets.js';
import type { AgentRegistry } from '../agents/registry.js';
import type { TemplateRegistry } from '../templates/registry.js';
import type { FactCheckFetcherFactory } from '../core/service.js';
import { createSourceFetcher } from '../fetch/index.js';
import { createHttpsTransport } from '../fetch/transport.js';
import type { Transport } from '../fetch/types.js';

/**
 * 正式的查證取回器（D-034，P6-T004）：每次查證一個，共用同一份額度。傳輸層包一層，使用者按停止
 * （`signal` abort）時正在抓的請求一起中止。測試一律注入假的（`BuildAppOptions.factCheckFetcher` 或注入 core）。
 */
export function realFactCheckFetcher(version: string): FactCheckFetcherFactory {
  return ({ articleText, containsSecret, signal }) => {
    const inner = createHttpsTransport();
    const transport: Transport = (request) => inner({ ...request, signal: AbortSignal.any([request.signal, signal]) });
    return createSourceFetcher({
      articleText,
      containsSecret,
      userAgent: `Galley/${version} (+https://github.com/x52640/wp-galley)`,
      transport,
    });
  };
}

/**
 * 設定精靈（P8-T002）要寫的檔案。**沒給就不能寫**：寫入路由回 503，絕不退回專案裡真的 `.env`
 * ——測試因此不可能碰到作者本機的設定。正式啟動由 main.ts 給真的路徑。
 */
export interface SetupFiles {
  readonly envFile: string;
  readonly envExampleFile: string;
  readonly siteConfigFile: string;
  readonly backupsDir: string;
  /**
   * 資料目錄（P8-T003）。回應裡的備份路徑從 P8-T003 起是完整路徑（資料目錄在 ~/Library 底下，
   * 只給 `backups/…` 使用者找不到檔），這一欄目前沒有用到；`routes/setup.ts` 還在傳，見 known-issues。
   */
  readonly rootDir: string;
}

export interface AppContext {
  // config／wordpress／targets 不是 readonly：設定精靈存檔後就地換掉（applyWordPressConfig、applyTargets），
  // 路由每次請求都從 ctx 讀，不要在註冊時把它們抓進區域變數。
  config: AppConfig;
  readonly db: DatabaseSync;
  readonly templates: TemplateRegistry;
  readonly agents: AgentRegistry;
  /** .env 沒設定 WordPress 時是 null；路由要自己處理這個情況。 */
  wordpress: WordPressClient | null;
  targets: PublishTargetRegistry;
  /** log、錯誤回應、CoreService 共用的遮蔽器；設定精靈存了新密碼就當場加進去。 */
  readonly secrets: MutableScrubber;
  readonly setupFiles: SetupFiles | null;
  /** 設定精靈測試連線用的 fetch；測試換成假的。 */
  readonly setupFetch: typeof fetch | undefined;
  /**
   * 發布台的安全核心。**Web UI 與階段 6 的 MCP Server 必須共用這一個實例**——
   * 所有核准、驗證與稽核只實作一次，路由層不得自己再寫一套。
   */
  readonly core: CoreService;
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
  /**
   * 測試（與階段 6 的 MCP 進入點）可以注入現成的 CoreService，
   * 讓工作區與媒體目錄指到暫存路徑，不會寫進專案的 drafts/。
   */
  readonly core?: CoreService;
  /**
   * 資料目錄（P8-T003）：沒注入 core 時，新建的 CoreService 把工作區與圖片放這底下。
   * 不給就是 `resolveDataDir()`。測試一律給暫存目錄。
   */
  readonly dataDir?: string;
  readonly version?: string;
  /** 設定精靈寫檔的位置。不給＝精靈只能讀、不能寫（見 SetupFiles）。 */
  readonly setupFiles?: SetupFiles;
  /** 測試用：精靈測試連線時的 fetch。 */
  readonly setupFetch?: typeof fetch;
  /** 測試用：log 的去處（驗證 log 裡沒有秘密）。 */
  readonly logStream?: { write(line: string): void };
  /** 測試用：查證的取回器。不給就用真的（`realFactCheckFetcher`）；注入 core 時這個不用。 */
  readonly factCheckFetcher?: FactCheckFetcherFactory;
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const { config, db } = options;
  const secrets = createMutableScrubber(collectSecrets(config));
  const scrub = secrets.scrub;

  const app = Fastify({
    logger: buildLoggerOptions(config, scrub, options.logStream),
    // 本機工具不需要信任 proxy header。
    trustProxy: false,
    bodyLimit: 8 * 1024 * 1024,
  });

  const wordpress = options.wordpress ?? createWordPressClient(config, app);

  const ctx: AppContext = {
    config,
    db,
    templates: options.templates,
    agents: options.agents,
    wordpress,
    targets: options.targets,
    core:
      options.core ??
      new CoreService({
        db,
        templates: options.templates,
        targets: options.targets,
        agents: options.agents,
        wordpress,
        site: config.wordpress ? siteOf(config.wordpress) : null,
        scrub,
        factCheckFetcher: options.factCheckFetcher ?? realFactCheckFetcher(options.version ?? '0.1.0'),
        ...(options.dataDir === undefined ? {} : { dataDir: options.dataDir }),
      }),
    secrets,
    setupFiles: options.setupFiles ?? null,
    setupFetch: options.setupFetch,
    version: options.version ?? '0.1.0',
    startedAt: new Date().toISOString(),
  };
  app.decorate('ctx', ctx);

  applyLocalOnlyGuard(app);

  // 所有回應送出前的最後一道遮蔽（P5-T023，審查 #7）：原本只遮錯誤回應，200 的 JSON 與校樣 HTML
  // 直接送出。掛在 root、在所有路由之前，一次涵蓋全部路由。到這裡時 JSON 已經序列化成字串；
  // Buffer（圖片）與 stream（靜態檔）不是字串，原封不動。Content-Length 由 Fastify 在 onSend 之後
  // 依換過的字串計算（路由都沒自己設）。
  app.addHook('onSend', async (_request, _reply, payload) => (typeof payload === 'string' ? scrub(payload) : payload));

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
  await app.register(jobRoutes);
  await app.register(setupRoutes);

  // 正式啟動時提供已建置的 UI；開發時用 Vite dev server，這裡不存在也不報錯。
  if (existsSync(paths.uiDist)) {
    await app.register(fastifyStatic, { root: paths.uiDist, prefix: '/' });
  }

  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    ctx: AppContext;
  }
}
