import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import {
  isSlugDirty,
  publishSlugView,
  slugEscapeAction,
  slugPublishBlocker,
  withSlug,
} from '../src/ui/lib/publish-slug.js';
import {
  clearSlugDraft,
  isSlugSaving,
  runSlugSave,
  runSourceSave,
  setSlugDraft,
  slugDraftFor,
  sourceSaveTouchesSlug,
  subscribeSlugSave,
  type SlugSaveSteps,
  type SyncOutcome,
} from '../src/ui/lib/slug-save-store.js';

/**
 * 發布面板的「網址」列（D-038，P5-T039）。Vitest 沒有 DOM，只測決定畫面要講什麼的純函式。
 */

describe('publishSlugView：發布面板的網址列', () => {
  it('有填網址：照實顯示、不提醒、不自動打開編輯', () => {
    const view = publishSlugView({ contentType: 'longform', slug: 'visible-mistakes', title: '看得見的錯誤', approvedNow: false });
    expect(view.value).toBe('visible-mistakes');
    expect(view.empty).toBeNull();
    expect(view.openEditor).toBe(false);
    expect(view.canSuggest).toBe(true);
  });

  it('長文沒填、中文標題：醒目提醒、講後果、當場給建議', () => {
    const view = publishSlugView({ contentType: 'longform', slug: '', title: 'AI未來已來 - 1', approvedNow: false });
    expect(view.value).toBeNull();
    expect(view.empty?.tone).toBe('warn');
    expect(view.empty?.text).toContain('WordPress 會用標題自動產生');
    expect(view.empty?.text).toContain('一長串編碼');
    expect(view.canSuggest).toBe(true);
    // 空的要能當場填：編輯列直接攤開，不用先按「改」。
    expect(view.openEditor).toBe(true);
  });

  it('一般文章沒填也一樣提醒；標題全是英數就不講編碼', () => {
    const view = publishSlugView({ contentType: 'post', slug: '', title: 'Hello World', approvedNow: false });
    expect(view.empty?.tone).toBe('warn');
    expect(view.empty?.text).toContain('WordPress 會用標題自動產生');
    expect(view.empty?.text).not.toContain('編碼');
    expect(view.canSuggest).toBe(true);
  });

  it('日記：不給建議；空的照實講會用日期標題，不當成警告', () => {
    const view = publishSlugView({ contentType: 'diary', slug: '', title: '20261004', approvedNow: false });
    expect(view.canSuggest).toBe(false);
    expect(view.empty?.tone).toBe('plain');
    expect(view.empty?.text).toContain('20261004');
    expect(view.openEditor).toBe(false);
  });

  it('日記標題不是日期：不講「網址就是日期」；中文標題照樣講會變編碼', () => {
    const view = publishSlugView({ contentType: 'diary', slug: '', title: '今天的雨', approvedNow: false });
    expect(view.canSuggest).toBe(false);
    expect(view.empty?.text).not.toContain('日期');
    expect(view.empty?.text).toContain('一長串編碼');
    expect(view.empty?.tone).toBe('warn');
  });

  it('日記有填：只顯示', () => {
    const view = publishSlugView({ contentType: 'diary', slug: '20261004', title: '20261004', approvedNow: false });
    expect(view.value).toBe('20261004');
    expect(view.canSuggest).toBe(false);
  });

  it('只有空白的網址當成沒填', () => {
    expect(publishSlugView({ contentType: 'longform', slug: '   ', title: '標題', approvedNow: false }).value).toBeNull();
  });

  it('已經核准：改之前先講改網址要重新核准；還沒核准就不講', () => {
    const approved = publishSlugView({ contentType: 'longform', slug: 'a', title: 't', approvedNow: true });
    expect(approved.approvalNote).toContain('重新核准');
    expect(publishSlugView({ contentType: 'longform', slug: 'a', title: 't', approvedNow: false }).approvalNote).toBeNull();
  });
});

describe('withSlug：發布面板存網址時組 templateData', () => {
  const data = { title: '標題', body: '<p>內文</p>', tags: ['隨筆'], slug: 'old' };

  it('換網址：其他欄位原樣帶上（templateData 是整份取代）', () => {
    expect(withSlug(data, 'new-slug')).toEqual({ title: '標題', body: '<p>內文</p>', tags: ['隨筆'], slug: 'new-slug' });
  });

  it('前後空白去掉', () => {
    expect(withSlug(data, '  new-slug ')['slug']).toBe('new-slug');
  });

  it('清空：拿掉 slug 鍵，讓 WordPress 自己產生（不送空字串）', () => {
    const next = withSlug(data, '  ');
    expect('slug' in next).toBe(false);
    expect(next['body']).toBe('<p>內文</p>');
  });

  it('沒有資料也不炸', () => {
    expect(withSlug(null, 'x')).toEqual({ slug: 'x' });
  });
});

