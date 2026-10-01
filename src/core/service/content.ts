/** 內容：建新版本（核准失效的唯一入口在 approval.ts，這裡呼叫）、渲染、校樣、校對符號。 */

import type { RenderOutcome, Revision } from '../../contract/api.js';
import { computeProofMarks, type ProofMark } from '../diff.js';
import { ContentChangedError, InvalidInputError } from '../errors.js';
import { normalizeEditedBody, wrapBareTopLevelText } from '../html-blocks.js';
import type { FactCheckFindingRow, ReviewItemRow } from '../repository.js';
import { EMPTY_BODY_HTML } from '../../contract/empty-body.js';
import { checkPlainTitle, sameTitle, titleMaxLengthFromSchema } from '../../contract/plain-title.js';
import { canTransition, isContentMutable } from '../state-machine.js';
import { buildPreviewDocument } from '../../preview/document.js';
import { sanitizeBody } from '../../templates/sanitize.js';
import type { LoadedTemplate } from '../../templates/types.js';
import type { CreateRevisionInput, RevisionPayload } from './types.js';
import type { CoreContext } from './context.js';

/**
 * 上一版正文實際會發布的樣子：跟 renderRevision 的第 2 步同一套（sanitize → 頂層裸文字包段落）。
 * 直接在文章上改時拿它當比對基準——前端校樣顯示的就是這一份（P5-T028 第三輪審查 #2）。
 */
function publishedBodyOf(template: LoadedTemplate, body: unknown): string | null {
  if (typeof body !== 'string') return null;
  return wrapBareTopLevelText(sanitizeBody(body, template.manifest).html.trim());
}

/** 整理完變成空字串的正文（使用者把字全刪了）存成一個空段落：schema 要求非空，渲染拒絕空字串（P5-T029）。 */
function bodyOrEmpty(body: string): string {
  return body.trim().length === 0 ? EMPTY_BODY_HTML : body;
}

export class ContentModule {
  constructor(private readonly ctx: CoreContext) {}

