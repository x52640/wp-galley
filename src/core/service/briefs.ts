/** 配圖需求：存 Agent 給的需求、卡片上改描述、不要了、轉成畫面要的樣子。 */

import type { ImageBrief as ImageBriefView, ImageCandidate, MediaAsset, Revision } from '../../contract/api.js';
import { AgentError, InvalidInputError } from '../errors.js';
import { findBlocksContaining, splitTopLevelBlocks } from '../html-blocks.js';
import type { JobRow, ImageBriefRow, ImageCandidateRow } from '../repository.js';
import {
  agentBriefKey,
  buildPositionImagePrompt,
  isFeaturedBrief,
  normalizeUserNote,
  positionContext,
  replacePositionNote,
  USER_NOTE_MAX,
} from '../image-generation.js';
import { userNoteLength } from '../../contract/user-note.js';
import { BRIEF_PROMPT_MAX, briefPromptLength, normalizeBriefPrompt } from '../../contract/brief-prompt.js';
import type { ImageBrief } from '../../agents/output-contract.js';
import { featuredInput, isCandidateCurrent } from './context.js';
import type { CoreContext } from './context.js';

export class BriefsModule {
  constructor(private readonly ctx: CoreContext) {}

  /**
   * 丟掉一條配圖需求。不刪列，只標時間——事後才看得出來曾經建議過什麼。
   */
  dismissImageBrief(uuid: string, briefId: number): void {
    const job = this.ctx.requireJob(uuid);
    const brief = this.ctx.repo.imageBriefById(briefId);
    if (!brief || brief.job_id !== job.id) {
      throw new InvalidInputError(`找不到這個工作項目的配圖需求 ${briefId}`);
    }
    this.ctx.repo.dismissImageBrief(briefId);
    this.ctx.repo.insertEvent({
      jobId: job.id,
      revisionId: null,
      approvalId: null,
      actor: 'ui',
      eventType: 'image_brief_dismissed',
      status: 'succeeded',
      detail: { briefId, briefKey: brief.brief_key },
    });
  }

  /**
   * 在卡片上改配圖需求（D-025，P5-T025）。只能送其中一個：
   *
   * - Agent 建議的那條（含封面）送 `prompt`：存成新的畫面描述；生圖時照舊由 `buildImagePrompt` 包進固定約束。
   * - 使用者發起的那條送 `note`：存那句話，並用**目前這一版**的前後段落與既有錨點重組整份 prompt
   *   （`buildPositionImagePrompt`）。錨點在目前的文章裡對不上（改掉了、不只一段、當初就沒有）時照存那句話、
   *   前後段落沿用當初的（`replacePositionNote` 只換最後那一塊），`notice` 講清楚；不默默用舊段落。
   *
   * 規則照原本的再驗一次：描述不能是空的、上限 `BRIEF_PROMPT_MAX`；那句話上限 `USER_NOTE_MAX`；有 WordPress
   * 應用程式密碼直接拒絕（D-023，連重組好的整份 prompt 一起查）。Codex 正在畫這張時不准改（那一趟用的是舊的，
   * 改了會讓人以為畫出來的是新的）。稿件不能改時也不准（反正生不了圖）。
   *
   * 不是內容改動：不建版本、不撤銷核准。`agent_run_id` 不變，已經生好的候選圖留著、還能用。
   */
  updateImageBrief(
    uuid: string,
    briefId: number,
    input: { prompt?: string; note?: string | null },
  ): { brief: ImageBriefView; notice: string | null } {
    const job = this.ctx.requireJob(uuid);
    this.ctx.assertMutable(job);
    const brief = this.requireOpenBrief(job, briefId);
    const mine = brief.origin === 'user';
    if (mine && (input.prompt !== undefined || input.note === undefined)) {
      throw new InvalidInputError('這條是你在文章上請 AI 配的：能改的是「想要什麼樣的圖」那句（note），整份生圖指令由系統組');
    }
    if (!mine && (input.note !== undefined || input.prompt === undefined)) {
      throw new InvalidInputError('這條是 AI 建議的：能改的是畫面描述（prompt）');
    }
    this.ctx.assertNoAppPassword(input.prompt, input.note);

    const run = this.ctx.activeRuns.get(job.uuid);
    if (run !== undefined && this.ctx.repo.agentRunById(run.rowId)?.image_brief_id === brief.id) {
      throw new AgentError('Codex 正在畫這張，等它跑完再改');
    }

    let prompt: string;
    let userNote: string | null = brief.user_note;
    let notice: string | null = null;
    if (!mine) {
      prompt = normalizeBriefPrompt(input.prompt);
      if (prompt === '') throw new InvalidInputError('畫面描述不能是空的');
      if (briefPromptLength(prompt) > BRIEF_PROMPT_MAX) {
        throw new InvalidInputError(`畫面描述最多 ${BRIEF_PROMPT_MAX} 個字`);
      }
    } else {
      userNote = normalizeUserNote(input.note);
      if (userNoteLength(userNote) > USER_NOTE_MAX) {
        throw new InvalidInputError(`想要什麼樣的圖，最多 ${USER_NOTE_MAX} 個字`);
      }
      const rebuilt = this.rebuildUserBriefPrompt(job, brief, userNote);
      prompt = rebuilt.prompt;
      notice = rebuilt.notice;
    }
    this.ctx.assertNoAppPassword(prompt);

    this.ctx.repo.updateImageBriefText(brief.id, { prompt, userNote });
    this.ctx.repo.insertEvent({
      jobId: job.id,
      revisionId: null,
      approvalId: null,
      actor: 'ui',
      eventType: 'image_brief_edited',
      status: 'succeeded',
      // 不記內容本身：事件只講「改了哪一條、改的是哪一欄、前後段落有沒有換成目前的」。
      detail: { briefId: brief.id, briefKey: brief.brief_key, field: mine ? 'note' : 'prompt', contextRefreshed: mine ? notice === null : null },
    });
    const view = this.ctx.jobs.getJob(uuid).imageBriefs.find((row) => row.id === brief.id)!;
    return { brief: view, notice };
  }