describe('建議網址兩處共用一個元件（不複製兩份）', () => {
  const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');

  it('「標題與網址」與發布面板都從 SlugSuggest.tsx 拿，自己不再定義', () => {
    const source = read('../src/ui/components/panels/SourcePanel.tsx');
    const sheet = read('../src/ui/components/PublishSheet.tsx');
    for (const file of [source, sheet]) {
      expect(file).toMatch(/import \{[^}]*\bSlugSuggest\b[^}]*\} from '\.{1,2}\/(?:\.\.\/)?(?:components\/)?SlugSuggest\.js'/);
      expect(file).not.toMatch(/function SlugSuggest\b/);
    }
    expect(read('../src/ui/components/SlugSuggest.tsx')).toMatch(/export function SlugSuggest\b/);
  });
});

describe('網址框沒存的改動（P5-T039 審查 #1–#4）', () => {
  it('isSlugDirty：只差前後空白不算改', () => {
    expect(isSlugDirty('', '')).toBe(false);
    expect(isSlugDirty(' a ', 'a')).toBe(false);
    expect(isSlugDirty('ai-future', '')).toBe(true);
    expect(isSlugDirty('', 'old')).toBe(true);
  });

  it('#1 有沒存的網址就擋發布，講要按「存網址」或取消', () => {
    const why = slugPublishBlocker({ dirty: true, saving: false });
    expect(why).toContain('網址改了還沒存');
    expect(why).toContain('存網址');
    expect(why).toContain('取消');
  });

  it('#4 存網址中也擋發布', () => {
    expect(slugPublishBlocker({ dirty: false, saving: true })).toContain('正在存網址');
    expect(slugPublishBlocker({ dirty: true, saving: true })).toContain('正在存網址');
  });

  it('沒改、沒在存就不擋', () => {
    expect(slugPublishBlocker({ dirty: false, saving: false })).toBeNull();
  });

  it('#2 換版本時：框裡沒改動才跟已存的值同步（草稿只記在 store，面板不另存一份）', () => {
    // 別處（儲存分類）建了新版本、網址沒變：打好的字留著。
    setSlugDraft('n2-a', 'typed-slug', '');
    expect(slugDraftFor('n2-a', '')).toBe('typed-slug');
    // 網址被別處換掉、框裡沒改動（沒有草稿）：跟上新值。
    expect(slugDraftFor('n2-b', 'new')).toBe('new');
    // 框裡有改動、網址又被別處換掉：不默默蓋掉使用者打的字。
    setSlugDraft('n2-c', 'typed', 'old');
    expect(slugDraftFor('n2-c', 'new')).toBe('typed');
    // 已存的值跟上了草稿（自己存好）：草稿作廢，之後已存的再變也跟著走。
    setSlugDraft('n2-d', 'new', 'old');
    expect(slugDraftFor('n2-d', 'new')).toBe('new');
    expect(slugDraftFor('n2-d', 'newer')).toBe('newer');
  });

  it('#3 Escape：有改動只還原框內的字；按「改」打開而沒改動就收起編輯；其他照常關面板', () => {
    expect(slugEscapeAction({ dirty: true, editing: false })).toBe('revert');
    expect(slugEscapeAction({ dirty: true, editing: true })).toBe('revert');
    expect(slugEscapeAction({ dirty: false, editing: true })).toBe('close-editor');
    expect(slugEscapeAction({ dirty: false, editing: false })).toBe('close-sheet');
  });

  it('存網址中按 Escape 不關面板、也不還原（PR #25 Codex 審查 P2）', () => {
    for (const dirty of [true, false]) {
      for (const editing of [true, false]) {
        expect(slugEscapeAction({ dirty, editing, saving: true })).toBe('block');
      }
    }
  });
});

/** 測試用的存網址步驟：`save` 可以卡住，`sync` 依序回傳給定的結果，`wait` 不真的等。 */
function steps(
  outcomes: SyncOutcome[] = ['applied'],
  save: () => Promise<void> = async () => {},
): SlugSaveSteps & { syncCalls: () => number } {
  let calls = 0;
  return {
    save,
    sync: async () => {
      const outcome = outcomes[Math.min(calls, outcomes.length - 1)]!;
      calls += 1;
      return outcome;
    },
    wait: async () => {},
    syncCalls: () => calls,
  };
}

