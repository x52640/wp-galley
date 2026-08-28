import { createHash } from 'node:crypto';
import type { WordPressClient } from './client.js';
import { WordPressError, wordpressErrorCodes } from './errors.js';
import { PostSchema, type Post } from './schemas.js';
import type { PublishTarget } from './targets.js';

/**
 * 文章的建立與更新。
 *
 * 這一層是**傳輸**，不是授權。「使用者核准過了沒」是 CoreService（階段 5）的事，
 * 在這裡假裝檢查只會製造安全感而已。這裡能守住的是三件實際的事：
 *
 * 1. **建立一律是草稿。** createDraft 不接受 status 參數，寫死 draft。
 *    要變成公開狀態必須經過另一個函式，呼叫點因此在程式碼裡數得出來。
 * 2. **更新前一定要比對遠端。** 從我們載入之後有人動過就中止，不覆蓋別人的修改
 *    （計畫 §8.4）。
 * 3. **只動 target 允許的內容類型與欄位。** 送出去的欄位是白名單。
 */

/** 遠端變動偵測用的快照。 */
export interface RemoteSnapshot {
  readonly id: number;
  readonly status: string;
  readonly modifiedGmt: string | null;
  /** content.raw 的 SHA-256。modified_gmt 只到秒，而且有些外掛不會更新它。 */
  readonly contentHash: string;
}

export class RemoteChangedError extends Error {
  override readonly name = 'RemoteChangedError';
  constructor(
    message: string,
    readonly expected: RemoteSnapshot,
    readonly actual: RemoteSnapshot,
  ) {
    super(message);
  }
}

export interface PostFields {
  readonly title: string;
  /** 已經轉成 Gutenberg 區塊標記的內容。 */
  readonly content: string;
  readonly slug?: string;
  readonly excerpt?: string;
  /** 精選圖片的媒體 ID。0 代表清除。 */
  readonly featuredMediaId?: number;
  /** 分類法 slug → term id 陣列。 */
  readonly terms?: Readonly<Record<string, readonly number[]>>;
}

function hashContent(post: Post): string {
  return createHash('sha256').update(post.content.raw ?? post.content.rendered ?? '').digest('hex');
}

export function snapshotOf(post: Post): RemoteSnapshot {
  return {
    id: post.id,
    status: post.status,
    modifiedGmt: post.modified_gmt,
    contentHash: hashContent(post),
  };
}

/**
 * 組出要送去 REST 的欄位。
 *
 * 白名單，不是把 input 整包丟出去：多送欄位可能覆蓋掉我們沒打算動的東西
 * （例如作者、日期、留言開關）。
 */
function buildPayload(target: PublishTarget, fields: PostFields): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    title: fields.title,
    content: fields.content,
  };
  if (fields.slug !== undefined) payload.slug = fields.slug;
  if (fields.excerpt !== undefined) payload.excerpt = fields.excerpt;
  if (fields.featuredMediaId !== undefined) payload.featured_media = fields.featuredMediaId;

  for (const [taxonomy, ids] of Object.entries(fields.terms ?? {})) {
    // 只送這個 target 認得的分類法，避免打錯字時把值送到別的地方。
    if (taxonomy !== target.taxonomy) {
      throw new WordPressError(
        wordpressErrorCodes.INVALID_REQUEST,
        `${target.key} 只接受分類法 ${target.taxonomy}，收到 ${taxonomy}`,
        { retryable: false },
      );
    }
    payload[taxonomy] = [...ids];
  }

  return payload;
}

export async function fetchPost(
  client: WordPressClient,
  target: PublishTarget,
  id: number,
): Promise<Post> {
  const { data } = await client.request(`/wp/v2/${target.restBase}/${id}`, {
    query: { context: 'edit' },
    schema: PostSchema,
  });
  return data;
}

export async function fetchSnapshot(
  client: WordPressClient,
  target: PublishTarget,
  id: number,
): Promise<RemoteSnapshot> {
  return snapshotOf(await fetchPost(client, target, id));
}

