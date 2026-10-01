/** 校稿、一鍵配圖、建議網址、停止（對應後端 `service/agent.ts`）。 */

import { EMPTY_BODY_AGENT_MESSAGE, isBlankBody } from '../../../contract/empty-body.js';
import { pickSlugSuggestions } from '../../../contract/slug.js';
import { pendingReviewBlocker } from '../../../contract/review-state.js';
import type { AgentReviewInput, AgentRunResult, PublisherApi, SlugSuggestionRequest, SlugSuggestionResponse } from '../types.js';
import { diaryBriefs, diaryReview } from './data.js';
import { clone, delay, mustGet } from './context.js';

/**
 * 假的「AI 建議的網址」（D-026）：照標題挑一組，故意混一個不合格的，走跟後端同一套篩選
 * （`pickSlugSuggestions`）。`&slug=none` 模擬一個合格的都沒有。
 */
function fixtureSlugIdeas(title: string): string[] {
  if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('slug') === 'none') {
    return ['Yuan_Shan', '遠山的呼喚'];
  }
  if (title.includes('遠山的呼喚')) {
    return ['a-distant-cry-from-spring-review', 'A_Distant_Cry', 'a-distant-cry-from-spring', 'yamada-distant-cry-from-spring'];
  }
  if (title.includes('看得見的錯誤')) return ['visible-mistakes', 'Seeing_Errors', 'mistakes-you-can-see', 'on-seeing-our-errors'];
  if (title.includes('文章要怎麼寫')) return ['how-to-structure-writing', 'writing-without-mess', 'organize-your-article'];
  return ['new-article', 'notes-on-this-topic', 'thoughts-and-notes'];
}

export const agentApi: Pick<PublisherApi, 'runAgent' | 'suggestSlugs' | 'cancelAgent'> = {
  /**
   * 校稿。**內容一個字都不動**——結果存成待處理清單，等使用者逐項決定。
   * 核准因此也不會失效，這正是提案制跟「直接落地」的差別。
   */
  async runAgent(uuid: string, input: AgentReviewInput): Promise<AgentRunResult> {
    const job = mustGet(uuid);
    if (isBlankBody(job.currentRevision?.publishHtml)) throw new Error(EMPTY_BODY_AGENT_MESSAGE);
    const task = input.task ?? 'review';
    const startedAt = new Date().toISOString();
    job.agentRun = {
      status: 'running',
      provider: input.provider,
      task,
      briefId: null,
      startedAt,
      finishedAt: null,
      errorMessage: null,
    };
    // 真的 Agent 要跑幾十秒到幾分鐘。示範資料等久一點，才練得到「執行中」的畫面。
    await delay(task === 'images' ? 2600 : 3400);
    job.agentRun = {
      status: 'succeeded',
      provider: input.provider,
      task,
      briefId: null,
      startedAt,
      finishedAt: new Date().toISOString(),
      errorMessage: null,
    };

    // 配圖那一趟不建提案，所以按「一鍵配圖」不會洗掉還沒清完的校稿清單。
    if (task === 'images') {
      // 跟後端同一套（P5-T027）：同 key 覆蓋，但使用者改過的描述保留、候選圖在比例沒變時留著；
      // 這趟沒提到的（含使用者自己請 AI 配的）照舊留著。
      const proposed = diaryBriefs();
      const previous = new Map(job.imageBriefs.map((brief) => [brief.key, brief]));
      const merged = proposed.map((brief) => {
        const old = previous.get(brief.key);
        if (old === undefined) return brief;
        if (!old.promptEdited) return { ...brief, id: old.id, fulfilled: old.fulfilled };
        return {
          ...brief,
          id: old.id,
          fulfilled: old.fulfilled,
          prompt: old.prompt,
          promptEdited: true,
          candidate: old.aspectRatio === brief.aspectRatio ? old.candidate : null,
        };
      });
      const proposedKeys = new Set(proposed.map((brief) => brief.key));
      job.imageBriefs = [...merged, ...job.imageBriefs.filter((brief) => !proposedKeys.has(brief.key))];
      return {
        runId: 'fixture-run',
        status: 'succeeded',
        summary: '兩個配圖建議',
        changes: [],
        observations: [],
        // 後端回的是 Agent 交回來的原樣（還沒有 id），不是存進去之後的樣子。
        imageBriefs: proposed.map((brief) => ({
          key: brief.key,
          purpose: brief.purpose,
          prompt: brief.prompt,
          aspectRatio: brief.aspectRatio,
          altText: brief.altText,
          ...(brief.caption === null ? {} : { caption: brief.caption }),
          ...(brief.placement === null ? {} : { placement: brief.placement }),
          ...(brief.anchor === null ? {} : { anchor: brief.anchor }),
        })),
        task,
        review: clone(job.review),
      };
    }

    if (job.state === 'SOURCE') job.state = 'REVIEWED';
    job.review = { ...diaryReview(), provider: input.provider };
    job.blockers = [pendingReviewBlocker(job.review.pendingCount)];
    return {
      runId: 'fixture-run',
      status: 'succeeded',
      summary: job.review.summary,
      changes: job.review.items.flatMap((item) => (item.change ? [item.change] : [])),
      observations: job.review.items.flatMap((item) => (item.observation ? [item.observation] : [])),
      imageBriefs: [],
      task,
      review: clone(job.review),
    };
  },

  async suggestSlugs(uuid: string, input: SlugSuggestionRequest): Promise<SlugSuggestionResponse> {
    const job = mustGet(uuid);
    if (job.target?.contentType === 'diary') throw new Error('日記的網址是日期（YYYYMMDD），不用 AI 建議');
    if (job.agentRun?.status === 'running') throw new Error('這個工作項目已經有一個 Agent 在跑了，先取消或等它跑完');
    const data = job.currentRevision?.templateData ?? {};
    const title = typeof data['title'] === 'string' ? data['title'] : (job.title ?? '');
    const startedAt = new Date().toISOString();
    job.agentRun = {
      status: 'running',
      provider: input.provider,
      task: 'suggest-slug',
      briefId: null,
      startedAt,
      finishedAt: null,
      errorMessage: null,
    };
    // 不動 templateData、不建版本、不動核准：跟後端一樣只回候選。
    await delay(2600);
    if (job.agentRun.status === 'cancelled') throw new Error('執行已取消');
    const picked = pickSlugSuggestions(fixtureSlugIdeas(title));
    if (picked.slugs.length === 0) {
      const message = `AI 沒給出能用的網址（給了 ${picked.dropped} 個，格式都不合格）。再按一次試試，或自己填。`;
      job.agentRun = { ...job.agentRun, status: 'failed', finishedAt: new Date().toISOString(), errorMessage: message };
      throw new Error(message);
    }
    job.agentRun = { ...job.agentRun, status: 'succeeded', finishedAt: new Date().toISOString() };
    return picked;
  },

  async cancelAgent(uuid: string) {
    await delay(100);
    const job = mustGet(uuid);
    if (job.agentRun) job.agentRun = { ...job.agentRun, status: 'cancelled' };
  },
};
