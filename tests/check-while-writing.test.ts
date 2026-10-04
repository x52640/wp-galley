import { describe, expect, it } from 'vitest';

import {
  afterStaySave,
  beginHold,
  dropStaleFactCheck,
  editBlockedByRun,
  editBarSavedNote,
  nextSaveBase,
  selectionCheckBlockedReason,
  locateTextOffset,
  countNonSpace,
  planSelectionCheck,
  settleHold,
  syncPending,
  shownFrame,
  type ProofHold,
} from '../src/ui/lib/check-while-writing.js';
import { decideProofSave } from '../src/ui/lib/write-in-place.js';

/**
 * 改字時也能「查證這句」、查證時可以繼續寫（D-036，P6-T006）。畫面的判斷放在純函式，這裡測。
 */

describe('打字模式按「查證這句」：先存再查', () => {
  const base = {
    bodyOriginal: '<p>原本</p>',
    dropped: [] as string[],
    force: false,
    titleText: '標題',
    titleOriginal: '標題',
    diary: false,
  };

  it('沒改：直接查', () => {
    expect(planSelectionCheck(decideProofSave({ ...base, bodyCleaned: '<p>原本</p>' }))).toEqual({ kind: 'check' });
  });

  it('有改：先照「儲存」流程存一版（只送有改的那一邊），存好再查', () => {
    expect(planSelectionCheck(decideProofSave({ ...base, bodyCleaned: '<p>原本，多一句。</p>' }))).toEqual({
      kind: 'save-then-check',
      save: { editedBody: '<p>原本，多一句。</p>' },
    });
    expect(planSelectionCheck(decideProofSave({ ...base, bodyCleaned: '<p>原本</p>', titleText: '新標題' }))).toEqual({
      kind: 'save-then-check',
      save: { editedTitle: '新標題' },
    });
  });

  it('標題清空：跟存檔一樣講原因，不存也不查', () => {
    const plan = planSelectionCheck(decideProofSave({ ...base, bodyCleaned: '<p>原本</p>', titleText: '   ' }));
    expect(plan.kind).toBe('invalid-title');
  });

  it('有會被拿掉的格式：跟存檔一樣先問（按「照樣存」才存、存好才查）', () => {
    const plan = planSelectionCheck(decideProofSave({ ...base, bodyCleaned: '<p>改過</p>', dropped: ['表格'] }));
    expect(plan).toEqual({ kind: 'confirm-drop', dropped: ['表格'] });
  });
});