/**
 * 建立草稿。狀態寫死是 draft——公開狀態要走 setStatus，
 * 這樣「什麼時候會讓內容曝光」在程式碼裡是數得出來的。
 */
export async function createDraft(
  client: WordPressClient,
  target: PublishTarget,
  fields: PostFields,
): Promise<Post> {
  if (!target.allowCreate) {
    throw new WordPressError(
      wordpressErrorCodes.INVALID_REQUEST,
      `發布目標 ${target.key} 不允許建立新內容`,
      { retryable: false },
    );
  }

  const { data } = await client.request(`/wp/v2/${target.restBase}`, {
    method: 'POST',
    body: { ...buildPayload(target, fields), status: 'draft' },
    schema: PostSchema,
    // 建立不重試：重試可能建出兩篇一樣的草稿。逾時就讓使用者自己確認後再試。
    maxRetries: 0,
  });
  return data;
}

export interface UpdateOptions {
  /**
   * 上次讀到的遠端狀態。**必填**——沒有它就無法判斷遠端有沒有被別人改過，
   * 那就等於允許無聲覆蓋。
   */
  readonly expect: RemoteSnapshot;
}

/**
 * 更新草稿。發現遠端在我們載入之後被改過就中止，不覆蓋。
 *
 * 為什麼同時比 modified_gmt 與內容 hash：modified_gmt 只精確到秒，同一秒內的
 * 修改看不出來；而有些外掛改內容時不會更新 modified_gmt。任一項對不上就當作
 * 被改過。
 */
export async function updateDraft(
  client: WordPressClient,
  target: PublishTarget,
  id: number,
  fields: PostFields,
  options: UpdateOptions,
): Promise<Post> {
  if (!target.allowUpdate) {
    throw new WordPressError(
      wordpressErrorCodes.INVALID_REQUEST,
      `發布目標 ${target.key} 不允許更新既有內容`,
      { retryable: false },
    );
  }

  await assertUnchanged(client, target, id, options.expect);

  const { data } = await client.request(`/wp/v2/${target.restBase}/${id}`, {
    method: 'POST', // WordPress REST 用 POST 做更新，PUT 也可以但官方文件用 POST
    body: buildPayload(target, fields),
    schema: PostSchema,
    maxRetries: 0,
  });
  return data;
}

/** 遠端沒被動過就通過，動過就丟 RemoteChangedError。 */
export async function assertUnchanged(
  client: WordPressClient,
  target: PublishTarget,
  id: number,
  expected: RemoteSnapshot,
): Promise<RemoteSnapshot> {
  const actual = await fetchSnapshot(client, target, id);

  const changed =
    actual.modifiedGmt !== expected.modifiedGmt || actual.contentHash !== expected.contentHash;

  if (changed) {
    throw new RemoteChangedError(
      `這篇內容在 WordPress 上被改過了（遠端最後修改時間 ${actual.modifiedGmt ?? '未知'}）。` +
        '為了不覆蓋掉那些修改，這次發布已中止。請重新載入遠端內容再確認一次。',
      expected,
      actual,
    );
  }

  return actual;
}

/**
 * 改變文章狀態（草稿 ↔ 公開）。
 *
 * 單獨拉成一個函式而不是併進 updateDraft 的參數，理由是「哪裡會讓內容曝光」
 * 必須在程式碼裡一眼數得出來。核准的檢查在 CoreService（階段 5）。
 */
export async function setStatus(
  client: WordPressClient,
  target: PublishTarget,
  id: number,
  status: 'draft' | 'publish' | 'pending' | 'private',
  options: UpdateOptions,
): Promise<Post> {
  await assertUnchanged(client, target, id, options.expect);

  const { data } = await client.request(`/wp/v2/${target.restBase}/${id}`, {
    method: 'POST',
    body: { status },
    schema: PostSchema,
    maxRetries: 0,
  });
  return data;
}
