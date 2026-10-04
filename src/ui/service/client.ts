import type {
  ApprovalResponse,
  FactCheckListResponse,
  FactCheckRequest,
  FactCheckRunResult,
  AuthorsResponse,
  ImageAtPositionRequest,
  ImageFromSelectionRequest,
  ImageBriefResponse,
  ImageCandidateResponse,
  ImageGenerationStatus,
  JobResponse,
  ListJobsResponse,
  MediaResponse,
  MediaUploadRequest,
  PublishResponse,
  PublishTargetSummary,
  RevisionResponse,
  RevisionsResponse,
  SetDefaultAuthorRequest,
  SetupAgentsResponse,
  SetupConnectionResult,
  SetupDestinationsResponse,
  SetupSaveResponse,
  SetupStatus,
  SlugSuggestionRequest,
  SlugSuggestionResponse,
  TermsResponse,
  UpdateImageBriefRequest,
  UpdateImageBriefResponse,
  UseCandidateRequest,
} from '../../contract/api.js';
import type {
  AddMediaInput,
  AgentReviewInput,
  AgentRunResult,
  Comparison,
  CreateJobInput,
  CreateRevisionInput,
  JobDetail,
  JobState,
  PublishInput,
  PublisherApi,
  RenderOutcome,
  ReviewResolveResult,
  Term,
} from './types.js';
import { fixtureApi } from './fixtures.js';

/**
 * 所有 HTTP 呼叫的唯一出口。
 *
 * 兩件事只在這裡做：
 * 1. 把後端的 `{ error: { code, message, details?, requestId } }` 轉成 ApiError，
 *    畫面才有辦法說「發生什麼事」而不是印出一串 JSON。
 * 2. 示範資料的切換。後端還沒接上時整個 UI 仍然能操作，見 fixtures.ts。
 */

export class ApiError extends Error {
  override readonly name = 'ApiError';
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: unknown,
    readonly requestId?: string,
  ) {
    super(message);
  }
}

/** 連不上後端與後端回錯是兩件事，訊息不能混在一起。 */
export class NetworkError extends Error {
  override readonly name = 'NetworkError';
  constructor(message: string) {
    super(message);
  }
}

const FIXTURE_KEY = 'publisher.fixtures';

