import type { FastifyInstance, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type {
  PublishTargetSummary,
  SetupAgentsResponse,
  SetupConnectionRequest,
  SetupConnectionResult,
  SetupDestinationsRequest,
  SetupDestinationsResponse,
  SetupSaveResponse,
  SetupSaveWordPressRequest,
  SetupSiteChange,
  SetupStatus,
} from '../../contract/api.js';
import { EnvFileError, mergeEnvFile } from '../../config/env-file.js';
import { AGENT_SETUP_HINTS } from '../../agents/setup-hints.js';
import {
  DESTINATION_KEYS,
  destinationOptions,
  diagnoseConnection,
  mergeSiteTargets,
  normalizeAppPassword,
  permissionsOf,
  readSiteConfig,
  SetupConflictError,
  setupTargetJson,
  writeSiteConfig,
  type VerifiedCredentials,
} from '../../wordpress/setup.js';
import { fetchIdentity, fetchPostTypes, fetchTaxonomies } from '../../wordpress/site.js';
import { loadPublishTargets, PublishTargetError, PublishTargetSchema } from '../../wordpress/targets.js';
import type { WordPressClient } from '../../wordpress/client.js';
import type { SetupFiles } from '../app.js';
import { applyTargets, applyWordPressConfig } from '../reconfigure.js';
import { AppError, errorCodes } from '../errors.js';
import { isAllowedWriteSource } from '../plugins/local-only.js';
import { mapCoreError } from './jobs.js';
import { summarize } from './wordpress.js';

/**
 * 首次設定精靈（P8-T002，D-016）。
 *
 * 這組路由是整個專案唯一「從瀏覽器收秘密、會寫檔」的地方，規則在 docs/specs/security.md
 * 「設定精靈寫入的秘密」：
 * - 密碼只在「測試連線」那一個請求出現；通過後放在記憶體，回一個 testId，「儲存」只送 testId。
 * - 任何回應都不含密碼。
 * - 寫入路由除了全域的本機守門，還要求 JSON 與同源（requireSetupWrite）。
 * - 沒有注入檔案路徑（ctx.setupFiles 是 null）就不能寫。
 */

/** 通過測試的憑證在記憶體裡留多久。 */
const PENDING_TTL_MS = 10 * 60 * 1000;

const ConnectionBody = z
  .object({
    url: z.string().max(2000),
    username: z.string().max(200),
    appPassword: z.string().max(200),
  })
  .strict() satisfies z.ZodType<SetupConnectionRequest>;

const SaveWordPressBody = z
  .object({ testId: z.string().min(1).max(100), confirmSiteChange: z.boolean().optional() })
  .strict() satisfies z.ZodType<SetupSaveWordPressRequest>;

/** 讀取但有副作用的路由（打真的站、跑 CLI）也走 POST＋JSON，吃同一套守門。body 一律是空物件。 */
const EmptyBody = z.object({}).strict();

/** WordPress 產生的應用程式密碼長這樣；只有這種字串才值得放進全域遮蔽器。 */
const APP_PASSWORD_SHAPE = /^[A-Za-z0-9]{24}$/;

const DestinationKey = z.enum(['post', 'page']);
const DestinationsBody = z
  .object({
    include: z.array(DestinationKey).min(1).max(2),
    replace: z.array(DestinationKey).max(2),
  })
  .strict() satisfies z.ZodType<SetupDestinationsRequest>;

function parseBody<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    // 不帶 issue 的原文以外的東西：zod 的訊息不含欄位值，但保險起見只給路徑。
    throw new AppError(
      errorCodes.VALIDATION_FAILED,
      '請求格式不正確',
      400,
      result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    );
  }
  return result.data;
}

/**
 * 寫入路由的額外守門（CSRF）。全域守門已經擋掉外站 Origin、null Origin 與非同源的 Sec-Fetch-Site；
 * 這裡再要求 JSON：跨來源送 `application/json` 一定先有 preflight，後端不回 CORS 標頭，瀏覽器就不送——
 * 連其他本機埠（localhost:8080 之類）的網頁也送不進來。
 */
function requireSetupWrite(request: FastifyRequest): void {
  const type = String(request.headers['content-type'] ?? '').toLowerCase();
  if (!type.startsWith('application/json')) {
    throw new AppError(errorCodes.CROSS_ORIGIN_BLOCKED, '設定只能從發布台自己的畫面送出。', 415);
  }
  if (!isAllowedWriteSource(request.headers)) {
    throw new AppError(errorCodes.CROSS_ORIGIN_BLOCKED, '設定只能從發布台自己的畫面送出。', 403);
  }
}

function requireFiles(app: FastifyInstance): SetupFiles {
  const files = app.ctx.setupFiles;
  if (!files) {
    throw new AppError(errorCodes.WORDPRESS_UNAVAILABLE, '這個發布台是以不能寫設定檔的方式啟動的，設定精靈只能測試、不能儲存。', 503);
  }
  return files;
}

