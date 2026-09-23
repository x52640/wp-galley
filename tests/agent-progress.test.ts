import { describe, expect, it } from 'vitest';

import { parseServerTime, waitingNote } from '../src/ui/components/AgentProgress.js';

/**
 * 執行中計時器（D-010）。agent_runs.started_at 是 SQLite 的 `datetime('now')`：UTC 但沒寫時區，
 * 直接 new Date 會被當成本地時間，台灣差 8 小時，計時器一直停在 00:00（P5-T013 發現）。
 */
describe('parseServerTime', () => {
  it('SQLite 的時間當成 UTC', () => {
    expect(parseServerTime('2026-09-23 13:51:00')).toBe(Date.UTC(2026, 8, 23, 13, 51, 0));
  });

  it('ISO 字串照原樣', () => {
    expect(parseServerTime('2026-09-23T13:51:00.000Z')).toBe(Date.UTC(2026, 8, 23, 13, 51, 0));
  });
});

describe('waitingNote', () => {
  it('生圖講生圖的期待值，而且說不會自動上傳', () => {
    expect(waitingNote('generate-image', 10)).toContain('一分鐘');
    expect(waitingNote('generate-image', 10)).toContain('不會自動上傳');
    expect(waitingNote('generate-image', 200)).toContain('停止');
    expect(waitingNote('review', 10)).toContain('30 秒到 3 分鐘');
  });
});
