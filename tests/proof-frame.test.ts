import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import type { ProofMark } from '../src/contract/api-compare.js';
import { blockSnippet, groupMarks, insertSlots, settleHeight } from '../src/ui/lib/proof-frame.js';
import {
  clickedMarkKey,
  highlightGroup,
  highlightKey,
  highlightStyle,
  type MarkLike,
  type ProofHighlight,
} from '../src/ui/lib/proof-highlights.js';

/**
 * 校樣本體（P5-T043 從 ProofView 抽出 `useProofFrame`、`MarkPin`、`InsertSlots`）：量測、插圖位置、頁邊符號分組、
 * 字上標記的樣式與點擊對應。
 */

describe('settleHeight：iframe 該設多高', () => {
  it('內容沒超出：用量到的', () => {
    expect(settleHeight(800, 600, 600)).toBe(800);
  });

  it('內容比 iframe 目前還高：至少用 scrollHeight，不裁掉', () => {
    expect(settleHeight(800, 900, 850)).toBe(900);
    expect(settleHeight(950, 900, 850)).toBe(950);
  });

  it('只差不到 4px：維持目前高度，不來回跳', () => {
    expect(settleHeight(797, 800, 800)).toBe(800);
  });

  it('差 4px 以上：縮回量到的高度', () => {
    expect(settleHeight(796, 800, 800)).toBe(796);
  });
});

describe('blockSnippet：區塊的摘要字', () => {
  it('空白攤平、去頭尾', () => {
    expect(blockSnippet('  第一行\n\n  第二行  ')).toBe('第一行 第二行');
  });

  it('最多 40 字', () => {
    expect(blockSnippet('字'.repeat(50))).toHaveLength(40);
  });

  it('沒有文字：空字串', () => {
    expect(blockSnippet(null)).toBe('');
  });
});

describe('insertSlots：段落之間插圖的位置', () => {
  it('沒有區塊：沒有位置', () => {
    expect(insertSlots([])).toEqual([]);
  });

  it('最前面、兩段之間的中間、最後面', () => {
    const blocks = [
      { index: 1, top: 200, height: 40, text: 'b' },
      { index: 0, top: 100, height: 60, text: 'a' },
    ];
    expect(insertSlots(blocks)).toEqual([
      { after: -1, y: 82 },
      { after: 0, y: 180 },
      { after: 1, y: 258 },
    ]);
  });

  it('不改動傳進來的陣列', () => {
    const blocks = [
      { index: 1, top: 200, height: 40, text: 'b' },
      { index: 0, top: 100, height: 60, text: 'a' },
    ];
    insertSlots(blocks);
    expect(blocks.map((block) => block.index)).toEqual([1, 0]);
  });
});

describe('groupMarks：頁邊符號依段落分組', () => {
  const mark = (blockIndex: number, summary: string): ProofMark => ({
    blockIndex,
    kind: 'replaced',
    glyph: '～',
    summary,
    before: null,
    after: null,
  });

  it('段落由上到下，同一段照原本順序', () => {
    const groups = groupMarks([mark(3, 'a'), mark(1, 'b'), mark(3, 'c')]);
    expect(groups.map((group) => [group.blockIndex, group.marks.map((m) => m.summary)])).toEqual([
      [1, ['b']],
      [3, ['a', 'c']],
    ]);
  });

  it('沒有符號：空的', () => {
    expect(groupMarks([])).toEqual([]);
  });
});

describe('highlightStyle：字上標記的樣式', () => {
  it('校稿：實線底線，屬性照設定順序', () => {
    const style = highlightStyle('typo', false);
    expect(Object.keys(style)).toEqual(['background', 'color', 'borderBottom', 'borderRadius', 'cursor']);
    expect(style.borderBottom).toBe('2px solid #C2410C');
  });

  it('查證：虛線底線（text-decoration），不用下框線', () => {
    const style = highlightStyle('factcheck', false);
    expect(style.textDecoration).toBe('underline dashed #3730A3');
    expect(style.borderBottom).toBeUndefined();
  });

  it('亮著的那一個多一圈外框，顏色跟線同色', () => {
    const style = highlightStyle('fact', true);
    expect(style.outline).toBe('2px solid #1E4F8A');
    expect(style.outlineOffset).toBe('2px');
    expect(highlightStyle('fact', false).outline).toBeUndefined();
  });

  it('查證自成一組，校稿四種同一組', () => {
    expect(highlightGroup('factcheck')).toBe('factcheck');
    expect(highlightGroup('style')).toBe('review');
  });
});

