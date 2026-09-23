import { createHash } from 'node:crypto';
import type { WordPressClient } from '../wordpress/client.js';
import { WordPressError, wordpressErrorCodes } from '../wordpress/errors.js';
import { MediaSchema, type Media } from '../wordpress/schemas.js';

/**
 * 媒體上傳。
 *
 * WordPress 的媒體端點吃的是**檔案本體**，不是 JSON：位元組直接當 body 送出，
 * 檔名放在 Content-Disposition 標頭裡。
 *
 * **SVG 傳不上去。** WordPress 核心預設不允許 SVG（SVG 可以內嵌 script，
 * 是已知的攻擊面），要開啟只能裝外掛或改 PHP——兩個都是這個專案明文禁止的。
 * 所以使用者選的 SVG 必須先在本機轉成 PNG 再上傳。轉檔在瀏覽器裡用 canvas
 * 做，不需要任何額外套件（見 docs/specs/wordpress-site.md）。
 */

/** 允許上傳的類型。刻意很窄——這是會被公開在網路上的檔案。 */
const ALLOWED_MIME_TYPES = new Map<string, string>([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
]);

/** 我們自己的上限。WordPress 那邊還有它自己的限制，會回 rest_upload_file_too_big。 */
const MAX_BYTES = 10 * 1024 * 1024;

export class MediaUploadError extends Error {
  override readonly name = 'MediaUploadError';
}

export interface UploadInput {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
  /** 不含副檔名的檔名主體；會被正規化成安全的 slug。 */
  readonly filename: string;
  readonly altText?: string;
  readonly caption?: string;
  readonly title?: string;
}

export interface UploadedMedia {
  readonly media: Media;
  /** 檔案內容的 SHA-256，給去重用。 */
  readonly sha256: string;
}

/**
 * 檔名正規化。
 *
 * 檔名會進 Content-Disposition 標頭，換行或引號能拆出額外的標頭；而且它最後會
 * 變成公開網址的一部分。只留英數、連字號與底線最省事也最安全。
 */
export function safeFilename(raw: string, extension: string): string {
  const base = raw
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `${base.length > 0 ? base : 'upload'}.${extension}`;
}

export function sha256Of(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export async function uploadMedia(
  client: WordPressClient,
  input: UploadInput,
): Promise<UploadedMedia> {
  const extension = ALLOWED_MIME_TYPES.get(input.mimeType);
  if (!extension) {
    throw new MediaUploadError(
      input.mimeType === 'image/svg+xml'
        ? 'WordPress 預設不接受 SVG。請先在本機轉成 PNG 再上傳'
        : `不允許的檔案類型 ${input.mimeType}。可用的是 ${[...ALLOWED_MIME_TYPES.keys()].join('、')}`,
    );
  }
  if (input.bytes.byteLength === 0) {
    throw new MediaUploadError('檔案是空的');
  }
  if (input.bytes.byteLength > MAX_BYTES) {
    throw new MediaUploadError(
      `檔案 ${(input.bytes.byteLength / 1024 / 1024).toFixed(1)} MB 超過上限 ${MAX_BYTES / 1024 / 1024} MB`,
    );
  }

  const filename = safeFilename(input.filename, extension);

  const { data } = await client.request('/wp/v2/media', {
    method: 'POST',
    rawBody: { bytes: input.bytes, contentType: input.mimeType },
    headers: { 'Content-Disposition': `attachment; filename="${filename}"` },
    schema: MediaSchema,
    // 上傳不重試：重試會在媒體庫留下重複檔案。
    maxRetries: 0,
  });

  // alt 與圖說要另外送——上傳那一次只吃檔案本體。
  const metadata: Record<string, unknown> = {};
  if (input.altText !== undefined) metadata.alt_text = input.altText;
  if (input.caption !== undefined) metadata.caption = input.caption;
  if (input.title !== undefined) metadata.title = input.title;

  if (Object.keys(metadata).length === 0) {
    return { media: data, sha256: sha256Of(input.bytes) };
  }

  const updated = await client.request(`/wp/v2/media/${data.id}`, {
    method: 'POST',
    body: metadata,
    schema: MediaSchema,
    maxRetries: 0,
  });

  return { media: updated.data, sha256: sha256Of(input.bytes) };
}

/**
 * 用 SHA-256 找出已經上傳過的同一個檔案。
 *
 * WordPress 沒有「用內容 hash 查媒體」的端點，所以真正的去重要靠本機的
 * media_assets 表（階段 5 接上）。這裡只提供 hash 計算，讓呼叫端自己比對——
 * 假裝能在遠端查會給人錯誤的安全感。
 */
export function isSameFile(bytes: Uint8Array, knownSha256: string): boolean {
  return sha256Of(bytes) === knownSha256;
}

export async function fetchMedia(client: WordPressClient, id: number): Promise<Media> {
  const { data } = await client.request(`/wp/v2/media/${id}`, {
    query: { context: 'edit' },
    schema: MediaSchema,
  });
  return data;
}
