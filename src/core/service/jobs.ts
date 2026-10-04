/** 建立與讀取稿件、取消與恢復、稽核紀錄。 */

import { randomUUID } from 'node:crypto';
import type {
  AgentRunTask,
  Approval as ApprovalView,
  Job,
  JobDetail,
  JobSummary,
  Revision,
  ReviewProposal as ReviewProposalView,
} from '../../contract/api.js';
import { computeProofMarks } from '../diff.js';
import type { JobRow } from '../repository.js';
import { buildTemplateDataFromSource } from '../source-text.js';
import { EMPTY_BODY_MESSAGE, isBlankBody } from '../../contract/empty-body.js';
import { titleMaxLengthFromSchema } from '../../contract/plain-title.js';
import { assertTransition, InvalidTransitionError, type JobState } from '../state-machine.js';
import { restoreStateFor } from '../../contract/job-states.js';
import { pendingReviewBlocker } from '../../contract/review-state.js';
import { createJobWorkspace } from '../../agents/workspace.js';
import type { PublishTarget } from '../../wordpress/targets.js';
import type { CreateJobInput, RevisionPayload } from './types.js';
import { FACTCHECK_PURPOSE, GENERATE_IMAGE_PURPOSE, SUGGEST_SLUG_PURPOSE } from './context.js';
import type { CoreContext } from './context.js';

/** `agent_runs.purpose` → 畫面上的 task。舊資料沒有 generate-image，一律照舊當成 review。 */
function taskOfPurpose(purpose: string): AgentRunTask {
  if (
    purpose === 'images' ||
    purpose === GENERATE_IMAGE_PURPOSE ||
    purpose === SUGGEST_SLUG_PURPOSE ||
    purpose === FACTCHECK_PURPOSE
  ) {
    return purpose;
  }
  return 'review';
}

export class JobsModule {
  constructor(private readonly ctx: CoreContext) {}

  createJob(input: CreateJobInput): Job {
    const target = this.ctx.requireTarget(input.targetKey);
    const template = this.ctx.templates.get(target.templateId);
    this.ctx.assertNoAppPassword(input.sourceText, input.title, input.templateData);

    // 原稿可以是空的（D-030，P5-T029）：先建再在文章上寫。正文存成一個空段落
    // （buildTemplateDataFromSource），schema 與渲染都不放寬；不能發布空文章由核准與發布前置檢查擋。

    const uuid = randomUUID();
    const workspace = createJobWorkspace(this.ctx.draftsDir, uuid);

    const templateData =
      input.templateData ?? buildTemplateDataFromSource(template, input.sourceText, input.title);

    const payload: RevisionPayload = { templateData, featuredMediaAssetId: null };
    const rendered = this.ctx.renderPayload(template, payload);

    const job = this.ctx.repo.insertJob({
      uuid,
      title: this.ctx.titleOf(templateData) ?? input.title ?? null,
      targetId: this.ctx.targetIds.get(target.key) ?? null,
      state: 'SOURCE',
      workspacePath: this.ctx.storedPath(workspace),
    });

    this.ctx.repo.insertRevision({
      jobId: job.id,
      revisionNumber: 1,
      parentRevisionId: null,
      templateRowId: this.ctx.templateRowIds.get(template.hash) ?? null,
      origin: 'source',
      contentHash: rendered.contentHash,
      sourceText: input.sourceText,
      templateDataJson: JSON.stringify(payload),
      renderedHtml: rendered.result.publishHtml,
    });

    this.ctx.repo.insertEvent({
      jobId: job.id,
      revisionId: null,
      approvalId: null,
      actor: 'ui',
      eventType: 'job_created',
      status: 'succeeded',
      detail: this.ctx.scrub({ targetKey: target.key, templateId: template.manifest.id }),
    });

    return this.ctx.toJob(this.ctx.repo.jobById(job.id)!);
  }

