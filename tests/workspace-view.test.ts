import { describe, expect, it } from 'vitest';

import {
  RUN_BLOCKED_NOTE,
  cardEditStart,
  editBlockedNote,
  findingEditStart,
  imagesHint,
  imagesNeedAttention,
  isLoadFailed,
  manualRevisionInput,
  sameBlocks,
} from '../src/ui/lib/workspace-view.js';
import { SYNC_PENDING_NOTE } from '../src/ui/lib/check-while-writing.js';
import type { FactCheckFinding, JobDetail, ReviewItem } from '../src/ui/service/types.js';

/** 工作區（P5-T045 從 Workspace 抽出）畫面上要算的東西。 */

function item(overrides: Partial<ReviewItem>): ReviewItem {
  return {
    id: 7,
    state: 'pending',
    blockIndex: 2,
    locatedText: null,
    change: { type: 'typo', before: '舊的字', after: '新的字', reason: '錯字', meaningChanged: false },
    observation: null,
    ...overrides,
  } as unknown as ReviewItem;
}

describe('進打字模式被擋住時講哪一句', () => {
  it('只有待同步講同步；AI 在跑（不管有沒有待同步）都講 AI', () => {
    expect(editBlockedNote({ runBlocked: false, pendingSync: true })).toBe(SYNC_PENDING_NOTE);
    expect(editBlockedNote({ runBlocked: true, pendingSync: true })).toBe(RUN_BLOCKED_NOTE);
    expect(editBlockedNote({ runBlocked: true, pendingSync: false })).toBe(RUN_BLOCKED_NOTE);
    expect(RUN_BLOCKED_NOTE).toBe('AI 還在處理這篇，等它跑完再改。');
  });
});

describe('剛建好的那一篇載入失敗', () => {
  const loaded = { target: {}, template: {} } as unknown as JobDetail;
  const orphan = { target: null, template: null } as unknown as JobDetail;
  it('讀不到（有錯誤、沒稿件）或發布目標不在了才算', () => {
    expect(isLoadFailed({ error: '讀不到', job: null })).toBe(true);
    expect(isLoadFailed({ error: null, job: orphan })).toBe(true);
    expect(isLoadFailed({ error: null, job: null })).toBe(false);
    expect(isLoadFailed({ error: null, job: loaded })).toBe(false);
    // 有稿件時的重讀失敗不算（頂端報錯，稿件還在）。
    expect(isLoadFailed({ error: '重讀失敗', job: loaded })).toBe(false);
  });
});

describe('校樣量到的區塊有沒有變', () => {
  it('段數一樣、每段字一樣才算沒變（只比字）', () => {
    const a = [
      { index: 0, text: '一' },
      { index: 1, text: '二' },
    ];
    expect(sameBlocks(a, [...a])).toBe(true);
    expect(sameBlocks(a, [{ index: 5, text: '一' }, { index: 6, text: '二' }])).toBe(true);
    expect(sameBlocks(a, [{ index: 0, text: '一' }])).toBe(false);
    expect(sameBlocks(a, [{ index: 0, text: '一' }, { index: 1, text: '三' }])).toBe(false);
    expect(sameBlocks([], [])).toBe(true);
  });
});

describe('右欄圖片區', () => {
  const base = {
    imageBriefs: [] as { fulfilled: boolean }[],
    featuredMediaId: null as number | null,
    media: [] as unknown[],
    target: { requireFeaturedImage: false },
  };
  const job = (overrides: Partial<typeof base>) => ({ ...base, ...overrides }) as unknown as Parameters<typeof imagesHint>[0];

  it('缺封面優先講；再來是待處理的配圖張數；都沒有就講有幾張，零張不講', () => {
    expect(imagesHint(job({ target: { requireFeaturedImage: true }, imageBriefs: [{ fulfilled: false }] }))).toBe('還缺封面圖');
    expect(imagesHint(job({ imageBriefs: [{ fulfilled: false }, { fulfilled: true }, { fulfilled: false }] }))).toBe(
      '配圖 2 張待處理',
    );
    expect(imagesHint(job({ media: [{}, {}] }))).toBe('2 張');
    expect(imagesHint(job({}))).toBe('');
    // 規定要封面、已經有了：不算缺。
    expect(imagesHint(job({ target: { requireFeaturedImage: true }, featuredMediaId: 3 }))).toBe('');
  });

  it('有沒完成的配圖、或缺封面才自己展開', () => {
    expect(imagesNeedAttention(job({}))).toBe(false);
    expect(imagesNeedAttention(job({ media: [{}] }))).toBe(false);
    expect(imagesNeedAttention(job({ imageBriefs: [{ fulfilled: true }] }))).toBe(false);
    expect(imagesNeedAttention(job({ imageBriefs: [{ fulfilled: false }] }))).toBe(true);
    expect(imagesNeedAttention(job({ target: { requireFeaturedImage: true } }))).toBe(true);
    expect(imagesNeedAttention(job({ target: { requireFeaturedImage: true }, featuredMediaId: 1 }))).toBe(false);
  });
});

