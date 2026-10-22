import { describe, expect, it } from 'vitest';

import { matchTerms, normalizeTermName } from '../src/ui/lib/term-match.js';
import type { Term } from '../src/contract/api.js';

/**
 * P5-T051（D-050）：建立新分類項目前，用已載入的清單在前端找站上名稱相近的既有項目。
 * 不另打 WordPress。
 */

const TERMS: Term[] = [
  { id: 12, name: '隨筆', slug: 'essay' },
  { id: 15, name: '經濟學', slug: 'economics' },
  { id: 16, name: 'AI 工具', slug: 'ai-tools' },
  { id: 17, name: 'Python', slug: 'python' },
  { id: 18, name: '藝術', slug: 'art' },
];

const names = (terms: readonly Term[]): string[] => terms.map((term) => term.name);

describe('normalizeTermName', () => {
  it('去頭尾空白、連續空白變一個、不分大小寫、全形轉半形', () => {
    expect(normalizeTermName('  Ａ Ｉ　　工具 ')).toBe('a i 工具');
    expect(normalizeTermName('ＰＹＴＨＯＮ')).toBe('python');
    expect(normalizeTermName('\t隨筆\n')).toBe('隨筆');
  });
});

describe('matchTerms', () => {
  it('空白或只有空白：沒有任何結果', () => {
    expect(matchTerms('', TERMS)).toEqual({ exact: null, similar: [] });
    expect(matchTerms('　 ', TERMS)).toEqual({ exact: null, similar: [] });
  });

  it('同名（大小寫、全半形、空白不同也算）：當成已存在，不放進相近清單', () => {
    expect(matchTerms('python', TERMS).exact?.id).toBe(17);
    expect(matchTerms('ＰＹＴＨＯＮ', TERMS).exact?.id).toBe(17);
    expect(matchTerms('  隨筆 ', TERMS).exact?.id).toBe(12);
    expect(matchTerms('ai　工具', TERMS).exact?.id).toBe(16);
    expect(matchTerms('python', TERMS).similar).toEqual([]);
  });

  it('打的名稱包含既有項目：列為相近', () => {
    const result = matchTerms('經濟學思考', TERMS);
    expect(result.exact).toBeNull();
    expect(names(result.similar)).toEqual(['經濟學']);
  });

  it('打的名稱被既有項目包含：列為相近', () => {
    expect(names(matchTerms('經濟', TERMS).similar)).toEqual(['經濟學']);
    expect(names(matchTerms('ＡＩ', TERMS).similar)).toEqual(['AI 工具']);
    expect(names(matchTerms('py', TERMS).similar)).toEqual(['Python']);
  });

  it('完全不相干：沒有結果', () => {
    expect(matchTerms('量子力學', TERMS)).toEqual({ exact: null, similar: [] });
  });

  it('多個相近的照原清單順序', () => {
    const terms: Term[] = [
      { id: 1, name: '讀書', slug: 'a' },
      { id: 2, name: '讀書心得', slug: 'b' },
      { id: 3, name: '雜記', slug: 'c' },
    ];
    expect(names(matchTerms('讀書心', terms).similar)).toEqual(['讀書', '讀書心得']);
    expect(names(matchTerms('雜', terms).similar)).toEqual(['雜記']);
  });
});
