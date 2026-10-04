/**
 * CoreService 各領域共用的狀態與內部小工具（P5-T004 從 service.ts 拆出）。
 *
 * 整個行程只有一個 CoreContext：門面（`../service.ts`）建構時建一個，把各領域模組掛上來
 * （`ctx.content`、`ctx.media`…），模組之間透過它互相呼叫。這裡的欄位就是以前 CoreService 的私有欄位。
 */

import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { AgentRunTask, Job, MediaAsset, Revision } from '../../contract/api.js';
import { computeRevisionHash } from '../content-hash.js';
import {
  AgentError,
  ContentInvalidError,
  InvalidInputError,
  JobNotFoundError,
  MediaError,
  WordPressUnavailableError,
} from '../errors.js';
import { findImageBlockIndex } from '../html-blocks.js';
import {
  Repository,
  type JobRow,
  type MediaAssetRow,
  type RevisionRow,
  type ImageBriefRow,
  type ImageCandidateRow,
} from '../repository.js';
import { isContentMutable } from '../state-machine.js';
import { containsSecret, createSecretScrubber, type Scrubber } from '../../config/secrets.js';
import { fromStoredMediaPath, fromStoredPath, isInsideDir, resolveDataDir, toStoredPath } from '../../config/paths.js';
import { createJobWorkspace, resolveInsideWorkspace, WorkspaceError } from '../../agents/workspace.js';
import { AgentRegistry } from '../../agents/registry.js';
import type { AgentId } from '../../agents/types.js';
import { renderRevision, RenderError, type RenderResult } from '../../templates/render.js';
import type { TemplateRegistry } from '../../templates/registry.js';
import type { LoadedTemplate } from '../../templates/types.js';
import type { WordPressClient } from '../../wordpress/client.js';
import type { PublishTarget, PublishTargetRegistry } from '../../wordpress/targets.js';
import type { RevisionPayload, CoreServiceOptions, FactCheckFetcherFactory } from './types.js';
import type { SetupModule } from './setup.js';
import type { JobsModule } from './jobs.js';
import type { ContentModule } from './content.js';
import type { AgentModule } from './agent.js';
import type { ReviewModule } from './review.js';
import type { BriefsModule } from './briefs.js';
import type { ImagesModule } from './images.js';
import type { MediaModule } from './media.js';
import type { ApprovalModule } from './approval.js';
import type { PublishModule } from './publish.js';
import type { AuthorsModule } from './authors.js';
import type { FactCheckModule } from './factcheck.js';

const MIME_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

export const MAX_AGENT_OUTPUT_BYTES = 4 * 1024 * 1024;

/** `agent_runs.purpose` 記的生圖那一趟。 */
export const GENERATE_IMAGE_PURPOSE: AgentRunTask = 'generate-image';

/** `agent_runs.purpose` 記的「建議英文網址」那一趟（D-026）。 */
export const SUGGEST_SLUG_PURPOSE: AgentRunTask = 'suggest-slug';

/** `agent_runs.purpose` 記的 AI 查證兩趟（D-034）；整次的進度在 `factcheck_runs`。 */
export const FACTCHECK_PURPOSE: AgentRunTask = 'factcheck';

/**
 * 進行中的 Agent 動作（`CoreContext.activeRuns` 的值）。`rowId` 是目前（或最近一趟）的 `agent_runs`。
 * 查證（P6-T004）多帶 `factCheck`：抓網頁、核對兩段沒有 CLI 在跑，取消要中止抓取、結掉查證紀錄。
 */
export interface ActiveRun {
  runId: string;
  provider: AgentId;
  rowId: number;
  factCheck?: {
    readonly runRowId: number;
    readonly abort: AbortController;
    /** 這一刻有沒有 CLI 在跑（第一趟、第二趟）；抓網頁與核對時是 false。 */
    cliRunning: boolean;
  };
}

/** 後端重啟時還沒跑完的 Agent 執行，結掉時寫的原因。 */
const AGENT_INTERRUPTED_MESSAGE = '後端重啟，這次沒有完成';

/** 圖是傳到別的站的（設定精靈換過站，P8-T002）。 */
export const OTHER_SITE_MEDIA_MESSAGE =
  '這張圖是傳到另一個站的媒體庫，現在發布台連的是別的站，不能用在這裡。請在現在這個站重新上傳這張圖。';

