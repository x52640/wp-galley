import { describe, expect, it } from 'vitest';
import { findIgnoringSpaces } from '../src/contract/text-match.js';
import { findBlockContaining, splitTopLevelBlocks } from '../src/core/html-blocks.js';

/**
 * P5-T001 實測：Agent 引用原文時會在中文與數字之間自己加空格
 * （寫「佔 40%」，原文是「佔40%」），逐字比對就定位不到。
 */
describe('findIgnoringSpaces', () => {
  it('Agent 多加的空格不影響比對，回傳的是原文裡的位置', () => {
    const text = '課程分成三個部分：理論基礎佔40%，案例研究佔35%。';
    const hit = findIgnoringSpaces(text, '理論基礎佔 40%，案例研究佔 35%');
    expect(hit).not.toBeNull();
    expect(text.slice(hit!.start, hit!.end)).toBe('理論基礎佔40%，案例研究佔35%');
  });

  it('原文有空格、引用沒有，也找得到，而且範圍包含原文的空格', () => {
    const text = '作者是 Richard Thaler 與 Cass Sunstein';
    const hit = findIgnoringSpaces(text, '是RichardThaler與');
    expect(text.slice(hit!.start, hit!.end)).toBe('是 Richard Thaler 與');
  });

  it('找不到回 null；只有空白的 needle 也回 null', () => {
    expect(findIgnoringSpaces('今天讀完了', '明天')).toBeNull();
    expect(findIgnoringSpaces('今天讀完了', '  ')).toBeNull();
  });
});

describe('findBlockContaining', () => {
  it('觀察引用多了空格，仍然定位到正確的段落', () => {
    const blocks = splitTopLevelBlocks('<p>第一段。</p><p>我上的2021年那一屆據說退課率特別高。</p>');
    expect(findBlockContaining(blocks, '我上的 2021 年那一屆')).toBe(1);
  });
});
