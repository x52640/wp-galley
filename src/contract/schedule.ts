/** 選時間／發布前置檢查：要比現在晚超過五分鐘。 */
export function checkSchedule(value: unknown, now = Date.now()): string | null {
  return checkScheduleMargin(value, now, 5, false);
}

/** 發布已開始後：保留至少一分鐘，容許前置檢查後的網路等待。 */
export function checkInFlightSchedule(value: unknown, now = Date.now()): string | null {
  return checkScheduleMargin(value, now, 1, true);
}

function checkScheduleMargin(value: unknown, now: number, minutes: number, allowEqual: boolean): string | null {
  if (typeof value !== 'string' || value === '') return '請選排程發布的日期與時間。';
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) {
    return '排程時間格式不對，請重新選日期與時間。';
  }
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value.replace(/Z$/, value.includes('.') ? 'Z' : '.000Z')) {
    return '排程時間格式不對，請重新選日期與時間。';
  }
  const remaining = time - now;
  if (remaining < minutes * 60_000 || (!allowEqual && remaining === minutes * 60_000)) {
    return allowEqual ? '排程時間太近了，寫入前至少要留 1 分鐘，請重新選時間。' : '排程時間要比現在晚超過 5 分鐘，請選晚一點。';
  }
  return null;
}

/** REST 的 date_gmt 沒有時區尾碼，但欄位本身就是 UTC。 */
export function wordpressDateUtc(value: string | null | undefined): string | null {
  if (!value) return null;
  const utc = /Z$|[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`;
  const time = Date.parse(utc);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

/** 取消也有 cron 競態：回草稿無法撤回可能已寄出的電子報或分享。 */
export function cancelScheduleWarning(value: string | null | undefined, now = Date.now()): string | null {
  const utc = wordpressDateUtc(value);
  return utc === null || Date.parse(utc) - now < 2 * 60_000
    ? '排程時間已到、快到了或無法確認，文章可能已經公開，電子報或社群分享可能已送出。請到網站確認。'
    : null;
}
