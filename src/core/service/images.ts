/** 生圖（D-017，P5-T013）：用 Codex 生候選圖、用這張、在文章上請 AI 配一張。 */

import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ImageBrief as ImageBriefView, ImageCandidate, ImageGenerationStatus } from '../../contract/api.js';
import { AgentError, ContentChangedError, InvalidInputError, MediaError } from '../errors.js';
import { splitTopLevelBlocks } from '../html-blocks.js';
import type { AgentRunStatus, JobRow, ImageCandidateRow } from '../repository.js';
import {
  buildImagePrompt,
  buildPositionImagePrompt,
  buildSelectionImagePrompt,
  POSITION_ASPECT_RATIO,
  positionAnchor,
  positionContext,
  USER_BRIEF_PREFIX,
  userImageFilename,
} from '../image-generation.js';
import { checkUserNote } from '../../contract/user-note.js';
import {
  checkSelectionImage,
  locateSelection,
  normalizeSelectionText,
  selectionBasisLabel,
  selectionSpotAnchor,
  selectionSpots,
  SELECTION_SPOTS_CHANGED_MESSAGE,
  spotEdges,
  spotEdgesMatch,
} from '../../contract/selection-image.js';
import { AgentUnavailableError } from '../../agents/registry.js';
import { sha256Of } from '../../media/upload.js';
import { inspectImage, MediaUploadError } from '../../media/validate.js';
import type { MediaUploadOutcome } from './types.js';
import { MAX_AGENT_OUTPUT_BYTES, GENERATE_IMAGE_PURPOSE, isCandidateCurrent } from './context.js';
import type { CoreContext } from './context.js';

/** 生圖實測約 54 秒（docs/specs/agent-cli.md）；給到 5 分鐘，比校稿寬。 */
const DEFAULT_IMAGE_TIMEOUT_MS = 300_000;

export class ImagesModule {
  constructor(private readonly ctx: CoreContext) {}

  /** 現在能不能生圖。只有 Codex 能生圖；畫面靠這個決定按鈕給不給按。 */
  async imageGenerationStatus(): Promise<ImageGenerationStatus> {
    return this.ctx.agents.imageGenerationStatus();
  }

