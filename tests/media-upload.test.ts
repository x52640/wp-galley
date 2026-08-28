import { afterEach, describe, expect, it } from 'vitest';
import { WordPressClient } from '../src/wordpress/client.js';
import { MediaUploadError, safeFilename, sha256Of, uploadMedia } from '../src/media/upload.js';
import { startMockWordPress, type MockResponse, type MockWordPress } from './helpers/mock-wordpress.js';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

let mock: MockWordPress | null = null;

afterEach(async () => {
  await mock?.close();
  mock = null;
});

function clientFor(server: MockWordPress): WordPressClient {
  return new WordPressClient({
    baseUrl: server.url,
    username: 'ai_publisher',
    appPassword: 'abcd EFGH 1234 ijkl MNOP 5678',
    sleepImpl: async () => {},
  });
}

function mediaBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 2001,
    source_url: 'https://www.remusplus.com/wp-content/uploads/2026/08/cover.png',
    mime_type: 'image/png',
    media_type: 'image',
    alt_text: '',
    title: { raw: 'cover', rendered: 'cover' },
    ...overrides,
  };
}

describe('檔案類型', () => {
  it('SVG 被擋下來，並說明要先轉檔', async () => {
    mock = await startMockWordPress(() => ({ body: mediaBody() }));
    await expect(
      uploadMedia(clientFor(mock), { bytes: PNG, mimeType: 'image/svg+xml', filename: 'cover' }),
    ).rejects.toThrow(/先在本機轉成 PNG/);
    // 連試都不該試。
    expect(mock.requests).toHaveLength(0);
  });

  it('不在允許清單的類型會被擋', async () => {
    mock = await startMockWordPress(() => ({ body: mediaBody() }));
    await expect(
      uploadMedia(clientFor(mock), { bytes: PNG, mimeType: 'application/pdf', filename: 'x' }),
    ).rejects.toBeInstanceOf(MediaUploadError);
  });

  it('空檔案與過大的檔案都會被擋', async () => {
    mock = await startMockWordPress(() => ({ body: mediaBody() }));
    const client = clientFor(mock);
    await expect(
      uploadMedia(client, { bytes: new Uint8Array(0), mimeType: 'image/png', filename: 'x' }),
    ).rejects.toThrow(/空的/);
    await expect(
      uploadMedia(client, {
        bytes: new Uint8Array(11 * 1024 * 1024),
        mimeType: 'image/png',
        filename: 'x',
      }),
    ).rejects.toThrow(/超過上限/);
  });
});

describe('檔名', () => {
  it('中文與空白會被換成安全字元', () => {
    // 中文被清掉後開頭會留下連字號，那個也要修掉。
    expect(safeFilename('日記 封面 2026', 'png')).toBe('2026.png');
    expect(safeFilename('cover image', 'png')).toBe('cover-image.png');
  });

  it('會拆標頭的字元被清掉', () => {
    // 換行或引號能在 Content-Disposition 裡拆出額外的標頭。
    const name = safeFilename('a"\r\nX-Evil: 1', 'png');
    expect(name).not.toContain('"');
    expect(name).not.toContain('\n');
    expect(name).not.toContain('\r');
  });

  it('全部被清光時給一個預設名字', () => {
    expect(safeFilename('中文檔名', 'png')).toBe('upload.png');
  });
});

describe('上傳', () => {
  it('位元組直接當 body，檔名放 Content-Disposition', async () => {
    mock = await startMockWordPress(() => ({ status: 201, body: mediaBody() }));
    const result = await uploadMedia(clientFor(mock), {
      bytes: PNG,
      mimeType: 'image/png',
      filename: 'diary-cover',
    });

    const req = mock.requests[0]!;
    expect(req.method).toBe('POST');
    expect(req.path).toContain('/wp-json/wp/v2/media');
    expect(req.contentType).toBe('image/png');
    expect(result.media.id).toBe(2001);
    expect(result.sha256).toBe(sha256Of(PNG));
  });

  it('alt 與圖說用第二個請求送——上傳那次只吃檔案本體', async () => {
    mock = await startMockWordPress((req): MockResponse =>
      req.path.includes('/media/2001')
        ? { body: mediaBody({ alt_text: '封面' }) }
        : { status: 201, body: mediaBody() },
    );

    const result = await uploadMedia(clientFor(mock), {
      bytes: PNG,
      mimeType: 'image/png',
      filename: 'cover',
      altText: '封面',
    });

    expect(mock.requests).toHaveLength(2);
    expect(JSON.parse(mock.requests[1]!.body)).toEqual({ alt_text: '封面' });
    expect(result.media.alt_text).toBe('封面');
  });

  it('沒有 alt 或圖說時不多送一次請求', async () => {
    mock = await startMockWordPress(() => ({ status: 201, body: mediaBody() }));
    await uploadMedia(clientFor(mock), { bytes: PNG, mimeType: 'image/png', filename: 'cover' });
    expect(mock.requests).toHaveLength(1);
  });

  it('上傳不重試——重試會在媒體庫留下重複檔案', async () => {
    mock = await startMockWordPress(() => ({ status: 500, body: {} }));
    await expect(
      uploadMedia(clientFor(mock), { bytes: PNG, mimeType: 'image/png', filename: 'cover' }),
    ).rejects.toThrow();
    expect(mock.requests).toHaveLength(1);
  });

  it('WordPress 拒絕檔案類型時的訊息提到 SVG', async () => {
    mock = await startMockWordPress(() => ({
      status: 400,
      body: { code: 'rest_upload_sideload_error', message: '…', data: { status: 400 } },
    }));
    await expect(
      uploadMedia(clientFor(mock), { bytes: PNG, mimeType: 'image/png', filename: 'cover' }),
    ).rejects.toThrow(/SVG 預設就是被擋掉的/);
  });
});
