/**
 * 核准（只有 UI 能呼叫）。
 *
 * **核准失效只有一個入口：`invalidateApproval`。** 每個會改變 content_hash 的方法都必須在寫入前呼叫它，
 * 其他模組不准自己撤銷核准。
 */

import type { Approval as ApprovalView } from '../../contract/api.js';
import { ApprovalForbiddenError, ContentChangedError, InvalidInputError, PublishBlockedError } from '../errors.js';
import type { ApprovalRow, JobRow } from '../repository.js';
import { EMPTY_BODY_MESSAGE, isBlankBody } from '../../contract/empty-body.js';
import { assertTransition } from '../state-machine.js';
import type { CoreContext } from './context.js';

export class ApprovalModule {
  constructor(private readonly ctx: CoreContext) {}

  /**
   * 建立核准。
   *
   * 三道關卡缺一不可：
   * 1. actor 必須是 'ui'——MCP 與 Agent 一律拒絕（DB 的 CHECK 是第二道）。
   * 2. 送來的 contentHash 必須等於目前 revision 的 hash——核准的是**這一版**，
   *    不是「這個 job」。
   * 3. 狀態必須能轉到 APPROVED，也就是使用者真的看過預覽。
   */
  approve(uuid: string, input: { contentHash: string; actor: 'ui' }): ApprovalView {
    const job = this.ctx.requireJob(uuid);

    if (input.actor !== 'ui') {
      this.ctx.repo.insertEvent({
        jobId: job.id,
        revisionId: null,
        approvalId: null,
        actor: 'system',
        eventType: 'approval_rejected',
        status: 'rejected',
        detail: this.ctx.scrub({ actor: input.actor }),
      });
      throw new ApprovalForbiddenError('只有本機發布台的介面能建立核准');
    }

    const revisionRow = this.ctx.requireRevision(job);
    this.ctx.assertNoAppPassword(this.ctx.payloadOf(revisionRow).templateData, revisionRow.rendered_html);
    // 空文章不給核准（P5-T029）：核准了也發不出去（發布前置檢查會再擋一次）。
    if (isBlankBody(revisionRow.rendered_html)) throw new InvalidInputError(EMPTY_BODY_MESSAGE);
    if (revisionRow.content_hash !== input.contentHash) {
      throw new ContentChangedError('內容在你按下核准之後又改過了，請重新檢查預覽再核准一次', {
        expected: revisionRow.content_hash,
        received: input.contentHash,
      });
    }

    assertTransition(job.state, 'APPROVED');

    this.ctx.repo.revokeApprovals(job.id, '重新核准');
    const approval = this.ctx.repo.insertApproval({
      jobId: job.id,
      revisionId: revisionRow.id,
      contentHash: revisionRow.content_hash,
    });
    this.ctx.repo.updateJobState(job.id, 'APPROVED');
    this.ctx.repo.insertEvent({
      jobId: job.id,
      revisionId: revisionRow.id,
      approvalId: approval.id,
      actor: 'ui',
      eventType: 'approved',
      status: 'succeeded',
    });

    return { id: approval.id, contentHash: approval.content_hash, createdAt: approval.created_at, valid: true };
  }

  /** 撤銷核准。重複呼叫是安全的（沒有有效核准就什麼都不做）。 */
  revokeApproval(uuid: string, reason: string): void {
    const job = this.ctx.requireJob(uuid);
    this.invalidateApproval(job, reason);
  }

  /**
   * 撤銷這個 job 尚未撤銷的核准，並在需要時把狀態退回 RENDERED。
   *
   * 只有這一個地方會撤銷核准；每個會改變 content_hash 的方法都必須先呼叫它。
   */
  invalidateApproval(job: JobRow, reason: string): void {
    const active = this.ctx.repo.activeApproval(job.id);
    if (!active) return;

    this.ctx.repo.revokeApprovals(job.id, reason);
    this.ctx.repo.insertEvent({
      jobId: job.id,
      revisionId: active.revision_id,
      approvalId: active.id,
      actor: 'system',
      eventType: 'approval_revoked',
      status: 'succeeded',
      detail: this.ctx.scrub({ reason }),
    });

    const fresh = this.ctx.repo.jobById(job.id)!;
    if (fresh.state === 'APPROVED') this.ctx.repo.updateJobState(job.id, 'RENDERED');
  }

  /**
   * 發布途中（PUBLISHING）確認建立發布時的那張核准還是有效的那一張（審查 #2）。
   * `revokeApproval` 不看工作狀態，PUBLISHING 期間也撤得掉；撤了之後不能再往 WordPress 寫。
   * 丟出的錯誤由 runPublish 的 catch 接住：工作轉 FAILED、記 failed 事件。
   */
  assertApprovalUnchanged(job: JobRow, approval: ApprovalRow, message: string): void {
    if (this.ctx.repo.activeApproval(job.id)?.id === approval.id) return;
    throw new PublishBlockedError(message);
  }
}
