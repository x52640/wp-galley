import { readFile } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { AppError, errorCodes } from '../errors.js';
import { CoreError } from '../../core/errors.js';
import { JOB_STATES, type JobState } from '../../core/state-machine.js';
import { MediaUploadError } from '../../media/upload.js';
import { RemoteChangedError } from '../../wordpress/posts.js';
import { WordPressError } from '../../wordpress/errors.js';
import { TemplateLoadError } from '../../templates/registry.js';
import { WorkspaceError } from '../../agents/workspace.js';
import { AgentUnavailableError } from '../../agents/registry.js';
import { USER_NOTE_MAX, userNoteLength } from '../../contract/user-note.js';
import { BlockConversionError } from '../../wordpress/block-types.js';
import type {
  AgentRunRequest,
  AgentRunResult,
  ApprovalResponse,
  ApproveRequest,
  CancelledResponse,
  Comparison,
  CreateJobRequest,
  CreateRevisionRequest,
  DiscardReviewRequest,
  DiscardedResponse,
  DismissedResponse,
  ImageAtPositionRequest,
  ImageBriefResponse,
  UseCandidateRequest,
  ImageCandidateResponse,
  JobDetail,
  JobResponse,
  ListJobsResponse,
  MarksResponse,
  MediaResponse,
  MediaUploadRequest,
  PlaceMediaRequest,
  ProposalRefRequest,
  PublishRequest,
  PublishResponse,
  RemovedResponse,
  RenderOutcome,
  ResolveReviewRequest,
  ReviewResolveResult,
  ReviewResponse,
  RevisionResponse,
  RevisionsResponse,
  RevokeApprovalRequest,
  RevokedResponse,
} from '../../contract/api.js';

/**
 * 發布台的 HTTP 介面（docs/specs/http-api.md）。
 *
 * 這一層只做三件事：**驗證請求形狀、呼叫 CoreService、把錯誤翻成 HTTP 狀態碼**。
 * 任何「可不可以做」的判斷都不在這裡——那些在 CoreService，因為階段 6 的 MCP
 * 走的是同一個 CoreService 但不會經過這些路由。規則寫在路由裡＝MCP 繞得過去。
 */

const UuidParams = z.object({ uuid: z.string().min(1).max(64) });

const CreateJobBody = z.object({
  targetKey: z.string().min(1).max(64),
  sourceText: z.string().max(200_000).default(''),
  title: z.string().max(120).optional(),
  templateData: z.record(z.string(), z.unknown()).optional(),
});

const CreateRevisionBody = z.object({
  templateData: z.record(z.string(), z.unknown()).optional(),
  editedBody: z.string().max(500_000).optional(),
  resolveItemId: z.number().int().positive().optional(),
  sourceText: z.string().max(200_000).optional(),
  featuredMediaId: z.number().int().positive().nullable().optional(),
  origin: z.enum(['source', 'agent_review', 'media', 'template_switch', 'chat', 'manual']).optional(),
  reason: z.string().max(200).optional(),
});

const AgentBody = z.object({
  provider: z.enum(['codex', 'claude', 'google']),
  /** 預設 review。images 那一趟不會產生提案，所以不會洗掉待處理清單。 */
  task: z.enum(['review', 'images']).optional(),
  model: z.string().max(120).optional(),
  instruction: z.string().max(8_000).optional(),
  timeoutMs: z.number().int().min(1_000).max(900_000).optional(),
});

/**
 * 圖片走 base64 JSON 而不是 multipart：本機工具沒有大量上傳的場景，
 * 而 multipart 要多裝一個外掛、多一套解析路徑。Fastify 的 bodyLimit 是 8 MB，
 * base64 會膨脹約 1/3，所以實際能傳約 6 MB 的圖。
 */
const MediaBody = z.object({
  filename: z.string().min(1).max(200),
  mimeType: z.string().min(1).max(100),
  dataBase64: z.string().min(1).max(12_000_000),
  altText: z.string().max(300).optional(),
  caption: z.string().max(500).optional(),
  briefKey: z.string().max(60).optional(),
});

