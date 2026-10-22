import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { probeSite, unconfiguredProbe } from '../../wordpress/site.js';
import { fetchPostTypes, fetchTaxonomies } from '../../wordpress/site.js';
import { taxonomyRestBaseOf, validateTargetsAgainstSite, type PublishTarget } from '../../wordpress/targets.js';
import { listTerms, resolveTerms } from '../../wordpress/terms.js';
import type { AuthorsResponse, CreateTermRequest, PublishTargetSummary, Term, TermsResponse } from '../../contract/api.js';
import type { WordPressClient } from '../../wordpress/client.js';
import { AppError, errorCodes } from '../errors.js';
import { mapCoreError } from './jobs.js';

/**
 * WordPress 連線狀態 API。
 *
 * 跟 /api/agents 一樣的定位：讓 UI 在使用者按下發布**之前**就知道連得上沒、
 * 權限夠不夠、內容類型在不在。發布失敗才發現問題就太晚了。
 *
 * 絕不回傳 Application Password，連「有沒有填」以外的資訊都不給。
 */

/**
 * 發布台會用到的內容類型＝站台設定檔裡的 target（D-016：一次連一個站，換站就換設定）。
 * 不寫死：寫死 read-think／diary 的話，通用站的診斷會多報兩個「找不到」。
 */
function expectedPostTypes(targets: readonly PublishTarget[]): string[] {
  return [...new Set(targets.map((target) => target.postType))];
}

export async function wordpressRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/wordpress', async () => {
    const client = app.ctx.wordpress;
    const targets = app.ctx.targets.list();

    if (!client) {
      return { ...unconfiguredProbe(), targetIssues: [], publishTargets: summarize(targets) };
    }

    const probe = await probeSite(client, expectedPostTypes(targets));

    // 認證都過不了就沒必要再驗設定，錯誤訊息會變成兩層噪音。
    if (!probe.authenticated) {
      return { ...probe, targetIssues: [], publishTargets: summarize(targets) };
    }

    // 設定檔說要發到哪，跟站台實際有什麼，要對得起來才算真的可用。
    const [postTypes, taxonomies] = await Promise.all([fetchPostTypes(client), fetchTaxonomies(client)]);
    const targetIssues = validateTargetsAgainstSite(targets, postTypes, taxonomies);

    return { ...probe, targetIssues, publishTargets: summarize(targets) };
  });

  /**
   * 分類項目清單。UI 的分類挑選器靠它，沒有它使用者只能盲打——打錯就變成
   * 「對不上的名稱」，發布出去的文章沒有分類。
   */
  app.get<{ Querystring: { taxonomy?: string } }>('/api/wordpress/terms', async (request): Promise<TermsResponse> => {
    const restBase = requireKnownTaxonomy(app, request.query.taxonomy);
    const client = requireClient(app);
    return guard(async () => ({ terms: await listTerms(client, restBase) }));
  });

  /**
   * 可以當作者的人（P5-T024，D-024）。只有 id 與顯示名稱；所有回應送出前還會再過一次遮蔽器（app.ts）。
   * 設預設作者走 `POST /api/setup/default-author`（寫檔的路由都在 setup 那一組）。
   */
  app.get('/api/wordpress/authors', async (): Promise<AuthorsResponse> => {
    requireClient(app);
    return guard(() => app.ctx.core.listAuthors());
  });

  /**
   * 建立分類項目（使用者在發布台右欄手動按「建立」）。
   *
   * D-050：**不看任何開關**，只要發布目標有分類法就能建。D-004 擋的是「發布時把 Agent 給的名稱自動建立」
   * （近義詞會把分類變垃圾場），那條路在 core/service/publish.ts 寫死 `allowCreate: false`，跟這裡無關。
   *
   * 這條路由只給本機發布台自己的畫面：來源防護在 server/plugins/local-only.ts（loopback、Host、Origin 同源、
   * Sec-Fetch-Site），外站網頁、同機其他埠、沙箱 iframe 送來的 POST 都擋（tests/wordpress-api.test.ts）。
   * MCP 不提供建立工具。
   *
   * 實際建立走 `resolveTerms(..., { allowCreate: true })` 而不是自己寫一份 POST：
   * 同名的既有項目會直接回傳，不會建出第二個。
   */
  app.post('/api/wordpress/terms', async (request, reply): Promise<Term> => {
    const body = parseBody(CreateTermBody, request.body);
    const target = requireTargetForTaxonomy(app, body.taxonomy);

    const client = requireClient(app);
    const resolution = await guard(() =>
      resolveTerms(client, taxonomyRestBaseOf(target)!, [body.name], { allowCreate: true }),
    );
    const term = resolution.resolved[0]?.term;
    if (!term) {
      throw new AppError(errorCodes.VALIDATION_FAILED, `分類項目名稱不能是空白：${body.name}`, 400);
    }

    // 已經存在就回 200，這次真的建出來才回 201。
    reply.status(resolution.created.length > 0 ? 201 : 200);
    return term;
  });
}

