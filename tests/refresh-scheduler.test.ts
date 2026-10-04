import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createRefreshScheduler, type ReadResult } from '../src/ui/lib/refresh-scheduler.js';
import { isSlugSaving, runSlugSave, setSlugDraft, slugDraftFor } from '../src/ui/lib/slug-save-store.js';

/**
 * 工作區的重讀排程（PR #28 第四輪 Codex P2）：查證中的輪詢、待同步的重試、存網址後的重讀走同一個排程，
 * 同時最多一個重讀在飛，上一個結束才排下一個；卸載／換篇時等著的立刻以 gone 收尾。
 */

/** 假的後端重讀：每次花 `ms`，回傳 applied（可以中途改成 failed 或卡住）。記錄同時在飛的數量。 */
function fakeServer(ms: number) {
  const state = { started: 0, inFlight: 0, maxInFlight: 0, applied: 0, result: 'applied' as ReadResult, hang: false };
  const read = (): Promise<ReadResult> => {
    state.started += 1;
    state.inFlight += 1;
    state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
    return new Promise<ReadResult>((resolve) => {
      if (state.hang) return; // 永遠不回來
      setTimeout(() => {
        state.inFlight -= 1;
        if (state.result === 'applied') state.applied += 1;
        resolve(state.result);
      }, ms);
    });
  };
  return { state, read };
}

describe('createRefreshScheduler：所有重讀同一個排程', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('重讀要 4 秒、查證輪詢（1.5 秒）＋待同步（3 秒）同時要：請求不重疊、每個都套用；查證結束、同步完就停', async () => {
    const server = fakeServer(4000);
    // 模擬工作區：查證在跑，直到第 3 次套用讀到「跑完了」；待同步在第一次套用後解除。
    let agentRunning = true;
    let pendingSync = true;
    const scheduler = createRefreshScheduler(async () => {
      const result = await server.read();
      if (result === 'applied') {
        if (server.state.applied >= 3) agentRunning = false;
        pendingSync = false;
        // React 的 effect：照最新一次套用的資料更新需求。
        queueMicrotask(() => {
          scheduler.setNeed('working', agentRunning ? 1500 : null);
          scheduler.setNeed('pendingSync', pendingSync ? 3000 : null);
        });
      }
      return result;
    });
    scheduler.setNeed('working', 1500);
    scheduler.setNeed('pendingSync', 3000);
    // 存網址後的重讀同時也要一個。
    const sync = scheduler.request();
    await vi.advanceTimersByTimeAsync(4000);
    await expect(sync).resolves.toBe('applied');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(server.state.maxInFlight).toBe(1);
    expect(server.state.applied).toBe(server.state.started);
    expect(agentRunning).toBe(false);
    expect(pendingSync).toBe(false);
    // 停了：之後不再發請求。
    const startedAtStop = server.state.started;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(server.state.started).toBe(startedAtStop);
    expect(startedAtStop).toBeLessThanOrEqual(4);
  });

  it('request() 要的是「呼叫之後才開始」的那一次：在飛的那個（存檔前就送出的）不算，結束後馬上再讀一次', async () => {
    const server = fakeServer(4000);
    const scheduler = createRefreshScheduler(server.read);
    const first = scheduler.request();
    await vi.advanceTimersByTimeAsync(1000);
    const afterSave = scheduler.request();
    let settled = false;
    void afterSave.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(3000); // 第一個結束
    await expect(first).resolves.toBe('applied');
    expect(settled).toBe(false);
    expect(server.state.started).toBe(2); // 不等間隔，馬上排
    await vi.advanceTimersByTimeAsync(4000);
    await expect(afterSave).resolves.toBe('applied');
    expect(server.state.maxInFlight).toBe(1);
  });

  it('同一時間好幾個 request() 合併成一次重讀', async () => {
    const server = fakeServer(1000);
    const scheduler = createRefreshScheduler(server.read);
    const results = Promise.all([scheduler.request(), scheduler.request(), scheduler.request()]);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(results).resolves.toEqual(['applied', 'applied', 'applied']);
    expect(server.state.started).toBe(1);
  });

  it('重讀失敗（或丟錯）回 failed，排程照樣往下走', async () => {
    const server = fakeServer(500);
    server.state.result = 'failed';
    const scheduler = createRefreshScheduler(server.read);
    const failing = scheduler.request();
    await vi.advanceTimersByTimeAsync(500);
    await expect(failing).resolves.toBe('failed');
    const throwing = createRefreshScheduler(() => Promise.reject(new Error('網路斷了')));
    await expect(throwing.request()).resolves.toBe('failed');
  });

  it('卸載／換篇（dispose）：卡住的那一次與等著的立刻以 gone 收尾，不等請求回來；之後不再發請求', async () => {
    const server = fakeServer(4000);
    server.state.hang = true;
    const scheduler = createRefreshScheduler(server.read);
    scheduler.setNeed('working', 1500);
    const inFlight = scheduler.request();
    await vi.advanceTimersByTimeAsync(100);
    const queued = scheduler.request();
    scheduler.dispose();
    await expect(inFlight).resolves.toBe('gone');
    await expect(queued).resolves.toBe('gone');
    await expect(scheduler.request()).resolves.toBe('gone');
    const started = server.state.started;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(server.state.started).toBe(started);
  });

  it('沒有任何需求就不輪詢；需求拿掉就停', async () => {
    const server = fakeServer(100);
    const scheduler = createRefreshScheduler(server.read);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(server.state.started).toBe(0);
    scheduler.setNeed('pendingSync', 3000);
    await vi.advanceTimersByTimeAsync(3000);
    expect(server.state.started).toBe(1);
    scheduler.setNeed('pendingSync', null);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(server.state.started).toBe(1);
    scheduler.dispose();
  });

  it('存網址進行中離開工作區：重讀卡住也立刻以 gone 收尾，「存網址進行中」放開，重開那篇不再被擋', async () => {
    const server = fakeServer(4000);
    server.state.hang = true;
    const scheduler = createRefreshScheduler(server.read);
    setSlugDraft('leave-a', 'b-slug', 'a-slug');
    const saving = runSlugSave('leave-a', { save: async () => {}, sync: () => scheduler.request() });
    await vi.advanceTimersByTimeAsync(100);
    expect(isSlugSaving('leave-a')).toBe(true);
    // 工作區卸載（或換篇）。
    scheduler.dispose();
    await saving;
    expect(isSlugSaving('leave-a')).toBe(false);
    // 存是成功的：草稿清掉，下次進來重新讀。
    expect(slugDraftFor('leave-a', 'b-slug')).toBe('b-slug');
    expect(slugDraftFor('leave-a', 'later')).toBe('later');
  });

  it('存網址後的重讀跟查證輪詢同時要、重讀 4 秒：最終套用、放開，請求不重疊', async () => {
    const server = fakeServer(4000);
    const scheduler = createRefreshScheduler(server.read);
    scheduler.setNeed('working', 1500);
    // 輪詢先送了一個（存之前）。
    await vi.advanceTimersByTimeAsync(1500);
    expect(server.state.started).toBe(1);
    const saving = runSlugSave('busy-a', { save: async () => {}, sync: () => scheduler.request() });
    await vi.advanceTimersByTimeAsync(12_000);
    await saving;
    expect(isSlugSaving('busy-a')).toBe(false);
    expect(server.state.maxInFlight).toBe(1);
    scheduler.dispose();
  });
});