/**
 * 換設定的那一段：先立旗子（有發布或上傳在跑就拒絕），期間 CoreService 擋掉所有會碰 WordPress 的動作；
 * 做完一定放下。reconfigure() 本身還會再檢查一次沒有動作在跑。
 */
async function withReconfigure<T>(app: FastifyInstance, fn: () => Promise<T>): Promise<T> {
  const busy = app.ctx.core.tryBeginReconfigure();
  if (busy !== null) throw new AppError(errorCodes.PUBLISH_BLOCKED, busy, 409);
  try {
    return await fn();
  } finally {
    app.ctx.core.endReconfigure();
  }
}

function requireClient(app: FastifyInstance): WordPressClient {
  const client = app.ctx.wordpress;
  if (!client) {
    throw new AppError(errorCodes.WORDPRESS_UNAVAILABLE, '還沒連上 WordPress：先完成第一步「連線 WordPress」。', 503);
  }
  return client;
}

function status(app: FastifyInstance): SetupStatus {
  const ctx = app.ctx;
  const siteExists = ctx.targets.setupRequired === undefined;
  return {
    needsSetup: ctx.config.wordpress === null || !siteExists,
    wordpress: ctx.config.wordpress
      ? { url: ctx.config.wordpress.url, username: ctx.config.wordpress.username }
      : null,
    siteConfig: { exists: siteExists, targets: summarize(ctx.targets.list()) },
    canWrite: ctx.setupFiles !== null,
  };
}

/** 設定檔裡現有的目標：有檔案路徑就讀磁碟（使用者可能啟動後手動改過），否則用記憶體裡的。 */
async function existingTargets(app: FastifyInstance): Promise<PublishTargetSummary[]> {
  const files = app.ctx.setupFiles;
  if (!files) return summarize(app.ctx.targets.list());
  const current = await readSiteConfig(files.siteConfigFile);
  return summarize(current.rawTargets.map((raw) => PublishTargetSchema.parse(raw)));
}

async function translate<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof SetupConflictError) throw new AppError(errorCodes.INVALID_INPUT, error.message, 409);
    if (error instanceof EnvFileError) throw new AppError(errorCodes.VALIDATION_FAILED, error.message, 400);
    if (error instanceof PublishTargetError) throw new AppError(errorCodes.VALIDATION_FAILED, error.message, 400);
    throw mapCoreError(error);
  }
}

/**
 * 測試的是另一個站、而目前的站上已經有發過的文或傳過的圖：回報給畫面，存檔前要使用者確認。
 */
function siteChangeFor(app: FastifyInstance, nextUrl: string): SetupSiteChange | null {
  const current = app.ctx.config.wordpress?.url ?? null;
  if (current === null || current === nextUrl) return null;
  const usage = app.ctx.core.currentSiteUsage();
  if (usage === null || (usage.publishedJobs === 0 && usage.uploadedMedia === 0)) return null;
  return { from: current, to: nextUrl, ...usage };
}

