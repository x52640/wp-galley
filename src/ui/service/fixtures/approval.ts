/** 核准、撤銷（對應後端 `service/approval.ts`；內容一改就撕核准的 `invalidateApproval` 在 context.ts）。 */

import { EMPTY_BODY_MESSAGE, isBlankBody } from '../../../contract/empty-body.js';
import type { Approval, PublisherApi } from '../types.js';
import { delay, mustGet } from './context.js';

export const approvalApi: Pick<PublisherApi, 'approve' | 'revokeApproval'> = {
  async approve(uuid: string, contentHash: string): Promise<Approval> {
    await delay(320);
    const job = mustGet(uuid);
    if (isBlankBody(job.currentRevision?.publishHtml)) throw new Error(EMPTY_BODY_MESSAGE);
    const approval: Approval = {
      id: Math.floor(Math.random() * 900) + 100,
      contentHash,
      createdAt: new Date().toISOString(),
      valid: true,
    };
    job.approval = approval;
    job.state = 'APPROVED';
    job.blockers = [];
    return approval;
  },

  async revokeApproval(uuid: string, _reason: string) {
    await delay();
    const job = mustGet(uuid);
    if (job.approval) job.approval = { ...job.approval, valid: false };
    job.state = 'RENDERED';
    job.blockers = ['還沒核准'];
  },
};
