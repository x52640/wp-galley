import type {
  AgentRunResult,
  Approval as ApprovalView,
  AuthorsResponse,
  Comparison as ComparisonView,
  ImageBrief as ImageBriefView,
  ImageCandidate,
  ImageGenerationStatus,
  Job,
  JobDetail,
  JobSummary,
  MediaAsset,
  PublishResult,
  RenderOutcome,
  Revision,
  ReviewProposal as ReviewProposalView,
  ReviewResolveResult,
  SelectionSpotsResponse,
  SlugSuggestionResponse,
  FactCheckListResponse,
  FactCheckRunResult,
} from '../contract/api.js';
import type { ProofMark } from './diff.js';
import type { JobState } from './state-machine.js';
import type { WordPressClient } from '../wordpress/client.js';
import type { PublishTargetRegistry } from '../wordpress/targets.js';
import { CoreContext } from './service/context.js';
import { SetupModule } from './service/setup.js';
import { JobsModule } from './service/jobs.js';
import { ContentModule } from './service/content.js';
import { AgentModule } from './service/agent.js';
import { ReviewModule } from './service/review.js';
import { BriefsModule } from './service/briefs.js';
import { ImagesModule } from './service/images.js';
import { MediaModule } from './service/media.js';
import { ApprovalModule } from './service/approval.js';
import { PublishModule } from './service/publish.js';
import { AuthorsModule } from './service/authors.js';
import { FactCheckModule } from './service/factcheck.js';
import type {
  AddMediaInput,
  AgentReviewInput,
  CoreServiceOptions,
  CreateJobInput,
  CreateRevisionInput,
  MediaUploadOutcome,
  ProposalRef,
  PublishInput,
  ResolveReviewInput,
  SlugSuggestionInput,
  FactCheckInput,
  FactCheckFetcherFactory,
} from './service/types.js';

/**
 * CoreService：發布台的安全核心。
 *
 * **本機 UI 與階段 6 的 MCP Server 共用同一個實例**。所有核准、驗證與稽核只在
 * 這裡實作一次——這是整個安全模型的地基。任何「先檢查再呼叫」的規則放到呼叫端，
 * 就等於多了一條可以繞過的路。
 *
 * 三條不可妥協的規則的落點（P5-T004 起實作分在 `service/` 各檔，這個檔只是門面）：
 *
 * 1. Agent 只產生結構化資料 → `runAgentReview` 拿到的 templateData 一律走
 *    `createRevision`（`service/content.ts`），由 `renderRevision` 用模板的 schema.json **再驗一次**
 *    才會落地；Agent 永遠碰不到 HTML 外框。
 * 2. 核准綁定 content_hash → `invalidateApproval()`（`service/approval.ts`，唯一入口）在每一個會改動內容的方法
 *    **寫入之前**執行。呼叫端不需要記得，也不准自己做。
 * 3. 只有本機 UI 能核准 → `approve()`（`service/approval.ts`）擋掉 actor !== 'ui'，DB 的 CHECK 再擋一次。
 */

/**
 * 門面的結構（P5-T004）：
 *
 * - 共用狀態（repo、目前的站、進行中的 Agent／發布／上傳）與內部小工具在 `service/context.ts` 的 CoreContext，
 *   整個行程一份。
 * - 各領域一個模組（`service/<領域>.ts`），建構時拿到同一個 context，彼此透過 `ctx.<領域>` 呼叫。
 * - 這裡每個公開方法只轉給對應的模組；規則與說明寫在模組的方法上。
 */

// --- 對外型別 ---------------------------------------------------------------
//
// 會過網路的形狀定義在 src/contract/api.ts（前端 import 同一份）。後端才需要的輸入型別在
// service/types.ts。這裡沿用既有的名字轉出去，讓呼叫端不用改。

export type {
  AgentTask,
  AgentRunResult,
  Comparison as ComparisonView,
  ImageBrief as ImageBriefView,
  Job,
  JobDetail,
  JobSummary,
  MediaAsset,
  PublishResult,
  RenderOutcome,
  Revision,
  ReviewItem as ReviewItemView,
  ReviewProposal as ReviewProposalView,
  ReviewResolveResult,
  Approval as ApprovalView,
  AgentRun as AgentRunView,
} from '../contract/api.js';
export type {
  AddMediaInput,
  AgentReviewInput,
  CoreServiceOptions,
  CreateJobInput,
  CreateRevisionInput,
  MediaUploadOutcome,
  ProposalRef,
  PublishInput,
  ResolveReviewInput,
  SlugSuggestionInput,
  FactCheckInput,
  FactCheckFetcherFactory,
};
export { APP_PASSWORD_IN_CONTENT_MESSAGE } from './service/context.js';
export { buildFigureHtml } from './service/media.js';

