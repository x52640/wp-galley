import { describe, expect, it } from 'vitest';

import type { CompareRow, Comparison, DiffSegment } from '../src/contract/api.js';
import { buildDiffEntries, runKeyForBlock, summarizeComparison } from '../src/ui/lib/diff-view.js';

/** 對照改成 git diff 式（D-019）：只列有改的段落，沒變的收成一行。 */

function same(left: number, right: number, text = `第${right}段`): CompareRow {
  const segments: DiffSegment[] = [{ op: 'same', text }];
  return { kind: 'same', leftIndex: left, rightIndex: right, left: segments, right: segments, segments, note: null };
}

function replaced(left: number, right: number, note: string | null = null): CompareRow {
  const segments: DiffSegment[] =
    note === null
      ? [{ op: 'same', text: '今天' }, { op: 'removed', text: '了' }, { op: 'added', text: '過' }]
      : [{ op: 'same', text: '看這裡' }];
  return {
    kind: 'replaced',
    leftIndex: left,
    rightIndex: right,
    left: segments.filter((s) => s.op !== 'added'),
    right: segments.filter((s) => s.op !== 'removed'),
    segments,
    note,
  };
}

function inserted(right: number): CompareRow {
  const segments: DiffSegment[] = [{ op: 'added', text: '新的' }];
  return { kind: 'inserted', leftIndex: null, rightIndex: right, left: null, right: segments, segments, note: null };
}

function deleted(left: number): CompareRow {
  const segments: DiffSegment[] = [{ op: 'removed', text: '舊的' }];
  return { kind: 'deleted', leftIndex: left, rightIndex: null, left: segments, right: null, segments, note: null };
}

function comparison(rows: CompareRow[], overrides: Partial<Comparison> = {}): Comparison {
  return { against: 'previous', leftLabel: 'r1', rightLabel: 'r2', rows, fieldChanges: [], ...overrides };
}

describe('buildDiffEntries', () => {
  it('連續沒變的段落收成一組，標出第幾到第幾段（以目前這一版算）', () => {
    const entries = buildDiffEntries(comparison([same(0, 0), same(1, 1), replaced(2, 2), same(3, 3)]));
    expect(entries.map((entry) => entry.type)).toEqual(['unchanged', 'change', 'unchanged']);
    expect(entries[0]).toMatchObject({ first: 1, last: 2, count: 2 });
    expect(entries[2]).toMatchObject({ first: 4, last: 4, count: 1 });
  });

  it('有改的列標第幾段與種類', () => {
    const entries = buildDiffEntries(comparison([replaced(0, 0), inserted(1), deleted(1), replaced(2, 2, '換了連結')]));
    expect(entries.map((entry) => (entry.type === 'change' ? `${entry.position}/${entry.kindLabel}` : '-'))).toEqual([
      '第 1 段/改寫',
      '第 2 段/新增',
      // 跟上一版比時，刪掉的那段在目前這一版不存在，只能講它原本在哪。
      '原第 2 段/刪除',
      '第 3 段/改了標記',
    ]);
  });

  it('跟提案比時目前的文章在左邊：段號用左邊的，提案新增的段落講「提案第 n 段」', () => {
    const entries = buildDiffEntries(
      comparison([same(0, 0), replaced(1, 1), inserted(2), same(2, 3)], { against: 'proposal' }),
    );
    const labels = entries.map((entry) =>
      entry.type === 'change' ? entry.position : `${entry.first}-${entry.last}`,
    );
    expect(labels).toEqual(['1-1', '第 2 段', '提案第 3 段', '3-3']);
  });

  it('全部沒變就是一整組', () => {
    const entries = buildDiffEntries(comparison([same(0, 0), same(1, 1), same(2, 2)]));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ type: 'unchanged', first: 1, last: 3, count: 3 });
  });

  it('每一組的 key 在同一份對照裡固定，展開狀態才記得住', () => {
    const rows = [same(0, 0), replaced(1, 1), same(2, 2)];
    expect(buildDiffEntries(comparison(rows)).map((e) => e.key)).toEqual(
      buildDiffEntries(comparison(rows)).map((e) => e.key),
    );
  });
});

describe('runKeyForBlock（點卡片要展開那一段所在的那一組）', () => {
  it('段落在收起來的那一組裡就回那一組的 key', () => {
    const entries = buildDiffEntries(comparison([replaced(0, 0), same(1, 1), same(2, 2)]));
    expect(runKeyForBlock(entries, 2, 'previous')).toBe(entries[1]!.key);
  });

  it('段落本來就列出來（有改）就不用展開', () => {
    const entries = buildDiffEntries(comparison([replaced(0, 0), same(1, 1)]));
    expect(runKeyForBlock(entries, 0, 'previous')).toBeNull();
  });

  it('跟提案比時用左邊（目前的文章）的索引', () => {
    const entries = buildDiffEntries(comparison([inserted(0), same(0, 1), same(1, 2)], { against: 'proposal' }));
    expect(runKeyForBlock(entries, 1, 'proposal')).toBe(entries[1]!.key);
  });
});

describe('summarizeComparison', () => {
  it('正文沒變、只設了封面：直接講，原本沒有的用「設了」', () => {
    const text = summarizeComparison(
      comparison([same(0, 0), same(1, 1)], {
        fieldChanges: [{ field: 'featuredMedia', label: '精選圖片', before: null, after: 'featured.png' }],
      }),
    );
    expect(text).toBe('正文沒變，只設了精選圖片');
  });

  it('只改正文：改幾段、新增幾段、刪幾段，沒有的不講', () => {
    expect(summarizeComparison(comparison([replaced(0, 0), replaced(1, 1), inserted(2)]))).toBe('正文改了 2 段、新增 1 段');
    expect(summarizeComparison(comparison([deleted(0)]))).toBe('正文刪掉 1 段');
  });

  it('兩種都有：先講正文，再講其他', () => {
    const text = summarizeComparison(
      comparison([replaced(0, 0)], {
        fieldChanges: [
          { field: 'title', label: '標題', before: 'a', after: 'b' },
          { field: 'tags', label: '標籤', before: null, after: '隨筆' },
        ],
      }),
    );
    expect(text).toBe('正文改了 1 段；另外換了標題、設了標籤');
  });

  it('拿掉的用「拿掉了」', () => {
    const text = summarizeComparison(
      comparison([same(0, 0)], {
        fieldChanges: [{ field: 'featuredMedia', label: '精選圖片', before: 'a.png', after: null }],
      }),
    );
    expect(text).toBe('正文沒變，只拿掉了精選圖片');
  });

  it('什麼都沒改就說一模一樣', () => {
    expect(summarizeComparison(comparison([same(0, 0)]))).toBe('兩邊一模一樣，什麼都沒改');
  });
});