const CreateTermBody = z.object({
  taxonomy: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
}) satisfies z.ZodType<CreateTermRequest>;

function parseBody<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new AppError(
      errorCodes.VALIDATION_FAILED,
      '請求格式不正確',
      400,
      result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    );
  }
  return result.data;
}

/** 錯誤翻譯跟 /api/jobs 用同一套，同一種失敗在兩邊不能回不同的 code。 */
async function guard<T>(fn: () => T | Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw mapCoreError(error);
  }
}

function requireClient(app: FastifyInstance): WordPressClient {
  const client = app.ctx.wordpress;
  if (!client) {
    throw new AppError(
      errorCodes.WORDPRESS_UNAVAILABLE,
      'WordPress 尚未設定。到「設定」跑一次設定精靈（或在 .env 填好連線資訊後重新啟動）',
      503,
    );
  }
  return client;
}

/**
 * 分類法只接受**設定檔裡真的用到的那幾個**。
 *
 * 這是硬性禁令「不得提供能呼叫任意 REST endpoint 的介面」在這條路由上的落點：
 * taxonomy 會被直接接到 `/wp/v2/<taxonomy>` 後面，放行任意字串就等於開了一個
 * 任意 GET 代理。允許清單從 publish-targets.json 來，不是寫死的。
 */
type TaxonomyTarget = PublishTarget & { taxonomy: string };

function requireTargetForTaxonomy(app: FastifyInstance, taxonomy: string | undefined): TaxonomyTarget {
  const available = app.ctx.targets
    .list()
    .filter((target): target is TaxonomyTarget => target.taxonomy !== null);
  const target = taxonomy === undefined ? undefined : available.find((entry) => entry.taxonomy === taxonomy);
  if (!target) {
    throw new AppError(
      errorCodes.VALIDATION_FAILED,
      `未知的分類法 ${taxonomy ?? '(未指定)'}；可用的是 ${available.map((entry) => entry.taxonomy).join('、') || '（無）'}`,
      400,
    );
  }
  return target;
}

/**
 * 畫面用分類法 slug 問（跟 target.taxonomy 一樣），回傳的是要打的 REST 名稱
 * （核心的 category → categories）。
 */
function requireKnownTaxonomy(app: FastifyInstance, taxonomy: string | undefined): string {
  return taxonomyRestBaseOf(requireTargetForTaxonomy(app, taxonomy))!;
}

/** 只回報 UI 需要的欄位。設定檔沒有秘密，但也沒必要整包吐出去。 */
export function summarize(targets: readonly PublishTarget[]): PublishTargetSummary[] {
  return targets.map((target) => ({
    key: target.key,
    displayName: target.displayName,
    contentType: target.contentType,
    postType: target.postType,
    templateId: target.templateId,
    taxonomy: target.taxonomy,
    requireFeaturedImage: target.requireFeaturedImage,
    disabled: target.disabled,
  }));
}