describe('打字中存了一版：校樣不重載（游標、捲動、打的字都留著）', () => {
  const loaded = { key: 'h1', epoch: 3 };

  it('沒有 hold：照目前的版本', () => {
    expect(shownFrame({ editing: true, hold: null, revisionKey: 'h1', renderEpoch: 3 })).toEqual(loaded);
    expect(shownFrame({ editing: false, hold: null, revisionKey: 'h2', renderEpoch: 4 })).toEqual({ key: 'h2', epoch: 4 });
  });

  it('存的請求還在路上：新版本（自己存的）回來也不重載', () => {
    const hold = beginHold(null, loaded);
    expect(shownFrame({ editing: true, hold, revisionKey: 'h2', renderEpoch: 4 })).toEqual(loaded);
  });

  it('存好了：版本是自己存的那一版就一直不重載，連存兩次也一樣', () => {
    let hold: ProofHold | null = settleHold(beginHold(null, loaded), 'h2');
    expect(shownFrame({ editing: true, hold, revisionKey: 'h2', renderEpoch: 4 })).toEqual(loaded);
    hold = settleHold(beginHold(hold, { key: 'h2', epoch: 4 }), 'h3');
    expect(shownFrame({ editing: true, hold, revisionKey: 'h3', renderEpoch: 5 })).toEqual(loaded);
  });

  it('版本換成不是自己存的（別處改了）：不再擋，照既有規則重載並講', () => {
    const hold = settleHold(beginHold(null, loaded), 'h2');
    expect(shownFrame({ editing: true, hold, revisionKey: 'h9', renderEpoch: 5 })).toEqual({ key: 'h9', epoch: 5 });
  });

  it('離開打字模式：重載成後端存好的那一版', () => {
    const hold = settleHold(beginHold(null, loaded), 'h2');
    expect(shownFrame({ editing: false, hold, revisionKey: 'h2', renderEpoch: 4 })).toEqual({ key: 'h2', epoch: 4 });
  });

  it('存失敗：第一次存就失敗的不留 hold；之前存過的照舊', () => {
    expect(settleHold(beginHold(null, loaded), null)).toBeNull();
    const held = settleHold(beginHold(null, loaded), 'h2');
    expect(settleHold(beginHold(held, { key: 'h2', epoch: 4 }), null)).toEqual(held);
  });

  it('後端說沒有新版本（整理完跟原本一樣）：hold 照留，frame 不變', () => {
    const hold = settleHold(beginHold(null, loaded), 'h1');
    expect(hold).toEqual({ ...loaded, own: ['h1'], pending: false });
    expect(shownFrame({ editing: true, hold, revisionKey: 'h1', renderEpoch: 4 })).toEqual(loaded);
  });

  it('H0 → H1 → H0（改了又改回原樣，各存一次）：整段期間 frame 都不變，不重載（審查 2）', () => {
    let hold: ProofHold | null = settleHold(beginHold(null, loaded), 'h2');
    expect(shownFrame({ editing: true, hold, revisionKey: 'h2', renderEpoch: 4 })).toEqual(loaded);
    hold = beginHold(hold, loaded);
    expect(shownFrame({ editing: true, hold, revisionKey: 'h1', renderEpoch: 5 })).toEqual(loaded);
    hold = settleHold(hold, 'h1');
    // 回到 h1，但渲染世代已經是 5：不能換成 r=5 重載。
    expect(shownFrame({ editing: true, hold, revisionKey: 'h1', renderEpoch: 5 })).toEqual(loaded);
  });

  it('查證跑完、工作區重讀：版本沒換（查證不改文章），校樣不重載', () => {
    // 查證完成只更新右欄與查證結果，contentHash 不變。
    expect(shownFrame({ editing: true, hold: null, revisionKey: 'h1', renderEpoch: 3 })).toEqual(loaded);
  });
});

describe('打字中存好之後：從卡片進來的那張只在第一次存時結案', () => {
  it('存過一次就把 itemId／factCheckId 拿掉，下一次存不再送', () => {
    const editing = { itemId: 7, factCheckId: 9, caret: '那句', blockIndex: 2, nonce: 1 };
    expect(afterStaySave(editing)).toEqual({ ...editing, itemId: null, factCheckId: null });
    expect(afterStaySave(null)).toBeNull();
  });
});

describe('什麼時候不能進打字模式（D-036：查證在跑時可以）', () => {
  it('查證在跑、查證剛送出：可以進', () => {
    expect(editBlockedByRun({ publishing: false, agentRun: { status: 'running', task: 'factcheck' } })).toBe(false);
    expect(editBlockedByRun({ publishing: false, agentRun: null })).toBe(false);
  });

  it('其他 Agent 動作在跑、發布中：照舊不能進', () => {
    for (const task of ['review', 'images', 'generate-image', 'suggest-slug']) {
      expect(editBlockedByRun({ publishing: false, agentRun: { status: 'running', task } }), task).toBe(true);
    }
    expect(editBlockedByRun({ publishing: true, agentRun: null })).toBe(true);
  });

  it('跑完的不算', () => {
    expect(editBlockedByRun({ publishing: false, agentRun: { status: 'succeeded', task: 'review' } })).toBe(false);
  });
});

