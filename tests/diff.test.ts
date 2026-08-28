import { describe, expect, it } from 'vitest';
import { computeProofMarks } from '../src/core/diff.js';
import { insertBlockAfter, removeBlocksWhere, splitTopLevelBlocks } from '../src/core/html-blocks.js';

const p = (text: string): string => `<p class="wp-block-paragraph">${text}</p>`;

describe('頂層區塊拆解', () => {
  it('每個頂層元素算一個區塊，純文字也算', () => {
    const blocks = splitTopLevelBlocks(`${p('一')}${p('二')}裸文字`);
    expect(blocks.map((block) => block.text)).toEqual(['一', '二', '裸文字']);
    expect(blocks.map((block) => block.tag)).toEqual(['p', 'p', '#text']);
  });

  it('巢狀內容不會被算成多個頂層區塊', () => {
    const blocks = splitTopLevelBlocks('<blockquote><p>一</p><p>二</p></blockquote>');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.text).toBe('一二');
  });

  it('插入位置 -1 代表放在最前面', () => {
    const html = insertBlockAfter(`${p('一')}${p('二')}`, -1, '<hr />');
    expect(splitTopLevelBlocks(html).map((b) => b.tag)).toEqual(['hr', 'p', 'p']);
  });

  it('插入位置超過長度就接在最後', () => {
    const html = insertBlockAfter(`${p('一')}${p('二')}`, 99, '<hr />');
    expect(splitTopLevelBlocks(html).map((b) => b.tag)).toEqual(['p', 'p', 'hr']);
  });

  it('移除指定區塊', () => {
    const result = removeBlocksWhere(`${p('一')}<hr class="x" />${p('二')}`, (block) => block.tag === 'hr');
    expect(result.removed).toBe(1);
    expect(splitTopLevelBlocks(result.html)).toHaveLength(2);
  });
});

describe('校對符號', () => {
  it('第一版沒有上一版可比，不產生任何符號', () => {
    expect(computeProofMarks(null, `${p('一')}${p('二')}`)).toEqual([]);
  });

  it('內容沒變就沒有符號', () => {
    const html = `${p('一')}${p('二')}`;
    expect(computeProofMarks(html, html)).toEqual([]);
  });

  it('新增一段標成 ＋，並指到新那一段的索引', () => {
    const marks = computeProofMarks(`${p('一')}${p('三')}`, `${p('一')}${p('二')}${p('三')}`);
    expect(marks).toHaveLength(1);
    expect(marks[0]).toMatchObject({ kind: 'inserted', glyph: '＋', blockIndex: 1, before: null, after: '二' });
  });

  it('刪除一段標成 －，並保留刪掉的內容給滑鼠移過去看', () => {
    const marks = computeProofMarks(`${p('一')}${p('二')}${p('三')}`, `${p('一')}${p('三')}`);
    expect(marks).toHaveLength(1);
    expect(marks[0]).toMatchObject({ kind: 'deleted', glyph: '－', before: '二', after: null });
  });

  it('改寫標成 ～，同時給改前與改後', () => {
    const marks = computeProofMarks(`${p('今天讀完這本書')}`, `${p('今天讀完了這本書')}`);
    expect(marks).toHaveLength(1);
    expect(marks[0]).toMatchObject({ kind: 'replaced', glyph: '～', before: '今天讀完這本書', after: '今天讀完了這本書' });
    expect(marks[0]!.summary).toContain('多了 1 字');
  });

  it('只補標點時說明就寫「調整標點」，不是「改寫」', () => {
    const marks = computeProofMarks(`${p('他說他會來')}`, `${p('他說，他會來。')}`);
    expect(marks).toHaveLength(1);
    expect(marks[0]!.kind).toBe('replaced');
    expect(marks[0]!.summary).toBe('調整標點');
  });

  it('段落搬家合併成一個 ⇄，不會變成一刪一增', () => {
    const before = `${p('一')}${p('二')}${p('三')}`;
    const after = `${p('二')}${p('三')}${p('一')}`;
    const marks = computeProofMarks(before, after);
    expect(marks.map((mark) => mark.kind)).toEqual(['moved']);
    expect(marks[0]).toMatchObject({ glyph: '⇄', before: '一', after: '一' });
  });

  it('符號依照目前版本的區塊順序排好，UI 才不用自己再排', () => {
    const before = `${p('一')}${p('二')}${p('三')}${p('四')}`;
    const after = `${p('一')}${p('二改')}${p('三')}${p('五')}${p('四')}`;
    const marks = computeProofMarks(before, after);
    expect(marks.map((mark) => mark.blockIndex)).toEqual([...marks.map((m) => m.blockIndex)].sort((a, b) => a - b));
    expect(marks.map((mark) => mark.kind)).toContain('replaced');
    expect(marks.map((mark) => mark.kind)).toContain('inserted');
  });

  it('整篇換掉時每一段都有符號，索引不會超出目前版本的範圍', () => {
    const marks = computeProofMarks(`${p('甲')}${p('乙')}`, `${p('丙')}${p('丁')}${p('戊')}`);
    for (const mark of marks) {
      expect(mark.blockIndex).toBeGreaterThanOrEqual(0);
      expect(mark.blockIndex).toBeLessThan(3);
    }
    expect(marks.length).toBeGreaterThan(0);
  });

  it('刪光內容時符號的索引不會變成負數', () => {
    const marks = computeProofMarks(`${p('甲')}${p('乙')}`, '');
    expect(marks).toHaveLength(2);
    for (const mark of marks) {
      expect(mark.kind).toBe('deleted');
      expect(mark.blockIndex).toBe(0);
    }
  });
});