describe('highlightKey：清單內容沒變就不重標', () => {
  const base: ProofHighlight = { id: 'r1', kind: 'typo', text: '很多事', blockIndex: 2 };

  it('內容一樣、陣列不同：同一個 key', () => {
    expect(highlightKey([{ ...base }])).toBe(highlightKey([{ ...base }]));
  });

  it('字、段落或種類一變：key 不同', () => {
    const key = highlightKey([base]);
    expect(highlightKey([{ ...base, text: '很多事情' }])).not.toBe(key);
    expect(highlightKey([{ ...base, blockIndex: null }])).not.toBe(key);
    expect(highlightKey([{ ...base, kind: 'style' }])).not.toBe(key);
  });
});

describe('clickedMarkKey：點了文章裡的哪一個標記', () => {
  /** 假的節點：`closest` 從自己往上找第一個 `<mark data-hl>`。 */
  const node = (hl: string | null, text: string, parent: MarkLike | null = null): MarkLike => {
    const self: MarkLike = {
      getAttribute: (name) => (name === 'data-hl' ? hl : null),
      textContent: text,
      parentElement: parent,
      closest: (selector) => {
        expect(selector).toBe('mark[data-hl]');
        if (hl !== null) return self;
        return parent?.closest?.(selector) ?? null;
      },
    };
    return self;
  };

  it('沒點到標記：null', () => {
    expect(clickedMarkKey(node(null, '一般的字'), null)).toBeNull();
    expect(clickedMarkKey(null, null)).toBeNull();
  });

  it('落點沒有 closest（文字節點之類）：null', () => {
    expect(clickedMarkKey({ getAttribute: () => null, textContent: '', parentElement: null }, null)).toBeNull();
  });

  it('點在標記裡的字：那個標記', () => {
    const mark = node('r9002', '我在那裡站了');
    expect(clickedMarkKey(node(null, '站', mark), null)).toBe('r9002');
  });

  it('查證包在校稿裡、範圍一樣：先亮內層，已經亮著再點換外層', () => {
    const outer = node('r9202', '只花了五千美元');
    const inner = node('f4', '只花了五千美元', outer);
    expect(clickedMarkKey(inner, null)).toBe('f4');
    expect(clickedMarkKey(inner, 'f4')).toBe('r9202');
    expect(clickedMarkKey(inner, 'r9202')).toBe('f4');
  });

  it('外層比較長：一律回點到的內層', () => {
    const outer = node('r1', '只花了五千美元就買下');
    const inner = node('f1', '五千美元', outer);
    expect(clickedMarkKey(inner, 'f1')).toBe('f1');
  });
});

describe('校樣本體的 effect 順序（P5-T043）', () => {
  // React 照呼叫順序跑 effect。抽出前 ProofView 的 effect 依序是：渲染世代 →（打字模式）→ 示範資料抓校樣 → 換版本清空 → 問 ETag →
  // ResizeObserver 收尾 → 捲到清單點的段落 → 標記 → 捲到點的標記 →（進出編輯）→（選字膠囊）→ 收掉插圖面板 → 插圖面板捲進畫面。
  const frame = readFileSync(new URL('../src/ui/lib/use-proof-frame.ts', import.meta.url), 'utf8');
  const insert = readFileSync(new URL('../src/ui/components/InsertSlots.tsx', import.meta.url), 'utf8');
  const view = readFileSync(new URL('../src/ui/components/ProofView.tsx', import.meta.url), 'utf8');
  const order = (source: string, needles: string[]): number[] => needles.map((needle) => source.indexOf(needle));
  const increasing = (positions: number[]): void => {
    expect(positions.every((at) => at >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  };

  it('useProofMeasure 只有渲染世代一個 effect，useProofFrame 七個、照原本的順序', () => {
    const split = frame.indexOf('export function useProofFrame(');
    expect(frame.slice(0, split).match(/\buseEffect\(/g)).toHaveLength(1);
    expect(frame.slice(split).match(/\buseEffect\(/g)).toHaveLength(7);
    increasing(
      order(frame, [
        "if (jobState === 'RENDERED') setRenderEpoch",
        'export function useProofFrame(',
        '.fetchPreview(job.uuid)',
        'edit.abandonOnNewVersion();',
        '.fetchPreviewHash(job.uuid)',
        'observerRef.current?.disconnect(), []',
        'top: Math.max(offset + focused.top - 96, 0)',
        'applyHighlights(doc, highlights, activeHighlight, mode)',
        'top: Math.max(offset + top - 160, 0)',
      ]),
    );
  });

  it('ProofView 只剩進出編輯一個 effect，插圖的 hook 在選字膠囊之後', () => {
    expect(view.match(/\buseEffect\(/g)).toHaveLength(1);
    increasing(order(view, ['useProofFrame({', 'edit.syncEditing();', 'useSelectionActions({', 'useInsertSlots({']));
  });

  it('插圖的兩個 effect：先收掉面板，再捲進畫面', () => {
    expect(insert.match(/\buseEffect\(/g)).toHaveLength(2);
    increasing(order(insert, ['if (!canInsert) setInserting(null);', 'popRef.current?.scrollIntoView(']));
  });
});
