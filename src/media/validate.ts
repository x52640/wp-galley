/**
 * 圖片驗證。上傳（`upload.ts`）與 Codex 生圖的候選圖（P5-T013）共用同一套規則。
 *
 * 規則刻意很窄：這些檔案最後會被公開在網路上。
 */

/** 允許的類型與副檔名。 */
export const ALLOWED_IMAGE_TYPES: ReadonlyMap<string, string> = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
]);

/** 我們自己的上限。WordPress 那邊還有它自己的限制，會回 rest_upload_file_too_big。 */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export class MediaUploadError extends Error {
  override readonly name = 'MediaUploadError';
}

/**
 * 類型與大小。回傳副檔名。
 *
 * 這是上傳一直以來的檢查；不看檔頭，因為使用者自己挑的檔案由瀏覽器給類型。
 */
export function assertUploadable(bytes: Uint8Array, mimeType: string): string {
  const extension = ALLOWED_IMAGE_TYPES.get(mimeType);
  if (!extension) {
    throw new MediaUploadError(
      mimeType === 'image/svg+xml'
        ? 'WordPress 預設不接受 SVG。請先在本機轉成 PNG 再上傳'
        : `不允許的檔案類型 ${mimeType}。可用的是 ${[...ALLOWED_IMAGE_TYPES.keys()].join('、')}`,
    );
  }
  if (bytes.byteLength === 0) {
    throw new MediaUploadError('檔案是空的');
  }
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new MediaUploadError(
      `檔案 ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB 超過上限 ${MAX_IMAGE_BYTES / 1024 / 1024} MB`,
    );
  }
  return extension;
}

export interface InspectedImage {
  readonly mimeType: string;
  readonly extension: string;
  /** 讀不出來（檔頭被截斷、WebP）就是 null。 */
  readonly width: number | null;
  readonly height: number | null;
}

/** 看檔頭認類型。認不出來回 null。 */
export function sniffImageType(bytes: Uint8Array): string | null {
  const at = (i: number): number => bytes[i] ?? -1;
  if ([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, i) => at(i) === value)) return 'image/png';
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'image/jpeg';
  if (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a') return 'image/gif';
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/**
 * 不信任來源的圖檔（Agent 生出來的）：**類型由檔頭決定**，不看副檔名，
 * 然後走跟上傳一樣的類型與大小檢查。
 */
export function inspectImage(bytes: Uint8Array): InspectedImage {
  const mimeType = sniffImageType(bytes);
  if (mimeType === null) {
    throw new MediaUploadError('這個檔案不是認得的圖片格式（PNG、JPEG、WebP、GIF）');
  }
  const extension = assertUploadable(bytes, mimeType);
  const size = dimensionsOf(bytes, mimeType);
  return { mimeType, extension, width: size?.width ?? null, height: size?.height ?? null };
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  if (bytes.byteLength < end) return '';
  return String.fromCharCode(...bytes.subarray(start, end));
}

function dimensionsOf(bytes: Uint8Array, mimeType: string): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  try {
    if (mimeType === 'image/png') {
      // 簽章 8 bytes，接著 IHDR：長度 4、型別 4、寬 4、高 4（big-endian）。
      if (ascii(bytes, 12, 16) !== 'IHDR') return null;
      return { width: view.getUint32(16), height: view.getUint32(20) };
    }
    if (mimeType === 'image/gif') {
      return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
    }
    if (mimeType === 'image/jpeg') {
      let offset = 2;
      while (offset + 9 < bytes.byteLength) {
        if (bytes[offset] !== 0xff) return null;
        const marker = bytes[offset + 1]!;
        const length = view.getUint16(offset + 2);
        // SOF0–SOF15，扣掉 DHT(C4)、JPG(C8)、DAC(CC)。
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
        }
        offset += 2 + length;
      }
    }
  } catch {
    return null;
  }
  return null;
}