  getJob(uuid: string): JobDetail {
    const job = this.ctx.requireJob(uuid);
    const target = this.ctx.targetOf(job);
    const template = target ? this.ctx.templates.get(target.templateId) : null;
    const revisionRow = this.ctx.repo.latestRevision(job.id);
    const revision = revisionRow ? this.ctx.toRevision(revisionRow) : null;
    const previousRow = revisionRow ? this.ctx.repo.previousRevision(job.id, revisionRow.revision_number) : null;

    // 用「最近一筆」而不是「尚未撤銷的那筆」：核准被撕掉之後，UI 還是要看得到
    // 曾經有過一個章、現在失效了，不然使用者分不出「沒核准過」與「核准掉了」。
    const approvalRow = this.ctx.repo.latestApproval(job.id);
    const approval: ApprovalView | null = approvalRow
      ? {
          id: approvalRow.id,
          contentHash: approvalRow.content_hash,
          createdAt: approvalRow.created_at,
          valid:
            approvalRow.revoked_at === null &&
            revision !== null &&
            approvalRow.content_hash === revision.contentHash,
        }
      : null;

    const media = this.ctx.mediaViews(job, revision);
    const publishedRow = this.ctx.repo.publishedObject(job.id);
    const agentRow = this.ctx.repo.latestAgentRun(job.id);
    const review = this.ctx.review.reviewView(job.id, revision);

    return {
      uuid: job.uuid,
      state: job.state,
      title: job.title,
      target: target
        ? {
            key: target.key,
            displayName: target.displayName,
            contentType: target.contentType,
            postType: target.postType,
            taxonomy: target.taxonomy,
            requireFeaturedImage: target.requireFeaturedImage,
            allowCreateTerms: target.allowCreateTerms,
          }
        : null,
      template: template
        ? {
            id: template.manifest.id,
            hash: template.hash,
            strictness: template.manifest.strictness,
            allowedTags: [...template.manifest.allowedTags],
            allowedSchemes: [...template.manifest.allowedSchemes],
            titleMaxLength: titleMaxLengthFromSchema(template.schema),
          }
        : null,
      currentRevision: revision,
      revisionCount: this.ctx.repo.listRevisions(job.id).length,
      previewUrl: `/api/jobs/${job.uuid}/preview`,
      marks: computeProofMarks(previousRow?.rendered_html ?? null, revisionRow?.rendered_html ?? ''),
      media,
      featuredMediaId: revision?.featuredMediaId ?? null,
      approval,
      blockers: this.blockersFor(job, target, revision, approval, review),
      published:
        publishedRow && publishedRow.link !== null
          ? {
              wordpressId: publishedRow.wordpress_id,
              status: publishedRow.status ?? 'draft',
              link: publishedRow.link,
            }
          : null,
      // AI 查證（P6-T004）正在跑或是最近一趟：由查證紀錄組出來（抓網頁、核對兩段沒有 running 的 agent_runs）。
      agentRun: this.ctx.factcheck.agentRunView(job, agentRow?.purpose ?? null) ?? (agentRow
        ? {
            status: agentRow.status,
            provider: agentRow.provider,
            // purpose 存的就是這一趟的 task，畫面靠它決定要說「校稿」、「想配圖」還是「生圖」。
            task: taskOfPurpose(agentRow.purpose),
            briefId: agentRow.image_brief_id ?? null,
            startedAt: agentRow.started_at,
            finishedAt: agentRow.finished_at,
            errorMessage: agentRow.error_message,
            factCheck: null,
          }
        : null),
      review,
      imageBriefs: this.ctx.briefs.imageBriefViews(job, media, revision),
      sourceText: revisionRow?.source_text ?? this.ctx.repo.listRevisions(job.id)[0]?.source_text ?? null,
      bodyEmpty: isBlankBody(revisionRow?.rendered_html ?? null),
      // 發布面板提醒（不是 blocker）：查證說法不同、還沒結案、原句還在的條數。
      openFactCheckContradictions: this.ctx.factcheck.openContradictionCount(job, revision),
    };
  }

  listJobs(filter: { state?: readonly JobState[] } = {}): JobSummary[] {
    return this.ctx.repo.listJobs(filter.state).map((row) => {
      const revisions = this.ctx.repo.listRevisions(row.id);
      const latest = revisions[revisions.length - 1] ?? null;
      const approval = this.ctx.repo.activeApproval(row.id);
      const published = this.ctx.repo.publishedObject(row.id);
      return {
        ...this.ctx.toJob(row),
        revisionCount: revisions.length,
        revisionNumber: latest?.revision_number ?? null,
        approved: approval !== null && latest !== null && approval.content_hash === latest.content_hash,
        publishedId: published?.wordpress_id ?? null,
        pendingReviewCount: this.ctx.review.pendingReviewCount(row.id),
      };
    });
  }

  cancelJob(uuid: string): Job {
    const job = this.ctx.requireJob(uuid);
    assertTransition(job.state, 'CANCELLED');
    this.ctx.repo.revokeApprovals(job.id, '工作項目已取消');
    this.ctx.repo.updateJobState(job.id, 'CANCELLED');
    this.ctx.repo.insertEvent({
      jobId: job.id,
      revisionId: null,
      approvalId: null,
      actor: 'ui',
      eventType: 'job_cancelled',
      status: 'succeeded',
      // 恢復時要知道回到哪裡（D-031）。只記在事件裡，不加欄位。
      detail: { fromState: job.state },
    });
    return this.ctx.toJob(this.ctx.repo.jobById(job.id)!);
  }