describe('從卡片進打字模式', () => {
  it('「改原文」：游標在文章開頭、不講話', () => {
    expect(cardEditStart(null, 42)).toEqual({
      notice: null,
      request: { itemId: null, factCheckId: null, caret: null, caretSkipInside: null, blockIndex: null, nonce: 42 },
    });
  });

  it('找得到的建議：游標停在原句前面，落在改好的字裡不算', () => {
    const entry = cardEditStart(item({ locatedText: '舊 的字' }), 1);
    expect(entry.notice).toBeNull();
    expect(entry.request).toEqual({
      itemId: 7,
      factCheckId: null,
      caret: '舊 的字',
      caretSkipInside: '新的字',
      blockIndex: 2,
      nonce: 1,
    });
  });

  it('找不到原句的（unappliable）：游標不定位，明講找不到、放在哪一段開頭', () => {
    const entry = cardEditStart(item({ state: 'unappliable' }), 1);
    expect(entry.notice).toBe('文章裡找不到「舊的字」，游標放在第 3 段開頭。找到那句直接改，改完按儲存。');
    expect(entry.request.caret).toBeNull();
    expect(entry.request.blockIndex).toBe(2);
    expect(cardEditStart(item({ state: 'unappliable', blockIndex: null }), 1).notice).toContain('游標放在文章開頭');
  });

  it('已經處理過的卡片字上標不出來：游標退回引用的那句', () => {
    const entry = cardEditStart(item({ state: 'accepted' as ReviewItem['state'] }), 1);
    expect(entry.notice).toBeNull();
    expect(entry.request.caret).toBe('舊的字');
  });

  it('觀察卡片：引用 excerpt，沒有 after', () => {
    const entry = cardEditStart(
      item({ change: null, observation: { kind: 'fact', excerpt: '那一句' } as unknown as ReviewItem['observation'] }),
      1,
    );
    expect(entry.request.caret).toBe('那一句');
    expect(entry.request.caretSkipInside).toBeNull();
  });

  it('查證卡片「去原文改」：游標停在那句，存檔後那條結案', () => {
    const finding = { id: 12, excerpt: '1994 年上映', blockIndex: 4 } as unknown as FactCheckFinding;
    expect(findingEditStart(finding, 9)).toEqual({ itemId: null, factCheckId: 12, caret: '1994 年上映', blockIndex: 4, nonce: 9 });
  });
});

describe('在文章上改完存檔送出去的內容', () => {
  it('只送有改的那一邊，帶存檔基準', () => {
    expect(manualRevisionInput({ editedBody: '<p>新</p>', editedTitle: undefined, from: null, base: 'h1' })).toEqual({
      editedBody: '<p>新</p>',
      origin: 'manual',
      reason: '直接在文章上改',
      expectedContentHash: 'h1',
    });
    expect(manualRevisionInput({ editedBody: undefined, editedTitle: '新標題', from: null, base: undefined })).toEqual({
      editedTitle: '新標題',
      origin: 'manual',
      reason: '直接在文章上改',
    });
  });

  it('從卡片進來的一起結案；只改標題也算；什麼都沒改就不結案', () => {
    const from = { itemId: 3, factCheckId: 8 };
    expect(manualRevisionInput({ editedBody: undefined, editedTitle: 'T', from, base: 'h' })).toMatchObject({
      resolveItemId: 3,
      resolveFactCheckId: 8,
    });
    const nothing = manualRevisionInput({ editedBody: undefined, editedTitle: undefined, from, base: 'h' });
    expect(nothing).not.toHaveProperty('resolveItemId');
    expect(nothing).not.toHaveProperty('resolveFactCheckId');
    const plain = manualRevisionInput({ editedBody: 'b', editedTitle: undefined, from: { itemId: null, factCheckId: null }, base: 'h' });
    expect(plain).not.toHaveProperty('resolveItemId');
    expect(plain).not.toHaveProperty('resolveFactCheckId');
  });

  it('欄位順序跟搬出來之前一樣', () => {
    const input = manualRevisionInput({ editedBody: 'b', editedTitle: 't', from: { itemId: 1, factCheckId: 2 }, base: 'h' });
    expect(Object.keys(input)).toEqual([
      'editedBody',
      'editedTitle',
      'origin',
      'reason',
      'resolveItemId',
      'resolveFactCheckId',
      'expectedContentHash',
    ]);
  });
});
