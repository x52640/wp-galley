/**
 * 示範資料的「資料庫」：每一篇示範稿件的初始狀態，跑在記憶體裡，重新整理就回到初始值。
 */

import type { JobDetail, JobState, PublishTargetSummary, ReviewProposal } from '../types.js';
import {
  ARTICLE_BODY,
  DIARY_BODY,
  DIARY_MARKS,
  DIARY_TARGET,
  LONGFORM_BODY,
  LONGFORM_MARKS,
  LONGFORM_TARGET,
  POST_TARGET,
  TEMPLATE_SCHEMES,
  TEMPLATE_TAGS,
  diaryBriefs,
  diaryReview,
  longformBriefs,
  media,
  revision,
} from './data.js';

/** 契約的欄位都是 readonly（讀到的資料）；示範資料扮演後端，得能改自己的狀態。 */
export type Writable<T> = { -readonly [K in keyof T]: T[K] };

/** 示範資料多帶兩個欄位，因為 JobSummary 需要而 JobDetail 沒有。 */
export interface FixtureJob extends Writable<Omit<JobDetail, 'target' | 'review'>> {
  target: PublishTargetSummary;
  review: Writable<ReviewProposal> | null;
  createdAt: string;
  updatedAt: string;
  /** 取消前的狀態與 blocker（D-031）。後端記在 job_cancelled 事件裡，這裡直接掛在稿件上。 */
  cancelledFrom?: { state: JobState; blockers: string[] } | undefined;
}

export function baseDiary(uuid: string, overrides: Partial<FixtureJob>): FixtureJob {
  return {
    uuid,
    state: 'SOURCE',
    title: '20260828',
    target: DIARY_TARGET,
    template: { id: 'diary-v1', hash: '9f2c41ab7d6e0c53', strictness: 'flexible', allowedTags: TEMPLATE_TAGS, allowedSchemes: TEMPLATE_SCHEMES, titleMaxLength: 120 },
    currentRevision: revision(1, 'source', { title: '20260828', slug: '20260828', body: DIARY_BODY }, '3a91c0d4e8b25f77'),
    revisionCount: 1,
    previewUrl: `/api/jobs/${uuid}/preview`,
    marks: [],
    media: [],
    featuredMediaId: null,
    approval: null,
    blockers: [],
    published: null,
    agentRun: null,
    review: null,
    imageBriefs: [],
    bodyEmpty: false,
    sourceText: '今天讀完這本書想到很多事……',
    createdAt: '2026-08-28T09:05:00Z',
    updatedAt: '2026-08-28T09:40:00Z',
    ...overrides,
  };
}

export function baseLongform(uuid: string, overrides: Partial<FixtureJob>): FixtureJob {
  return {
    uuid,
    state: 'RENDERED',
    title: '看得見的錯誤',
    target: LONGFORM_TARGET,
    template: { id: 'longform-v1', hash: '41d7be092ca6f318', strictness: 'hybrid', allowedTags: TEMPLATE_TAGS, allowedSchemes: TEMPLATE_SCHEMES, titleMaxLength: 120 },
    currentRevision: revision(
      3,
      'agent_review',
      { title: '看得見的錯誤', slug: 'visible-mistakes', body: LONGFORM_BODY, tags: ['隨筆'] },
      'b7e4290ac1f6d835',
    ),
    revisionCount: 3,
    previewUrl: `/api/jobs/${uuid}/preview`,
    marks: LONGFORM_MARKS,
    media: [{ ...media(41, '雨天的路口'), featured: true }],
    featuredMediaId: 41,
    approval: null,
    blockers: [],
    published: null,
    agentRun: null,
    review: null,
    imageBriefs: [],
    bodyEmpty: false,
    sourceText: null,
    createdAt: '2026-08-27T14:00:00Z',
    updatedAt: '2026-08-28T10:02:00Z',
    ...overrides,
  };
}

export function baseArticle(uuid: string, overrides: Partial<FixtureJob>): FixtureJob {
  return {
    uuid,
    state: 'RENDERED',
    title: '文章要怎麼寫才不會亂',
    target: POST_TARGET,
    template: { id: 'article-v1', hash: 'c3f81d2a0b9e4476', strictness: 'hybrid', allowedTags: TEMPLATE_TAGS, allowedSchemes: TEMPLATE_SCHEMES, titleMaxLength: 200 },
    currentRevision: revision(
      1,
      'source',
      { title: '文章要怎麼寫才不會亂', body: ARTICLE_BODY, category: '教學' },
      'e1a7c9340f5d2b68',
    ),
    revisionCount: 1,
    previewUrl: `/api/jobs/${uuid}/preview`,
    marks: [],
    media: [],
    featuredMediaId: null,
    approval: null,
    blockers: ['還沒核准'],
    published: null,
    agentRun: null,
    review: null,
    imageBriefs: [],
    bodyEmpty: false,
    sourceText: '第一次架站的人最常問的問題……',
    createdAt: '2026-09-23T08:00:00Z',
    updatedAt: '2026-09-23T08:10:00Z',
    ...overrides,
  };
}