const PlaceBody = z.object({ afterBlockIndex: z.number().int().min(-1).max(10_000) });

/**
 * 在文章上請 AI 配一張（P5-T018）。`.strict()`：這條路由的重點就是 prompt 只能由後端組，
 * 前端多送一個 `prompt` 之類的欄位要當場擋下，而不是被 zod 默默丟掉、讓人以為有效。
 */
const ImageAtPositionBody = z
  .object({
    afterBlockIndex: z.number().int().min(-1).max(10_000),
    contentHash: z.string().regex(/^[0-9a-f]{64}$/, 'contentHash 必須是 64 位十六進位'),
    // 上限跟前端計數、CoreService 同一套：摺疊空白之後數 code point。另有一個寬鬆的原始長度上限擋超大 body。
    note: z
      .string()
      .max(4_000)
      .refine((value) => userNoteLength(value) <= USER_NOTE_MAX, `想要什麼樣的圖，最多 ${USER_NOTE_MAX} 個字`)
      .optional(),
  })
  .strict();

/** 「用這張」可以帶卡片上填的替代文字（P5-T018）；body 可以整個不給。 */
const UseCandidateBody = z.object({ altText: z.string().max(300).optional() }).strict().optional();

/**
 * 逐項處理校稿建議。
 *
 * 上限 500 是配合 `changes` 的 maxItems 300 加上 `observations` 的 50 再留餘裕——
 * 「全部套用」會把清單上所有 id 一次送過來，數字要蓋得住整份提案。
 */
const ResolveReviewBody = z.object({
  itemIds: z.array(z.number().int().positive()).min(1).max(500),
  decision: z.enum(['apply', 'skip']),
});

/**
 * 整份操作要指名是哪一份提案。
 *
 * 只帶 job uuid 的話認的是「目前那一份」；確認對話框開著的時候如果又跑了一次
 * 校稿，按下去就會作用在使用者沒看過的那一份上。
 */
const ProposalRefBody = z.object({ proposalId: z.number().int().positive().optional() }).optional();
const DiscardReviewBody = z
  .object({ reason: z.string().max(200).optional(), proposalId: z.number().int().positive().optional() })
  .optional();
const ApproveBody = z.object({ contentHash: z.string().regex(/^[0-9a-f]{64}$/, 'contentHash 必須是 64 位十六進位') });
const RevokeBody = z.object({ reason: z.string().max(200).optional() }).optional();
const PublishBody = z.object({
  status: z.enum(['draft', 'publish']),
  confirm: z.boolean().optional(),
});

/**
 * 請求 schema 與共用契約（src/contract/api.ts）必須說同一件事：欄位一樣多，
 * 而且前端照契約送來的東西 schema 都收。
 *
 * 對不上就在這裡編譯失敗。最常見的是前端多送一個欄位、zod 默默把它丟掉——
 * 前端以為有的保護，後端其實沒有（P5-T002 就是這樣抓到 expectedContentHash）。
 */
type SameKeys<A, B> = [keyof A] extends [keyof B] ? ([keyof B] extends [keyof A] ? true : false) : false;
type Accepts<Schema extends z.ZodType, Req> = [Req] extends [NonNullable<z.input<Schema>>]
  ? SameKeys<Req, NonNullable<z.input<Schema>>>
  : false;

export const REQUEST_CONTRACT_CHECK: {
  readonly createJob: Accepts<typeof CreateJobBody, CreateJobRequest>;
  readonly createRevision: Accepts<typeof CreateRevisionBody, CreateRevisionRequest>;
  readonly agent: Accepts<typeof AgentBody, AgentRunRequest>;
  readonly media: Accepts<typeof MediaBody, MediaUploadRequest>;
  readonly place: Accepts<typeof PlaceBody, PlaceMediaRequest>;
  readonly imageAtPosition: Accepts<typeof ImageAtPositionBody, ImageAtPositionRequest>;
  readonly useCandidate: Accepts<typeof UseCandidateBody, UseCandidateRequest>;
  readonly resolve: Accepts<typeof ResolveReviewBody, ResolveReviewRequest>;
  readonly proposalRef: Accepts<typeof ProposalRefBody, ProposalRefRequest>;
  readonly discard: Accepts<typeof DiscardReviewBody, DiscardReviewRequest>;
  readonly approve: Accepts<typeof ApproveBody, ApproveRequest>;
  readonly revoke: Accepts<typeof RevokeBody, RevokeApprovalRequest>;
  readonly publish: Accepts<typeof PublishBody, PublishRequest>;
} = {
  createJob: true,
  createRevision: true,
  agent: true,
  media: true,
  place: true,
  imageAtPosition: true,
  useCandidate: true,
  resolve: true,
  proposalRef: true,
  discard: true,
  approve: true,
  revoke: true,
  publish: true,
};

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
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