/**
 * 使用者輸入含目前設定的 WordPress 應用程式密碼時的訊息（D-023，P5-T023，審查 #5）。
 * **訊息本身不含密碼**，連遮蔽過的樣子、位置、長度都不給。
 */
export const APP_PASSWORD_IN_CONTENT_MESSAGE = '內容裡有你的 WordPress 應用程式密碼，請刪掉再存';

/** `isFeaturedBrief` 要的欄位：使用者在文章上請 AI 配的那條永遠不是封面（P5-T018）。 */
export function featuredInput(row: ImageBriefRow): { key: string; placement: string | null; origin: 'agent' | 'user' } {
  return { key: row.brief_key, placement: row.placement, origin: row.origin };
}

/**
 * 候選圖是不是照這條需求**目前的**描述生的。同一個 key 重新提過（upsert 保留 id、
 * 換掉 agent_run_id）之後，更早生的圖就不算數——描述、比例可能都變了。
 */
export function isCandidateCurrent(candidate: ImageCandidateRow, brief: ImageBriefRow): boolean {
  if (brief.agent_run_id === null) return true;
  return candidate.agent_run_id !== null && candidate.agent_run_id > brief.agent_run_id;
}

export class CoreContext {
  // 各領域模組：門面建構時掛上來，模組之間透過這裡互相呼叫。
  setup!: SetupModule;
  jobs!: JobsModule;
  content!: ContentModule;
  agent!: AgentModule;
  review!: ReviewModule;
  briefs!: BriefsModule;
  images!: ImagesModule;
  media!: MediaModule;
  approval!: ApprovalModule;
  publish!: PublishModule;
  authors!: AuthorsModule;
  factcheck!: FactCheckModule;

  readonly repo: Repository;
  readonly templates: TemplateRegistry;
  // 下面四個不是 readonly：設定精靈（P8-T002）不重新啟動就換連線與發布目標，見 reconfigure()。
  targets: PublishTargetRegistry;
  readonly agents: AgentRegistry;
  wordpress: WordPressClient | null;
  readonly scrub: Scrubber;
  /** 資料目錄：DB 裡的相對路徑以這裡解析（P8-T003）。 */
  readonly dataDir: string;
  readonly draftsDir: string;
  readonly mediaDir: string;
  siteId: number | null;
  targetIds: Map<string, number>;
  readonly templateRowIds: Map<string, number>;
  /** 進行中的 Agent 執行；程式重啟就沒了，反正子行程也一起沒了。 */
  readonly activeRuns = new Map<string, ActiveRun>();
  /** AI 查證的取回器（P6-T004）；沒給就不能查證。 */
  readonly factCheckFetcher: FactCheckFetcherFactory | null;
  /**
   * 正在發布中的 job。狀態機本身擋得住大部分的重複發布（第二次會看到 PUBLISHING），
   * 但「讀遠端」那一段 await 發生在轉成 PUBLISHING **之前**，兩個請求可以同時通過
   * 前置檢查。這個集合把那個空窗關掉，而且能給出比「狀態不對」更清楚的訊息。
   *
   * 只在同一個行程內有效——本機單使用者工具只有一個行程，跨行程的鎖留給真的有
   * 第二個寫入者的時候再說。
   */
  readonly publishing = new Set<string>();
  /**
   * 設定精靈正在換連線或發布目標（P8-T002）。這段期間任何會碰 WordPress 或依賴「目前是哪個站」的動作
   * 一律拒絕，免得半途換站、把東西記到錯的站上。
   */
  reconfiguring = false;
  /** 正在跟 WordPress 講話的動作（上傳、換圖、發布）。不是 0 就不准換設定。 */
  wordpressOps = 0;
  /**
   * 每個 job 正在進行的上傳／換圖有幾個（P5-T022，審查 #3）。不是 0 就不准發布：
   * 換圖一開始就撤銷核准、然後等上傳，等待期間重新核准再發布的話，發出去的是舊圖，
   * 回來的上傳卻要改本機紀錄——本機與線上從此對不上，媒體庫還多一張孤兒圖。
   */
  readonly mediaUploads = new Map<string, number>();