  /**
   * 恢復已取消的稿件（D-031，P5-T030）。只有本機 UI 會呼叫，MCP 不開。
   *
   * 回到最近一次取消前的狀態；取消前是 `APPROVED` 的回 `RENDERED`——取消時核准已經撤銷，
   * 這裡**不建立、不恢復任何核准**，要重新核准。記不到（本 Task 之前取消的）、解析不了、
   * 或轉移表不允許的值一律回 `SOURCE`。跟 WordPress 草稿的連結沒動過，照舊。
   */
  restoreJob(uuid: string): Job {
    const job = this.ctx.requireJob(uuid);
    if (job.state !== 'CANCELLED') {
      // 跟轉移表同一種錯（HTTP 409）；SOURCE 只是代表「恢復」這個方向。
      throw new InvalidTransitionError(job.state, 'SOURCE', `只有已取消的稿件能恢復，這篇目前是 ${job.state}`);
    }
    const target = this.restoreTargetOf(job);
    assertTransition(job.state, target);
    this.ctx.repo.updateJobState(job.id, target);
    this.ctx.repo.insertEvent({
      jobId: job.id,
      revisionId: null,
      approvalId: null,
      actor: 'ui',
      eventType: 'job_restored',
      status: 'succeeded',
      detail: { toState: target },
    });
    return this.ctx.toJob(this.ctx.repo.jobById(job.id)!);
  }

  /** 恢復要回到的狀態。能回去的清單就是轉移表的 CANCELLED 那一列（`RESTORABLE_STATES`）。 */
  private restoreTargetOf(job: JobRow): JobState {
    const event = this.ctx.repo.latestSucceededEvent(job.id, 'job_cancelled');
    let from: unknown = null;
    try {
      const detail: unknown = event?.detail_json ? JSON.parse(event.detail_json) : null;
      if (detail !== null && typeof detail === 'object') from = (detail as { fromState?: unknown }).fromState;
    } catch {
      // 紀錄壞掉就當成沒記，回 SOURCE。
    }
    // APPROVED 回 RENDERED；認不得或轉移表不允許的回 SOURCE（規則在共用契約，示範資料也用）。
    return restoreStateFor(from);
  }

  /** 稽核紀錄。UI 的「這一步」面板與日後的除錯都靠它。 */
  listEvents(uuid: string, limit = 50): {
    id: number;
    eventType: string;
    status: string;
    actor: string;
    createdAt: string;
    detail: unknown;
  }[] {
    const job = this.ctx.requireJob(uuid);
    return this.ctx.repo.listEvents(job.id, limit).map((row) => ({
      id: row.id,
      eventType: row.event_type,
      status: row.status,
      actor: row.actor,
      createdAt: row.created_at,
      detail: row.detail_json === null ? null : (JSON.parse(row.detail_json) as unknown),
    }));
  }

  private blockersFor(
    job: JobRow,
    target: PublishTarget | null,
    revision: Revision | null,
    approval: ApprovalView | null,
    review: ReviewProposalView | null,
  ): string[] {
    const blockers: string[] = [];
    if (!target) blockers.push('這個工作項目沒有綁定發布目標');
    if (!revision) blockers.push('還沒有任何內容');
    else if (isBlankBody(revision.publishHtml)) blockers.push(EMPTY_BODY_MESSAGE);
    if (this.ctx.wordpress === null) blockers.push('WordPress 尚未設定，先到「設定」跑一次設定精靈');
    if (target?.requireFeaturedImage && revision?.featuredMediaId == null) {
      blockers.push('這個發布目標必須設定精選圖片');
    }
    if (approval !== null && !approval.valid) blockers.push('內容改過了，核准已失效，請重新預覽並核准');
    // 使用者的心智模型是「清單從上往下清完，就可以發了」。沒清完就講出來——
    // 但這是提醒不是禁令，blockers 只餵給畫面，發布的硬性前置檢查在 preflightPublish。
    if (review !== null && review.pendingCount > 0) {
      blockers.push(pendingReviewBlocker(review.pendingCount));
    }

    switch (job.state) {
      case 'SOURCE':
      case 'REVIEWED':
      case 'MEDIA_READY':
        blockers.push('還沒渲染，先按「渲染」產生校樣');
        break;
      case 'RENDERED':
        blockers.push('還沒看過校樣，開啟預覽後才能核准');
        break;
      case 'PREVIEWED':
        blockers.push('還沒核准');
        break;
      case 'PUBLISHING':
        blockers.push('正在發布中');
        break;
      case 'PUBLISHED':
        blockers.push('已經發布過了');
        break;
      case 'FAILED':
      case 'CANCELLED':
      case 'SUPERSEDED':
        blockers.push(`工作項目已經是 ${job.state}，不能再發布`);
        break;
      case 'APPROVED':
        break;
    }

    return blockers;
  }
}