/** CoreService 的錯誤 code → HTTP 狀態碼。 */
const STATUS_BY_CORE_CODE: Record<string, number> = {
  JOB_NOT_FOUND: 404,
  INVALID_TRANSITION: 409,
  APPROVAL_FORBIDDEN: 403,
  CONTENT_CHANGED: 409,
  CONTENT_INVALID: 422,
  PUBLISH_BLOCKED: 409,
  MEDIA_ERROR: 400,
  AGENT_ERROR: 502,
  WORDPRESS_UNAVAILABLE: 503,
  INVALID_INPUT: 400,
};

/** WordPress 的錯誤 code → HTTP 狀態碼。連不上是 502，權限問題照實回報。 */
function statusForWordPress(error: WordPressError): number {
  switch (error.code) {
    case 'WP_AUTH':
      return 401;
    case 'WP_FORBIDDEN':
      return 403;
    case 'WP_NOT_FOUND':
      return 404;
    case 'WP_INVALID_REQUEST':
      return 400;
    case 'WP_RATE_LIMITED':
      return 429;
    default:
      return 502;
  }
}

export function mapCoreError(error: unknown): unknown {
  if (error instanceof AppError) return error;

  if (error instanceof CoreError) {
    return new AppError(error.code, error.message, STATUS_BY_CORE_CODE[error.code] ?? 400, error.details);
  }
  if (error instanceof RemoteChangedError) {
    return new AppError(errorCodes.REMOTE_CHANGED, error.message, 409, {
      expectedModifiedGmt: error.expected.modifiedGmt,
      actualModifiedGmt: error.actual.modifiedGmt,
      // 具體是哪些欄位對不上。只講「被改過了」使用者沒辦法判斷要不要放棄自己的版本。
      changedFields: [...error.changedFields],
    });
  }
  if (error instanceof MediaUploadError) {
    return new AppError(errorCodes.MEDIA_ERROR, error.message, 400);
  }
  if (error instanceof BlockConversionError) {
    return new AppError(errorCodes.CONTENT_INVALID, error.message, 422);
  }
  if (error instanceof WordPressError) {
    return new AppError(errorCodes.WORDPRESS_ERROR, error.message, statusForWordPress(error));
  }
  if (error instanceof AgentUnavailableError) {
    return new AppError(errorCodes.AGENT_ERROR, error.message, 503);
  }
  if (error instanceof TemplateLoadError || error instanceof WorkspaceError) {
    return new AppError(errorCodes.VALIDATION_FAILED, error.message, 400);
  }
  return error;
}

/** 所有 handler 都包一層，錯誤在同一個地方翻譯，不散在每個路由裡。 */
async function guard<T>(fn: () => T | Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw mapCoreError(error);
  }
}

function decodeMedia(body: z.infer<typeof MediaBody>): Uint8Array {
  const bytes = Buffer.from(body.dataBase64, 'base64');
  if (bytes.byteLength === 0) {
    throw new AppError(errorCodes.MEDIA_ERROR, '圖片資料是空的，或不是合法的 base64', 400);
  }
  return new Uint8Array(bytes);
}