  constructor(options: CoreServiceOptions) {
    this.repo = new Repository(options.db);
    this.templates = options.templates;
    this.targets = options.targets;
    this.agents = options.agents;
    this.wordpress = options.wordpress;
    this.scrub = options.scrub ?? createSecretScrubber([]);
    this.dataDir = options.dataDir ?? resolveDataDir();
    this.draftsDir = options.draftsDir ?? join(this.dataDir, 'drafts');
    this.mediaDir = options.mediaDir ?? join(this.dataDir, 'generated-images');
    this.factCheckFetcher = options.factCheckFetcher ?? null;

    this.siteId = this.repo.syncSite(options.site ?? null);
    this.targetIds = this.repo.syncTargets(this.targets.list(), this.siteId);
    this.templateRowIds = this.repo.syncTemplates(this.templates.list());
    this.failInterruptedAgentRuns();
  }

  /**
   * 啟動清理（P5-T020）：上一個行程留下、DB 還是 running 的 Agent 執行，一律結成失敗。
   *
   * `activeRuns` 只在記憶體，子行程也跟著舊行程一起沒了，所以這些執行不可能再完成；不結掉的話
   * 畫面會一直卡在「看稿中」、校稿按鈕停用、取消也找不到它。所有種類（校稿、配圖、生圖、查證）都清。
   * **只改 agent_runs 與 factcheck_runs（P6-T004）的 running 紀錄**、每筆記一條事件，不刪資料、不動其他表。
   *
   * 前提：一個 DB 只有一個 CoreService 行程在用（本機單使用者工具，見 core-service.md）。
   */
  private failInterruptedAgentRuns(): void {
    for (const row of this.repo.allRunningAgentRuns()) {
      this.repo.finishAgentRun(row.id, { status: 'failed', outputHash: null, errorMessage: AGENT_INTERRUPTED_MESSAGE });
      if (row.job_id === null) continue;
      this.repo.insertEvent({
        jobId: row.job_id,
        revisionId: null,
        approvalId: null,
        actor: 'system',
        eventType: 'agent_interrupted',
        status: 'failed',
        detail: { agentRunId: row.id, purpose: row.purpose, provider: row.provider, startedAt: row.started_at },
      });
    }
    // AI 查證（P6-T004）：抓網頁、核對兩段沒有 agent_runs 在跑，整次的紀錄另外結。
    for (const row of this.repo.allRunningFactCheckRuns()) {
      this.repo.finishFactCheckRun(row.id, { status: 'failed', errorMessage: AGENT_INTERRUPTED_MESSAGE });
      this.repo.insertEvent({
        jobId: row.job_id,
        revisionId: null,
        approvalId: null,
        actor: 'system',
        eventType: 'factcheck_interrupted',
        status: 'failed',
        detail: { factCheckRunId: row.id, stage: row.stage, provider: row.provider, startedAt: row.started_at },
      });
    }
  }

  /** 會碰 WordPress 的動作都包在這裡：設定精靈換設定時擋掉；跑的期間設定精靈也不能換。 */
  async trackWordPress<T>(fn: () => Promise<T>): Promise<T> {
    this.assertNotReconfiguring();
    this.wordpressOps += 1;
    try {
      return await fn();
    } finally {
      this.wordpressOps -= 1;
    }
  }

  assertNotReconfiguring(): void {
    if (this.reconfiguring) {
      throw new WordPressUnavailableError('設定精靈正在儲存新的 WordPress 設定，等幾秒再試一次');
    }
  }

  /**
   * 這張圖是不是傳到**別的站**的媒體庫（設定精靈換過站）。沒有站台紀錄的舊資料當成目前這個站，
   * 不因為缺紀錄就擋住原本能用的東西。
   */
  mediaOnOtherSite(asset: MediaAssetRow): boolean {
    if (asset.wordpress_media_id === null) return false;
    const sites = this.repo.mediaSiteIds(asset.job_id, asset.wordpress_media_id);
    return sites.length > 0 && !sites.includes(this.siteId ?? -1);
  }

