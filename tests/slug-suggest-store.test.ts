import { afterEach, describe, expect, it } from 'vitest';

import {
  clearSlugSuggest,
  forgetOtherSlugSuggests,
  getSlugSuggest,
  IDLE_SLUG_SUGGEST,
  startSlugSuggest,
  subscribeSlugSuggest,
  type SlugIdeas,
} from '../src/ui/lib/slug-suggest-store.js';
import { runLocksContent } from '../src/ui/lib/agent-tasks.js';

/**
 * 「建議網址」的請求與結果放在模組層級（P5-T026 審查）：抽屜（元件）在跑的時候被關掉、卸載，
 * 結果或失敗訊息照樣存得下來，重開抽屜接得回來。這裡不掛元件，直接測 store。
 */

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const IDEAS: SlugIdeas = { slugs: ['a-distant-cry-from-spring-review'], dropped: 1 };
let n = 0;
const uuid = (): string => `job-${(n += 1)}`;

afterEach(() => {
  forgetOtherSlugSuggests('__none__');
});

describe('slug-suggest-store', () => {
  it('跑的時候沒有人在看（抽屜關了），跑完的結果照樣存著，之後讀得到', async () => {
    const id = uuid();
    const pending = deferred<SlugIdeas>();
    let refreshed = 0;
    const done = startSlugSuggest(id, {
      request: () => pending.promise,
      wasCancelled: async () => false,
      describe: String,
      refresh: () => {
        refreshed += 1;
      },
    });
    expect(getSlugSuggest(id).running).toBe(true);
    expect(getSlugSuggest(id).startedAt).not.toBeNull();

    // 沒有任何訂閱者（抽屜已經卸載）。
    pending.resolve(IDEAS);
    await done;

    // 抽屜重開：讀得到候選。
    expect(getSlugSuggest(id)).toMatchObject({ running: false, ideas: IDEAS, error: null, stopped: false });
    expect(refreshed).toBe(1);
  });

  it('失敗訊息也存著，重開接得回來', async () => {
    const id = uuid();
    await startSlugSuggest(id, {
      request: () => Promise.reject(new Error('AI 沒給出能用的網址')),
      wasCancelled: async () => false,
      describe: (cause) => (cause as Error).message,
    });
    expect(getSlugSuggest(id)).toMatchObject({ running: false, ideas: null, error: 'AI 沒給出能用的網址' });
  });

  it('被停止的講「已停止」，不當成錯誤', async () => {
    const id = uuid();
    await startSlugSuggest(id, {
      request: () => Promise.reject(new Error('執行已取消')),
      wasCancelled: async () => true,
      describe: String,
    });
    expect(getSlugSuggest(id)).toMatchObject({ stopped: true, error: null });
  });

  it('同一篇在跑的時候再按不會送第二趟', async () => {
    const id = uuid();
    const pending = deferred<SlugIdeas>();
    let calls = 0;
    const deps = {
      request: () => {
        calls += 1;
        return pending.promise;
      },
      wasCancelled: async () => false,
      describe: String,
    };
    const first = startSlugSuggest(id, deps);
    await startSlugSuggest(id, deps);
    pending.resolve(IDEAS);
    await first;
    expect(calls).toBe(1);
  });

  it('通知訂閱者；取消訂閱之後不再通知', async () => {
    const id = uuid();
    let hits = 0;
    const off = subscribeSlugSuggest(() => {
      hits += 1;
    });
    await startSlugSuggest(id, { request: async () => IDEAS, wasCancelled: async () => false, describe: String });
    expect(hits).toBe(2); // 開始、結束
    off();
    clearSlugSuggest(id);
    expect(hits).toBe(2);
  });

  it('clear 收起結果；還在跑的不動', async () => {
    const id = uuid();
    const pending = deferred<SlugIdeas>();
    const done = startSlugSuggest(id, { request: () => pending.promise, wasCancelled: async () => false, describe: String });
    clearSlugSuggest(id);
    expect(getSlugSuggest(id).running).toBe(true);
    pending.resolve(IDEAS);
    await done;
    clearSlugSuggest(id);
    expect(getSlugSuggest(id)).toEqual(IDLE_SLUG_SUGGEST);
  });

  it('換篇：別篇已經結束的丟掉，還在跑的與目前這篇留著', async () => {
    const a = uuid();
    const b = uuid();
    const c = uuid();
    await startSlugSuggest(a, { request: async () => IDEAS, wasCancelled: async () => false, describe: String });
    await startSlugSuggest(c, { request: async () => IDEAS, wasCancelled: async () => false, describe: String });
    const pending = deferred<SlugIdeas>();
    const done = startSlugSuggest(b, { request: () => pending.promise, wasCancelled: async () => false, describe: String });

    forgetOtherSlugSuggests(c);
    expect(getSlugSuggest(a)).toEqual(IDLE_SLUG_SUGGEST);
    expect(getSlugSuggest(b).running).toBe(true);
    expect(getSlugSuggest(c).ideas).toEqual(IDEAS);

    pending.resolve(IDEAS);
    await done;
    expect(getSlugSuggest(b).ideas).toEqual(IDEAS);
  });
});

describe('runLocksContent：哪些 Agent 動作在跑時要鎖住會建新版本的動作', () => {
  it('校稿、一鍵配圖鎖；生圖、建議網址不鎖（跟後端 contentRunActive 一致）', () => {
    expect(runLocksContent({ status: 'running', task: 'review' })).toBe(true);
    expect(runLocksContent({ status: 'running', task: 'images' })).toBe(true);
    expect(runLocksContent({ status: 'running', task: 'generate-image' })).toBe(false);
    expect(runLocksContent({ status: 'running', task: 'suggest-slug' })).toBe(false);
    expect(runLocksContent({ status: 'succeeded', task: 'review' })).toBe(false);
    expect(runLocksContent(null)).toBe(false);
  });
});