export class CoreService {
  private readonly ctx: CoreContext;

  constructor(options: CoreServiceOptions) {
    const ctx = new CoreContext(options);
    ctx.setup = new SetupModule(ctx);
    ctx.jobs = new JobsModule(ctx);
    ctx.content = new ContentModule(ctx);
    ctx.agent = new AgentModule(ctx);
    ctx.review = new ReviewModule(ctx);
    ctx.briefs = new BriefsModule(ctx);
    ctx.images = new ImagesModule(ctx);
    ctx.media = new MediaModule(ctx);
    ctx.approval = new ApprovalModule(ctx);
    ctx.publish = new PublishModule(ctx);
    ctx.authors = new AuthorsModule(ctx);
    ctx.factcheck = new FactCheckModule(ctx);
    this.ctx = ctx;
  }

  // --- setup.ts ---

  isPublishing(): boolean {
    return this.ctx.setup.isPublishing();
  }

  tryBeginReconfigure(): string | null {
    return this.ctx.setup.tryBeginReconfigure();
  }

  endReconfigure(): void {
    return this.ctx.setup.endReconfigure();
  }

  currentSiteUsage(): { publishedJobs: number; uploadedMedia: number } | null {
    return this.ctx.setup.currentSiteUsage();
  }

  openJobCountsByTarget(): Record<string, number> {
    return this.ctx.setup.openJobCountsByTarget();
  }

  reconfigure(options: {
    readonly wordpress?: WordPressClient | null;
    readonly site?: { key: string; displayName: string; baseUrl: string; username: string } | null;
    readonly targets?: PublishTargetRegistry;
  }): void {
    return this.ctx.setup.reconfigure(options);
  }

  // --- jobs.ts ---

  createJob(input: CreateJobInput): Job {
    return this.ctx.jobs.createJob(input);
  }

  getJob(uuid: string): JobDetail {
    return this.ctx.jobs.getJob(uuid);
  }

  listJobs(filter: { state?: readonly JobState[] } = {}): JobSummary[] {
    return this.ctx.jobs.listJobs(filter);
  }

  cancelJob(uuid: string): Job {
    return this.ctx.jobs.cancelJob(uuid);
  }

  restoreJob(uuid: string): Job {
    return this.ctx.jobs.restoreJob(uuid);
  }

  listEvents(uuid: string, limit = 50): {
    id: number;
    eventType: string;
    status: string;
    actor: string;
    createdAt: string;
    detail: unknown;
  }[] {
    return this.ctx.jobs.listEvents(uuid, limit);
  }

  // --- content.ts ---

  createRevision(uuid: string, input: CreateRevisionInput = {}): Revision {
    return this.ctx.content.createRevision(uuid, input);
  }

  listRevisions(uuid: string): Revision[] {
    return this.ctx.content.listRevisions(uuid);
  }

  render(uuid: string): RenderOutcome {
    return this.ctx.content.render(uuid);
  }

  getPreviewDocument(uuid: string): { html: string; contentHash: string } {
    return this.ctx.content.getPreviewDocument(uuid);
  }

  getMarks(uuid: string, revisionNumber?: number): ProofMark[] {
    return this.ctx.content.getMarks(uuid, revisionNumber);
  }

  // --- agent.ts ---

  runAgentReview(uuid: string, input: AgentReviewInput): Promise<AgentRunResult> {
    return this.ctx.agent.runAgentReview(uuid, input);
  }

  suggestSlugs(uuid: string, input: SlugSuggestionInput): Promise<SlugSuggestionResponse> {
    return this.ctx.agent.suggestSlugs(uuid, input);
  }

  cancelAgentRun(uuid: string): void {
    return this.ctx.agent.cancelAgentRun(uuid);
  }

  // --- factcheck.ts（AI 查證，D-034，P6-T004）---

  runFactCheck(uuid: string, input: FactCheckInput): Promise<FactCheckRunResult> {
    return this.ctx.factcheck.runFactCheck(uuid, input);
  }

  listFactChecks(uuid: string): FactCheckListResponse {
    return this.ctx.factcheck.listFactChecks(uuid);
  }

  dismissFactCheck(uuid: string, findingId: number): void {
    return this.ctx.factcheck.dismissFactCheck(uuid, findingId);
  }

  // --- review.ts ---