  /**
   * 照一條配圖需求生一張候選圖。
   *
   * - 跟校稿共用「同一篇稿件一次只跑一個 Agent 動作」（`activeRuns`），取消也走
   *   同一個 `cancelAgentRun`。
   * - 生出來的圖**只存在本機**（generated-images/），不上傳、不建 revision：
   *   它不是內容改動，核准不會失效。要用它得再按「用這張」（`useImageCandidate`）。
   * - 圖檔不信任：類型由檔頭決定，再過跟上傳一樣的類型與大小檢查。
   */
  async generateBriefImage(uuid: string, briefId: number, input: { timeoutMs?: number } = {}): Promise<ImageCandidate> {
    const job = this.ctx.requireJob(uuid);
    this.ctx.assertMutable(job);
    const brief = this.ctx.briefs.requireOpenBrief(job, briefId);
    const revisionRow = this.ctx.repo.latestRevision(job.id);

    if (this.ctx.activeRuns.has(job.uuid)) {
      throw new AgentError('這個工作項目已經有一個 Agent 在跑了，先取消或等它跑完');
    }
    const provider = this.ctx.agents.imageGeneratorId();
    if (provider === null) {
      // 不建 agent_runs：根本沒有東西可以跑。訊息跟 imageGenerationStatus 同一句。
      const status = await this.ctx.agents.imageGenerationStatus();
      throw new AgentUnavailableError(status.reason ?? '沒有能生圖的 Agent');
    }

    // 使用者在文章上請 AI 配的那條（P5-T018），prompt 建需求時就由固定程式組好了（前後段落＋
    // 那句話＋固定約束），直接用；再包一層「畫面描述」反而把約束埋進內容裡。
    const prompt =
      brief.origin === 'user'
        ? brief.prompt
        : buildImagePrompt({ prompt: brief.prompt, aspectRatio: brief.aspect_ratio });
    this.ctx.assertNoAppPassword(prompt);

    const workspace = this.ctx.jobWorkspace(job);
    const runRow = this.ctx.repo.insertAgentRun({
      jobId: job.id,
      revisionId: revisionRow?.id ?? null,
      provider,
      model: null,
      purpose: GENERATE_IMAGE_PURPOSE,
      status: 'running',
      inputHash: revisionRow?.content_hash ?? null,
      imageBriefId: brief.id,
    });
    const runId = `${job.uuid}-${runRow.id}`;
    this.ctx.activeRuns.set(job.uuid, { runId, provider, rowId: runRow.id });

    try {
      const result = await this.ctx.agents.generateImage(
        provider,
        {
          prompt,
          workspaceDir: workspace,
          timeoutMs: input.timeoutMs ?? DEFAULT_IMAGE_TIMEOUT_MS,
          maxOutputBytes: MAX_AGENT_OUTPUT_BYTES,
        },
        runId,
      );

      if (!result.ok) {
        const status: AgentRunStatus =
          result.reason === 'timeout' ? 'timeout' : result.reason === 'cancelled' ? 'cancelled' : 'failed';
        const message = this.ctx.scrub(result.message);
        // 已經被結掉的（使用者取消、重啟清理）不改寫：原因與結束時間以先結的那一次為準。
        if (this.ctx.repo.agentRunById(runRow.id)?.status === 'running') {
          this.ctx.repo.finishAgentRun(runRow.id, { status, outputHash: null, errorMessage: message });
        }
        throw new AgentError(message, this.ctx.scrub(result.issues));
      }

      // 等待期間被取消（排在佇列裡才被取消的那一個照樣會跑完）或稿件不能再改了，就不收。
      // 內容被改過**不算**：候選圖不是對著某一版文字做的，配圖需求還在就還用得上。
      const after = this.ctx.repo.agentRunById(runRow.id);
      if (after !== null && after.status !== 'running') {
        throw new AgentError(`這次生圖已經是 ${after.status}，圖不採用`);
      }
      const fresh = this.ctx.repo.jobById(job.id);
      if (!fresh) throw new AgentError('工作項目在生圖期間被刪除了，圖不採用');
      this.ctx.assertMutable(fresh);
      if (this.ctx.repo.imageBriefById(brief.id)?.dismissed_at !== null) {
        throw new AgentError('這條配圖需求在生圖期間被標成不要了，圖不採用');
      }

      let inspected;
      try {
        inspected = inspectImage(result.data.bytes);
      } catch (error) {
        if (error instanceof MediaUploadError) throw new MediaError(`Codex 生出來的檔案不能用：${error.message}`);
        throw error;
      }

      const sha256 = sha256Of(result.data.bytes);
      const dir = join(this.ctx.mediaDir, job.uuid, 'candidates');
      mkdirSync(dir, { recursive: true });
      const localPath = join(dir, `${sha256}.${inspected.extension}`);
      writeFileSync(localPath, result.data.bytes);

      const row = this.ctx.repo.insertImageCandidate({
        jobId: job.id,
        imageBriefId: brief.id,
        agentRunId: runRow.id,
        localPath: this.ctx.storedPath(localPath),
        mimeType: inspected.mimeType,
        byteSize: result.data.bytes.byteLength,
        width: inspected.width,
        height: inspected.height,
        sha256,
      });
      this.ctx.repo.finishAgentRun(runRow.id, { status: 'succeeded', outputHash: sha256, errorMessage: null });
      this.ctx.repo.insertEvent({
        jobId: job.id,
        revisionId: null,
        approvalId: null,
        actor: 'ui',
        eventType: 'image_generated',
        status: 'succeeded',
        detail: { briefId: brief.id, briefKey: brief.brief_key, candidateId: row.id, bytes: row.byte_size },
      });
      return this.ctx.briefs.toCandidate(job, row);
    } catch (error) {
      const row = this.ctx.repo.agentRunById(runRow.id);
      if (row?.status === 'running') {
        this.ctx.repo.finishAgentRun(runRow.id, {
          status: 'failed',
          outputHash: null,
          errorMessage: this.ctx.scrub(error instanceof Error ? error.message : String(error)),
        });
      }
      throw error;
    } finally {
      if (this.ctx.activeRuns.get(job.uuid)?.runId === runId) this.ctx.activeRuns.delete(job.uuid);
    }
  }

