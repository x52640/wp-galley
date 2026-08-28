import { describe, expect, it } from 'vitest';
import {
  assertTransition,
  canTransition,
  InvalidTransitionError,
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

describe('非法轉移一律丟 InvalidTransitionError', () => {
  // 表格之外的每一組轉移都要被擋下來，不是抽樣。
  const allPairs: [JobState, JobState][] = [];
  for (const from of JOB_STATES) {
    for (const to of JOB_STATES) {
      if (!TRANSITIONS[from].includes(to)) allPairs.push([from, to]);
    }
  }

  it(`共 ${allPairs.length} 組非法轉移，全部被拒絕`, () => {
    for (const [from, to] of allPairs) {
      expect(canTransition(from, to)).toBe(false);
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