export function isFixtureMode(): boolean {
  const flag = new URLSearchParams(window.location.search).get('fixtures');
  if (flag === '1') return true;
  if (flag === '0') return false;
  try {
    return window.localStorage.getItem(FIXTURE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setFixtureMode(on: boolean): void {
  try {
    if (on) window.localStorage.setItem(FIXTURE_KEY, '1');
    else window.localStorage.removeItem(FIXTURE_KEY);
  } catch {
    /* 無痕視窗會擋 localStorage；此時只能靠網址參數。 */
  }
}

interface ErrorPayload {
  error?: { code?: string; message?: string; details?: unknown; requestId?: string };
}

async function toApiError(response: Response): Promise<ApiError> {
  let payload: ErrorPayload | null = null;
  try {
    payload = (await response.json()) as ErrorPayload;
  } catch {
    /* 不是 JSON（例如 proxy 掛了）就只能用狀態碼。 */
  }
  const error = payload?.error;
  return new ApiError(
    error?.code ?? `HTTP_${response.status}`,
    error?.message ?? `後端回應 HTTP ${response.status}`,
    response.status,
    error?.details,
    error?.requestId,
  );
}

async function send(path: string, init?: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch (cause) {
    throw new NetworkError(
      '連不上後端。請確認 `npm run dev` 的 server 那一欄還在跑，然後重試。',
    );
  }
  if (!response.ok) throw await toApiError(response);
  return response;
}

async function getJson<T>(path: string): Promise<T> {
  const response = await send(path);
  return (await response.json()) as T;
}

async function sendJson<T>(path: string, method: string, body?: unknown): Promise<T> {
  const response = await send(path, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return (text.length === 0 ? undefined : JSON.parse(text)) as T;
}

/**
 * 圖片走 base64 JSON。
 *
 * 後端（src/server/routes/jobs.ts）刻意不裝 multipart 外掛：本機工具沒有大量
 * 上傳的場景，多一個外掛就多一套解析路徑。Fastify 的 bodyLimit 是 8 MB，
 * base64 會膨脹約 1/3，所以實際能傳約 6 MB 的圖。
 *
 * SVG 不會走到這裡：WordPress 不收 SVG，前端在 lib/svg-to-png.ts 先轉成 PNG。
 */
async function mediaBody(input: AddMediaInput): Promise<MediaUploadRequest> {
  const buffer = await input.file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  // 一次 8 KB，避免大圖把 String.fromCharCode 的參數塞爆。
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return {
    filename: input.filename,
    mimeType: input.mimeType,
    dataBase64: btoa(binary),
    ...(input.altText === undefined ? {} : { altText: input.altText }),
    ...(input.caption === undefined ? {} : { caption: input.caption }),
    ...(input.briefKey === undefined ? {} : { briefKey: input.briefKey }),
  };
}

const httpApi: PublisherApi = {
  async listJobs(filter) {
    const query =
      filter?.state && filter.state.length > 0 ? `?state=${filter.state.join(',')}` : '';
    const body = await getJson<ListJobsResponse>(`/api/jobs${query}`);
    return body.jobs;
  },

  async createJob(input: CreateJobInput) {
    const body = await sendJson<JobResponse>('/api/jobs', 'POST', input);
    return { uuid: body.job.uuid };
  },

  getJob: (uuid: string) => getJson<JobDetail>(`/api/jobs/${uuid}`),

  async cancelJob(uuid: string) {
    await sendJson<unknown>(`/api/jobs/${uuid}`, 'DELETE');
  },

  async restoreJob(uuid: string) {
    await sendJson<JobResponse>(`/api/jobs/${uuid}/restore`, 'POST');
  },

  async createRevision(uuid: string, input: CreateRevisionInput) {
    const body = await sendJson<RevisionResponse>(
      `/api/jobs/${uuid}/revisions`,
      'POST',
      input,
    );
    return body.revision;
  },

  async listRevisions(uuid: string) {
    const body = await getJson<RevisionsResponse>(`/api/jobs/${uuid}/revisions`);
    return body.revisions;
  },

  render: (uuid: string) => sendJson<RenderOutcome>(`/api/jobs/${uuid}/render`, 'POST'),

  async fetchPreview(uuid: string) {
    const response = await send(`/api/jobs/${uuid}/preview`);
    return response.text();
  },

  /**
   * 只要 header 不要 body，所以用 HEAD。
   *
   * 校樣本體是 iframe 自己去載的，瀏覽器不會把那個回應的 header 交給 JS，
   * 所以想知道「iframe 裡那一份的 hash 是多少」只能另外問一次。舊版後端沒有
   * 自動產生 HEAD 路由時退回 GET，再拿不到就回 null（無法確認）。
   */
  async fetchPreviewHash(uuid: string) {
    const path = `/api/jobs/${uuid}/preview`;
    let response: Response;
    try {
      response = await send(path, { method: 'HEAD' });
    } catch (cause) {
      if (cause instanceof ApiError && (cause.status === 404 || cause.status === 405)) {
        response = await send(path);
      } else {
        throw cause;
      }
    }
    const etag = response.headers.get('etag');
    if (etag === null) return null;
    // ETag 的格式是 "<hash>"，弱驗證還會多一個 W/ 前綴。
    const hash = etag.replace(/^W\//, '').replace(/^"/, '').replace(/"$/, '');
    return hash.length === 0 ? null : hash;
  },

  runAgent: (uuid: string, input: AgentReviewInput) =>
    sendJson<AgentRunResult>(`/api/jobs/${uuid}/agent`, 'POST', input),

  async cancelAgent(uuid: string) {
    await sendJson<unknown>(`/api/jobs/${uuid}/agent`, 'DELETE');
  },

  suggestSlugs: (uuid: string, input: SlugSuggestionRequest) =>
    sendJson<SlugSuggestionResponse>(`/api/jobs/${uuid}/slug-suggestions`, 'POST', input),

  runFactCheck: (uuid: string, input: FactCheckRequest) =>
    sendJson<FactCheckRunResult>(`/api/jobs/${uuid}/factchecks`, 'POST', input),

  listFactChecks: (uuid: string) => getJson<FactCheckListResponse>(`/api/jobs/${uuid}/factchecks`),

  async dismissFactCheck(uuid: string, findingId: number) {
    await sendJson<unknown>(`/api/jobs/${uuid}/factchecks/${findingId}`, 'DELETE');
  },

  resolveReview: (uuid: string, input: { itemIds: number[]; decision: 'apply' | 'skip' }) =>
    sendJson<ReviewResolveResult>(`/api/jobs/${uuid}/review/resolve`, 'POST', input),

  acceptWholeReview: (uuid: string, proposalId: number) =>
    sendJson<ReviewResolveResult>(`/api/jobs/${uuid}/review/accept-all`, 'POST', { proposalId }),

  async discardReview(uuid: string, reason: string, proposalId: number) {
    await sendJson<unknown>(`/api/jobs/${uuid}/review`, 'DELETE', { reason, proposalId });
  },

  fetchComparison: (uuid: string, against?: 'proposal' | 'previous') =>
    getJson<Comparison>(`/api/jobs/${uuid}/compare${against === undefined ? '' : `?against=${against}`}`),

  async dismissImageBrief(uuid: string, briefId: number) {
    await sendJson<unknown>(`/api/jobs/${uuid}/briefs/${briefId}`, 'DELETE');
  },

  updateImageBrief: (uuid: string, briefId: number, input: UpdateImageBriefRequest) =>
    sendJson<UpdateImageBriefResponse>(`/api/jobs/${uuid}/briefs/${briefId}`, 'PATCH', input),

  getImageGenerationStatus: () => getJson<ImageGenerationStatus>('/api/image-generation'),

  async generateBriefImage(uuid: string, briefId: number) {
    const body = await sendJson<ImageCandidateResponse>(`/api/jobs/${uuid}/briefs/${briefId}/generate`, 'POST');
    return body.candidate;
  },

  async requestImageAtPosition(uuid: string, input: ImageAtPositionRequest) {
    const body = await sendJson<ImageBriefResponse>(`/api/jobs/${uuid}/briefs`, 'POST', input);
    return body.brief;
  },

  async requestImageFromSelection(uuid: string, input: ImageFromSelectionRequest) {
    const body = await sendJson<ImageBriefResponse>(`/api/jobs/${uuid}/briefs`, 'POST', input);
    return body.brief;
  },

  async useImageCandidate(uuid: string, candidateId: number, altText?: string) {
    const request: UseCandidateRequest | undefined = altText === undefined ? undefined : { altText };
    const body = await sendJson<MediaResponse>(`/api/jobs/${uuid}/candidates/${candidateId}/use`, 'POST', request);
    return { media: body.media, autoFeature: body.autoFeature ?? null, autoPlace: body.autoPlace ?? null };
  },

  async addMedia(uuid: string, input: AddMediaInput) {
    const body = await sendJson<MediaResponse>(
      `/api/jobs/${uuid}/media`,
      'POST',
      await mediaBody(input),
    );
    return { media: body.media, autoFeature: body.autoFeature ?? null, autoPlace: body.autoPlace ?? null };
  },

  async replaceMedia(uuid: string, assetId: number, input: AddMediaInput) {
    const body = await sendJson<MediaResponse>(
      `/api/jobs/${uuid}/media/${assetId}`,
      'PUT',
      await mediaBody(input),
    );
    return body.media;
  },

  async removeMedia(uuid: string, assetId: number) {
    await sendJson<unknown>(`/api/jobs/${uuid}/media/${assetId}`, 'DELETE');
  },

  async placeMedia(uuid: string, assetId: number, afterBlockIndex: number) {
    await sendJson<unknown>(`/api/jobs/${uuid}/media/${assetId}/place`, 'POST', {
      afterBlockIndex,
    });
  },

  // 設定精選圖片與取消精選走的是兩條路徑：取消要送 null，綁在某張圖底下的
  // 路徑表達不了「沒有精選圖片」，所以後端另外開了 DELETE /featured。
  async setFeaturedMedia(uuid: string, assetId: number | null) {
    if (assetId === null) {
      await sendJson<unknown>(`/api/jobs/${uuid}/featured`, 'DELETE');
      return;
    }
    await sendJson<unknown>(`/api/jobs/${uuid}/media/${assetId}/featured`, 'POST');
  },

  async approve(uuid: string, contentHash: string) {
    const body = await sendJson<ApprovalResponse>(`/api/jobs/${uuid}/approve`, 'POST', {
      contentHash,
    });
    return body.approval;
  },

  async revokeApproval(uuid: string, reason: string) {
    await sendJson<unknown>(`/api/jobs/${uuid}/approve`, 'DELETE', { reason });
  },

  async publish(uuid: string, input: PublishInput) {
    const body = await sendJson<PublishResponse>(
      `/api/jobs/${uuid}/publish`,
      'POST',
      input,
    );
    return body.result;
  },

  async listTerms(taxonomy: string) {
    const body = await getJson<TermsResponse>(
      `/api/wordpress/terms?taxonomy=${encodeURIComponent(taxonomy)}`,
    );
    return body.terms;
  },

  createTerm: (taxonomy: string, name: string) =>
    sendJson<Term>('/api/wordpress/terms', 'POST', { taxonomy, name }),

  listAuthors: () => getJson<AuthorsResponse>('/api/wordpress/authors'),

  setDefaultAuthor: (authorId) =>
    sendJson<AuthorsResponse>('/api/setup/default-author', 'POST', { authorId } satisfies SetDefaultAuthorRequest),

  async listTargets() {
    const body = await getJson<{ publishTargets?: PublishTargetSummary[] }>('/api/wordpress');
    return body.publishTargets ?? [];
  },

  getSetupStatus: () => getJson<SetupStatus>('/api/setup'),

  testWordPressConnection: (input) =>
    sendJson<SetupConnectionResult>('/api/setup/wordpress/test', 'POST', input),

  saveWordPressConnection: (testId, confirmSiteChange) =>
    sendJson<SetupSaveResponse>('/api/setup/wordpress', 'POST', {
      testId,
      ...(confirmSiteChange === undefined ? {} : { confirmSiteChange }),
    }),

  // 下面兩個是「讀取」，但會打真的站、會跑 CLI：走 POST＋JSON，吃跟寫入一樣的同源守門。
  async getSetupAgents() {
    const body = await sendJson<SetupAgentsResponse>('/api/setup/agents', 'POST', {});
    return body.agents;
  },

  getSetupDestinations: () => sendJson<SetupDestinationsResponse>('/api/setup/destinations/check', 'POST', {}),

  saveSetupDestinations: (input) => sendJson<SetupSaveResponse>('/api/setup/destinations', 'POST', input),
};

/** 畫面只認這個。示範資料模式在這裡分流，元件完全不用知道。 */
export const api: PublisherApi = new Proxy({} as PublisherApi, {
  get(_target, prop: string) {
    const source = isFixtureMode() ? fixtureApi : httpApi;
    return source[prop as keyof PublisherApi];
  },
});

export function describeError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof NetworkError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}

export type { JobState };