  /**
   * 使用者給的東西裡有 WordPress 應用程式密碼就整個拒絕（D-023，P5-T023，審查 #5）。
   *
   * **所有使用者文字進系統、以及任何要送給 Agent 的東西，都在這一個方法檢查**：建立 job、建新版本
   * （createRevision——放圖、設封面、套用校稿全部經過它）、上傳圖片的替代文字與說明、派校稿（指示＋實際送出的
   * prompt）、請 AI 配一張（那句話＋實際送出的 prompt）、在卡片上改配圖描述（P5-T025）、生圖（實際送出的 prompt）。派工時檢查的是**組好的
   * prompt**，所以密碼設定之前就存進去的舊內容也擋得住。
   *
   * 「認得哪些樣子」跟遮蔽器完全一樣（containsSecret 用的就是同一個遮蔽器，含有無空白兩種寫法），
   * 設定精靈當場換的新密碼也立刻算數。在任何寫入之前呼叫，拒絕時什麼都不留。
   */
  assertNoAppPassword(...values: unknown[]): void {
    if (this.hasAppPassword(...values)) throw new InvalidInputError(APP_PASSWORD_IN_CONTENT_MESSAGE);
  }

  hasAppPassword(...values: unknown[]): boolean {
    return values.some((value) => containsSecret(this.scrub, value));
  }

  /**
   * 目前這一版的內容（templateData＋渲染結果）。核准、發布、上傳／換圖前檢查用：密碼設定之前就存進去的舊內容
   * 不能被核准、發出去，也不要等圖傳到 WordPress 之後才在建版本時被擋（審查補充）。
   */
  currentContentOf(job: JobRow): unknown[] {
    const row = this.repo.latestRevision(job.id);
    return row ? [this.payloadOf(row).templateData, row.rendered_html] : [];
  }

  renderPayload(
    template: LoadedTemplate,
    payload: RevisionPayload,
    displayDate?: string,
  ): { result: RenderResult; contentHash: string } {
    const featured =
      payload.featuredMediaAssetId === null ? null : this.repo.mediaById(payload.featuredMediaAssetId);
    const featuredUrl = featured ? this.mediaUrl(featured) : null;

    let result: RenderResult;
    try {
      result = renderRevision(template, payload.templateData, {
        ...(displayDate === undefined ? {} : { displayDate }),
        ...(featured && featuredUrl
          ? {
              featuredImage: {
                src: featuredUrl,
                alt: featured.alt_text ?? '',
                ...(featured.caption === null ? {} : { caption: featured.caption }),
              },
            }
          : {}),
      });
    } catch (error) {
      if (error instanceof RenderError) throw new ContentInvalidError(error.message, error.issues);
      throw error;
    }

    // 精選圖片會被發布出去，所以必須進 hash——換封面要讓核准失效。
    // renderRevision 自己算的 hash 不含它（那個 hash 給模板預覽 API 用）。
    const contentHash = computeRevisionHash({
      templateId: template.manifest.id,
      templateHash: template.hash,
      publishHtml: result.publishHtml,
      fields: {
        ...Object.fromEntries(
          Object.entries(payload.templateData).filter(([key]) => key !== template.manifest.publishSlot),
        ),
        featuredMedia: featured?.wordpress_media_id ?? null,
      },
    });

    return { result, contentHash };
  }

