import { describe, expect, it } from 'vitest';

import {
  capsuleNotes,
  selectionImageBlockedReason,
  selectionImageContentHash,
  selectionImageHeading,
  selectionImageProblem,
  refreshStillCurrent,
  selectionPickStale,
  stillOnJob,
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

describe('面板標題', () => {
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

describe('面板開著時文章被別處改了：關掉請重選（Codex 審查 P2）', () => {
  it('版本換成別處改的才算；自己這次打字中存的、正在送出時的都不算', () => {
    const base = { spotsHash: 'h1', currentHash: 'h1', openedKey: 'h1', currentKey: 'h1', own: [] as string[], sending: false };
    expect(selectionPickStale(base)).toBe(false);
    expect(selectionPickStale({ ...base, currentKey: 'h2' })).toBe(true);
    expect(selectionPickStale({ ...base, currentKey: 'h2', own: ['h2'] })).toBe(false);
    expect(selectionPickStale({ ...base, currentKey: 'h2', sending: true })).toBe(false);
  });

  it('位置選項來源那一版已經不是畫面知道的目前版本：過時（後端算的選項只對那一版有效）', () => {
    const base = { spotsHash: 'h1', currentHash: 'h1', openedKey: 'k', currentKey: 'k', own: [] as string[], sending: false };
    expect(selectionPickStale({ ...base, currentHash: 'h2' })).toBe(true);
    // 還在載入選項（還沒有 spotsHash）不算。
    expect(selectionPickStale({ ...base, spotsHash: null, currentHash: 'h2' })).toBe(false);
  });
});

describe('重讀綁住發起的那一篇（第二輪審查）', () => {
  it('最新一次、而且還在同一篇才寫進畫面', () => {
    const base = { alive: true, mine: 3, latest: 3, current: 'a', origin: 'a' };
    expect(refreshStillCurrent(base)).toBe(true);
    expect(refreshStillCurrent({ ...base, latest: 4 })).toBe(false);
    // 舊篇的 refresh 剛好是最後送出的那一個：世代對、篇不對，照樣丟掉。
    expect(refreshStillCurrent({ ...base, current: 'b' })).toBe(false);
    expect(refreshStillCurrent({ ...base, alive: false })).toBe(false);
  });
});

describe('送出後換到別篇：不動畫面（Codex 審查 P2）', () => {
  it('還在發起的那一篇才更新', () => {
    expect(stillOnJob({ alive: true, current: 'a', origin: 'a' })).toBe(true);
    expect(stillOnJob({ alive: true, current: 'b', origin: 'a' })).toBe(false);
    expect(stillOnJob({ alive: false, current: 'a', origin: 'a' })).toBe(false);
  });
});

describe('舊篇的 refresh 不得推進世代（第三輪審查）', () => {
  it('換到 B 之後，A 的舊 refresh 不開始、世代不動；B 第一次載入的回應照樣寫得進畫面', async () => {
    const { beginRefresh, refreshStillCurrent } = await import('../src/ui/lib/selection-image-view.js');
    // B 第一次載入開始：世代 5 → 6。
    let generation = 5;
    const bMine = beginRefresh({ generation, current: 'b', origin: 'b' })!;
    generation = bMine;
    // A 的舊 refresh（例如「請 AI 配一張」完成後才跑）在這時被叫到：不開始、世代不動。
    expect(beginRefresh({ generation, current: 'b', origin: 'a' })).toBeNull();
    // B 的回應回來：仍是最新一次、仍在 B → 寫進畫面（不會卡在「載入稿件…」）。
    expect(refreshStillCurrent({ alive: true, mine: bMine, latest: generation, current: 'b', origin: 'b' })).toBe(true);
  });
});
