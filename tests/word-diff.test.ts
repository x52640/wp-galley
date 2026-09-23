import { describe, expect, it } from 'vitest';
import { computeComparison } from '../src/core/diff.js';
import { diffWords, hasWordChanges, segmentWords } from '../src/core/word-diff.js';

const p = (text: string): string => `<p class="wp-block-paragraph">${text}</p>`;

/** 把差異攤平成好讀的字串：改動的地方用括號標出來。 */
function render(before: string, after: string): string {
  return diffWords(before, after)
    .map((segment) =>
      segment.op === 'same'
        ? segment.text
        : `${segment.op === 'removed' ? '-[' : '+['}${segment.text}]`,
    )
    .join('');
}

describe('中文斷詞', () => {
  it('中文照詞切，不是照字切', () => {
    expect(segmentWords('今天讀完這本書')).toEqual(['今天', '讀完', '這本書']);
  });

  it('標點與空白保留成自己的一段，接回去等於原文', () => {
    const text = '我覺得，這樣 ok 嗎？';
    expect(segmentWords(text).join('')).toBe(text);
  });
});

describe('逐詞比對', () => {
  it('中文只標真正動到的那個詞，不會逐字爆開', () => {
    // 這是規格裡點名的反例：靠空格切詞的 diff 會把整句拆成一個一個字。
    expect(render('今天讀完了這本書', '今天讀完這本書')).toBe('今天讀完-[了]這本書');
  });

  it('錯字只標那兩個字', () => {
    expect(render('這樣做不彷試試', '這樣做不妨試試')).toBe('這樣做-[不彷]+[不妨]試試');
  });

  it('相鄰的同類改動併成一段，不留下一串碎片', () => {
    const segments = diffWords('甲乙丙丁', '戊己庚辛');
    expect(segments.map((segment) => segment.op)).toEqual(['removed', 'added']);
  });

  it('一模一樣就沒有任何改動標記', () => {
    const segments = diffWords('完全一樣的句子', '完全一樣的句子');
    expect(hasWordChanges(segments)).toBe(false);
    expect(segments.map((segment) => segment.text).join('')).toBe('完全一樣的句子');
  });

  it('中英數混排也切得開', () => {
    expect(render('版本 v1 上線', '版本 v2 上線')).toBe('版本 -[v1]+[v2] 上線');
  });

  it('左右兩欄各自接回去，等於原本的兩段文字', () => {
    const before = '第一段講的是甲，第二段講的是乙。';
    const after = '第一段講的其實是甲，第二段講的是丙。';
    const segments = diffWords(before, after);
    expect(segments.filter((s) => s.op !== 'added').map((s) => s.text).join('')).toBe(before);
    expect(segments.filter((s) => s.op !== 'removed').map((s) => s.text).join('')).toBe(after);
  });

  it('超長的一整塊不逐詞比，整段換掉就好', () => {
    const before = '甲'.repeat(4000);
    const after = '乙'.repeat(4000);
    const segments = diffWords(before, after);
    expect(segments).toEqual([
      { op: 'removed', text: before },
      { op: 'added', text: after },
    ]);
  });
});

describe('左右對照', () => {
  it('沒動到的段落兩欄都給，並標成 same', () => {
    const rows = computeComparison(`${p('一')}${p('二')}`, `${p('一')}${p('二')}`);
    expect(rows.map((row) => row.kind)).toEqual(['same', 'same']);
    expect(rows[0]!.leftIndex).toBe(0);
    expect(rows[0]!.rightIndex).toBe(0);
  });

  it('改寫過的段落配成一列，逐詞標出差異', () => {
    const rows = computeComparison(p('今天讀完了這本書'), p('今天讀完這本書'));
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.kind).toBe('replaced');
    expect(row.left!.map((s) => s.text).join('')).toBe('今天讀完了這本書');
    expect(row.right!.map((s) => s.text).join('')).toBe('今天讀完這本書');
    expect(row.right!.every((s) => s.op !== 'removed')).toBe(true);
  });

  it('新增的段落只有右欄，刪掉的只有左欄', () => {
    const rows = computeComparison(`${p('一')}`, `${p('一')}${p('二')}`);
    expect(rows.map((row) => row.kind)).toEqual(['same', 'inserted']);
    expect(rows[1]!.left).toBeNull();
    expect(rows[1]!.leftIndex).toBeNull();

    const removed = computeComparison(`${p('一')}${p('二')}`, `${p('一')}`);
    expect(removed.map((row) => row.kind)).toEqual(['same', 'deleted']);
    expect(removed[1]!.right).toBeNull();
  });

  it('文字一樣但標記被改掉，要說出來而不是看起來沒改', () => {
    const rows = computeComparison(
      '<p class="wp-block-paragraph">看<a href="https://a.test">這裡</a></p>',
      '<p class="wp-block-paragraph">看<a href="https://b.test">這裡</a></p>',
    );
    expect(rows[0]!.kind).toBe('replaced');
    expect(rows[0]!.note).toContain('標記');
    // 文字真的一樣，所以逐詞比對標不出東西——只能靠 note。
    expect(hasWordChanges(rows[0]!.left!)).toBe(false);
  });

  it('單欄用的 segments 照順序把刪掉與換上的字排在一起（D-019）', () => {
    const rows = computeComparison(
      `${p('一')}${p('今天讀完了這本書')}${p('三')}`,
      `${p('一')}${p('今天讀完這本書')}${p('三')}${p('新的')}`,
    );
    const replaced = rows.find((row) => row.kind === 'replaced')!;
    expect(replaced.segments.map((s) => `${s.op}:${s.text}`)).toEqual(['same:今天讀完', 'removed:了', 'same:這本書']);
    expect(rows.find((row) => row.kind === 'same')!.segments).toEqual([{ op: 'same', text: '一' }]);
    expect(rows.find((row) => row.kind === 'inserted')!.segments).toEqual([{ op: 'added', text: '新的' }]);
    const removed = computeComparison(`${p('一')}${p('二')}`, `${p('一')}`);
    expect(removed[1]!.segments).toEqual([{ op: 'removed', text: '二' }]);
  });

  it('對照用的索引跟校對符號是同一套（第 n 段就是第 n 個頂層區塊）', () => {
    const rows = computeComparison(`${p('一')}${p('二')}${p('三')}`, `${p('一')}${p('改過')}${p('三')}`);
    const changed = rows.find((row) => row.kind === 'replaced')!;
    expect(changed.rightIndex).toBe(1);
  });
});

describe('computeComparison：沒有文字的段落（圖片、分隔線）', () => {
  const figure = '<figure class="wp-block-image"><img src="https://example.com/a.png" alt=""></figure>';
  const p = (text: string): string => `<p>${text}</p>`;

  it('新增一張沒有圖說的圖：segments 是空的，畫面才會顯示「這一段沒有文字」', () => {
    const rows = computeComparison(p('一'), `${p('一')}${figure}`);
    const inserted = rows.find((row) => row.kind === 'inserted')!;
    expect(inserted.segments).toEqual([]);
    expect(inserted.right).toEqual([]);
  });

  it('刪掉一張沒有圖說的圖：同上', () => {
    const rows = computeComparison(`${p('一')}${figure}`, p('一'));
    const deleted = rows.find((row) => row.kind === 'deleted')!;
    expect(deleted.segments).toEqual([]);
    expect(deleted.left).toEqual([]);
  });
});
