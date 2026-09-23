import { describe, expect, it } from 'vitest';

import { inspectImage, MediaUploadError, sniffImageType } from '../src/media/validate.js';
import { TINY_PNG } from './helpers/core-fixture.js';

/** 不信任來源的圖檔（Codex 生出來的）怎麼驗：類型看檔頭，不看副檔名（P5-T013）。 */
describe('inspectImage', () => {
  it('認得 PNG，並讀出尺寸', () => {
    expect(inspectImage(TINY_PNG)).toEqual({ mimeType: 'image/png', extension: 'png', width: 1, height: 1 });
  });

  it('GIF 與 JPEG 也讀得出尺寸', () => {
    const gif = new Uint8Array([...Buffer.from('GIF89a'), 0x10, 0x00, 0x09, 0x00, 0, 0, 0]);
    expect(inspectImage(gif)).toMatchObject({ mimeType: 'image/gif', width: 16, height: 9 });

    // SOI、APP0（長度 4）、SOF0：長度、精度、高 0x0200、寬 0x0300。
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x00, 0x03, 0x00, 0x03]);
    expect(inspectImage(jpeg)).toMatchObject({ mimeType: 'image/jpeg', width: 768, height: 512 });
  });

  it('不是圖（例如 SVG、HTML）就拒絕', () => {
    expect(() => inspectImage(new TextEncoder().encode('<svg onload=alert(1)>'))).toThrow(MediaUploadError);
    expect(sniffImageType(new Uint8Array(0))).toBeNull();
  });

  it('超過上限就拒絕', () => {
    const big = new Uint8Array(11 * 1024 * 1024);
    big.set(TINY_PNG);
    expect(() => inspectImage(big)).toThrow('超過上限');
  });
});