export async function setupRoutes(app: FastifyInstance): Promise<void> {
  /** 只留最新一組；新的測試會把舊的蓋掉。重啟就沒了（使用者重測一次即可）。 */
  let pending: {
    id: string;
    credentials: VerifiedCredentials;
    expiresAt: number;
    siteChange: SetupSiteChange | null;
  } | null = null;

  app.get('/api/setup', async (): Promise<SetupStatus> => status(app));

  app.post('/api/setup/wordpress/test', async (request): Promise<SetupConnectionResult> => {
    requireSetupWrite(request);
    const body = parseBody(ConnectionBody, request.body);
    // 長得像應用程式密碼的才加進全域遮蔽器（含有空白與去掉空白兩種樣子），之後任何 log 或錯誤都抹得掉。
    // 格式不對的不加：那多半是打錯欄位的網址或帳號，加進去會讓它在 log 與稽核紀錄裡永遠變成 [REDACTED]；
    // 它們也不會被送去 WordPress（格式不對在連線前就擋），這次診斷內部另有自己的遮蔽器。
    const bare = normalizeAppPassword(body.appPassword);
    if (APP_PASSWORD_SHAPE.test(bare)) app.ctx.secrets.add([body.appPassword, bare]);

    const outcome = await diagnoseConnection(body, {
      ...(app.ctx.setupFetch === undefined ? {} : { fetchImpl: app.ctx.setupFetch }),
    });
    if (!outcome.credentials) {
      pending = null;
      return { ...outcome.result, testId: null, siteChange: null };
    }
    const siteChange = siteChangeFor(app, outcome.credentials.url);
    const id = randomUUID();
    pending = { id, credentials: outcome.credentials, expiresAt: Date.now() + PENDING_TTL_MS, siteChange };
    return { ...outcome.result, testId: id, siteChange };
  });

  app.post('/api/setup/wordpress', async (request): Promise<SetupSaveResponse> => {
    requireSetupWrite(request);
    const body = parseBody(SaveWordPressBody, request.body);
    const files = requireFiles(app);
    if (!pending || pending.id !== body.testId || pending.expiresAt < Date.now()) {
      throw new AppError(
        errorCodes.INVALID_INPUT,
        '這次的測試結果已經失效（超過 10 分鐘、之後又測過別的，或發布台重新啟動過）。請再按一次「測試連線」。',
        409,
      );
    }
    const { credentials, siteChange } = pending;
    if (siteChange !== null && body.confirmSiteChange !== true) {
      throw new AppError(
        errorCodes.INVALID_INPUT,
        `要從 ${siteChange.from} 換到 ${siteChange.to}：舊站上的 ${siteChange.publishedJobs} 篇與 ${siteChange.uploadedMedia} 張圖不會跟過去。確認之後再存。`,
        409,
      );
    }

    await withReconfigure(app, async () => {
      await translate(() =>
        mergeEnvFile(
          files.envFile,
          {
            WORDPRESS_URL: credentials.url,
            WORDPRESS_USERNAME: credentials.username,
            WORDPRESS_APP_PASSWORD: credentials.appPassword,
          },
          { exampleFile: files.envExampleFile },
        ),
      );
      applyWordPressConfig(app, credentials);
    });
    pending = null;
    request.log.info({ url: credentials.url }, '設定精靈：已儲存 WordPress 連線並當場套用');
    return { saved: true, restartRequired: false, backupFile: null, status: status(app) };
  });

  app.post('/api/setup/agents', async (request): Promise<SetupAgentsResponse> => {
    requireSetupWrite(request);
    parseBody(EmptyBody, request.body ?? {});
    const statuses = await app.ctx.agents.detectAll({ refresh: true });
    const imageGenerator = app.ctx.agents.imageGeneratorId();
    return {
      agents: statuses.map((agent) => ({
        id: agent.id,
        displayName: agent.displayName,
        installed: agent.installed,
        version: agent.version,
        loginState: agent.loginState,
        available: agent.available,
        unavailableReason: agent.unavailableReason,
        canGenerateImages: agent.id === imageGenerator,
        ...AGENT_SETUP_HINTS[agent.id],
      })),
    };
  });

  app.post('/api/setup/destinations/check', async (request): Promise<SetupDestinationsResponse> => {
    requireSetupWrite(request);
    parseBody(EmptyBody, request.body ?? {});
    const client = requireClient(app);
    return translate(async () => {
      const [identity, types, taxonomies, existing] = await Promise.all([
        fetchIdentity(client),
        fetchPostTypes(client),
        fetchTaxonomies(client),
        existingTargets(app),
      ]);
      return { options: destinationOptions(types, taxonomies, permissionsOf(identity), existing), existing };
    });
  });

  app.post('/api/setup/destinations', async (request): Promise<SetupSaveResponse> => {
    requireSetupWrite(request);
    const body = parseBody(DestinationsBody, request.body);
    const files = requireFiles(app);
    const client = requireClient(app);
    const include = DESTINATION_KEYS.filter((key) => body.include.includes(key));

    const backupFile = await withReconfigure(app, () => translate(async () => {
      // 站上實際有什麼，後端自己再問一次，不信任畫面送來的 restBase。
      const [identity, types, taxonomies, current] = await Promise.all([
        fetchIdentity(client),
        fetchPostTypes(client),
        fetchTaxonomies(client),
        readSiteConfig(files.siteConfigFile),
      ]);
      const existingSummaries = summarize(current.rawTargets.map((raw) => PublishTargetSchema.parse(raw)));
      const options = destinationOptions(types, taxonomies, permissionsOf(identity), existingSummaries);
      const additions = include.map((key) => {
        const option = options.find((item) => item.key === key)!;
        if (!option.available) throw new AppError(errorCodes.VALIDATION_FAILED, option.reason ?? `${option.displayName}選不了`, 400);
        return setupTargetJson(option);
      });
      const merged = mergeSiteTargets(current.rawTargets, additions, body.replace);
      const backup = await writeSiteConfig(files.siteConfigFile, merged, {
        backupsDir: files.backupsDir,
        rootDir: files.rootDir,
        hadFile: current.exists,
      });
      applyTargets(app, await loadPublishTargets(files.siteConfigFile));
      return backup;
    }));

    request.log.info({ include, replace: body.replace, backupFile }, '設定精靈：已寫入站台設定檔並當場套用');
    return { saved: true, restartRequired: false, backupFile, status: status(app) };
  });
}
