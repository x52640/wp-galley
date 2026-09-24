import { describe, expect, it } from 'vitest';
import {
  assertTransition,
  canTransition,
  InvalidTransitionError,
  isContentMutable,
  isTerminal,
  JOB_STATES,
  TRANSITIONS,
  type JobState,
} from '../src/core/state-machine.js';

describe('狀態機的表格', () => {
  it('每個狀態都在表格裡，沒有漏掉的', () => {
    for (const state of JOB_STATES) {
      expect(TRANSITIONS[state]).toBeDefined();
    }
  });

  it('表格裡列出的目標狀態都是合法狀態', () => {
    for (const state of JOB_STATES) {
      for (const target of TRANSITIONS[state]) {
        expect(JOB_STATES).toContain(target);
      }
    }
  });

  it('只有 APPROVED 能進入 PUBLISHING——人工核准繞不過去', () => {
    const canPublish = JOB_STATES.filter((state) => TRANSITIONS[state].includes('PUBLISHING'));
    expect(canPublish).toEqual(['APPROVED']);
  });

  it('終止狀態沒有任何出口', () => {
    for (const state of ['FAILED', 'CANCELLED', 'SUPERSEDED'] as JobState[]) {
      expect(isTerminal(state)).toBe(true);
      expect(TRANSITIONS[state]).toEqual([]);
    }
  });

  it('SOURCE 可以直接跳到 RENDERED：使用者能不用 Agent', () => {
    expect(canTransition('SOURCE', 'RENDERED')).toBe(true);
  });

  it('內容改動時 APPROVED 退得回 RENDERED', () => {
    expect(canTransition('APPROVED', 'RENDERED')).toBe(true);
  });
});

/**
 * docs/specs/state-machine.md「狀態轉移」那張表，**抄死在這裡**（審查 #16）。
 * 不能從 TRANSITIONS 反推：實作表多加一條錯的邊，反推出來的「非法清單」就跟著少一條，測試永遠綠。
 * 規格改了，這裡要跟著手改——那正是要的：改狀態機必須同時改規格與這張表。
 * 表裡沒列的 FAILED／CANCELLED／SUPERSEDED 是終止狀態（「另外三個終止狀態」），沒有出口。
 */
const SPEC_TRANSITIONS: Readonly<Record<JobState, readonly JobState[]>> = {
  SOURCE: ['REVIEWED', 'RENDERED', 'CANCELLED', 'FAILED'],
  REVIEWED: ['MEDIA_READY', 'RENDERED', 'CANCELLED', 'FAILED'],
  MEDIA_READY: ['RENDERED', 'CANCELLED', 'FAILED'],
  RENDERED: ['PREVIEWED', 'REVIEWED', 'MEDIA_READY', 'CANCELLED', 'FAILED'],
  PREVIEWED: ['APPROVED', 'RENDERED', 'CANCELLED', 'FAILED'],
  APPROVED: ['PUBLISHING', 'RENDERED', 'CANCELLED'],
  PUBLISHING: ['PUBLISHED', 'FAILED'],
  PUBLISHED: ['SUPERSEDED'],
  FAILED: [],
  CANCELLED: [],
  SUPERSEDED: [],
};

describe('實作的轉移表與規格完全一致', () => {
  it('狀態集合相同，每個狀態允許的目標集合相同（不多不少）', () => {
    expect(Object.keys(TRANSITIONS).sort()).toEqual(Object.keys(SPEC_TRANSITIONS).sort());
    expect([...JOB_STATES].sort()).toEqual(Object.keys(SPEC_TRANSITIONS).sort());
    for (const state of JOB_STATES) {
      expect([...TRANSITIONS[state]].sort(), state).toEqual([...SPEC_TRANSITIONS[state]].sort());
    }
  });
});