  /** 候選圖的本機檔案，給路由送出去。路徑只由資料庫決定，呼叫端只給得了編號。 */
  imageCandidateFile(uuid: string, candidateId: number): { path: string; mimeType: string } {
    const job = this.ctx.requireJob(uuid);
    const row = this.requireCandidate(job, candidateId);
    return { path: this.ctx.requireMediaFile(row.local_path, '候選圖'), mimeType: row.mime_type };
  }

  /**
   * 「用這張」：把候選圖上傳到 WordPress 媒體庫。走 `addMediaWithOutcome`，所以 briefKey、
   * alt、圖說、封面自動設精選、內文圖照錨點自動放（P5-T016）、核准會不會失效，全部照上傳的既有規則。
   *
   * 第一個 await 之前就先**同步**搶下這張（`claimImageCandidate`）：兩個同時送來的請求
   * 只有一個會上傳。上傳失敗就放回去，候選圖回到卡片上。
   */
  async useImageCandidate(
    uuid: string,
    candidateId: number,
    input: { altText?: string } = {},
  ): Promise<MediaUploadOutcome> {
    const job = this.ctx.requireJob(uuid);
    this.ctx.assertMutable(job);
    const row = this.requireCandidate(job, candidateId);
    this.ctx.assertNoAppPassword(input.altText, ...this.ctx.currentContentOf(job));
    const brief = this.ctx.repo.imageBriefById(row.image_brief_id);
    if (!brief || brief.job_id !== job.id || brief.dismissed_at !== null) {
      throw new InvalidInputError('這張圖對應的配圖需求已經不在了（或被標成不要了）');
    }
    if (!isCandidateCurrent(row, brief)) {
      throw new InvalidInputError('這條配圖需求之後又重新提過，這張是照舊的描述生的；請再生一張');
    }
    if (!this.ctx.repo.claimImageCandidate(row.id)) {
      throw new InvalidInputError('這張圖已經用過了（或正在上傳），已經在媒體庫裡');
    }

    // 卡片上填的替代文字（P5-T018）優先；沒填就用需求上的（使用者那條是空的）。
    const typedAlt = input.altText?.replace(/\s+/g, ' ').trim();
    const altText = typedAlt !== undefined && typedAlt !== '' ? typedAlt : brief.alt_text;
    // 檔名會變成公開網址的一部分：使用者那條的 key 是亂數，改用文章的 slug／標題（P5-T018）。
    const filename =
      brief.origin === 'user'
        ? userImageFilename({ slug: this.currentSlug(job), title: job.title }, brief.brief_key)
        : brief.brief_key;

    try {
      const result = await this.ctx.media.addMediaWithOutcome(uuid, {
        bytes: new Uint8Array(readFileSync(this.ctx.requireMediaFile(row.local_path, '候選圖'))),
        mimeType: row.mime_type,
        filename,
        altText,
        ...(brief.caption === null ? {} : { caption: brief.caption }),
        briefKey: brief.brief_key,
      });
      this.ctx.repo.markImageCandidateUsed(row.id, result.media.id);
      return result;
    } catch (error) {
      this.ctx.repo.releaseImageCandidate(row.id);
      throw error;
    }
  }