describe('去原文改的那條在打字中被取代：之後存檔不再送它（審查 1）', () => {
  const editing = { itemId: null, factCheckId: 9, caret: '那句', blockIndex: 2, nonce: 1 };

  it('還是 open：原樣（同一個物件）', () => {
    expect(dropStaleFactCheck(editing, [{ id: 9, status: 'open' }])).toBe(editing);
  });

  it('不在清單裡（superseded 不列）或已經不是 open：清成 null', () => {
    expect(dropStaleFactCheck(editing, [{ id: 10, status: 'open' }])).toEqual({ ...editing, factCheckId: null });
    expect(dropStaleFactCheck(editing, [{ id: 9, status: 'dismissed' }])).toEqual({ ...editing, factCheckId: null });
  });

  it('讀不到清單、沒在改、不是從查證卡片進來：不動', () => {
    expect(dropStaleFactCheck(editing, null)).toBe(editing);
    expect(dropStaleFactCheck(null, [])).toBeNull();
    const plain = { ...editing, factCheckId: null };
    expect(dropStaleFactCheck(plain, [])).toBe(plain);
  });
});

describe('照樣存之後畫面換成存進去的樣子：游標照「前面有幾個非空白字」放回去（審查 3）', () => {
  it('落在某個文字節點裡；空白不算（整理後區塊之間會多出換行節點）', () => {
    expect(locateTextOffset(['你好嗎', '\n', '很好'], 0)).toEqual({ index: 0, offset: 0 });
    expect(locateTextOffset(['你好嗎', '\n', '很好'], 4)).toEqual({ index: 2, offset: 1 });
    expect(locateTextOffset(['a b', 'cd'], 2)).toEqual({ index: 0, offset: 3 });
  });

  it('剛好在交界：放在前一個有字的節點結尾（打字接在原本那段後面），不落在換行節點', () => {
    expect(locateTextOffset(['你好嗎', '\n', '很好'], 3)).toEqual({ index: 0, offset: 3 });
    expect(locateTextOffset(['\n', '很好'], 0)).toEqual({ index: 1, offset: 0 });
  });

  it('超出（整理掉了一些字）：放在最後一個有字節點的結尾；沒有字回 null', () => {
    expect(locateTextOffset(['你好', '很好', '\n'], 99)).toEqual({ index: 1, offset: 2 });
    expect(locateTextOffset([], 3)).toBeNull();
    expect(locateTextOffset(['\n'], 0)).toBeNull();
  });

  it('數字是非空白字數', () => {
    expect(countNonSpace('a b\n c')).toBe(3);
  });
});

describe('自動存過一版：打字模式的提示列講清楚（審查 4）', () => {
  it('存過才講，講按取消會回到哪裡', () => {
    expect(editBarSavedNote(false)).toBeNull();
    expect(editBarSavedNote(true)).toBe('已自動存一版；按取消會回到這一版');
  });
});

describe('自動存成功但工作區重讀失敗（Codex P1）：iframe 不換、下次存用存進去的那一版當基準', () => {
  const loaded = { key: 'h0', epoch: 1 };

  it('存了 H1（重讀成功）再存 H2、重讀失敗：工作區還停在 H1，frame 不變、不結束打字模式', () => {
    let hold: ProofHold | null = settleHold(beginHold(null, loaded), 'h1');
    expect(shownFrame({ editing: true, hold, revisionKey: 'h1', renderEpoch: 2 })).toEqual(loaded);
    hold = settleHold(beginHold(hold, loaded), 'h2');
    // 重讀失敗：job 還是 H1（比存檔舊的快照），不算外部改動。
    expect(shownFrame({ editing: true, hold, revisionKey: 'h1', renderEpoch: 2 })).toEqual(loaded);
    // 之後一次重讀成功、讀到 H2：照樣不換。
    expect(shownFrame({ editing: true, hold, revisionKey: 'h2', renderEpoch: 3 })).toEqual(loaded);
  });

  it('第一次自動存（H1）重讀就失敗：工作區還是 H0，frame 不變', () => {
    const hold = settleHold(beginHold(null, loaded), 'h1');
    expect(shownFrame({ editing: true, hold, revisionKey: 'h0', renderEpoch: 1 })).toEqual(loaded);
  });

  it('真的被別處改了（不是自己存過的任何一版）：照舊放掉、重載並講', () => {
    const hold = settleHold(beginHold(null, loaded), 'h1');
    expect(shownFrame({ editing: true, hold, revisionKey: 'h9', renderEpoch: 4 })).toEqual({ key: 'h9', epoch: 4 });
  });

  it('下次存的基準：有「最後一次存成功的 hash」就用它，不用可能還沒重讀到的工作區快照', () => {
    expect(nextSaveBase('h2', 'h1')).toBe('h2');
    expect(nextSaveBase(null, 'h1')).toBe('h1');
    expect(nextSaveBase(null, undefined)).toBeUndefined();
  });
});

