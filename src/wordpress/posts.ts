import { createHash } from 'node:crypto';
import type { WordPressClient } from './client.js';
import { WordPressError, wordpressErrorCodes } from './errors.js';
import { PostSchema, type Post } from './schemas.js';
import { taxonomyRestBaseOf, type PublishTarget } from './targets.js';

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

/**
 * 遠端變動偵測用的快照。
 *
 * 收錄的欄位跟 `buildPayload()` 會覆寫的欄位**一一對應**。只比內容 hash 是不夠的：
 * 別人在後台改了標題、換了網址代稱、換了精選圖片、調了分類，或把草稿發成公開，
 * 內容 hash 可以一個位元都沒變，而我們照樣會把那些改動蓋掉。
 * 之後 `buildPayload()` 多送一個欄位，這裡就要跟著多比一個。
 */
export interface RemoteSnapshot {
  readonly id: number;
  readonly status: string;
  readonly modifiedGmt: string | null;
  /** content.raw 的 SHA-256。modified_gmt 只到秒，而且有些外掛不會更新它。 */
  readonly contentHash: string;
  readonly title: string;
  readonly slug: string;
  /** 0 代表沒有精選圖片，跟 WordPress 自己的表示法一致。 */
  readonly featuredMediaId: number;
  /** 這個 target 的分類法上掛了哪些 term id，排序過。null 代表這個 target 不用分類法。 */
  readonly terms: readonly number[] | null;
  /**
   * 作者的使用者 id（P5-T024：發布會送 author）。null＝回應裡沒有（內容類型不支援作者）。
   * 選填：P5-T024 之前存進 DB 的快照沒有這個欄位，那種快照不比作者，免得每次更新都誤報衝突。
   */
  readonly author?: number | null;
}

/** 兩份快照差在哪。用欄位名稱回報，訊息才講得出「被改的是什麼」。 */
export function diffSnapshots(expected: RemoteSnapshot, actual: RemoteSnapshot): string[] {
  const changed: string[] = [];
  if (actual.modifiedGmt !== expected.modifiedGmt) changed.push('修改時間');
  if (actual.contentHash !== expected.contentHash) changed.push('內容');
  if (actual.status !== expected.status) changed.push(`狀態（${expected.status} → ${actual.status}）`);
  if (actual.title !== expected.title) changed.push('標題');
  if (actual.slug !== expected.slug) changed.push('網址代稱');
  if (actual.featuredMediaId !== expected.featuredMediaId) changed.push('精選圖片');
  if (JSON.stringify(actual.terms) !== JSON.stringify(expected.terms)) changed.push('分類');
  if (expected.author !== undefined && (actual.author ?? null) !== expected.author) changed.push('作者');
  return changed;
}

