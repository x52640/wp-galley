/** 顯示用的小工具。數字與 hash 一律用等寬字（見設計系統：個性放在數字上）。 */

/** hash 只看前 8 碼就夠辨識，全長 64 碼在畫面上只是噪音。 */
export function shortHash(hash: string | null | undefined): string {
  if (!hash) return '—';
  return hash.slice(0, 8);
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const minutes = Math.round((Date.now() - then) / 60_000);
  if (minutes < 1) return '剛剛';
  if (minutes < 60) return `${minutes} 分鐘前`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小時前`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} 天前`;
  return formatDateTime(iso);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** 從 templateData 取一個字串欄位，型別不對就回 fallback。 */
export function readString(
  data: Record<string, unknown> | null | undefined,
  key: string,
  fallback = '',
): string {
  const value = data?.[key];
  return typeof value === 'string' ? value : fallback;
}

/** 從 templateData 取一個字串陣列欄位。 */
export function readStringArray(
  data: Record<string, unknown> | null | undefined,
  key: string,
): string[] {
  const value = data?.[key];
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  if (typeof value === 'string' && value.length > 0) return [value];
  return [];
}
