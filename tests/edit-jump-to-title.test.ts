import { describe, expect, it } from 'vitest';

import { locateEditCaret } from '../src/ui/lib/edit-target.js';

/**
 * P5-T031：卡片的「去原文改／自己改」游標要停在哪裡。講標題的建議（沒有段落、正文裡找不到引用的字）
 * 要跳到打字模式可編輯的標題。純函式測：只給文字節點的字，不碰 DOM、不呼叫 CLI、不連 WordPress。
 */

const BODY = ['今天讀完這本書，想到很多事。', '下午的雨下得很急。'];

describe('locateEditCaret', () => {
  it('正文找得到：照舊停在正文那個文字節點', () => {
    expect(locateEditCaret({ caret: '雨下得', blockIndex: null }, BODY, ['hello'])).toEqual({
      in: 'body',
      node: 1,
      start: 3,
      end: 6,
    });
  });

  it('沒有段落、正文找不到、標題找得到：停在標題並標那段字', () => {
    expect(locateEditCaret({ caret: 'hello', blockIndex: null }, BODY, ['hello'])).toEqual({
      in: 'title',
      node: 0,
      start: 0,
      end: 5,
    });
  });

  it('正文與標題都有：正文優先', () => {
    expect(locateEditCaret({ caret: '很多事', blockIndex: null }, BODY, ['很多事'])).toMatchObject({ in: 'body' });
  });

  it('標題裡照樣忽略空白、照樣跳過落在 after 裡的', () => {
    expect(locateEditCaret({ caret: 'hel lo', blockIndex: null }, BODY, ['  hello'])).toEqual({
      in: 'title',
      node: 0,
      start: 2,
      end: 7,
    });
    expect(
      locateEditCaret({ caret: 'hello', caretSkipInside: 'hello world', blockIndex: null }, BODY, ['hello world']),
    ).toEqual({ in: 'fallback' });
  });

  it('標題被拆成幾個文字節點：找有那段字的那一個', () => {
    expect(locateEditCaret({ caret: '暫定', blockIndex: null }, BODY, ['我的', '暫定標題'])).toEqual({
      in: 'title',
      node: 1,
      start: 0,
      end: 2,
    });
  });

  it('有指定段落：不去標題找（那一項講的是正文某段）', () => {
    expect(locateEditCaret({ caret: 'hello', blockIndex: 0 }, BODY, ['hello'])).toEqual({ in: 'fallback' });
  });

  it('兩邊都找不到、或沒有要找的字：退回原本的做法（段落或文章開頭）', () => {
    expect(locateEditCaret({ caret: '找不到', blockIndex: null }, BODY, ['hello'])).toEqual({ in: 'fallback' });
    expect(locateEditCaret({ caret: null, blockIndex: null }, BODY, ['hello'])).toEqual({ in: 'fallback' });
    expect(locateEditCaret({ caret: 'hello', blockIndex: null }, BODY, [])).toEqual({ in: 'fallback' });
  });
});
