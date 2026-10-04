import { describe, expect, it } from 'vitest';

import {
  capsuleNotes,
  selectionImageBlockedReason,
  selectionImageContentHash,
  selectionImageHeading,
  selectionImageProblem,
  selectionImageSpotCount,
  selectionImageSpots,
} from '../src/ui/lib/selection-image-view.js';
import { planSelectionCheck } from '../src/ui/lib/check-while-writing.js';
import { decideProofSave } from '../src/ui/lib/write-in-place.js';
import { FACTCHECK_SELECTION_MAX } from '../src/contract/factcheck.js';
import { selectionProblem } from '../src/ui/lib/factcheck-view.js';

/** 選一段文字「用此段配圖」（D-037，P5-T038）畫面的判斷。 */

const ready = { available: true, provider: 'codex', reason: null } as const;

describe('「用此段配圖」能不能按', () => {
  it('跟「請 AI 配一張」同一套：Codex 不能用、另一個 Agent 在跑、稿件已結束都反灰並講原因', () => {
    expect(selectionImageBlockedReason({ generation: ready, running: false, finished: false })).toBeNull();
    expect(
      selectionImageBlockedReason({
        generation: { available: false, provider: 'codex', reason: '尚未登入，請執行 `codex login`' },
        running: false,
        finished: false,
      }),
    ).toContain('codex login');
    expect(selectionImageBlockedReason({ generation: ready, running: true, finished: false })).toContain('另一個 Agent');
    expect(selectionImageBlockedReason({ generation: ready, running: false, finished: true })).toContain('結束');
    expect(selectionImageBlockedReason({ generation: null, running: false, finished: false })).toContain('正在確認');
  });

  it('字數：9 反灰講太短、10 可以、3000 可以、3001 反灰講太長（不截斷）', () => {
    expect(selectionImageProblem('字'.repeat(9), null)).toContain('太短');
    expect(selectionImageProblem('字'.repeat(10), null)).toBeNull();
    expect(selectionImageProblem('字'.repeat(3000), null)).toBeNull();
    expect(selectionImageProblem('字'.repeat(3001), null)).toContain('太長');
    expect(selectionImageProblem('字'.repeat(20), '另一個在跑')).toBe('另一個在跑');
  });

  it('選了超過 300 字：「查證這句」反灰講原因，「用此段配圖」可以按', () => {
    const text = '字'.repeat(FACTCHECK_SELECTION_MAX + 1);
    const checkProblem = selectionProblem(text);
    const imageProblem = selectionImageProblem(text, null);
    expect(checkProblem).toContain('太長');
    expect(imageProblem).toBeNull();
    expect(capsuleNotes({ checkProblem, imageProblem, imageShown: true, checkNote: null })).toEqual([
      { text: checkProblem, tone: 'warn' },
    ]);
  });

  it('膠囊說明：同一個原因只講一次；不同就分別講是哪一顆；只選到標題不講配圖的', () => {
    expect(capsuleNotes({ checkProblem: 'A', imageProblem: 'A', imageShown: true, checkNote: null })).toEqual([{ text: 'A', tone: 'warn' }]);
    expect(capsuleNotes({ checkProblem: 'A', imageProblem: 'B', imageShown: true, checkNote: null })).toEqual([
      { text: '查證：A', tone: 'warn' },
      { text: '配圖：B', tone: 'warn' },
    ]);
    expect(capsuleNotes({ checkProblem: null, imageProblem: 'B', imageShown: false, checkNote: '提醒' })).toEqual([
      { text: '提醒', tone: 'info' },
    ]);
  });
});

describe('送出前的位置選項（用畫面上的正文定位）', () => {
  const texts = ['前一節最後一段。', '第二段的內容在這裡。', '第三段的內容在這裡。', '第四段的內容在這裡。'];

  it('跨三段：開頭、兩個中間、結尾', () => {
    const { spots, message } = selectionImageSpots(texts, '的內容在這裡。\n\n第三段的內容在這裡。\n\n第四段的');
    expect(message).toBeNull();
    expect(spots.map((spot) => spot.label)).toEqual([
      '這段開頭',
      '第 2 段之後：「第二段的內容在這裡。」',
      '第 3 段之後：「第三段的內容在這裡。」',
      '這段結尾',
    ]);
  });

  it('只選一段：開頭、結尾', () => {
    expect(selectionImageSpots(texts, '第三段的內容在').spots.map((spot) => spot.kind)).toEqual(['start', 'end']);
  });

  it('畫面上找不到：只剩「這段開頭」並講原因（後端再判斷）', () => {
    const { spots, message } = selectionImageSpots(texts, '不在文章裡的字');
    expect(spots.map((spot) => spot.spot)).toEqual([0]);
    expect(message).toContain('找不到');
  });

  it('面板標題：開頭十幾個字與字數', () => {
    expect(selectionImageHeading('一二三四五六七八九十一二三四五六')).toEqual({ excerpt: '一二三四五六七八九十一二三四五…', length: 16 });
  });
});

describe('打字模式：先存再送（跟「查證這句」同一套）', () => {
  const base = { bodyOriginal: '<p>原本</p>', dropped: [] as string[], force: false, titleText: '標題', titleOriginal: '標題', diary: false };

  it('有改先存一版、沒改直接送', () => {
    expect(planSelectionCheck(decideProofSave({ ...base, bodyCleaned: '<p>原本，多一句。</p>' })).kind).toBe('save-then-check');
    expect(planSelectionCheck(decideProofSave({ ...base, bodyCleaned: '<p>原本</p>' })).kind).toBe('check');
  });

  it('送出的 contentHash：打字中存過就用最後存的那一版，沒在打字用目前這一版', () => {
    expect(selectionImageContentHash({ editing: true, lastSaved: 'h2', jobHash: 'h1' })).toBe('h2');
    expect(selectionImageContentHash({ editing: true, lastSaved: null, jobHash: 'h1' })).toBe('h1');
    expect(selectionImageContentHash({ editing: false, lastSaved: 'h2', jobHash: 'h1' })).toBe('h1');
  });
});

describe('打字模式中「用這張」反灰（審查 1）', () => {
  it('打字模式講原因；不在打字模式可以按', async () => {
    const { placeBlockedWhileWriting } = await import('../src/ui/lib/check-while-writing.js');
    expect(placeBlockedWhileWriting(true)).toContain('先按「儲存」離開打字模式');
    expect(placeBlockedWhileWriting(false)).toBeNull();
  });
});

describe('送出的位置個數（審查 2）', () => {
  it('畫面上定位得到：帶位置個數；定位不到：不帶', () => {
    const texts = ['第二段的內容在這裡。', '第三段的內容在這裡。'];
    expect(selectionImageSpotCount(selectionImageSpots(texts, '的內容在這裡。\n\n第三段'))).toBe(3);
    expect(selectionImageSpotCount(selectionImageSpots(texts, '不在文章裡的字'))).toBeUndefined();
  });
});