describe('非法轉移一律丟 InvalidTransitionError', () => {
  // 規格表之外的每一組轉移都要被擋下來，不是抽樣。答案來自 SPEC_TRANSITIONS，不是實作。
  const allPairs: [JobState, JobState][] = [];
  const legalPairs: [JobState, JobState][] = [];
  for (const from of JOB_STATES) {
    for (const to of JOB_STATES) {
      if (SPEC_TRANSITIONS[from].includes(to)) legalPairs.push([from, to]);
      else allPairs.push([from, to]);
    }
  }

  it(`規格允許的 ${legalPairs.length} 組全部通過`, () => {
    for (const [from, to] of legalPairs) {
      expect(canTransition(from, to), `${from} → ${to}`).toBe(true);
      expect(() => assertTransition(from, to)).not.toThrow();
    }
  });

  it(`共 ${allPairs.length} 組非法轉移，全部被拒絕`, () => {
    for (const [from, to] of allPairs) {
      expect(canTransition(from, to), `${from} → ${to}`).toBe(false);
      expect(() => assertTransition(from, to)).toThrow(InvalidTransitionError);
    }
  });

  it('自己轉到自己也不合法（避免重複執行同一步）', () => {
    for (const state of JOB_STATES) {
      expect(canTransition(state, state)).toBe(false);
    }
  });

  it.each([
    ['SOURCE', 'APPROVED'],
    ['SOURCE', 'PUBLISHING'],
    ['SOURCE', 'PUBLISHED'],
    ['REVIEWED', 'APPROVED'],
    ['MEDIA_READY', 'PREVIEWED'],
    ['RENDERED', 'APPROVED'],
    ['RENDERED', 'PUBLISHING'],
    ['PREVIEWED', 'PUBLISHING'],
    ['PREVIEWED', 'PUBLISHED'],
    ['APPROVED', 'PUBLISHED'],
    ['PUBLISHING', 'APPROVED'],
    ['PUBLISHED', 'PUBLISHING'],
    ['CANCELLED', 'SOURCE'],
    ['FAILED', 'PUBLISHING'],
    ['SUPERSEDED', 'RENDERED'],
  ] as [JobState, JobState][])('%s → %s 被拒絕', (from, to) => {
    expect(() => assertTransition(from, to)).toThrow(InvalidTransitionError);
  });

  it('錯誤訊息會說明目前狀態允許哪些轉移', () => {
    try {
      assertTransition('SOURCE', 'APPROVED');
      expect.unreachable('應該要丟錯');
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidTransitionError);
      const typed = error as InvalidTransitionError;
      expect(typed.from).toBe('SOURCE');
      expect(typed.to).toBe('APPROVED');
      expect(typed.message).toContain('REVIEWED');
      expect(typed.code).toBe('INVALID_TRANSITION');
    }
  });
});

describe('內容還能不能改', () => {
  it('已發布、發布中與終止狀態都不能再改內容', () => {
    // PUBLISHED 只能轉到 SUPERSEDED，沒有回 RENDERED 的路——改了內容，
    // 核准就退不回去，等於留下一個仍然有效卻對不上內容的核准。
    for (const state of ['PUBLISHED', 'PUBLISHING', 'FAILED', 'CANCELLED', 'SUPERSEDED'] as JobState[]) {
      expect(isContentMutable(state)).toBe(false);
    }
  });

  it('還在編輯途中的狀態都可以改', () => {
    for (const state of ['SOURCE', 'REVIEWED', 'MEDIA_READY', 'RENDERED', 'PREVIEWED', 'APPROVED'] as JobState[]) {
      expect(isContentMutable(state)).toBe(true);
    }
  });

  it('不可改的狀態都沒有回到 RENDERED 的路，可改的都還在流程裡', () => {
    // 這條測試綁的是「規則從轉移表推出來」，而不是某一份寫死的清單。
    for (const state of JOB_STATES) {
      if (isContentMutable(state)) {
        expect(TRANSITIONS[state].length).toBeGreaterThan(0);
      } else {
        expect(canTransition(state, 'RENDERED')).toBe(false);
      }
    }
  });
});
