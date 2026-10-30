/** 發布（對應後端 `service/publish.ts`）。示範資料不連 WordPress，等一下就回一個假的結果。 */

import { checkSchedule, cancelScheduleWarning } from '../../../contract/schedule.js';

import { EMPTY_BODY_MESSAGE, isBlankBody } from '../../../contract/empty-body.js';
import type { PublishInput, PublishResult, PublisherApi } from '../types.js';
import { fixtureAuthors } from './authors.js';
import { delay, mustGet } from './context.js';

export const publishApi: Pick<PublisherApi, 'publish' | 'cancelSchedule'> = {
  async publish(uuid: string, input: PublishInput): Promise<PublishResult> {
    const job = mustGet(uuid);
    if (input.status === 'future') {
      const problem = checkSchedule(input.scheduledAt);
      if (problem) throw new Error(problem);
      if (!input.confirm) throw new Error('排程發布前需要再次確認。');
    }
    if (isBlankBody(job.currentRevision?.publishHtml)) throw new Error(EMPTY_BODY_MESSAGE);
    const listed = fixtureAuthors();
    if (listed.listUnavailable && (input.authorId !== undefined || listed.defaultAuthorId !== null)) {
      throw new Error('讀不到站上的作者清單，這次沒有發布，免得作者被記成發布台的帳號；稍後再試。');
    }
    const wantedAuthor = input.authorId ?? listed.defaultAuthor?.id ?? null;
    const author = listed.authors.find((option) => option.id === wantedAuthor) ?? null;
    if (input.authorId !== undefined && author === null) {
      throw new Error(`指定的作者（第 ${input.authorId} 號使用者）不在這個站可以當作者的名單裡。這次沒有送出任何內容。`);
    }
    job.state = 'PUBLISHING';
    await delay(1500);
    const result: PublishResult = {
      wordpressId: 1800 + Math.floor(Math.random() * 90),
      status: input.status,
      dateGmt: input.status === 'future' ? input.scheduledAt! : null,
      link: `https://www.remusplus.com/${job.target.key}/${job.title ?? 'untitled'}/`,
      created: true,
      unknownTerms: [],
      fallbackBlocks: 0,
      author,
    };
    job.published = result;
    job.state = 'PUBLISHED';
    return result;
  },
  async cancelSchedule(uuid) {
    const job = mustGet(uuid);
    if (job.published?.status !== 'future') throw new Error('這篇目前沒有排程，無法取消排程。');
    const scheduledDate = job.published.dateGmt;
    await delay(500);
    job.published = { ...job.published, status: 'draft', dateGmt: null };
    return { ...job.published, publicationWarning: cancelScheduleWarning(scheduledDate) };
  },
};