describe('打字模式的「查證這句」：正文空不空看編輯中的內容，不看存過的（Codex P2）', () => {
  const idle = { running: false, editing: true, comparing: false, bodyEmpty: true, finished: false };

  it('空白新稿在打字模式打了第一句：不因存過的正文是空的而反灰（交給存檔與查證流程驗）', () => {
    expect(selectionCheckBlockedReason(idle)).toBeNull();
  });

  it('不在打字模式：照舊看存過的正文', () => {
    expect(selectionCheckBlockedReason({ ...idle, editing: false })).toBe('正文是空的，先寫點內容再查證');
  });

  it('其他原因照舊：另一個 AI 動作在跑、稿件已結束', () => {
    expect(selectionCheckBlockedReason({ ...idle, running: true })).toBe('另一個 AI 動作還在跑，等它跑完再查證');
    expect(selectionCheckBlockedReason({ ...idle, finished: true })).toBe('這篇稿件已經結束，不能再查證');
  });
});

describe('先存再做：動作出錯不算存檔失敗（P5-T038 審查 3）', () => {
  it('存好之後動作出錯：只講動作的錯，不走存檔失敗（不放掉 hold）', async () => {
    const { saveThenAct } = await import('../src/ui/lib/check-while-writing.js');
    const calls: string[] = [];
    await saveThenAct({
      save: async () => 'h2',
      onSaved: (hash) => calls.push(`saved:${hash}`),
      onSaveFailed: () => calls.push('save-failed'),
      act: async () => {
        throw new Error('配圖沒開始');
      },
      onActFailed: (cause) => calls.push(`act-failed:${(cause as Error).message}`),
    });
    expect(calls).toEqual(['saved:h2', 'act-failed:配圖沒開始']);
  });

  it('存檔失敗：不做動作', async () => {
    const { saveThenAct } = await import('../src/ui/lib/check-while-writing.js');
    const calls: string[] = [];
    await saveThenAct({
      save: async () => {
        throw new Error('409');
      },
      onSaved: () => calls.push('saved'),
      onSaveFailed: () => calls.push('save-failed'),
      act: () => {
        calls.push('act');
      },
      onActFailed: () => calls.push('act-failed'),
    });
    expect(calls).toEqual(['save-failed']);
  });
});

describe('自動存好但重讀失敗（P5-T040 #1）：待同步，重讀成功之前不給再進打字模式', () => {
  it('存好之後重讀失敗、離開打字模式：待同步（擋進入）；之後任何一次重讀成功就解除，不看讀到的 hash', () => {
    // 存好那一刻已經送出的重讀是第 5 個；存好之後那一個（第 6 個）失敗了，最近成功的還是第 4 個。
    expect(syncPending({ editing: false, savedAt: 5, okSeq: 4 })).toBe(true);
    // 輪詢的第 7 個成功（就算讀到的版本剛好跟進打字模式前的 H0 一模一樣，那就是伺服器的真實版本）。
    expect(syncPending({ editing: false, savedAt: 5, okSeq: 7 })).toBe(false);
  });

  it('存好之前就送出、存好之後才回來的重讀讀的是舊資料，不算同步', () => {
    expect(syncPending({ editing: false, savedAt: 5, okSeq: 5 })).toBe(true);
  });

  it('打字中不擋（打字中的基準是最後存成功的那一版）；這篇沒在打字中存過也不擋', () => {
    expect(syncPending({ editing: true, savedAt: 5, okSeq: 4 })).toBe(false);
    expect(syncPending({ editing: false, savedAt: null, okSeq: 0 })).toBe(false);
  });

  it('同步之後再進打字模式：基準就是工作區的版本（H0 還原的情境也不會拿 H1 當基準而 409）', () => {
    // 進打字模式時打字中還沒存過，lastSaved 是 null。
    expect(nextSaveBase(null, 'H0')).toBe('H0');
  });
});