describe('存網址的進行中狀態放在模組層級（PR #25 Codex 審查 P2）', () => {
  it('面板關掉重開（元件換新）也看得到還在存，存完才放開', async () => {
    let finish!: () => void;
    const pending = runSlugSave('job-a', steps(['applied'], () => new Promise<void>((resolve) => (finish = resolve))));
    expect(isSlugSaving('job-a')).toBe(true);
    expect(isSlugSaving('job-b')).toBe(false);
    // 重開的面板拿到的是同一份狀態，發布照樣被擋。
    expect(slugPublishBlocker({ dirty: false, saving: isSlugSaving('job-a') })).toContain('正在存網址');
    finish();
    await pending;
    expect(isSlugSaving('job-a')).toBe(false);
  });

  it('同一篇在存時再按一次不會送第二趟；失敗也會放開並把錯誤丟回給呼叫端', async () => {
    let calls = 0;
    let finish!: () => void;
    const first = runSlugSave(
      'job-c',
      steps(['applied'], () => {
        calls += 1;
        return new Promise<void>((resolve) => (finish = resolve));
      }),
    );
    await runSlugSave(
      'job-c',
      steps(['applied'], async () => {
        calls += 1;
      }),
    );
    expect(calls).toBe(1);
    finish();
    await first;
    await expect(runSlugSave('job-c', steps(['applied'], () => Promise.reject(new Error('409'))))).rejects.toThrow('409');
    expect(isSlugSaving('job-c')).toBe(false);
  });

  it('狀態變了會通知訂閱者', async () => {
    let n = 0;
    const off = subscribeSlugSave(() => (n += 1));
    await runSlugSave('job-d', steps());
    off();
    // 開始、存完清草稿、放開。
    expect(n).toBeGreaterThanOrEqual(2);
  });
});

describe('發布面板沒存的網址：關掉再開還在、照樣擋發布（P5-T040 #2）', () => {
  it('有沒存的改動就記下來，重開的面板拿回來，發布照樣被擋', () => {
    setSlugDraft('draft-a', 'my-new-slug', '');
    const restored = slugDraftFor('draft-a', '');
    expect(restored).toBe('my-new-slug');
    expect(slugPublishBlocker({ dirty: isSlugDirty(restored, ''), saving: false })).toContain('還沒存');
  });

  it('換篇不帶過去：別篇拿到的是自己已存的網址', () => {
    setSlugDraft('draft-b', 'only-for-b', 'old');
    expect(slugDraftFor('draft-c', 'c-saved')).toBe('c-saved');
  });

  it('按取消（框回到已存的值）或清掉就沒了；改草稿會通知訂閱的面板', () => {
    let n = 0;
    const off = subscribeSlugSave(() => (n += 1));
    setSlugDraft('draft-d', 'typed', 'saved');
    setSlugDraft('draft-d', 'saved', 'saved');
    off();
    expect(n).toBe(2);
    expect(slugDraftFor('draft-d', 'saved')).toBe('saved');
    setSlugDraft('draft-f', 'typed', 'saved');
    clearSlugDraft('draft-f');
    expect(slugDraftFor('draft-f', 'saved')).toBe('saved');
  });
});

describe('「標題與網址」抽屜存到網址時也算「存網址進行中」（P5-T040 #3）', () => {
  it('網址有改才算', () => {
    expect(sourceSaveTouchesSlug({ slug: 'a' }, 'b')).toBe(true);
    expect(sourceSaveTouchesSlug({ slug: 'a' }, '')).toBe(true);
    expect(sourceSaveTouchesSlug({}, 'new')).toBe(true);
    expect(sourceSaveTouchesSlug({ slug: 'a' }, 'a')).toBe(false);
    expect(sourceSaveTouchesSlug(null, '')).toBe(false);
  });

  it('存的期間（含重讀）發布面板看得到在存、擋發布；存完放開', async () => {
    let finish!: () => void;
    const pending = runSourceSave('src-a', true, steps(['applied'], () => new Promise<void>((resolve) => (finish = resolve))));
    expect(isSlugSaving('src-a')).toBe(true);
    expect(slugPublishBlocker({ dirty: false, saving: isSlugSaving('src-a') })).toContain('正在存網址');
    finish();
    await pending;
    expect(isSlugSaving('src-a')).toBe(false);
  });

  it('沒改網址不登記、只重讀一次；失敗也放開、錯誤丟回去給抽屜顯示', async () => {
    let seen: boolean | null = null;
    const plain = steps(['failed'], async () => {
      seen = isSlugSaving('src-b');
    });
    await runSourceSave('src-b', false, plain);
    expect(seen).toBe(false);
    expect(plain.syncCalls()).toBe(1);
    await expect(runSourceSave('src-c', true, steps(['applied'], () => Promise.reject(new Error('409'))))).rejects.toThrow('409');
    expect(isSlugSaving('src-c')).toBe(false);
  });

  it('發布面板那邊還在存網址時不默默跳過：講出來', async () => {
    let finish!: () => void;
    const pending = runSlugSave('src-d', steps(['applied'], () => new Promise<void>((resolve) => (finish = resolve))));
    let ran = false;
    await expect(
      runSourceSave(
        'src-d',
        true,
        steps(['applied'], async () => {
          ran = true;
        }),
      ),
    ).rejects.toThrow('正在存網址');
    expect(ran).toBe(false);
    finish();
    await pending;
  });
});

