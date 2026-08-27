import { describe, expect, it } from 'vitest';
import { computeRevisionHash, canonicalizeRevision } from '../src/core/content-hash.js';

const base = {
  templateId: 'diary-v1',
  templateHash: 'a'.repeat(64),
  publishHtml: '<p>內文</p>',
  fields: { title: '20260522', slug: '20260522' },
};

describe('revision hash', () => {
  it('同樣的輸入永遠得到同樣的 hash', () => {
    expect(computeRevisionHash(base)).toBe(computeRevisionHash(base));
    expect(computeRevisionHash(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('欄位順序不影響 hash', () => {
    const reordered = { ...base, fields: { slug: '20260522', title: '20260522' } };
    expect(computeRevisionHash(reordered)).toBe(computeRevisionHash(base));
  });

  it('巢狀物件的鍵值順序也不影響', () => {
    const a = { ...base, fields: { meta: { x: 1, y: 2 } } };
    const b = { ...base, fields: { meta: { y: 2, x: 1 } } };
    expect(computeRevisionHash(a)).toBe(computeRevisionHash(b));
  });

  it('陣列順序會影響——標籤順序是有意義的', () => {
    const a = { ...base, fields: { tags: ['甲', '乙'] } };
    const b = { ...base, fields: { tags: ['乙', '甲'] } };
    expect(computeRevisionHash(a)).not.toBe(computeRevisionHash(b));
  });

  it.each([
    ['正文', { publishHtml: '<p>改過</p>' }],
    ['標題', { fields: { title: '改過', slug: '20260522' } }],
    ['模板', { templateId: 'longform-v1' }],
    ['模板版本', { templateHash: 'b'.repeat(64) }],
  ])('%s 改動就會產生不同的 hash——核准因此失效', (_label, patch) => {
    expect(computeRevisionHash({ ...base, ...patch })).not.toBe(computeRevisionHash(base));
  });

  it('canonical 字串可以直接比對，方便除錯', () => {
    expect(canonicalizeRevision(base)).toContain('"title":"20260522"');
  });
});