  /**
   * 使用者那條的 prompt 用目前這一版重組（P5-T025）。錨點在目前的文章裡剛好對上一段，才知道「那個位置」在哪：
   * 照建需求時同一套（`positionContext`＋`buildPositionImagePrompt`）。對不上就只換那句話，並回一句話講清楚。
   */
  private rebuildUserBriefPrompt(
    job: JobRow,
    brief: ImageBriefRow,
    note: string | null,
  ): { prompt: string; notice: string | null } {
    const blocks = splitTopLevelBlocks(this.ctx.repo.latestRevision(job.id)?.rendered_html ?? '');
    const anchor = brief.anchor?.trim() ?? '';
    const hits = anchor === '' ? [] : findBlocksContaining(blocks, anchor);
    if (hits.length === 1) {
      const afterBlockIndex = brief.anchor_position === 'before' ? hits[0]! - 1 : hits[0]!;
      const context = positionContext(blocks, afterBlockIndex);
      return { prompt: buildPositionImagePrompt({ ...context, note, aspectRatio: brief.aspect_ratio }), notice: null };
    }

    const kept = replacePositionNote(brief.prompt, note);
    if (kept === null) {
      throw new InvalidInputError('這條配圖需求的生圖指令認不出來，沒辦法只換那句話；請按「不要了」，再到那個位置重新請 AI 配一張');
    }
    const side = brief.anchor_position === 'before' ? '後面' : '前面';
    const why =
      anchor === ''
        ? '你選的位置前後當初就沒有文字可以對照'
        : hits.length === 0
          ? `你選的位置${side}那段「${anchor}」在目前的文章裡找不到（可能改過了）`
          : `你選的位置${side}那段「${anchor}」在文章裡出現在 ${hits.length} 段，不確定是哪一段`;
    return {
      prompt: kept,
      notice: `已存。${why}，所以送給 Codex 的前後段落沿用當初請 AI 配圖時的內容，只換了你想要的那句。`,
    };
  }