  getReview(uuid: string): ReviewProposalView | null {
    return this.ctx.review.getReview(uuid);
  }

  resolveReviewItems(uuid: string, input: ResolveReviewInput): ReviewResolveResult {
    return this.ctx.review.resolveReviewItems(uuid, input);
  }

  acceptWholeProposal(uuid: string, ref: ProposalRef = {}): ReviewResolveResult {
    return this.ctx.review.acceptWholeProposal(uuid, ref);
  }

  discardReview(uuid: string, reason: string, ref: ProposalRef = {}): void {
    return this.ctx.review.discardReview(uuid, reason, ref);
  }

  getComparison(uuid: string, against?: 'proposal' | 'previous'): ComparisonView {
    return this.ctx.review.getComparison(uuid, against);
  }

  // --- briefs.ts ---

  dismissImageBrief(uuid: string, briefId: number): void {
    return this.ctx.briefs.dismissImageBrief(uuid, briefId);
  }

  updateImageBrief(uuid: string, briefId: number, input: { prompt?: string; note?: string | null }): { brief: ImageBriefView; notice: string | null } {
    return this.ctx.briefs.updateImageBrief(uuid, briefId, input);
  }

  // --- images.ts ---

  imageGenerationStatus(): Promise<ImageGenerationStatus> {
    return this.ctx.images.imageGenerationStatus();
  }

  generateBriefImage(uuid: string, briefId: number, input: { timeoutMs?: number } = {}): Promise<ImageCandidate> {
    return this.ctx.images.generateBriefImage(uuid, briefId, input);
  }

  imageCandidateFile(uuid: string, candidateId: number): { path: string; mimeType: string } {
    return this.ctx.images.imageCandidateFile(uuid, candidateId);
  }

  useImageCandidate(uuid: string, candidateId: number, input: { altText?: string } = {}): Promise<MediaUploadOutcome> {
    return this.ctx.images.useImageCandidate(uuid, candidateId, input);
  }

  requestImageAtPosition(uuid: string, input: { afterBlockIndex: number; contentHash: string; note?: string | null; timeoutMs?: number }): Promise<{ brief: ImageBriefView; generation: Promise<ImageCandidate> }> {
    return this.ctx.images.requestImageAtPosition(uuid, input);
  }

  selectionImageSpots(uuid: string, input: { selection: string; contentHash: string }): SelectionSpotsResponse {
    return this.ctx.images.selectionImageSpots(uuid, input);
  }

  requestImageFromSelection(uuid: string, input: { selection: string; spot?: number; contentHash: string; note?: string | null; timeoutMs?: number }): Promise<{ brief: ImageBriefView; generation: Promise<ImageCandidate> }> {
    return this.ctx.images.requestImageFromSelection(uuid, input);
  }

  // --- media.ts ---

  addMedia(uuid: string, input: AddMediaInput): Promise<MediaAsset> {
    return this.ctx.media.addMedia(uuid, input);
  }

  addMediaWithOutcome(uuid: string, input: AddMediaInput): Promise<MediaUploadOutcome> {
    return this.ctx.media.addMediaWithOutcome(uuid, input);
  }

  replaceMedia(uuid: string, assetId: number, input: AddMediaInput): Promise<MediaAsset> {
    return this.ctx.media.replaceMedia(uuid, assetId, input);
  }

  removeMedia(uuid: string, assetId: number): void {
    return this.ctx.media.removeMedia(uuid, assetId);
  }

  setFeaturedMedia(uuid: string, assetId: number | null): Revision {
    return this.ctx.media.setFeaturedMedia(uuid, assetId);
  }

  placeMedia(uuid: string, assetId: number, afterBlockIndex: number): Revision {
    return this.ctx.media.placeMedia(uuid, assetId, afterBlockIndex);
  }

  // --- approval.ts ---

  approve(uuid: string, input: { contentHash: string; actor: 'ui' }): ApprovalView {
    return this.ctx.approval.approve(uuid, input);
  }

  revokeApproval(uuid: string, reason: string): void {
    return this.ctx.approval.revokeApproval(uuid, reason);
  }

  // --- publish.ts ---

  publish(uuid: string, input: PublishInput): Promise<PublishResult> {
    return this.ctx.publish.publish(uuid, input);
  }

  // --- authors.ts ---

  listAuthors(): Promise<AuthorsResponse> {
    return this.ctx.authors.listAuthors();
  }

  assertAuthorChoosable(authorId: number): Promise<void> {
    return this.ctx.authors.assertAuthorChoosable(authorId);
  }
}