  /**
   * 在文章上「在這裡插圖」→「請 AI 配一張」（D-022，P5-T018）。
   *
   * 1. 先把所有擋得下來的都擋掉，才建東西：稿件不能改、已經有 Agent 動作在跑、Codex 不能用（沒裝、
   *    沒登入）、畫面上那一版不是目前這一版（位置是照畫面數的）、位置超出範圍、那句話太長。
   *    擋下來就什麼都不留。
   * 2. 建一條使用者發起的配圖需求：key `user-<亂數>`（Agent 的 key 碰不到這個開頭，見 `agentBriefKey`）、
   *    不是封面、錨點是插入點前面那段的原文（最前面那個位置用後面那段、放在它之前）、prompt 由固定程式
   *    組（`buildPositionImagePrompt`：前後各兩段目前的內容＋那句話＋固定約束）。
   * 3. 同一趟開始生圖（`generateBriefImage`，一次一個、佇列、取消、逾時、候選圖全部沿用），**不等它畫完**：
   *    回傳那條需求與生圖的 promise。`generateBriefImage` 在第一個 await 之前就登記好 `activeRuns` 與
   *    `agent_runs`，所以一回傳，`getJob` 的 agentRun 就是 running、briefId 指向這條。
   *
   * 生圖失敗記在 `agent_runs`（卡片上講「上次生圖失敗」），promise 另外接住，呼叫端不 await 也不會
   * 變成沒人接的 rejection。
   */
  async requestImageAtPosition(
    uuid: string,
    input: { afterBlockIndex: number; contentHash: string; note?: string | null; timeoutMs?: number },
  ): Promise<{ brief: ImageBriefView; generation: Promise<ImageCandidate> }> {
    const job = this.ctx.requireJob(uuid);
    this.ctx.assertMutable(job);
    const revisionRow = this.ctx.requireRevision(job);

    this.ctx.assertNoAppPassword(input.note);
    const note = this.checkedNote(input.note);
    this.assertShownRevision(input.contentHash, revisionRow);
    const blocks = splitTopLevelBlocks(revisionRow.rendered_html ?? '');
    if (!Number.isInteger(input.afterBlockIndex) || input.afterBlockIndex < -1 || input.afterBlockIndex > blocks.length - 1) {
      throw new InvalidInputError(
        `插入位置 ${input.afterBlockIndex} 超出範圍（目前有 ${blocks.length} 個區塊，可用的位置是 -1 到 ${blocks.length - 1}）`,
      );
    }
    await this.assertCanStartUserImage(job);
    this.recheckAfterAwait(job, revisionRow.id);

    const { anchor, position } = positionAnchor(blocks, input.afterBlockIndex);
    const context = positionContext(blocks, input.afterBlockIndex);
    const prompt = buildPositionImagePrompt({ ...context, note, aspectRatio: POSITION_ASPECT_RATIO });
    return this.startUserBrief(uuid, job, revisionRow.id, {
      prompt,
      purpose: '你在文章上指定位置、請 AI 配的圖',
      anchor,
      anchorPosition: position,
      note,
      detail: { afterBlockIndex: input.afterBlockIndex },
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
    });
  }

  /**
   * 選一段文字「用此段配圖」（D-037，P5-T038）。流程跟 `requestImageAtPosition` 同一套（先擋、建使用者那條需求、
   * 同一趟開始生圖不等它畫完），差別：
   *
   * - 選取文字照共用規則驗字數（10～3000，超過不截斷），用**目前這一版**重新定位（忽略空白、可跨段，
   *   `locateSelection`）：找不到或出現不只一次都拒絕（400）。
   * - 圖放哪裡由使用者選（`spot`：0＝這段開頭、中間＝選取內第 k 段之後、最後＝這段結尾，`selectionSpots`），
   *   錨點照「在這裡插圖」同一套（「這段開頭」先引用開頭那段、放在它之前）。位置只影響放哪，不影響 prompt。
   * - `spotCount`（選填）是畫面上看到的位置個數、`spotBefore`／`spotAfter`（選填）是所選位置兩側的字（`spotEdges`），
   *   跟這裡用目前這一版算的不一樣就拒絕（400），不猜。
   * - prompt 用 `buildSelectionImagePrompt`：選取文字為主，文章標題與所在小節標題只當背景。
   * - purpose 記卡片上要講的依據（「依選取段落：『…』（共 N 字）」）。
   * - 選取文字、標題、那句話、組好的 prompt 有 WordPress 密碼一律先擋（D-023）。
   */
  async requestImageFromSelection(
    uuid: string,
    input: {
      selection: string;
      spot?: number;
      spotCount?: number;
      spotBefore?: string;
      spotAfter?: string;
      contentHash: string;
      note?: string | null;
      timeoutMs?: number;
    },
  ): Promise<{ brief: ImageBriefView; generation: Promise<ImageCandidate> }> {
    const job = this.ctx.requireJob(uuid);
    this.ctx.assertMutable(job);
    const revisionRow = this.ctx.requireRevision(job);

    this.ctx.assertNoAppPassword(input.note, input.selection);
    const note = this.checkedNote(input.note);
    const checked = checkSelectionImage(input.selection);
    if (!checked.ok) throw new InvalidInputError(checked.message);
    this.assertShownRevision(input.contentHash, revisionRow);

    const blocks = splitTopLevelBlocks(revisionRow.rendered_html ?? '');
    const located = locateSelection(blocks, input.selection);
    if (!located.ok) throw new InvalidInputError(located.message);
    const spots = selectionSpots(blocks, located.first, located.last);
    // 畫面上的位置是用存檔前的畫面算的；打字模式存檔整理改了段落結構時編號會對到別處：個數對不上就不猜。
    if (input.spotCount !== undefined && input.spotCount !== spots.length) {
      throw new InvalidInputError(SELECTION_SPOTS_CHANGED_MESSAGE);
    }
    const wanted = input.spot ?? 0;
    const spot = spots.find((candidate) => candidate.spot === wanted);
    if (spot === undefined) {
      throw new InvalidInputError(`位置 ${wanted} 不在選取範圍內（可用的是 0 到 ${spots[spots.length - 1]!.spot}）`);
    }
    // 位置個數一樣、邊界卻挪了（段落被拆開／合併）：比邊界兩側的字（Codex 審查 P2）。
    if (
      (input.spotBefore !== undefined || input.spotAfter !== undefined) &&
      !spotEdgesMatch(
        { before: input.spotBefore ?? '', after: input.spotAfter ?? '' },
        spotEdges(blocks, spot.afterBlockIndex),
      )
    ) {
      throw new InvalidInputError(SELECTION_SPOTS_CHANGED_MESSAGE);
    }
    await this.assertCanStartUserImage(job);
    this.recheckAfterAwait(job, revisionRow.id);

    const title = this.currentTitle(job);
    const section = sectionHeading(blocks, located.first);
    this.ctx.assertNoAppPassword(title, section);
    const { anchor, position } = selectionSpotAnchor(blocks, spot);
    const prompt = buildSelectionImagePrompt({
      title,
      section,
      selection: normalizeSelectionText(input.selection),
      note,
      aspectRatio: POSITION_ASPECT_RATIO,
    });
    return this.startUserBrief(uuid, job, revisionRow.id, {
      prompt,
      purpose: selectionBasisLabel(input.selection),
      anchor,
      anchorPosition: position,
      note,
      // 不記選取內容本身：只記範圍與位置。
      detail: {
        fromSelection: true,
        firstBlockIndex: located.first,
        lastBlockIndex: located.last,
        spot: spot.spot,
        afterBlockIndex: spot.afterBlockIndex,
      },
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
    });
  }