export function buildStore(): Map<string, FixtureJob> {
  const jobs: FixtureJob[] = [
    baseDiary('f-source', { state: 'SOURCE', blockers: ['還沒渲染，先按「渲染」產生校樣'] }),
    baseDiary('f-reviewed', {
      state: 'REVIEWED',
      marks: DIARY_MARKS,
      currentRevision: revision(2, 'agent_review', { title: '20260828', slug: '20260828', body: DIARY_BODY }, '5c02f7ab91de4460'),
      agentRun: {
        status: 'succeeded',
        provider: 'claude',
        task: 'review',
        briefId: null,
        startedAt: '2026-08-28T09:38:00Z',
        finishedAt: '2026-08-28T09:39:10Z',
        errorMessage: null,
      },
      review: diaryReview(),
      imageBriefs: diaryBriefs(),
      blockers: ['還有 6 項校稿建議沒處理', '還沒渲染，先按「渲染」產生校樣'],
    }),
    baseLongform('f-media', {
      state: 'MEDIA_READY',
      media: [media(41, '雨天的路口'), media(42, '回報流程圖', false)],
      featuredMediaId: null,
      imageBriefs: longformBriefs(),
      blockers: ['這個發布目標必須設定精選圖片', '還沒渲染，先按「渲染」產生校樣'],
    }),
    baseLongform('f-rendered', { state: 'RENDERED', blockers: ['還沒核准'] }),
    baseDiary('f-previewed', {
      state: 'PREVIEWED',
      marks: DIARY_MARKS,
      currentRevision: revision(2, 'agent_review', { title: '20260828', slug: '20260828', body: DIARY_BODY, category: '隨筆' }, '5c02f7ab91de4460'),
      agentRun: {
        status: 'succeeded',
        provider: 'codex',
        task: 'review',
        briefId: null,
        startedAt: '2026-08-28T09:38:00Z',
        finishedAt: '2026-08-28T09:39:02Z',
        errorMessage: null,
      },
      blockers: ['還沒核准'],
    }),
    baseLongform('f-approved', {
      state: 'APPROVED',
      approval: { id: 7, contentHash: 'b7e4290ac1f6d835'.padEnd(64, '0'), createdAt: '2026-08-28T10:20:00Z', valid: true },
      blockers: [],
    }),
    baseLongform('f-torn', {
      state: 'RENDERED',
      currentRevision: revision(
        4,
        'media',
        { title: '看得見的錯誤', slug: 'visible-mistakes', body: LONGFORM_BODY, tags: ['隨筆'] },
        'ee18c3407b9d2a61',
      ),
      approval: {
        id: 8,
        contentHash: 'b7e4290ac1f6d835'.padEnd(64, '0'),
        createdAt: '2026-08-28T10:20:00Z',
        valid: false,
      },
      blockers: ['內容改過了，核准已失效，請重新預覽並核准'],
    }),
    baseLongform('f-publishing', {
      state: 'PUBLISHING',
      approval: { id: 9, contentHash: 'b7e4290ac1f6d835'.padEnd(64, '0'), createdAt: '2026-08-28T10:20:00Z', valid: true },
      blockers: [],
    }),
    baseLongform('f-published', {
      state: 'PUBLISHED',
      approval: { id: 10, contentHash: 'b7e4290ac1f6d835'.padEnd(64, '0'), createdAt: '2026-08-28T10:20:00Z', valid: true },
      published: { wordpressId: 1783, status: 'draft', link: 'https://www.remusplus.com/?p=1783' },
      blockers: [],
    }),
    baseDiary('f-failed', {
      state: 'FAILED',
      blockers: ['遠端文章在本次載入之後被改過。請重新載入內容並重新核准，再發布一次。'],
    }),
    baseArticle('f-article', {}),
    // 已取消（D-031）：打開看得到「恢復這篇」。取消前是已核准，恢復後回到「還沒核准」。
    baseLongform('f-cancelled', {
      state: 'CANCELLED',
      approval: { id: 11, contentHash: 'b7e4290ac1f6d835'.padEnd(64, '0'), createdAt: '2026-08-28T10:20:00Z', valid: false },
      blockers: ['工作項目已經是 CANCELLED，不能再發布'],
      cancelledFrom: { state: 'APPROVED', blockers: [] },
    }),
  ];
  return new Map(jobs.map((job) => [job.uuid, job]));
}

export const store = buildStore();
