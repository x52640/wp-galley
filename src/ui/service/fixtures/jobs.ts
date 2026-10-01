/** 建立與讀取稿件、取消與恢復（對應後端 `service/jobs.ts`）。 */

import { EMPTY_BODY_HTML } from '../../../contract/empty-body.js';
import { canCancel, cancelRejectedMessage, restoreStateFor } from '../../../contract/job-states.js';
import type { CreateJobInput, JobSummary, PublisherApi } from '../types.js';
import { DIARY_TARGET, LONGFORM_TARGET, PAGE_TARGET, POST_TARGET, revision } from './data.js';
import { baseArticle, baseDiary, baseLongform, store } from './store.js';
import { clone, delay, escapeText, mustGet, nextHash, syncEmptyBody, syncPlacement } from './context.js';
import { fixtureTargets } from './setup.js';

export const jobsApi: Pick<PublisherApi, 'listJobs' | 'createJob' | 'getJob' | 'cancelJob' | 'restoreJob'> = {
  async listJobs(filter) {
    await delay(120);
    const all = [...store.values()];
    const filtered = filter?.state?.length ? all.filter((j) => filter.state?.includes(j.state)) : all;
    return filtered.map<JobSummary>((job) => ({
      uuid: job.uuid,
      state: job.state,
      title: job.title,
      targetKey: job.target.key,
      templateId: job.template?.id ?? null,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      revisionCount: job.revisionCount,
      revisionNumber: job.currentRevision?.number ?? null,
      approved: job.approval?.valid === true,
      publishedId: job.published?.wordpressId ?? null,
      pendingReviewCount: job.review?.pendingCount ?? 0,
    }));
  },

  async createJob(input: CreateJobInput): Promise<{ uuid: string }> {
    await delay();
    const uuid = `f-new-${store.size + 1}`;
    const target =
      [DIARY_TARGET, LONGFORM_TARGET, POST_TARGET, PAGE_TARGET].find((item) => item.key === input.targetKey) ??
      LONGFORM_TARGET;
    // 跟後端一樣擋停用的類型（P5-T032）：畫面不給選，但示範資料也不該默默建出來。
    if (fixtureTargets().some((item) => item.key === target.key && item.disabled)) {
      throw new Error(`「${target.displayName}」已經停用，不能建新稿。要用的話到設定精靈「發到哪裡」把它打開；已經有的稿件不受影響。`);
    }
    const base =
      target.contentType === 'diary' ? baseDiary : target.contentType === 'article' ? baseArticle : baseLongform;
    const job = base(uuid, {
      state: 'SOURCE',
      title: input.title ?? null,
      target,
      marks: [],
      media: [],
      featuredMediaId: null,
      approval: null,
      published: null,
      agentRun: null,
      blockers: ['還沒渲染，先按「渲染」產生校樣'],
      sourceText: input.sourceText,
      // 原稿可以是空的（P5-T029）：跟後端一樣存成一個空段落。
      currentRevision: revision(
        1,
        'source',
        {
          title: input.title ?? '未命名',
          body: input.sourceText.trim() === '' ? EMPTY_BODY_HTML : `<p>${escapeText(input.sourceText.slice(0, 400))}</p>`,
        },
        nextHash(),
      ),
    });
    store.set(uuid, job);
    return { uuid };
  },

  async getJob(uuid: string) {
    await delay(90);
    const job = mustGet(uuid);
    syncPlacement(job);
    syncEmptyBody(job);
    return clone(job);
  },

  async cancelJob(uuid: string) {
    await delay();
    const job = mustGet(uuid);
    // 跟後端 cancelJob 同一條規則與說法（`contract/job-states.ts`，對著轉移表測過）。
    if (!canCancel(job.state)) throw new Error(cancelRejectedMessage(job.state));
    job.cancelledFrom = { state: job.state, blockers: job.blockers };
    job.state = 'CANCELLED';
    // 跟後端一樣：取消就撤銷核准。
    if (job.approval) job.approval = { ...job.approval, valid: false };
    job.blockers = ['工作項目已經是 CANCELLED，不能再發布'];
  },

  async restoreJob(uuid: string) {
    await delay();
    const job = mustGet(uuid);
    if (job.state !== 'CANCELLED') throw new Error(`只有已取消的稿件能恢復，這篇目前是 ${job.state}`);
    // 回到哪裡跟後端同一份（`contract/job-states.ts`）：APPROVED 回 RENDERED、核准不復活；記不到或回不去的回 SOURCE。
    // blockers 是示範資料自己記的（後端每次讀取時重算）。
    const from = job.cancelledFrom;
    job.state = restoreStateFor(from?.state);
    if (from?.state === 'APPROVED') job.blockers = ['還沒核准'];
    else if (from !== undefined && from.state === job.state) job.blockers = from.blockers;
    else job.blockers = ['還沒渲染，先按「渲染」產生校樣'];
    job.cancelledFrom = undefined;
  },
};