  /** 跟前端計數、zod 同一套算法：摺疊空白之後數 code point（contract/user-note.ts）。 */
  private checkedNote(note: string | null | undefined): string | null {
    const checked = checkUserNote(note);
    if (!checked.ok) throw new InvalidInputError(checked.message);
    return checked.note;
  }

  /** 畫面上那一版不是目前這一版：位置（與選取）是照畫面算的，不能用。 */
  private assertShownRevision(contentHash: string, revisionRow: { content_hash: string }): void {
    if (contentHash !== revisionRow.content_hash) {
      throw new ContentChangedError('文章在你按下去之前換了一版，位置可能已經不對了。重新讀取之後再選一次位置。', {
        expected: contentHash,
        current: revisionRow.content_hash,
      });
    }
  }

  /**
   * 使用者發起的生圖能不能開始：沒有別的 Agent 動作在跑、Codex 能用（沒裝**或沒登入**都擋）。
   * 中間有 await，回來之後呼叫端要**同步**呼叫 `recheckAfterAwait` 再接 `startUserBrief`（中間不能再 await），
   * 兩個同時送來的請求才不會都通過。
   */
  private async assertCanStartUserImage(job: JobRow): Promise<void> {
    if (this.ctx.activeRuns.has(job.uuid)) {
      throw new AgentError('這個工作項目已經有一個 Agent 在跑了，先取消或等它跑完');
    }
    const status = await this.ctx.agents.imageGenerationStatus();
    if (!status.available || status.provider === null) {
      throw new AgentUnavailableError(status.reason ?? '沒有能生圖的 Agent');
    }
  }

  /** await 期間世界可能變了：再確認一次稿件、Agent、版本。同步。 */
  private recheckAfterAwait(job: JobRow, revisionId: number): void {
    const fresh = this.ctx.repo.jobById(job.id)!;
    this.ctx.assertMutable(fresh);
    if (this.ctx.activeRuns.has(job.uuid)) {
      throw new AgentError('這個工作項目已經有一個 Agent 在跑了，先取消或等它跑完');
    }
    if (this.ctx.repo.latestRevision(job.id)?.id !== revisionId) {
      throw new ContentChangedError('文章在你按下去之前換了一版，位置可能已經不對了。重新讀取之後再選一次位置。');
    }
  }

