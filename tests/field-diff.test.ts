import { describe, expect, it } from 'vitest';

import { describeMediaForDiff, diffFields } from '../src/core/field-diff.js';

/**
 * 正文以外的改動（D-019）。使用者那篇 r12 → r13 只換了封面，舊畫面卻寫「兩邊一模一樣」——
 * 對照只看正文，其他欄位改了什麼完全沒講。
 */
describe('diffFields', () => {
  const base = { title: '20260828', slug: '20260828', body: '<p>一</p>', category: '隨筆' };

  it('什麼都沒改就是空的', () => {
    expect(diffFields({ before: base, after: { ...base }, publishSlot: 'body' })).toEqual([]);
  });

  it('正文不算在這裡（正文另外逐段比）', () => {
    expect(diffFields({ before: base, after: { ...base, body: '<p>二</p>' }, publishSlot: 'body' })).toEqual([]);
  });

  it('標題、網址片段、分類用中文名稱，值照原樣給', () => {
    const changes = diffFields({
      before: base,
      after: { ...base, title: '20260829', slug: '20260829', category: '讀書' },
      publishSlot: 'body',
    });
    expect(changes).toEqual([
      { field: 'title', label: '標題', before: '20260828', after: '20260829' },
      { field: 'slug', label: '網址片段', before: '20260828', after: '20260829' },
      { field: 'category', label: '分類', before: '隨筆', after: '讀書' },
    ]);
  });

  it('標籤用頓號接起來；加上去或拿掉的一邊是 null', () => {
    const changes = diffFields({
      before: { title: 'a', body: '' },
      after: { title: 'a', body: '', tags: ['隨筆', '藝術'] },
      publishSlot: 'body',
    });
    expect(changes).toEqual([{ field: 'tags', label: '標籤', before: null, after: '隨筆、藝術' }]);

    const cleared = diffFields({
      before: { title: 'a', body: '', tags: ['隨筆'] },
      after: { title: 'a', body: '', tags: [] },
      publishSlot: 'body',
    });
    expect(cleared).toEqual([{ field: 'tags', label: '標籤', before: '隨筆', after: null }]);
  });

  it('空字串跟沒設定當成同一件事，不列出來', () => {
    expect(
      diffFields({ before: { title: 'a', slug: '' }, after: { title: 'a' }, publishSlot: 'body' }),
    ).toEqual([]);
  });

  it('認不得的欄位用欄位名當名稱，不要默默漏掉', () => {
    const changes = diffFields({ before: { title: 'a' }, after: { title: 'a', mood: '晴' }, publishSlot: 'body' });
    expect(changes).toEqual([{ field: 'mood', label: 'mood', before: null, after: '晴' }]);
  });

  it('精選圖片放在最後，給顯示用的名字不給 id', () => {
    const changes = diffFields({
      before: base,
      after: base,
      publishSlot: 'body',
      featured: { beforeId: null, afterId: 1, before: null, after: 'featured.png（預設值）' },
    });
    expect(changes).toEqual([{ field: 'featuredMedia', label: '精選圖片', before: null, after: 'featured.png（預設值）' }]);
  });

  it('精選圖片沒換（同一張）就不列，就算顯示的名字相同也看 id', () => {
    expect(
      diffFields({ before: base, after: base, publishSlot: 'body', featured: { beforeId: 3, afterId: 3, before: 'a.png', after: 'a.png' } }),
    ).toEqual([]);
    // 換了一張檔名剛好一樣的圖，還是要講。
    expect(
      diffFields({ before: base, after: base, publishSlot: 'body', featured: { beforeId: 3, afterId: 4, before: 'a.png', after: 'a.png' } }),
    ).toHaveLength(1);
  });
});

describe('describeMediaForDiff', () => {
  it('有網址就用檔名，再附上替代文字', () => {
    expect(
      describeMediaForDiff({ url: 'https://www.remusplus.com/wp-content/uploads/2026/09/featured.png', altText: '一個核取方塊' }),
    ).toBe('featured.png（一個核取方塊）');
  });

  it('檔名是網址編碼過的中文要解回來', () => {
    expect(describeMediaForDiff({ url: 'https://x.test/wp-content/uploads/%E5%B0%81%E9%9D%A2.jpg', altText: null })).toBe(
      '封面.jpg',
    );
  });

  it('還沒上傳（沒有網址）就只用替代文字', () => {
    expect(describeMediaForDiff({ url: null, altText: '雨天的路口' })).toBe('「雨天的路口」');
  });

  it('替代文字太長就截斷，摘要不能被一句話撐爆', () => {
    const text = describeMediaForDiff({ url: null, altText: '字'.repeat(80) });
    expect(text.length).toBeLessThan(40);
    expect(text).toContain('…');
  });

  it('什麼都沒有也要講得出是一張圖', () => {
    expect(describeMediaForDiff({ url: null, altText: null })).toBe('一張沒有說明的圖片');
  });
});

describe('diffFields：順序不重要的清單', () => {
  it('標籤只是換順序，不算改動（WordPress 不在意標籤順序）', () => {
    expect(
      diffFields({ before: { tags: ['a', 'b'] }, after: { tags: ['b', 'a'] }, publishSlot: 'body' }),
    ).toEqual([]);
  });

  it('標籤真的多一個，照樣列出來', () => {
    expect(
      diffFields({ before: { tags: ['a'] }, after: { tags: ['b', 'a'] }, publishSlot: 'body' }),
    ).toHaveLength(1);
  });
});