  /**
   * 把 Agent 這一趟給的配圖需求存起來（校驗與一鍵配圖都走這裡）。同一個 key 覆蓋上一次的建議。
   *
   * 例外（D-027，P5-T027）：使用者在卡片上改過描述的那條（`promptEditedBriefIds`），**描述保留使用者的版本**，
   * 其他欄位（用途、比例、alt、說明、位置、錨點）照常換成 Agent 的新版本。比例也沒變時連 `agent_run_id` 都不換：
   * 生圖只看描述與比例，已經生好的候選圖一律不讓它過時（包括改描述前照 AI 描述生的那張，見 agent-tasks.md）。
   */
  storeImageBriefs(job: JobRow, agentRunId: number, briefs: readonly ImageBrief[]): void {
    const existing = new Map(this.ctx.repo.listImageBriefs(job.id).map((row) => [row.brief_key, row]));
    const edited = this.ctx.repo.promptEditedBriefIds(job.id);
    const keptUserPrompt: string[] = [];
    for (const brief of briefs) {
      const briefKey = agentBriefKey(brief.key);
      const previous = existing.get(briefKey);
      const keep = previous !== undefined && previous.origin === 'agent' && edited.has(previous.id);
      if (keep) keptUserPrompt.push(briefKey);
      this.ctx.repo.upsertImageBrief({
        jobId: job.id,
        agentRunId: keep && previous.aspect_ratio === brief.aspectRatio ? previous.agent_run_id : agentRunId,
        briefKey,
        purpose: brief.purpose,
        prompt: keep ? previous.prompt : brief.prompt,
        aspectRatio: brief.aspectRatio,
        altText: brief.altText,
        caption: brief.caption ?? null,
        placement: brief.placement ?? null,
        anchor: brief.anchor ?? null,
      });
    }
    if (briefs.length > 0) {
      this.ctx.repo.insertEvent({
        jobId: job.id,
        revisionId: null,
        approvalId: null,
        actor: 'ui',
        eventType: 'image_briefs_proposed',
        status: 'succeeded',
        // keptUserPrompt：哪幾條保留了使用者改過的描述（只記 key，不記內容）。
        detail: { count: briefs.length, keys: briefs.map((brief) => agentBriefKey(brief.key)), keptUserPrompt },
      });
    }
  }

  imageBriefViews(job: JobRow, media: readonly MediaAsset[], revision: Revision | null): ImageBriefView[] {
    const filled = new Set(media.map((asset) => asset.briefKey).filter((key): key is string => key !== null));
    const featuredKey = revision?.templateData['featuredImageBriefKey'];
    const candidates = new Map(this.ctx.repo.latestOpenCandidates(job.id).map((row) => [row.image_brief_id, row]));
    const edited = this.ctx.repo.promptEditedBriefIds(job.id);
    return this.ctx.repo
      .listImageBriefs(job.id)
      .filter((row) => row.dismissed_at === null)
      .map((row) => {
        const candidate = candidates.get(row.id);
        const current = candidate !== undefined && isCandidateCurrent(candidate, row);
        const promptEdited = row.origin === 'agent' && edited.has(row.id);
        return this.toImageBrief(row, filled, featuredKey, current ? this.toCandidate(job, candidate) : null, promptEdited);
      });
  }

  private toImageBrief(
    row: ImageBriefRow,
    filled: ReadonlySet<string>,
    featuredKey: unknown,
    candidate: ImageCandidate | null,
    promptEdited: boolean,
  ): ImageBriefView {
    return {
      id: row.id,
      key: row.brief_key,
      purpose: row.purpose,
      prompt: row.prompt,
      aspectRatio: row.aspect_ratio,
      altText: row.alt_text,
      caption: row.caption,
      placement: row.placement,
      anchor: row.anchor,
      fulfilled: filled.has(row.brief_key),
      dismissed: row.dismissed_at !== null,
      createdAt: row.created_at,
      isFeatured: isFeaturedBrief(featuredInput(row), featuredKey),
      candidate,
      origin: row.origin,
      anchorPosition: row.anchor_position,
      note: row.user_note,
      promptEdited,
    };
  }

  toCandidate(job: JobRow, row: ImageCandidateRow): ImageCandidate {
    return {
      id: row.id,
      briefId: row.image_brief_id,
      url: `/api/jobs/${job.uuid}/candidates/${row.id}`,
      mimeType: row.mime_type,
      byteSize: row.byte_size,
      width: row.width,
      height: row.height,
      createdAt: row.created_at,
    };
  }

  requireOpenBrief(job: JobRow, briefId: number): ImageBriefRow {
    const brief = this.ctx.repo.imageBriefById(briefId);
    if (!brief || brief.job_id !== job.id) {
      throw new InvalidInputError(`找不到這個工作項目的配圖需求 ${briefId}`);
    }
    if (brief.dismissed_at !== null) {
      throw new InvalidInputError('這條配圖需求已經標成不要了');
    }
    return brief;
  }
}