  /**
   * 建立新 revision。**任何內容改動都必須走這裡**，因為核准失效也只在這裡處理。
   *
   * 順序很重要：先撤銷核准，再寫新版本。反過來的話中間有一瞬間「核准還在、
   * 內容已經換掉」，那一瞬間如果有人呼叫 publish 就會發出未經核准的內容。
   */
  createRevision(uuid: string, input: CreateRevisionInput = {}): Revision {
    const job = this.ctx.requireJob(uuid);
    this.ctx.assertMutable(job);
    // AI 查證跑的期間鎖住內容（P6-T004）：在文章上改、放圖、套用建議都經過這裡。
    this.ctx.factcheck.assertNotRunning(job);

    const template = this.ctx.requireTemplate(job);
    const baseRow = this.ctx.repo.latestRevision(job.id);
    // 呼叫端說「我是根據哪一版改的」，目前版本不是那一版就整個拒絕（P5-T005）：
    // templateData 是整份取代，放行的話會把中間別人存進去的修改悄悄蓋掉。
    // 比對放在任何寫入之前（核准也還沒撤銷）。不會被插隊：這個方法從這裡到
    // insertRevision 都是同步的（node:sqlite 的 DatabaseSync），中間沒有 await，
    // 別的請求進不來；呼叫端（包括 MCP）也不該在這中間加 await。
    if (input.expectedContentHash !== undefined && input.expectedContentHash !== (baseRow?.content_hash ?? null)) {
      throw new ContentChangedError(
        '這一版在你編輯的期間被改過了，這次沒有存進去，也沒有蓋掉那些修改。重新讀取拿最新的內容，再改一次。',
        { expected: input.expectedContentHash, current: baseRow?.content_hash ?? null },
      );
    }
    const base: RevisionPayload = baseRow
      ? this.ctx.payloadOf(baseRow)
      : { templateData: {}, featuredMediaAssetId: null };

    if (input.editedBody !== undefined && input.templateData !== undefined) {
      throw new InvalidInputError('editedBody 與 templateData 不能同時給：一個只換正文，一個整份取代');
    }
    if (input.editedTitle !== undefined && input.templateData !== undefined) {
      throw new InvalidInputError('editedTitle 與 templateData 不能同時給：一個只換標題，一個整份取代');
    }
    // 在文章上直接改的標題（P5-T029）：跟前端同一條規則，寫入任何東西之前先驗。
    let editedTitle: string | undefined;
    if (input.editedTitle !== undefined) {
      const checked = checkPlainTitle(input.editedTitle, {
        diary: this.ctx.targetOf(job)?.contentType === 'diary',
        // 上限照這篇模板的 schema（通用文章 200、日記與長文 120），不寫死（審查 #2）。
        maxLength: titleMaxLengthFromSchema(template.schema),
      });
      if (!checked.ok) throw new InvalidInputError(checked.message);
      // 跟目前的標題只差在空白（連續空格、NBSP、全形空格）不算改（P5-T031，跟前端同一條 sameTitle）：
      // 沿用舊標題，後面的「沒有實質改動」判斷才認得出來，卡片也不會因為空白被結案。
      const current = base.templateData['title'];
      editedTitle = typeof current === 'string' && sameTitle(checked.title, current) ? current : checked.title;
    }
    // 要一起結案的那張卡片，寫入任何東西之前先驗：驗不過就整個存檔拒絕，不留下半套。
    let resolveRow: ReviewItemRow | null = null;
    if (input.resolveItemId !== undefined) {
      // 講標題的建議只改標題也算（P5-T031）。
      if (input.editedBody === undefined && input.editedTitle === undefined) {
        throw new InvalidInputError('resolveItemId 只能跟 editedBody 或 editedTitle 一起用（從卡片進去直接改文章）');
      }
      const proposal = this.ctx.repo.openReviewProposal(job.id);
      resolveRow =
        (proposal ? this.ctx.repo.listReviewItems(proposal.id) : []).find((row) => row.id === input.resolveItemId) ?? null;
      if (!resolveRow) throw new InvalidInputError(`這一項不屬於目前的校稿提案：${input.resolveItemId}`);
    }
    // 從查證卡片「去原文改」（P6-T004）：規則同 resolveItemId，寫入任何東西之前先驗。
    let resolveFactCheck: FactCheckFindingRow | null = null;
    if (input.resolveFactCheckId !== undefined) {
      if (input.editedBody === undefined && input.editedTitle === undefined) {
        throw new InvalidInputError('resolveFactCheckId 只能跟 editedBody 或 editedTitle 一起用（從查證卡片進去直接改文章）');
      }
      resolveFactCheck = this.ctx.factcheck.requireOpenFinding(job, input.resolveFactCheckId);
    }
    const bodyData =
      input.editedBody === undefined
        ? (input.templateData ?? base.templateData)
        : { ...base.templateData, [template.manifest.publishSlot]: bodyOrEmpty(normalizeEditedBody(input.editedBody, {
              allowedSchemes: template.manifest.allowedSchemes,
              // 基準＝上一版實際會發布的正文（跟前端校樣同一份），沒改的頂層區塊原樣沿用（P5-T028 審查）。
              baseline: publishedBodyOf(template, base.templateData[template.manifest.publishSlot]),
            })) };
    const templateData = editedTitle === undefined ? bodyData : { ...bodyData, title: editedTitle };

    const payload: RevisionPayload = {
      templateData,
      featuredMediaAssetId:
        input.featuredMediaId === undefined ? base.featuredMediaAssetId : input.featuredMediaId,
    };
    // 檢查整份新內容（不只這次送來的欄位）：之後的校稿會把整份送給 Agent。
    this.ctx.assertNoAppPassword(payload.templateData, input.editedBody, input.editedTitle, input.sourceText, input.reason);

    if (payload.featuredMediaAssetId !== null) {
      const asset = this.ctx.repo.mediaById(payload.featuredMediaAssetId);
      if (!asset || asset.job_id !== job.id) {
        throw new InvalidInputError(`找不到這個工作項目的圖片 ${payload.featuredMediaAssetId}`);
      }
    }

    // 直接在文章上改：整理之後跟目前這一版一樣（例如只多按了一個 Enter）就不算改動——
    // 不建新版本、不撤銷核准。否則核准會為了一個看不見的差異失效。
    if (
      (input.editedBody !== undefined || editedTitle !== undefined) &&
      baseRow &&
      this.ctx.renderPayload(template, payload).contentHash === baseRow.content_hash
    ) {
      return this.ctx.toRevision(baseRow);
    }

    // 1) 先撤銷核准（契約三之「核准失效的實作點」）。
    this.ctx.approval.invalidateApproval(job, input.reason ?? '內容已修改');

    // 2) 再渲染。渲染失敗就整份退回，不留下半成品。
    const rendered = this.ctx.renderPayload(template, payload);

    const revisionRow = this.ctx.repo.insertRevision({
      jobId: job.id,
      revisionNumber: (baseRow?.revision_number ?? 0) + 1,
      parentRevisionId: baseRow?.id ?? null,
      templateRowId: this.ctx.templateRowIds.get(template.hash) ?? null,
      origin: input.origin ?? 'manual',
      contentHash: rendered.contentHash,
      sourceText: input.sourceText ?? baseRow?.source_text ?? null,
      templateDataJson: JSON.stringify(payload),
      renderedHtml: rendered.result.publishHtml,
    });

    const title = this.ctx.titleOf(payload.templateData);
    if (title !== null && title !== job.title) this.ctx.repo.updateJobTitle(job.id, title);

    // 3) 內容變了就不能還停在「已預覽」——使用者看到的已經不是這一版了。
    const fresh = this.ctx.repo.jobById(job.id)!;
    if (fresh.state === 'PREVIEWED') this.ctx.repo.updateJobState(job.id, 'RENDERED');

    this.ctx.repo.insertEvent({
      jobId: job.id,
      revisionId: revisionRow.id,
      approvalId: null,
      actor: 'ui',
      eventType: 'revision_created',
      status: 'succeeded',
      detail: this.ctx.scrub({ origin: revisionRow.origin, reason: input.reason ?? null }),
    });

    // 從卡片進去改的：那一項跟著這一版結案。記下是哪一版結的，畫面才分得出「自己改了」與「保留原文」。
    // 已經套用過的不動——文字已經是 AI 的版本了，改標成略過會讓清單說謊。
    if (resolveRow && resolveRow.state !== 'applied') {
      this.ctx.repo.updateReviewItemState(resolveRow.id, 'skipped', revisionRow.id);
      this.ctx.repo.insertEvent({
        jobId: job.id,
        revisionId: revisionRow.id,
        approvalId: null,
        actor: 'ui',
        eventType: 'review_items_skipped',
        status: 'succeeded',
        detail: { proposalId: resolveRow.proposal_id, count: 1, ignored: 0, byEdit: true },
      });
      this.ctx.review.closeProposalIfDone(resolveRow.proposal_id);
    }
    if (resolveFactCheck) this.ctx.factcheck.resolveByEdit(job, resolveFactCheck, revisionRow.id);

    return this.ctx.toRevision(revisionRow);
  }