  /** 存一份上傳過的圖到本機。回傳要寫進 DB 的路徑（相對資料目錄，見 `storedPath`）。 */
  writeLocalCopy(jobUuid: string, sha256: string, mimeType: string, bytes: Uint8Array): string {
    const extension = MIME_EXTENSIONS[mimeType] ?? 'bin';
    const dir = join(this.mediaDir, jobUuid);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${sha256}.${extension}`);
    writeFileSync(file, bytes);
    return this.storedPath(file);
  }

  /** 要寫進 DB 的路徑：在資料目錄裡就存相對路徑（P8-T003），以後資料目錄再搬也不會壞。 */
  storedPath(absolute: string): string {
    return toStoredPath(this.dataDir, absolute);
  }

  /** DB 讀出的工作目錄路徑 → 實際位置。相對的以資料目錄解析；舊資料的絕對路徑照舊用。媒體檔用 `mediaFile`。 */
  localFile(stored: string): string {
    return fromStoredPath(this.dataDir, stored);
  }

  /**
   * DB 讀出的媒體路徑（上傳過的圖、候選圖）→ 實際檔案位置；**一定在 `mediaDir` 裡**，不在就是 null（P8-T004）。
   * 讀檔、刪檔都只能用這裡回傳的路徑，規則見 `fromStoredMediaPath`。
   */
  mediaFile(stored: string): string | null {
    return fromStoredMediaPath(this.dataDir, this.mediaDir, stored);
  }

  /** 同 `mediaFile`，但路徑不在媒體資料夾裡就丟「檔案不見了」（不洩漏 DB 裡記的是哪裡）。 */
  requireMediaFile(stored: string, what: string): string {
    const file = this.mediaFile(stored);
    if (file === null) {
      throw new MediaError(`${what}的檔案不見了（generated-images/ 被清過？），請再生一張或重新上傳`);
    }
    return file;
  }

  /**
   * 這個 job 的 Agent 工作目錄。**一定在 `draftsDir` 裡，字面路徑與實體路徑都是**：DB 記的路徑解析後在 drafts/ 裡就用它
   * （資料夾不見了補建）；逃出去（被改過、舊資料指到別處、或路徑上有符號連結指到外面）就改用 `drafts/<uuid>`；
   * 連 `drafts/<uuid>` 的實體路徑都不在 drafts/ 裡，就不跑 Agent（P8-T004）。
   */
  jobWorkspace(job: JobRow): string {
    if (job.workspace_path !== null) {
      try {
        const dir = resolveInsideWorkspace(this.draftsDir, this.localFile(job.workspace_path));
        if (this.ensureRealDraftDir(dir)) return dir;
      } catch (error) {
        if (!(error instanceof WorkspaceError)) throw error;
      }
    }
    const fallback = join(this.draftsDir, job.uuid);
    if (!this.ensureRealDraftDir(fallback)) {
      throw new AgentError('這篇稿件的 AI 工作目錄不在發布台的 drafts/ 資料夾裡（可能被換成了符號連結），為了安全不在那裡跑 AI');
    }
    return createJobWorkspace(this.draftsDir, job.uuid);
  }

  /**
   * 建好 `dir`（drafts/ 底下、字面上已檢查過）並確認實體路徑也在 drafts/ 的實體路徑底下。
   * 建之前先確認已經存在的那一段祖先在 drafts/ 裡，免得透過符號連結在外面建出資料夾。
   */
  private ensureRealDraftDir(dir: string): boolean {
    try {
      mkdirSync(this.draftsDir, { recursive: true });
      const root = realpathSync(this.draftsDir);
      const inside = (path: string, allowRoot: boolean): boolean => {
        const real = realpathSync(path);
        return (allowRoot && real === root) || isInsideDir(root, real);
      };
      let existing = dir;
      while (!existsSync(existing)) existing = dirname(existing);
      if (!inside(existing, true)) return false;
      mkdirSync(dir, { recursive: true });
      return inside(dir, false);
    } catch {
      return false;
    }
  }

  mediaUrl(asset: MediaAssetRow): string | null {
    if (asset.wordpress_media_id === null) return null;
    return this.repo.mediaObject(asset.wordpress_media_id, this.siteId)?.link ?? null;
  }

  mediaViews(job: JobRow, revision: Revision | null): MediaAsset[] {
    return this.repo.listMedia(job.id).map((row) => this.toMedia(row, revision));
  }

  toMedia(row: MediaAssetRow, revision: Revision | null): MediaAsset {
    const wpId = row.wordpress_media_id;
    const placedAt =
      wpId === null || revision === null
        ? -1
        : findImageBlockIndex(revision.publishHtml, wpId);

    return {
      id: row.id,
      jobId: row.job_id,
      mimeType: row.mime_type,
      byteSize: row.byte_size,
      sha256: row.sha256,
      width: row.width,
      height: row.height,
      altText: row.alt_text,
      caption: row.caption,
      briefKey: row.brief_key,
      wordpressMediaId: row.wordpress_media_id,
      url: this.mediaUrl(row),
      placed: placedAt >= 0,
      // placeMedia 收的是「插在第幾塊後面」，所以回報時也用同一套：圖片自己的
      // 索引減一。放在最前面就是 -1。
      placedAfterBlockIndex: placedAt >= 0 ? placedAt - 1 : null,
      featured: revision?.featuredMediaId === row.id,
      createdAt: row.created_at,
    };
  }

  toJob(row: JobRow): Job {
    const target = this.targetOf(row);
    return {
      uuid: row.uuid,
      state: row.state,
      title: row.title,
      targetKey: target?.key ?? null,
      templateId: target?.templateId ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  toRevision(row: RevisionRow): Revision {
    const payload = this.payloadOf(row);
    return {
      id: row.id,
      number: row.revision_number,
      origin: row.origin,
      contentHash: row.content_hash,
      templateData: payload.templateData,
      featuredMediaId: payload.featuredMediaAssetId,
      publishHtml: row.rendered_html ?? '',
      createdAt: row.created_at,
    };
  }

  payloadOf(row: RevisionRow): RevisionPayload {
    if (row.template_data_json === null) return { templateData: {}, featuredMediaAssetId: null };
    const parsed = JSON.parse(row.template_data_json) as Partial<RevisionPayload> & Record<string, unknown>;
    if (parsed && typeof parsed === 'object' && 'templateData' in parsed) {
      return {
        templateData: (parsed.templateData ?? {}) as Record<string, unknown>,
        featuredMediaAssetId: parsed.featuredMediaAssetId ?? null,
      };
    }
    // 舊格式（沒有信封）也讀得回來。
    return { templateData: parsed as Record<string, unknown>, featuredMediaAssetId: null };
  }

  titleOf(templateData: Record<string, unknown>): string | null {
    const title = templateData['title'];
    return typeof title === 'string' && title.length > 0 ? title : null;
  }

  /**
   * 這個 job 現在還能不能改內容。
   *
   * 判斷交給 `isContentMutable()`（state-machine.ts），因為那是從轉移表推出來的，
   * 不是散在這裡的另一套規則。`PUBLISHED` 也在不可改之列——它只能轉到 `SUPERSEDED`，
   * 沒有回到 `RENDERED` 的路，改了內容核准就退不回去了。
   */
  assertMutable(job: JobRow): void {
    if (!isContentMutable(job.state)) {
      throw new InvalidInputError(`工作項目目前是 ${job.state}，不能再改內容`);
    }
  }

  requireJob(uuid: string): JobRow {
    const job = this.repo.jobByUuid(uuid);
    if (!job) throw new JobNotFoundError(uuid);
    return job;
  }

  requireRevision(job: JobRow): RevisionRow {
    const revision = this.repo.latestRevision(job.id);
    if (!revision) throw new InvalidInputError('這個工作項目還沒有任何版本');
    return revision;
  }

  requireMedia(job: JobRow, assetId: number): MediaAssetRow {
    const asset = this.repo.mediaById(assetId);
    if (!asset || asset.job_id !== job.id) throw new MediaError(`找不到這個工作項目的圖片 ${assetId}`);
    return asset;
  }

  /** 建新稿用：停用的類型（D-032）在這裡擋。舊稿件走 targetOf，不受停用影響。 */
  requireTarget(key: string): PublishTarget {
    // 根本還沒設定站台（本機設定檔不存在）：講下一步，不要列一串空的「可用的是」。
    if (this.targets.setupRequired !== undefined) throw new InvalidInputError(this.targets.setupRequired);
    const usable = this.targets.list().filter((t) => !t.disabled);
    if (!this.targets.has(key)) {
      throw new InvalidInputError(`找不到發布目標 ${key}；可用的是 ${usable.map((t) => t.key).join('、')}`);
    }
    const target = this.targets.get(key);
    // 不信任前端：畫面上已經不給選，MCP 或舊分頁送來的一樣擋。
    if (target.disabled) {
      throw new InvalidInputError(
        `「${target.displayName}」已經停用，不能建新稿。要用的話到設定精靈「發到哪裡」把它打開；已經有的稿件不受影響。`,
      );
    }
    return target;
  }

  targetOf(job: JobRow): PublishTarget | null {
    const key = this.repo.targetKeyOf(job.target_id);
    return key !== null && this.targets.has(key) ? this.targets.get(key) : null;
  }

  requireTemplate(job: JobRow): LoadedTemplate {
    const target = this.targetOf(job);
    if (!target) throw new InvalidInputError('這個工作項目沒有綁定發布目標，找不到模板');
    return this.templates.get(target.templateId);
  }

  requireWordPress(): WordPressClient {
    if (!this.wordpress) throw new WordPressUnavailableError();
    return this.wordpress;
  }
}