describe('面板關著時存網址成功：草稿在存檔成功的路徑就清掉（PR #28 第二輪 Codex P2）', () => {
  it('存 B、關面板、存完、別處另存 C、重開：框是 C、不擋發布', async () => {
    setSlugDraft('sync-a', 'b-slug', 'a-slug');
    await runSlugSave('sync-a', steps());
    const reopened = slugDraftFor('sync-a', 'c-slug');
    expect(reopened).toBe('c-slug');
    expect(slugPublishBlocker({ dirty: isSlugDirty(reopened, 'c-slug'), saving: false })).toBeNull();
  });

  it('「標題與網址」改到網址存成功也清掉發布面板的舊草稿', async () => {
    setSlugDraft('sync-b', 'old-draft', 'a-slug');
    await runSourceSave('sync-b', true, steps());
    expect(slugDraftFor('sync-b', 'new-slug')).toBe('new-slug');
  });

  it('存失敗：草稿留著（網址就是沒存上，重開照樣擋）', async () => {
    setSlugDraft('sync-c', 'b-slug', 'a-slug');
    await expect(runSlugSave('sync-c', steps(['applied'], () => Promise.reject(new Error('409'))))).rejects.toThrow('409');
    expect(slugDraftFor('sync-c', 'a-slug')).toBe('b-slug');
  });
});

describe('PR #28 第三輪 Codex：草稿只有 store 一份、重讀沒套用不算存好', () => {
  it('#2 面板開著（訂閱 store）時另一處存網址成功：store 清掉草稿並通知，面板下一次讀到的就是新值', async () => {
    setSlugDraft('t3-a', 'b-slug', 'a-slug');
    let notified = 0;
    const off = subscribeSlugSave(() => (notified += 1));
    // 「標題與網址」存 C；存的期間面板重開，讀到的是 B（照樣擋）。
    let finish!: () => void;
    const pending = runSourceSave('t3-a', true, steps(['applied'], () => new Promise<void>((resolve) => (finish = resolve))));
    expect(slugDraftFor('t3-a', 'a-slug')).toBe('b-slug');
    finish();
    await pending;
    off();
    expect(notified).toBeGreaterThanOrEqual(2);
    // 面板沒有自己的一份：重讀之後已存的是 C，框就是 C、不擋。
    expect(slugDraftFor('t3-a', 'c-slug')).toBe('c-slug');
  });

  it('#3 存好之後重讀沒套用（失敗）：照樣「存網址進行中」、草稿不清，重試到套用才放開', async () => {
    setSlugDraft('t3-b', 'b-slug', 'a-slug');
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const waits: number[] = [];
    let syncs = 0;
    const pending = runSlugSave('t3-b', {
      save: async () => {},
      sync: async () => {
        syncs += 1;
        if (syncs === 1) return 'failed';
        await gate;
        return 'applied';
      },
      wait: async (ms) => {
        waits.push(ms);
        // 重試之間：還在存、草稿還在。
        expect(isSlugSaving('t3-b')).toBe(true);
        expect(slugDraftFor('t3-b', 'a-slug')).toBe('b-slug');
      },
    });
    await vi.waitFor(() => expect(syncs).toBe(2));
    expect(isSlugSaving('t3-b')).toBe(true);
    release();
    await pending;
    expect(waits.length).toBe(1);
    expect(isSlugSaving('t3-b')).toBe(false);
    expect(slugDraftFor('t3-b', 'b-slug')).toBe('b-slug');
    expect(slugDraftFor('t3-b', 'c-slug')).toBe('c-slug');
  });

  it('#3 工作區已經離開這一篇（gone）：不再重試、放開', async () => {
    const s = steps(['gone']);
    await runSlugSave('t3-c', s);
    expect(s.syncCalls()).toBe(1);
    expect(isSlugSaving('t3-c')).toBe(false);
  });
});