export class RemoteChangedError extends Error {
  override readonly name = 'RemoteChangedError';
  constructor(
    message: string,
    readonly expected: RemoteSnapshot,
    readonly actual: RemoteSnapshot,
    /** 具體是哪些欄位對不上。給錯誤訊息與稽核紀錄用。 */
    readonly changedFields: readonly string[] = [],
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
  /** 作者的使用者 id（P5-T024）。不給就不送，WordPress 維持原本的作者（建稿時是登入的帳號）。 */
  readonly authorId?: number;
}

function hashContent(post: Post): string {
  return createHash('sha256').update(post.content.raw ?? post.content.rendered ?? '').digest('hex');
}

/**
 * 分類項目不在 `PostSchema` 的固定欄位裡——分類法的名字是站台設定，不是協定的一部分。
 * 所以由呼叫端把 target 的分類法**REST 名稱**（`taxonomyRestBaseOf`，核心的 category 是
 * `categories`）傳進來，只讀那一個鍵，其他外掛塞的東西一概不碰
 * （否則某個外掛回一組會變動的數字陣列，就會變成永遠對不上的假衝突）。
 */
function termsOf(post: Post, taxonomy: string | null): readonly number[] | null {
  if (taxonomy === null) return null;
  const raw = (post as unknown as Record<string, unknown>)[taxonomy];
  if (!Array.isArray(raw)) return [];
  return raw.filter((value): value is number => typeof value === 'number').sort((a, b) => a - b);
}

/** `raw` 是我們寫進去的值，優先用它；`rendered` 會被 WordPress 加工過。 */
function plainTitle(post: Post): string {
  return post.title.raw ?? post.title.rendered ?? '';
}

/**
 * `taxonomy` 沒有預設值是刻意的：預設成 null 的話，用 `snapshotOf(post)` 做出來的
 * expected 會帶 `terms: null`，而 `assertUnchanged` 抓回來的 actual 帶的是真正的
 * term 陣列，兩者永遠對不上——變成每次更新都誤報衝突。呼叫端一律指名。
 */
export function snapshotOf(post: Post, taxonomy: string | null): RemoteSnapshot {
  return {
    id: post.id,
    status: post.status,
    modifiedGmt: post.modified_gmt,
    contentHash: hashContent(post),
    title: plainTitle(post),
    slug: post.slug,
    featuredMediaId: post.featured_media,
    terms: termsOf(post, taxonomy),
    author: typeof post['author'] === 'number' ? post['author'] : null,
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
  if (fields.authorId !== undefined) payload.author = fields.authorId;

  const restBase = taxonomyRestBaseOf(target);
  for (const [taxonomy, ids] of Object.entries(fields.terms ?? {})) {
    // 只送這個 target 認得的分類法，避免打錯字時把值送到別的地方。
    // 鍵是 REST 名稱（文章 JSON 的欄位名），不是分類法 slug。
    if (taxonomy !== restBase) {
      throw new WordPressError(
        wordpressErrorCodes.INVALID_REQUEST,
        `${target.key} 只接受分類法 ${restBase ?? '（無）'}，收到 ${taxonomy}`,
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
  taxonomy: string | null = taxonomyRestBaseOf(target),
): Promise<RemoteSnapshot> {
  return snapshotOf(await fetchPost(client, target, id), taxonomy);
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
  /**
   * 讀回遠端、確認沒被改過之後，**送出寫入之前**同步呼叫（中間沒有 await）。丟錯就不寫。
   * CoreService 用它在最後一刻確認核准還有效（P5-T022，審查 #2）：讀遠端要等網路，那段期間核准可能被撤銷。
   */
  readonly beforeWrite?: () => void;
}

/**
 * 遠端那篇不是草稿時的拒絕訊息；是草稿回 null（P5-T022，審查 #1）。CoreService 的前置檢查用同一句。
 * 更新一篇已公開、排程或私人的文章就是「修改已發布文章」，Q-5 還沒裁定，一律不做。
 */
export function nonDraftUpdateMessage(status: string): string | null {
  if (status === 'draft') return null;
  return `這篇在站上已經是 ${status}，發布台目前不支援修改已公開的文章（待裁定 Q-5），這次沒有送出任何修改。`;
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

  // 只更新草稿（P5-T022，審查 #1）：WordPress 的更新不帶 status 就維持原狀態，遠端已公開的話
  // 新內容會直接上線。CoreService 前置檢查已經擋過，這裡用剛讀回的狀態再擋一次，並固定帶 status:draft。
  const actual = await assertUnchanged(client, target, id, options.expect);
  const refused = nonDraftUpdateMessage(actual.status);
  if (refused !== null) {
    throw new WordPressError(wordpressErrorCodes.INVALID_REQUEST, refused, { retryable: false });
  }
  options.beforeWrite?.();

  const { data } = await client.request(`/wp/v2/${target.restBase}/${id}`, {
    method: 'POST', // WordPress REST 用 POST 做更新，PUT 也可以但官方文件用 POST
    body: { ...buildPayload(target, fields), status: 'draft' },
    schema: PostSchema,
    maxRetries: 0,
  });
  return data;
}

/**
 * 遠端沒被動過就通過，動過就丟 RemoteChangedError。
 *
 * 比對的欄位就是 `RemoteSnapshot` 的全部——也就是我們會覆寫的全部。
 * 少比一個欄位，那個欄位上的別人的修改就會被我們無聲蓋掉。
 */
export async function assertUnchanged(
  client: WordPressClient,
  target: PublishTarget,
  id: number,
  expected: RemoteSnapshot,
): Promise<RemoteSnapshot> {
  const actual = await fetchSnapshot(client, target, id, taxonomyRestBaseOf(target));
  const changed = diffSnapshots(expected, actual);

  if (changed.length > 0) {
    throw new RemoteChangedError(
      `這篇內容在 WordPress 上被改過了（改動的是：${changed.join('、')}；` +
        `遠端最後修改時間 ${actual.modifiedGmt ?? '未知'}）。` +
        '為了不覆蓋掉那些修改，這次發布已中止。請重新載入遠端內容再確認一次。',
      expected,
      actual,
      changed,
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
  options.beforeWrite?.();

  const { data } = await client.request(`/wp/v2/${target.restBase}/${id}`, {
    method: 'POST',
    body: { status },
    schema: PostSchema,
    maxRetries: 0,
  });
  return data;
}
