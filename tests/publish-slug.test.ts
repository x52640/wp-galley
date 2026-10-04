import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  isSlugDirty,
  nextSlugDraft,
  publishSlugView,
  slugEscapeAction,
  slugPublishBlocker,
  withSlug,
} from '../src/ui/lib/publish-slug.js';
import { isSlugSaving, runSlugSave, subscribeSlugSave } from '../src/ui/lib/slug-save-store.js';

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

  it('#2 換版本時：框裡沒改動才跟已存的值同步', () => {
    // 別處（儲存分類）建了新版本、網址沒變：打好的字留著。
    expect(nextSlugDraft('typed-slug', '', '')).toBe('typed-slug');
    // 網址被別處換掉、框裡沒改動：跟上新值。
    expect(nextSlugDraft('old', 'old', 'new')).toBe('new');
    // 自己存好：框裡就是新值。
    expect(nextSlugDraft('new', 'old', 'new')).toBe('new');
    // 框裡有改動、網址又被別處換掉：不默默蓋掉使用者打的字。
    expect(nextSlugDraft('typed', 'old', 'new')).toBe('typed');
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

describe('存網址的進行中狀態放在模組層級（PR #25 Codex 審查 P2）', () => {
  it('面板關掉重開（元件換新）也看得到還在存，存完才放開', async () => {
    let finish!: () => void;
    const pending = runSlugSave('job-a', () => new Promise<void>((resolve) => (finish = resolve)));
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
    const first = runSlugSave('job-c', () => {
      calls += 1;
      return new Promise<void>((resolve) => (finish = resolve));
    });
    await runSlugSave('job-c', async () => {
      calls += 1;
    });
    expect(calls).toBe(1);
    finish();
    await first;
    await expect(runSlugSave('job-c', () => Promise.reject(new Error('409')))).rejects.toThrow('409');
    expect(isSlugSaving('job-c')).toBe(false);
  });

  it('狀態變了會通知訂閱者', async () => {
    let n = 0;
    const off = subscribeSlugSave(() => (n += 1));
    await runSlugSave('job-d', async () => {});
    off();
    expect(n).toBe(2);
  });
});