export async function jobRoutes(app: FastifyInstance): Promise<void> {
  const core = (): FastifyInstance['ctx']['core'] => app.ctx.core;

  // --- job ------------------------------------------------------------------

  app.get<{ Querystring: { state?: string } }>('/api/jobs', async (request): Promise<ListJobsResponse> => {
    const raw = request.query.state;
    const states = (raw ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0);

    const unknown = states.filter((value) => !(JOB_STATES as readonly string[]).includes(value));
    if (unknown.length > 0) {
      throw new AppError(errorCodes.VALIDATION_FAILED, `未知的狀態：${unknown.join('、')}`, 400);
    }

    return guard(() => ({
      jobs: core().listJobs(states.length > 0 ? { state: states as JobState[] } : {}),
    }));
  });

  app.post('/api/jobs', async (request, reply): Promise<JobResponse> => {
    const body = parse(CreateJobBody, request.body);
    const job = await guard(() =>
      core().createJob({
        targetKey: body.targetKey,
        sourceText: body.sourceText,
        ...(body.title === undefined ? {} : { title: body.title }),
        ...(body.templateData === undefined ? {} : { templateData: body.templateData }),
      }),
    );
    reply.status(201);
    return { job };
  });

  app.get<{ Params: { uuid: string } }>('/api/jobs/:uuid', async (request): Promise<JobDetail> => {
    const { uuid } = parse(UuidParams, request.params);
    return guard(() => core().getJob(uuid));
  });

  app.delete<{ Params: { uuid: string } }>('/api/jobs/:uuid', async (request): Promise<JobResponse> => {
    const { uuid } = parse(UuidParams, request.params);
    return guard(() => ({ job: core().cancelJob(uuid) }));
  });

  // --- 內容 -----------------------------------------------------------------

  app.get<{ Params: { uuid: string } }>('/api/jobs/:uuid/revisions', async (request): Promise<RevisionsResponse> => {
    const { uuid } = parse(UuidParams, request.params);
    return guard(() => ({ revisions: core().listRevisions(uuid) }));
  });

  app.post<{ Params: { uuid: string } }>('/api/jobs/:uuid/revisions', async (request, reply): Promise<RevisionResponse> => {
    const { uuid } = parse(UuidParams, request.params);
    const body = parse(CreateRevisionBody, request.body ?? {});
    const revision = await guard(() =>
      core().createRevision(uuid, {
        ...(body.templateData === undefined ? {} : { templateData: body.templateData }),
        ...(body.editedBody === undefined ? {} : { editedBody: body.editedBody }),
        ...(body.resolveItemId === undefined ? {} : { resolveItemId: body.resolveItemId }),
        ...(body.sourceText === undefined ? {} : { sourceText: body.sourceText }),
        ...(body.featuredMediaId === undefined ? {} : { featuredMediaId: body.featuredMediaId }),
        ...(body.origin === undefined ? {} : { origin: body.origin }),
        ...(body.reason === undefined ? {} : { reason: body.reason }),
      }),
    );
    reply.status(201);
    return { revision };
  });

  app.post<{ Params: { uuid: string } }>('/api/jobs/:uuid/render', async (request): Promise<RenderOutcome> => {
    const { uuid } = parse(UuidParams, request.params);
    return guard(() => core().render(uuid));
  });

  /**
   * 校樣本體。回 text/html 讓 UI 直接用 iframe 載入——校樣要套模板自己的
   * preview.css，跟介面的 CSS 完全隔離。
   */
  app.get<{ Params: { uuid: string } }>('/api/jobs/:uuid/preview', async (request, reply) => {
    const { uuid } = parse(UuidParams, request.params);
    const preview = await guard(() => core().getPreviewDocument(uuid));
    reply.header('Content-Type', 'text/html; charset=utf-8');
    reply.header('ETag', `"${preview.contentHash}"`);
    return preview.html;
  });

  app.get<{ Params: { uuid: string }; Querystring: { revision?: string } }>(
    '/api/jobs/:uuid/diff',
    async (request): Promise<MarksResponse> => {
      const { uuid } = parse(UuidParams, request.params);
      const raw = request.query.revision;
      const revisionNumber = raw === undefined ? undefined : Number(raw);
      if (revisionNumber !== undefined && !Number.isInteger(revisionNumber)) {
        throw new AppError(errorCodes.VALIDATION_FAILED, 'revision 必須是整數', 400);
      }
      return guard(() => ({ marks: core().getMarks(uuid, revisionNumber) }));
    },
  );

  // --- Agent ----------------------------------------------------------------

  app.post<{ Params: { uuid: string } }>('/api/jobs/:uuid/agent', async (request): Promise<AgentRunResult> => {
    const { uuid } = parse(UuidParams, request.params);
    const body = parse(AgentBody, request.body);
    return guard(() =>
      core().runAgentReview(uuid, {
        provider: body.provider,
        ...(body.task === undefined ? {} : { task: body.task }),
        ...(body.model === undefined ? {} : { model: body.model }),
        ...(body.instruction === undefined ? {} : { instruction: body.instruction }),
        ...(body.timeoutMs === undefined ? {} : { timeoutMs: body.timeoutMs }),
      }),
    );
  });

  app.delete<{ Params: { uuid: string } }>('/api/jobs/:uuid/agent', async (request): Promise<CancelledResponse> => {
    const { uuid } = parse(UuidParams, request.params);
    return guard(() => {
      core().cancelAgentRun(uuid);
      return { cancelled: true };
    });
  });

  // --- 待處理清單（階段 5.5） ------------------------------------------------

  app.get<{ Params: { uuid: string } }>('/api/jobs/:uuid/review', async (request): Promise<ReviewResponse> => {
    const { uuid } = parse(UuidParams, request.params);
    return guard(() => ({ review: core().getReview(uuid) }));
  });

  app.post<{ Params: { uuid: string } }>('/api/jobs/:uuid/review/resolve', async (request): Promise<ReviewResolveResult> => {
    const { uuid } = parse(UuidParams, request.params);
    const body = parse(ResolveReviewBody, request.body);
    return guard(() => core().resolveReviewItems(uuid, body));
  });

  /**
   * 接受 Agent 的整份稿。
   *
   * 跟「把每一項都勾起來送 resolve」不是同一件事：那個只會套上 Agent 申報過的
   * 改動，這個是整份採用。差別寫在 CoreService.acceptWholeProposal。
   */
  app.post<{ Params: { uuid: string } }>('/api/jobs/:uuid/review/accept-all', async (request): Promise<ReviewResolveResult> => {
    const { uuid } = parse(UuidParams, request.params);
    const body = parse(ProposalRefBody, request.body ?? {});
    return guard(() =>
      core().acceptWholeProposal(uuid, body?.proposalId === undefined ? {} : { proposalId: body.proposalId }),
    );
  });

  app.delete<{ Params: { uuid: string } }>('/api/jobs/:uuid/review', async (request): Promise<DiscardedResponse> => {
    const { uuid } = parse(UuidParams, request.params);
    const body = parse(DiscardReviewBody, request.body ?? {});
    return guard(() => {
      core().discardReview(
        uuid,
        body?.reason ?? '使用者丟棄這份校稿提案',
        body?.proposalId === undefined ? {} : { proposalId: body.proposalId },
      );
      return { discarded: true };
    });
  });

  app.delete<{ Params: { uuid: string; id: string } }>('/api/jobs/:uuid/briefs/:id', async (request): Promise<DismissedResponse> => {
    const { uuid } = parse(UuidParams, request.params);
    const briefId = parseId(request.params.id);
    return guard(() => {
      core().dismissImageBrief(uuid, briefId);
      return { dismissed: true };
    });
  });

  // --- 生圖（D-017，P5-T013） -------------------------------------------------

  /**
   * 照一條配圖需求用 Codex 生一張候選圖。跟 `POST /agent` 一樣要等它跑完才回（約一分鐘），
   * 跑的期間 `GET /api/jobs/:uuid` 的 agentRun 是 running，取消走 `DELETE /agent`。
   */
  app.post<{ Params: { uuid: string; id: string } }>(
    '/api/jobs/:uuid/briefs/:id/generate',
    async (request): Promise<ImageCandidateResponse> => {
      const { uuid } = parse(UuidParams, request.params);
      const briefId = parseId(request.params.id, '配圖需求');
      return guard(async () => ({ candidate: await core().generateBriefImage(uuid, briefId) }));
    },
  );

  /**
   * 在文章上「請 AI 配一張」（D-022，P5-T018）：建一條使用者發起的配圖需求，同一趟開始用 Codex 生圖。
   *
   * 跟 `generate` 不同，這條**不等畫完**就回 202：畫面要能馬上關掉插圖面板，進度看 `GET /api/jobs/:uuid`
   * 的 agentRun（task `generate-image`、briefId 就是這條），取消走 `DELETE /agent`；失敗記在那一趟上。
   * 沒有能用的 Codex 回 503、有別的 Agent 動作在跑回 502（跟 `generate` 一樣）、畫面那一版不是目前這一版回 409，
   * 這些情況都不建需求。
   */
  app.post<{ Params: { uuid: string } }>('/api/jobs/:uuid/briefs', async (request, reply): Promise<ImageBriefResponse> => {
    const { uuid } = parse(UuidParams, request.params);
    const body = parse(ImageAtPositionBody, request.body);
    const { brief } = await guard(() =>
      core().requestImageAtPosition(uuid, {
        afterBlockIndex: body.afterBlockIndex,
        contentHash: body.contentHash,
        ...(body.note === undefined ? {} : { note: body.note }),
      }),
    );
    reply.status(202);
    return { brief };
  });

  /**
   * 候選圖本體。只在本機，**還沒上傳到 WordPress**。檔案路徑由資料庫決定，
   * 呼叫端只給得了編號，碰不到任意路徑。
   */
  app.get<{ Params: { uuid: string; id: string } }>('/api/jobs/:uuid/candidates/:id', async (request, reply) => {
    const { uuid } = parse(UuidParams, request.params);
    const candidateId = parseId(request.params.id, '候選圖');
    const file = await guard(() => core().imageCandidateFile(uuid, candidateId));
    let bytes: Buffer;
    try {
      bytes = await readFile(file.path);
    } catch {
      throw new AppError(errorCodes.NOT_FOUND, '候選圖的檔案不見了（generated-images/ 被清過？），請再生一張', 404);
    }
    reply.header('Content-Type', file.mimeType);
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Content-Type-Options', 'nosniff');
    return reply.send(bytes);
  });

  /** 「用這張」：上傳到 WordPress 媒體庫（走 addMedia 的既有規則）。 */
  app.post<{ Params: { uuid: string; id: string } }>(
    '/api/jobs/:uuid/candidates/:id/use',
    async (request, reply): Promise<MediaResponse> => {
      const { uuid } = parse(UuidParams, request.params);
      const candidateId = parseId(request.params.id, '候選圖');
      const body = parse(UseCandidateBody, request.body ?? undefined);
      const result = await guard(() =>
        core().useImageCandidate(uuid, candidateId, body?.altText === undefined ? {} : { altText: body.altText }),
      );
      reply.status(201);
      return result;
    },
  );

  app.get<{ Params: { uuid: string }; Querystring: { against?: string } }>(
    '/api/jobs/:uuid/compare',
    async (request): Promise<Comparison> => {
      const { uuid } = parse(UuidParams, request.params);
      const against = request.query.against;
      if (against !== undefined && against !== 'proposal' && against !== 'previous') {
        throw new AppError(errorCodes.VALIDATION_FAILED, 'against 只能是 proposal 或 previous', 400);
      }
      return guard(() => core().getComparison(uuid, against));
    },
  );

  // --- 媒體 -----------------------------------------------------------------

  app.post<{ Params: { uuid: string } }>('/api/jobs/:uuid/media', async (request, reply): Promise<MediaResponse> => {
    const { uuid } = parse(UuidParams, request.params);
    const body = parse(MediaBody, request.body);
    const bytes = decodeMedia(body);
    const result = await guard(() =>
      core().addMediaWithOutcome(uuid, {
        bytes,
        mimeType: body.mimeType,
        filename: body.filename,
        ...(body.altText === undefined ? {} : { altText: body.altText }),
        ...(body.caption === undefined ? {} : { caption: body.caption }),
        ...(body.briefKey === undefined ? {} : { briefKey: body.briefKey }),
      }),
    );
    reply.status(201);
    return result;
  });

  app.put<{ Params: { uuid: string; id: string } }>('/api/jobs/:uuid/media/:id', async (request): Promise<MediaResponse> => {
    const { uuid } = parse(UuidParams, request.params);
    const assetId = parseId(request.params.id);
    const body = parse(MediaBody, request.body);
    const bytes = decodeMedia(body);
    return guard(async () => ({
      media: await core().replaceMedia(uuid, assetId, {
        bytes,
        mimeType: body.mimeType,
        filename: body.filename,
        ...(body.altText === undefined ? {} : { altText: body.altText }),
        ...(body.caption === undefined ? {} : { caption: body.caption }),
      }),
    }));
  });

  app.delete<{ Params: { uuid: string; id: string } }>('/api/jobs/:uuid/media/:id', async (request): Promise<RemovedResponse> => {
    const { uuid } = parse(UuidParams, request.params);
    const assetId = parseId(request.params.id);
    return guard(() => {
      core().removeMedia(uuid, assetId);
      return { removed: true };
    });
  });

  app.post<{ Params: { uuid: string; id: string } }>('/api/jobs/:uuid/media/:id/place', async (request): Promise<RevisionResponse> => {
    const { uuid } = parse(UuidParams, request.params);
    const assetId = parseId(request.params.id);
    const body = parse(PlaceBody, request.body);
    return guard(() => ({ revision: core().placeMedia(uuid, assetId, body.afterBlockIndex) }));
  });

  app.post<{ Params: { uuid: string; id: string } }>('/api/jobs/:uuid/media/:id/featured', async (request): Promise<RevisionResponse> => {
    const { uuid } = parse(UuidParams, request.params);
    const assetId = parseId(request.params.id);
    return guard(() => ({ revision: core().setFeaturedMedia(uuid, assetId) }));
  });

  app.delete<{ Params: { uuid: string } }>('/api/jobs/:uuid/featured', async (request): Promise<RevisionResponse> => {
    const { uuid } = parse(UuidParams, request.params);
    return guard(() => ({ revision: core().setFeaturedMedia(uuid, null) }));
  });

  // --- 核准 -----------------------------------------------------------------

  /**
   * 核准。actor 在這裡寫死 'ui'——**這條路由就是本機介面本身**。
   * MCP 走的是 CoreService，那條路徑上 actor 不是 'ui'，會被 approve() 擋下來。
   */
  app.post<{ Params: { uuid: string } }>('/api/jobs/:uuid/approve', async (request, reply): Promise<ApprovalResponse> => {
    const { uuid } = parse(UuidParams, request.params);
    const body = parse(ApproveBody, request.body);
    const approval = await guard(() => core().approve(uuid, { contentHash: body.contentHash, actor: 'ui' }));
    reply.status(201);
    return { approval };
  });

  app.delete<{ Params: { uuid: string } }>('/api/jobs/:uuid/approve', async (request): Promise<RevokedResponse> => {
    const { uuid } = parse(UuidParams, request.params);
    const body = parse(RevokeBody, request.body ?? {});
    return guard(() => {
      core().revokeApproval(uuid, body?.reason ?? '使用者撤銷核准');
      return { revoked: true };
    });
  });

  // --- 發布 -----------------------------------------------------------------

  app.post<{ Params: { uuid: string } }>('/api/jobs/:uuid/publish', async (request): Promise<PublishResponse> => {
    const { uuid } = parse(UuidParams, request.params);
    const body = parse(PublishBody, request.body);
    return guard(async () => ({
      result: await core().publish(uuid, {
        status: body.status,
        ...(body.confirm === undefined ? {} : { confirm: body.confirm }),
        actor: 'ui',
      }),
    }));
  });
}

function parseId(raw: string, what = '圖片'): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new AppError(errorCodes.VALIDATION_FAILED, `${what}編號不合法：${raw}`, 400);
  }
  return value;
}
