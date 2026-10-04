import { describe, expect, it } from 'vitest';

import { runLocksContent, taskLocksContent } from '../src/contract/agent-run.js';
import {
  AUTO_FEATURE_AGENT_RUNNING,
  AUTO_PLACE_AGENT_RUNNING,
  placeByAnchor,
  replacedResult,
} from '../src/contract/auto-place.js';
import { briefEditFieldError, BRIEF_PROMPT_MAX, checkBriefPrompt } from '../src/contract/brief-prompt.js';
import { isOpenJobState, RESTORABLE_STATES, restoreStateFor } from '../src/contract/job-states.js';
import { positionAnchor } from '../src/contract/position-anchor.js';
import { countOpenReviewItems, isOpenReviewState, pendingReviewBlocker } from '../src/contract/review-state.js';
import { checkUserNote, USER_NOTE_MAX } from '../src/contract/user-note.js';
import { JOB_STATES } from '../src/contract/api.js';
import { positionAnchor as corePositionAnchor } from '../src/core/image-generation.js';
import { canTransition, TRANSITIONS } from '../src/core/state-machine.js';

/**
 * 從示範資料抽出來、前後端共用的規則（P5-T033）。後端照舊的行為由各自的整合測試守著
 * （image-anchor、image-at-position、restore-cancelled、edit-image-brief、disable-targets…）；
 * 這裡守純函式本身，以及「後端用的就是這一份」。
 */

describe('照錨點自動放（placeByAnchor）', () => {
  const agent = { origin: 'agent' as const, anchorPosition: 'after' as const };
  const user = { origin: 'user' as const, anchorPosition: 'before' as const };

  it('剛好一段對得上：放在那段之後', () => {
    const decision = placeByAnchor({ ...agent, anchor: '雨天' }, () => [2]);
    expect(decision).toEqual({
      place: true,
      afterBlockIndex: 2,
      result: { outcome: 'placed', message: '已放進正文第 3 段之後。', afterBlockIndex: 2 },
    });
  });

  it('before：放在那段之前；第 0 段之前是文章最前面', () => {
    const decision = placeByAnchor({ ...user, anchor: '第一段' }, () => [0]);
    expect(decision.place).toBe(true);
    expect(decision.result).toEqual({ outcome: 'placed', message: '已放進正文最前面。', afterBlockIndex: -1 });
  });

  it('沒有錨點：不找、不放，講 AI 沒指定（使用者的講前後沒字）', () => {
    let called = false;
    const find = (): number[] => {
      called = true;
      return [];
    };
    const ai = placeByAnchor({ ...agent, anchor: '  ' }, find);
    expect(called).toBe(false);
    expect(ai.place).toBe(false);
    expect(ai.result.outcome).toBe('not-found');
    expect(ai.result.message).toBe(
      '找不到建議的位置，請自己放：AI 沒有指定要放在哪一段。在文章段落之間按「在這裡插圖」，或用圖片的「插入位置」選。',
    );
    expect(placeByAnchor({ ...user, anchor: null }, find).result.message).toContain('找不到你選的位置，請自己放：你選的位置前後都沒有文字可以對照。');
  });

  it('錨點去頭尾之後才找', () => {
    let seen = '';
    placeByAnchor({ ...agent, anchor: '  雨天  ' }, (anchor) => {
      seen = anchor;
      return [1];
    });
    expect(seen).toBe('雨天');
  });

  it('找不到、不只一段：不放，講引用的那句', () => {
    expect(placeByAnchor({ ...agent, anchor: '雨天' }, () => []).result).toEqual({
      outcome: 'not-found',
      message: '找不到建議的位置，請自己放：AI 引用的「雨天」在目前的文章裡找不到（可能改過了）。在文章段落之間按「在這裡插圖」，或用圖片的「插入位置」選。',
      afterBlockIndex: null,
    });
    const ambiguous = placeByAnchor({ ...user, anchor: '晚安' }, () => [1, 4]);
    expect(ambiguous.place).toBe(false);
    expect(ambiguous.result.outcome).toBe('ambiguous');
    expect(ambiguous.result.message).toContain('你選的位置後面那段「晚安」在文章裡出現在 2 段，不確定是哪一段。');
  });

  it('換一張與 AI 在跑的固定說法', () => {
    expect(replacedResult(-1).message).toBe('已換掉正文裡原本那張（文章最前面）。舊圖拿出正文了，還留在媒體庫。');
    expect(replacedResult(3)).toEqual({
      outcome: 'replaced',
      message: '已換掉正文裡原本那張（第 4 段之後）。舊圖拿出正文了，還留在媒體庫。',
      afterBlockIndex: 3,
    });
    expect(AUTO_PLACE_AGENT_RUNNING.outcome).toBe('agent-running');
    expect(AUTO_PLACE_AGENT_RUNNING.afterBlockIndex).toBeNull();
    expect(AUTO_FEATURE_AGENT_RUNNING.outcome).toBe('agent-running');
  });
});

describe('Agent 動作會不會鎖住內容', () => {
  it('校稿、一鍵配圖、讀不到的會鎖；生圖、建議網址、查證不會（D-036）', () => {
    expect(taskLocksContent('review')).toBe(true);
    expect(taskLocksContent('images')).toBe(true);
    expect(taskLocksContent(undefined)).toBe(true);
    expect(taskLocksContent('generate-image')).toBe(false);
    expect(taskLocksContent('suggest-slug')).toBe(false);
    expect(taskLocksContent('factcheck')).toBe(false);
  });

  it('只有正在跑的才算', () => {
    expect(runLocksContent({ status: 'running', task: 'review' })).toBe(true);
    expect(runLocksContent({ status: 'succeeded', task: 'review' })).toBe(false);
    expect(runLocksContent({ status: 'running', task: 'generate-image' })).toBe(false);
    expect(runLocksContent({ status: 'running', task: 'factcheck' })).toBe(false);
    expect(runLocksContent(null)).toBe(false);
  });
});

