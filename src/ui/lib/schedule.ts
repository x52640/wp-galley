import { wordpressDateUtc } from '../../contract/schedule.js';

/** datetime-local 用本機時間；不以 UTC 切字串，以免偷偷換了時區。 */
export function localDateInput(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
export function defaultSchedule(now = new Date()): string {
  const date = new Date(now);
  date.setDate(date.getDate() + 1);
  date.setHours(8, 0, 0, 0);
  return localDateInput(date);
}
export function scheduleUtc(local: string): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return undefined;
  const date = new Date(local);
  // 夏令時間跳過的時刻、不存在的日期也不猜。
  return Number.isFinite(date.getTime()) && localDateInput(date) === local ? date.toISOString() : undefined;
}
export function scheduleTime(value: string | null | undefined): string {
  const utc = wordpressDateUtc(value);
  if (!utc) return '時間未知';
  const date = new Date(utc);
  const year = date.getFullYear() === new Date(Date.now()).getFullYear() ? '' : `${date.getFullYear()}年`;
  return `${year}${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
export function publishedStatus(status: string, dateGmt?: string | null): string {
  if (status === 'future') return `已排程，會在 ${scheduleTime(dateGmt)}（本機時間）公開`;
  if (status === 'publish') return '已公開';
  if (status === 'draft') return '草稿';
  if (status === 'pending') return '待審核';
  if (status === 'private') return '私人';
  if (status === 'trash') return '已移至回收桶';
  return '其他狀態';
}
