import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { startSerialPoll } from '../src/ui/lib/serial-poll.js';

/**
 * 待同步的重讀（PR #28 第三輪 Codex P2）：每次重讀要比間隔還久時，固定間隔會一直送新的、推進世代，
 * 每個回應都被當成過期丟掉、永遠同步不了。改成一次只跑一個，上一次結束才排下一次。
 */
describe('startSerialPoll：一次只跑一個，結束才排下一次', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('立刻跑一次；每次要 4 秒、間隔 3 秒：不會疊在一起，結束 3 秒後才跑下一次', async () => {
    let running = 0;
    let maxRunning = 0;
    let started = 0;
    const stop = startSerialPoll(async () => {
      started += 1;
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((resolve) => setTimeout(resolve, 4000));
      running -= 1;
    }, 3000);
    expect(started).toBe(1);
    await vi.advanceTimersByTimeAsync(3500);
    // 第一次還在跑：不送第二個。
    expect(started).toBe(1);
    await vi.advanceTimersByTimeAsync(500); // 第一次在 4s 結束
    expect(started).toBe(1);
    await vi.advanceTimersByTimeAsync(3000); // 結束後 3 秒
    expect(started).toBe(2);
    await vi.advanceTimersByTimeAsync(7000);
    expect(started).toBe(3);
    expect(maxRunning).toBe(1);
    stop();
  });

  it('失敗（丟錯）也照樣排下一次；停掉之後不再跑', async () => {
    let started = 0;
    const stop = startSerialPoll(async () => {
      started += 1;
      throw new Error('網路斷了');
    }, 3000);
    await vi.advanceTimersByTimeAsync(3000);
    expect(started).toBe(2);
    stop();
    await vi.advanceTimersByTimeAsync(10000);
    expect(started).toBe(2);
  });

  it('跑到一半停掉：那一次結束後不再排', async () => {
    let started = 0;
    let finish!: () => void;
    const stop = startSerialPoll(() => {
      started += 1;
      return new Promise<void>((resolve) => (finish = resolve));
    }, 3000);
    stop();
    finish();
    await vi.advanceTimersByTimeAsync(10000);
    expect(started).toBe(1);
  });
});