  listRevisions(uuid: string): Revision[] {
    const job = this.ctx.requireJob(uuid);
    return this.ctx.repo.listRevisions(job.id).map((row) => this.ctx.toRevision(row));
  }

  /** 渲染最新 revision。決定性的，所以重跑不會改變 content hash。 */
  render(uuid: string): RenderOutcome {
    const job = this.ctx.requireJob(uuid);
    const template = this.ctx.requireTemplate(job);
    const revisionRow = this.ctx.requireRevision(job);
    const payload = this.ctx.payloadOf(revisionRow);
    const rendered = this.ctx.renderPayload(template, payload, revisionRow.created_at);

    // 已核准就不動狀態——重新渲染是唯讀操作，不該把核准弄掉。
    const fresh = this.ctx.repo.jobById(job.id)!;
    // 只在還能改的狀態推進：CANCELLED 在轉移表裡有回 RENDERED 的邊，但那是「恢復」專用的（D-031）。
    if (
      fresh.state !== 'RENDERED' &&
      fresh.state !== 'APPROVED' &&
      isContentMutable(fresh.state) &&
      canTransition(fresh.state, 'RENDERED')
    ) {
      this.ctx.repo.updateJobState(job.id, 'RENDERED');
    }

    return {
      revisionId: revisionRow.id,
      revisionNumber: revisionRow.revision_number,
      contentHash: rendered.contentHash,
      publishHtml: rendered.result.publishHtml,
      previewDocument: buildPreviewDocument(template, rendered.result),
      sanitize: {
        changed: rendered.result.sanitizeReport.changed,
        removedTags: [...rendered.result.sanitizeReport.removedTags],
        removedAttributes: [...rendered.result.sanitizeReport.removedAttributes],
      },
      state: this.ctx.repo.jobById(job.id)!.state,
    };
  }

  /**
   * 預覽文件。載入預覽就等於「使用者看過了」，所以會把 RENDERED 推到 PREVIEWED——
   * 核准只能從 PREVIEWED 出發，人一定看過才准得了。
   */
  getPreviewDocument(uuid: string): { html: string; contentHash: string } {
    const job = this.ctx.requireJob(uuid);
    const template = this.ctx.requireTemplate(job);
    const revisionRow = this.ctx.requireRevision(job);
    const rendered = this.ctx.renderPayload(template, this.ctx.payloadOf(revisionRow), revisionRow.created_at);

    if (job.state === 'RENDERED') this.ctx.repo.updateJobState(job.id, 'PREVIEWED');

    return { html: buildPreviewDocument(template, rendered.result), contentHash: rendered.contentHash };
  }

  /** 兩個相鄰 revision 的差異，給頁邊校對符號用。 */
  getMarks(uuid: string, revisionNumber?: number): ProofMark[] {
    const job = this.ctx.requireJob(uuid);
    const revisions = this.ctx.repo.listRevisions(job.id);
    const current =
      revisionNumber === undefined
        ? revisions[revisions.length - 1]
        : revisions.find((row) => row.revision_number === revisionNumber);
    if (!current) return [];
    const previous = this.ctx.repo.previousRevision(job.id, current.revision_number);
    return computeProofMarks(previous?.rendered_html ?? null, current.rendered_html ?? '');
  }
}