describe('待處理清單還有幾項', () => {
  it('pending 與 unappliable 算沒處理完', () => {
    expect(isOpenReviewState('pending')).toBe(true);
    expect(isOpenReviewState('unappliable')).toBe(true);
    expect(isOpenReviewState('applied')).toBe(false);
    expect(isOpenReviewState('skipped')).toBe(false);
    expect(countOpenReviewItems([{ state: 'pending' }, { state: 'applied' }, { state: 'unappliable' }, { state: 'skipped' }])).toBe(2);
    expect(pendingReviewBlocker(3)).toBe('還有 3 項校稿建議沒處理');
  });
});

describe('恢復已取消的稿件回到哪裡', () => {
  it('APPROVED 回 RENDERED，其他能回的照原樣', () => {
    expect(restoreStateFor('APPROVED')).toBe('RENDERED');
    expect(restoreStateFor('PREVIEWED')).toBe('PREVIEWED');
    expect(restoreStateFor('REVIEWED')).toBe('REVIEWED');
  });

  it('記不到、認不得、轉移表不允許的回 SOURCE', () => {
    expect(restoreStateFor(null)).toBe('SOURCE');
    expect(restoreStateFor(undefined)).toBe('SOURCE');
    expect(restoreStateFor(42)).toBe('SOURCE');
    expect(restoreStateFor('NOPE')).toBe('SOURCE');
    expect(restoreStateFor('PUBLISHED')).toBe('SOURCE');
    expect(restoreStateFor('PUBLISHING')).toBe('SOURCE');
    expect(restoreStateFor('FAILED')).toBe('SOURCE');
  });

  it('能回的清單就是狀態機 CANCELLED 那一列，每個結果都是合法轉移', () => {
    expect(TRANSITIONS.CANCELLED).toBe(RESTORABLE_STATES);
    for (const state of JOB_STATES) expect(canTransition('CANCELLED', restoreStateFor(state))).toBe(true);
  });

  it('進行中的稿件：沒發布、沒取消、沒被取代（FAILED 算）', () => {
    expect(JOB_STATES.filter((state) => !isOpenJobState(state))).toEqual(['PUBLISHED', 'CANCELLED', 'SUPERSEDED']);
    expect(isOpenJobState('FAILED')).toBe(true);
  });
});

describe('卡片上改配圖需求', () => {
  it('Agent 的只能改 prompt，使用者的只能改 note', () => {
    expect(briefEditFieldError('agent', { prompt: 'x' })).toBeNull();
    expect(briefEditFieldError('agent', { note: 'x' })).toBe('這條是 AI 建議的：能改的是畫面描述（prompt）');
    expect(briefEditFieldError('agent', { prompt: 'x', note: null })).not.toBeNull();
    expect(briefEditFieldError('user', { note: null })).toBeNull();
    expect(briefEditFieldError('user', { prompt: 'x', note: 'y' })).toContain('能改的是「想要什麼樣的圖」那句（note）');
    expect(briefEditFieldError('user', {})).not.toBeNull();
  });

  it('畫面描述：去頭尾、不能空、有上限', () => {
    expect(checkBriefPrompt('  雨天 \n 路口 ')).toEqual({ ok: true, prompt: '雨天 \n 路口' });
    expect(checkBriefPrompt('   ')).toEqual({ ok: false, message: '畫面描述不能是空的' });
    expect(checkBriefPrompt('字'.repeat(BRIEF_PROMPT_MAX))).toMatchObject({ ok: true });
    expect(checkBriefPrompt('字'.repeat(BRIEF_PROMPT_MAX + 1))).toEqual({ ok: false, message: `畫面描述最多 ${BRIEF_PROMPT_MAX} 個字` });
  });

  it('想要什麼樣的圖：摺疊空白、空的算沒寫、有上限', () => {
    expect(checkUserNote('  水彩 \n 風 ')).toEqual({ ok: true, note: '水彩 風' });
    expect(checkUserNote('   ')).toEqual({ ok: true, note: null });
    expect(checkUserNote(undefined)).toEqual({ ok: true, note: null });
    expect(checkUserNote('😀'.repeat(USER_NOTE_MAX))).toMatchObject({ ok: true });
    expect(checkUserNote('字'.repeat(USER_NOTE_MAX + 1))).toEqual({ ok: false, message: `想要什麼樣的圖，最多 ${USER_NOTE_MAX} 個字` });
  });
});

describe('請 AI 配一張的錨點（positionAnchor）', () => {
  it('後端轉出的就是共用契約那一份', () => {
    expect(corePositionAnchor).toBe(positionAnchor);
  });

  it('前面那段有字就引用它；沒有就引用後面那段、放在它之前', () => {
    const blocks = [{ text: '第一段文字' }, { text: '' }, { text: '第三段文字' }];
    expect(positionAnchor(blocks, 0)).toEqual({ anchor: '第一段文字', position: 'after' });
    expect(positionAnchor(blocks, 1)).toEqual({ anchor: '第三段文字', position: 'before' });
    expect(positionAnchor([{ text: '' }], 0)).toEqual({ anchor: null, position: 'after' });
  });
});
