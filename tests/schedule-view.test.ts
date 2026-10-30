import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { defaultSchedule, localDateInput, scheduleTime, scheduleUtc, publishedStatus } from '../src/ui/lib/schedule.js';
import { cancelThenRefresh } from '../src/ui/lib/cancel-schedule.js';
import { cancelScheduleWarning, wordpressDateUtc } from '../src/contract/schedule.js';

beforeEach(() => vi.spyOn(Date, 'now').mockReturnValue(new Date(2026, 9, 30).getTime()));
afterEach(() => vi.restoreAllMocks());

describe('排程時間與狀態顯示', () => {
  it('預設明天早上八點，用本機日期、跨月也正確', () => {
    expect(defaultSchedule(new Date(2026, 9, 31, 22))).toBe('2026-11-01T08:00');
  });
  it('本機選的時間轉 UTC，來回不換時區', () => {
    const date = new Date(2099, 0, 1, 8, 30);
    expect(scheduleUtc(localDateInput(date))).toBe(date.toISOString());
    expect(scheduleTime(date.toISOString())).toBe('2099年1月1日 08:30');
  });
  it.each(['', 'invalid', '2026-02-30T08:00'])('不猜不合法的本機日期 %s', value => {
    expect(scheduleUtc(value)).toBeUndefined();
  });
  it('WordPress 無尾碼的 date_gmt 也依 UTC 解讀', () => {
    expect(wordpressDateUtc('2099-01-01T00:00:00')).toBe('2099-01-01T00:00:00.000Z');
    expect(wordpressDateUtc(null)).toBeNull();
  });
  it('排程顯示時間，公開、草稿各自如實顯示', () => {
    expect(publishedStatus('future', new Date(2099, 0, 1, 8, 30).toISOString())).toBe('已排程，會在 2099年1月1日 08:30（本機時間）公開');
    expect(publishedStatus('publish')).toBe('已公開');
    expect(publishedStatus('draft')).toBe('草稿');
    expect(publishedStatus('future', null)).toContain('時間未知');
  });
});


describe('排程跨年與取消錯誤', () => {
  it('同一年省略年份，不同年包括年份', () => {
    vi.spyOn(Date, 'now').mockReturnValue(new Date(2026, 9, 30).getTime());
    expect(scheduleTime(new Date(2026, 0, 1, 8).toISOString())).toBe('1月1日 08:00');
    expect(scheduleTime(new Date(2099, 0, 1, 8).toISOString())).toBe('2099年1月1日 08:00');
    expect(publishedStatus('future', new Date(2099, 0, 1, 8).toISOString())).toContain('2099年1月1日 08:00');
  });
  it('取消失敗後重讀也失敗，保留取消的原始錯誤', async () => {
    const original = new Error('遠端已經公開，不能取消');
    const refresh = vi.fn().mockRejectedValue(new Error('重讀失敗'));
    await expect(cancelThenRefresh(async () => { throw original; }, refresh)).rejects.toBe(original);
    expect(refresh).toHaveBeenCalledOnce();
  });
  it('取消成功後才發生重讀錯誤，就回報重讀錯誤', async () => {
    const error = new Error('重讀失敗');
    await expect(cancelThenRefresh(async () => {}, async () => { throw error; })).rejects.toBe(error);
  });
});


describe('取消排程警告門檻', () => {
  const now = Date.parse('2026-10-30T00:00:00Z');
  it('正好兩分鐘不警告、少一毫秒與缺日期要警告', () => {
    expect(cancelScheduleWarning(new Date(now + 120_000).toISOString(), now)).toBeNull();
    expect(cancelScheduleWarning(new Date(now + 119_999).toISOString(), now)).toMatch(/網站確認/);
    expect(cancelScheduleWarning(null, now)).toMatch(/無法確認/);
  });
});