  /**
   * 建使用者那條需求、記事件、同一趟開始生圖（不等它畫完）。
   * 生圖失敗記在 `agent_runs`，promise 另外接住；沒登記成功就把需求標成不要了、錯誤照丟。
   */
  private async startUserBrief(
    uuid: string,
    job: JobRow,
    revisionId: number,
    input: {
      prompt: string;
      purpose: string;
      anchor: string | null;
      anchorPosition: 'after' | 'before';
      note: string | null;
      detail: Record<string, unknown>;
      timeoutMs?: number;
    },
  ): Promise<{ brief: ImageBriefView; generation: Promise<ImageCandidate> }> {
    this.ctx.assertNoAppPassword(input.prompt);
    const row = this.ctx.repo.insertUserImageBrief({
      jobId: job.id,
      briefKey: `${USER_BRIEF_PREFIX}${randomBytes(4).toString('hex')}`,
      purpose: input.purpose,
      prompt: input.prompt,
      aspectRatio: POSITION_ASPECT_RATIO,
      // 那句話講的是風格（「水彩風」），不是圖的內容，不能當替代文字；生圖那一趟也只回圖。
      // 留空，卡片上在「用這張」旁邊請使用者自己寫一句（選填），跟著用這張送出。
      altText: '',
      anchor: input.anchor,
      anchorPosition: input.anchorPosition,
      userNote: input.note,
    });
    this.ctx.repo.insertEvent({
      jobId: job.id,
      revisionId,
      approvalId: null,
      actor: 'ui',
      eventType: 'image_brief_requested',
      status: 'succeeded',
      detail: { briefId: row.id, briefKey: row.brief_key, ...input.detail, anchorPosition: input.anchorPosition },
    });

    const generation = this.generateBriefImage(
      uuid,
      row.id,
      input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs },
    );
    generation.catch(() => {
      // 失敗已經記在 agent_runs；這裡只是讓它不變成沒人接的 rejection。
    });

    // 正常情況下 generateBriefImage 同步登記好了這一趟。沒有的話代表它一開頭就失敗了：
    // 需求標成不要了（不留一張按了也不會動的卡片），錯誤照原樣丟回去。
    const active = this.ctx.activeRuns.get(job.uuid);
    if (!active || this.ctx.repo.agentRunById(active.rowId)?.image_brief_id !== row.id) {
      this.ctx.repo.dismissImageBrief(row.id);
      await generation;
      throw new AgentError('生圖沒有開始，原因不明');
    }

    const brief = this.ctx.jobs.getJob(uuid).imageBriefs.find((view) => view.id === row.id)!;
    return { brief, generation };
  }

  /** 目前這一版的標題（templateData 的 title，沒有就用稿件標題）。 */
  private currentTitle(job: JobRow): string | null {
    const latest = this.ctx.repo.latestRevision(job.id);
    const title = latest ? this.ctx.payloadOf(latest).templateData['title'] : null;
    if (typeof title === 'string' && title.trim() !== '') return title.trim();
    return job.title?.trim() || null;
  }

  /** 目前這一版 templateData 的 slug（字串才算）。 */
  private currentSlug(job: JobRow): string | null {
    const latest = this.ctx.repo.latestRevision(job.id);
    const slug = latest ? this.ctx.payloadOf(latest).templateData['slug'] : null;
    return typeof slug === 'string' && slug.trim() !== '' ? slug : null;
  }

  private requireCandidate(job: JobRow, candidateId: number): ImageCandidateRow {
    const row = this.ctx.repo.imageCandidateById(candidateId);
    if (!row || row.job_id !== job.id) {
      throw new InvalidInputError(`找不到這個工作項目的候選圖 ${candidateId}`);
    }
    return row;
  }
}

/** 選取開頭那塊所在的小節標題：從那塊往前找最近的 H2／H3（那塊本身是標題也算）；沒有就 null。 */
function sectionHeading(blocks: readonly { tag: string; text: string }[], first: number): string | null {
  for (let i = first; i >= 0; i -= 1) {
    const block = blocks[i];
    if (block && (block.tag === 'h2' || block.tag === 'h3') && block.text.trim() !== '') return block.text.trim();
  }
  return null;
}
