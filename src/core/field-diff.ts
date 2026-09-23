import type { FieldChange } from '../contract/api.js';

export type { FieldChange };

/**
 * 正文以外的改動（D-019）。
 *
 * 對照原本只逐段比正文，使用者那篇 r12 → r13 只換了封面，畫面卻寫「兩邊一模一樣」。
 * 這裡把 templateData 的其他欄位與精選圖片也比一次，產出「給人看」的名稱與值——
 * 名稱與值怎麼顯示只在這裡決定，畫面照抄，不在前端再翻譯一次。
 */

/** 認得的欄位用中文名稱；認不得的用欄位名本身，寧可醜也不要漏掉。 */
const FIELD_LABELS: Readonly<Record<string, string>> = {
  title: '標題',
  slug: '網址片段',
  category: '分類',
  tags: '標籤',
  featuredImageBriefKey: '封面對應的配圖需求',
};

/** 標題、網址先講，其他欄位照出現的順序。 */
const LEADING_FIELDS = ['title', 'slug'];

export const FEATURED_FIELD = 'featuredMedia';

export interface FeaturedInput {
  readonly beforeId: number | null;
  readonly afterId: number | null;
  /** 顯示用的名字（describeMediaForDiff 的結果）；null＝沒有精選圖片。 */
  readonly before: string | null;
  readonly after: string | null;
}

export function diffFields(input: {
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  /** 正文欄位，另外逐段比，這裡跳過。 */
  publishSlot: string;
  featured?: FeaturedInput;
}): FieldChange[] {
  const keys: string[] = [];
  for (const key of [...LEADING_FIELDS, ...Object.keys(input.before), ...Object.keys(input.after)]) {
    if (key === input.publishSlot || keys.includes(key)) continue;
    keys.push(key);
  }

  const changes: FieldChange[] = [];
  for (const key of keys) {
    const before = displayValue(input.before[key]);
    const after = displayValue(input.after[key]);
    if (sameValue(input.before[key], input.after[key]) || (before === null && after === null)) continue;
    changes.push({ field: key, label: FIELD_LABELS[key] ?? key, before, after });
  }

  const featured = input.featured;
  if (featured && featured.beforeId !== featured.afterId) {
    changes.push({ field: FEATURED_FIELD, label: '精選圖片', before: featured.before, after: featured.after });
  }
  return changes;
}

/** 空字串、空陣列跟沒設定是同一件事。 */
function displayValue(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return value.trim().length === 0 ? null : value;
  if (Array.isArray(value)) {
    const parts = value.map((item) => (typeof item === 'string' ? item : JSON.stringify(item)));
    return parts.length === 0 ? null : parts.join('、');
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

/** 字串清單（標籤、分類）當成集合比：WordPress 不在意順序，只換順序不該被列成改動。 */
function normalizeForCompare(value: unknown): unknown {
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) return [...value].sort();
  return value ?? null;
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(normalizeForCompare(a)) === JSON.stringify(normalizeForCompare(b));
}

const ALT_LIMIT = 24;

/**
 * 精選圖片給人看的名字：檔名（從 WordPress 網址取）加上替代文字。不給資料庫 id——
 * 使用者看不懂「#1」是哪一張。本機不存原始檔名（存的是 sha256），所以還沒上傳的圖只能靠替代文字。
 */
export function describeMediaForDiff(media: { url: string | null; altText: string | null }): string {
  const name = media.url === null ? null : fileNameOf(media.url);
  const alt = media.altText?.trim() ? truncate(media.altText.trim(), ALT_LIMIT) : null;
  if (name !== null && alt !== null) return `${name}（${alt}）`;
  if (name !== null) return name;
  if (alt !== null) return `「${alt}」`;
  return '一張沒有說明的圖片';
}

function fileNameOf(url: string): string | null {
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    // 不是完整網址就照字串切。
  }
  const last = path.split('/').filter((part) => part.length > 0).pop();
  if (!last) return null;
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

function truncate(text: string, limit: number): string {
  const chars = Array.from(text);
  return chars.length <= limit ? text : `${chars.slice(0, limit).join('')}…`;
}
