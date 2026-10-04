import type { SyncOutcome } from './slug-save-store.js';

/**
 * 工作區所有重讀的同一個排程（PR #28 第四輪 Codex P2）。
 *
 * 以前查證中的輪詢（每 1.5 秒）、待同步的重試、存網址後的重讀各跑各的：重讀比間隔還慢時，每個回應回來時
 * 都已經有更新的一次送出、被當成過期丟掉，畫面永遠讀不到新資料——查證早就跑完，輪詢還以為在跑，打字與存網址一直被擋。
 *
 * 這裡保證：
 * - 同時最多一個重讀在飛；上一個結束（成功、失敗、丟錯）才排下一個。
 * - `request()`：要一次「呼叫之後才開始」的重讀（存好之後要讀到存好的那一版；在飛的那一個是存之前送出的，不算）。
 *   同一段同步程式碼裡的多個 request 合併成一次（下一個 microtask 才開始）。在飛的結束後馬上讀，不等間隔。
 * - `setNeed(key, delayMs)`：有任何一方需要輪詢（查證在跑、待同步）就照最短的間隔一直讀，都不需要就停。
 *   需求由呼叫端照**最新一次套用成功**的資料更新（工作區的 effect）。
 * - `dispose()`：卸載或換篇。在飛的與等著的立刻以 `gone` 收尾，不等請求回來；之後 request 一律 `gone`、不再發請求。
 *
 * 不碰 React 與 API，可以直接在 node 裡用假時鐘測。
 */

export type ReadResult = 'applied' | 'failed';

export interface RefreshScheduler {
  request(): Promise<SyncOutcome>;
  setNeed(key: string, delayMs: number | null): void;
  dispose(): void;
}

type Resolve = (outcome: SyncOutcome) => void;

export function createRefreshScheduler(read: () => Promise<ReadResult>): RefreshScheduler {
  let disposed = false;
  let inFlight = false;
  /** 在飛的那一次要回覆的人。 */
  let current: Resolve[] = [];
  /** 要等下一次（還沒開始的）重讀的人。 */
  let waiting: Resolve[] = [];
  const needs = new Map<string, number>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** 已經排了「下一個 microtask 開始」：同一段同步程式碼裡的多個 request 合併成一次。 */
  let startQueued = false;

  const clearTimer = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const schedule = (): void => {
    if (disposed || inFlight || timer !== null || needs.size === 0) return;
    const delay = Math.min(...needs.values());
    timer = setTimeout(() => {
      timer = null;
      if (!disposed && !inFlight) start();
    }, delay);
  };

  const start = (): void => {
    if (disposed || inFlight) return;
    clearTimer();
    inFlight = true;
    current = waiting;
    waiting = [];
    let result: Promise<ReadResult>;
    try {
      result = read();
    } catch {
      result = Promise.resolve('failed');
    }
    void result
      .catch((): ReadResult => 'failed')
      .then((outcome) => {
        if (disposed) return; // 已經用 gone 回覆過了
        inFlight = false;
        const done = current;
        current = [];
        for (const resolve of done) resolve(outcome);
        if (waiting.length > 0) start();
        else schedule();
      });
  };

  return {
    request(): Promise<SyncOutcome> {
      if (disposed) return Promise.resolve('gone');
      return new Promise<SyncOutcome>((resolve) => {
        waiting.push(resolve);
        if (inFlight || startQueued) return; // 在飛的結束後會接著讀
        startQueued = true;
        queueMicrotask(() => {
          startQueued = false;
          start();
        });
      });
    },
    setNeed(key: string, delayMs: number | null): void {
      if (disposed) return;
      const before = needs.get(key) ?? null;
      if (before === delayMs) return;
      if (delayMs === null) needs.delete(key);
      else needs.set(key, delayMs);
      // 需求變了：還沒開始的那一次照新的最短間隔重排（沒有需求就不排）。
      clearTimer();
      schedule();
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      clearTimer();
      needs.clear();
      const pending = [...current, ...waiting];
      current = [];
      waiting = [];
      for (const resolve of pending) resolve('gone');
    },
  };
}
