import { afterEach, describe, expect, it } from 'vitest';

import { createCoreFixture, TINY_PNG, type CoreFixture } from './helpers/core-fixture.js';
import {
  containsImage,
  findImageBlockIndex,
  removeImageFromBody,
  replaceImageInBody,
} from '../src/core/html-blocks.js';
import type { CoreService } from '../src/core/service.js';

/**
 * 圖片跟文字在同一段（審查 #9，P5-T019）。
 *
 * `<p>前文<img class="wp-image-N">後文</p>` 是合法的正文：整份採用 Agent 的稿、或在文章上直接改
 * （contenteditable 合併段落）都可能產生。移動、移除、換圖只能動圖片本身（連同包它的 figure），
 * 同一段的文字要留著。
 *
 * 一律用本機假 WordPress，絕不連真實網站。
 */

const SOURCE = '第一段。\n\n第二段。';
const P = (text: string): string => `<p class="wp-block-paragraph">${text}</p>`;

let fixture: CoreFixture | null = null;

afterEach(async () => {
  await fixture?.cleanup();
  fixture = null;
});

/** 建一篇稿，上傳一張圖，改成「第二段是 前文<img>後文」。 */
async function setupMixed(): Promise<{ core: CoreService; uuid: string; assetId: number; wpId: number }> {
  fixture = await createCoreFixture();
  const core = fixture.core;
  const uuid = core.createJob({ targetKey: 'diary', sourceText: SOURCE, title: '20260828' }).uuid;
  const asset = await core.addMedia(uuid, { bytes: TINY_PNG, mimeType: 'image/png', filename: 'a', altText: '圖' });
  const placed = core.placeMedia(uuid, asset.id, 0);
  const img = /<img[^>]*>/.exec(placed.publishHtml)![0];

  core.createRevision(uuid, {
    templateData: { title: '20260828', body: P('第一段。') + P(`前文${img}後文`) },
    reason: '手動編輯',
  });
  const html = core.getJob(uuid).currentRevision!.publishHtml;
  expect(html).toContain('前文');
  expect(html).toContain(`wp-image-${asset.wordpressMediaId}`);
  return { core, uuid, assetId: asset.id, wpId: asset.wordpressMediaId! };
}

function bodyOf(core: CoreService, uuid: string): string {
  return core.getJob(uuid).currentRevision!.publishHtml;
}

function countOf(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

describe('移動圖片不刪同段文字', () => {
  it('搬到最前面：前文與後文都留在原段，圖只出現一次', async () => {
    const { core, uuid, assetId, wpId } = await setupMixed();

    const revision = core.placeMedia(uuid, assetId, -1);

    expect(revision.publishHtml).toContain('前文');
    expect(revision.publishHtml).toContain('後文');
    expect(revision.publishHtml).toContain('第一段。');
    expect(countOf(revision.publishHtml, `wp-image-${wpId}`)).toBe(1);
    // 圖在最前面，文字那段還在，只是少了圖。
    expect(revision.publishHtml.indexOf(`wp-image-${wpId}`)).toBeLessThan(revision.publishHtml.indexOf('第一段。'));
    expect(revision.publishHtml).toMatch(/<p class="wp-block-paragraph">前文後文<\/p>/);
  });

  it('搬到所在那段之後：位置照使用者看到的算（那段沒被刪，不往前挪）', async () => {
    const { core, uuid, assetId, wpId } = await setupMixed();

    const revision = core.placeMedia(uuid, assetId, 1);

    const html = revision.publishHtml;
    expect(html).toMatch(/<p class="wp-block-paragraph">前文後文<\/p>/);
    expect(html.indexOf('後文')).toBeLessThan(html.indexOf(`wp-image-${wpId}`));
    expect(countOf(html, `wp-image-${wpId}`)).toBe(1);
  });
});

describe('同一張圖出現在兩塊：一塊整塊拿掉、一塊留下文字', () => {
  async function setupTwice() {
    const { core, uuid, assetId, wpId } = await setupMixed();
    const html = bodyOf(core, uuid);
    const img = /<img[^>]*>/.exec(html)![0];
    core.createRevision(uuid, {
      templateData: {
        title: '20260828',
        body: P('第一段。') + `<p class="wp-block-paragraph">${img}</p>` + P(`前文${img}後文`) + P('第四段。'),
      },
      reason: '手動編輯',
    });
    return { core, uuid, assetId, wpId };
  }

  it('插在最後一段之後：只有整塊拿掉的那塊讓位置往前挪一格', async () => {
    const { core, uuid, assetId, wpId } = await setupTwice();

    const html = core.placeMedia(uuid, assetId, 3).publishHtml;

    expect(countOf(html, `wp-image-${wpId}`)).toBe(1);
    expect(html).toMatch(/<p class="wp-block-paragraph">前文後文<\/p>/);
    expect(html.indexOf('第四段。')).toBeLessThan(html.indexOf(`wp-image-${wpId}`));
  });

  it('插在留下文字的那段之後：圖接在「前文後文」後面、「第四段」前面', async () => {
    const { core, uuid, assetId, wpId } = await setupTwice();

    const html = core.placeMedia(uuid, assetId, 2).publishHtml;

    expect(countOf(html, `wp-image-${wpId}`)).toBe(1);
    expect(html.indexOf('前文後文')).toBeLessThan(html.indexOf(`wp-image-${wpId}`));
    expect(html.indexOf(`wp-image-${wpId}`)).toBeLessThan(html.indexOf('第四段。'));
  });
});

describe('文字裡寫著 wp-image-N 不算圖在正文裡', () => {
  it('圖片清單不會把它標成已放進正文', async () => {
    const { core, uuid, assetId, wpId } = await setupMixed();
    core.createRevision(uuid, {
      templateData: { title: '20260828', body: P(`檔名是 wp-image-${wpId} 的那張`) },
      reason: '手動編輯',
    });

    expect(core.getJob(uuid).media.find((row) => row.id === assetId)).toMatchObject({ placed: false });
  });
});

describe('移除圖片不刪同段文字', () => {
  it('圖拿掉，前文與後文還在', async () => {
    const { core, uuid, assetId, wpId } = await setupMixed();

    core.removeMedia(uuid, assetId);

    const html = bodyOf(core, uuid);
    expect(html).not.toContain(`wp-image-${wpId}`);
    expect(html).toMatch(/<p class="wp-block-paragraph">前文後文<\/p>/);
    expect(html).toContain('第一段。');
  });
});

describe('換圖不刪同段文字', () => {
  it('換掉之後前文與後文還在，新圖接在那一段後面', async () => {
    const { core, uuid, assetId, wpId } = await setupMixed();

    const replaced = await core.replaceMedia(uuid, assetId, { bytes: TINY_PNG, mimeType: 'image/png', filename: 'b' });

    const html = bodyOf(core, uuid);
    expect(html).not.toContain(`wp-image-${wpId}`);
    expect(html).toMatch(/<p class="wp-block-paragraph">前文後文<\/p>/);
    expect(countOf(html, `wp-image-${replaced.wordpressMediaId}`)).toBe(1);
    expect(html.indexOf('後文')).toBeLessThan(html.indexOf(`wp-image-${replaced.wordpressMediaId}`));
  });
});

describe('removeImageFromBody／replaceImageInBody', () => {
  const FIG = (id: number): string =>
    `<figure class="wp-block-image"><img src="https://x/${id}.png" alt="" class="wp-image-${id}"><figcaption>說明</figcaption></figure>`;

  it('整塊都是那張圖（figure）：整塊拿掉，計入 dropped', () => {
    const result = removeImageFromBody(P('一') + FIG(5) + P('二'), 5);
    expect(result.html).not.toContain('wp-image-5');
    expect(result.html).not.toContain('說明');
    expect(result.touched).toBe(1);
    expect(result.droppedIndexes).toEqual([1]);
    expect(result.html).toContain('一');
    expect(result.html).toContain('二');
  });

  it('段落裡只有圖（連同連結、換行）：整段拿掉', () => {
    const result = removeImageFromBody(`${P('一')}<p><a href="https://x"><img class="wp-image-5" src="https://x/5.png"></a><br></p>`, 5);
    expect(result.droppedIndexes).toEqual([1]);
    expect(result.html).toBe(P('一'));
  });

  it('段落裡還有字：只拿掉圖，包它的空連結一起拿掉', () => {
    const result = removeImageFromBody(P('前文<a href="https://x"><img class="wp-image-5" src="https://x/5.png"></a>後文'), 5);
    expect(result.html).toBe(P('前文後文'));
    expect(result.touched).toBe(1);
    expect(result.droppedIndexes).toEqual([]);
  });

  it('群組裡還有別的段落：只拿掉那個 figure', () => {
    const result = removeImageFromBody(`<div class="wp-block-group">${P('留著')}${FIG(5)}</div>`, 5);
    expect(result.html).toBe(`<div class="wp-block-group">${P('留著')}</div>`);
    expect(result.droppedIndexes).toEqual([]);
  });

  it('圖庫：只拿掉那一張的 figure，其他張留著', () => {
    const result = removeImageFromBody(`<figure class="wp-block-gallery">${FIG(5)}${FIG(6)}</figure>`, 5);
    expect(result.html).not.toContain('wp-image-5');
    expect(result.html).toContain('wp-image-6');
  });

  it('圖庫沒有逐張包 figure：只拿掉那張 img，其他張與圖庫留著', () => {
    const html = '<figure class="wp-block-gallery"><img class="wp-image-5" src="https://x/5.png"><img class="wp-image-6" src="https://x/6.png"></figure>';
    const result = removeImageFromBody(html, 5);
    expect(result.html).toBe('<figure class="wp-block-gallery"><img class="wp-image-6" src="https://x/6.png"></figure>');
    expect(result.droppedIndexes).toEqual([]);
  });

  it('沒有 wp-block-gallery class、但裝著不只一張圖的 figure 也當圖庫', () => {
    const html = '<figure><img class="wp-image-5" src="https://x/5.png"><img class="wp-image-6" src="https://x/6.png"></figure>';
    expect(removeImageFromBody(html, 5).html).toBe('<figure><img class="wp-image-6" src="https://x/6.png"></figure>');
  });

  it('圖庫只剩那一張：拿掉之後圖庫空了，整塊拿掉', () => {
    const result = removeImageFromBody(`${P('一')}<figure class="wp-block-gallery">${FIG(5)}</figure>`, 5);
    expect(result.html).toBe(P('一'));
    expect(result.droppedIndexes).toEqual([1]);
  });

  it('引用裡只有那張圖：引用空了，整塊拿掉', () => {
    const result = removeImageFromBody(`${P('一')}<blockquote>${FIG(5)}</blockquote>`, 5);
    expect(result.html).toBe(P('一'));
    expect(result.droppedIndexes).toEqual([1]);
  });

  it('清單項目只有那張圖：空的 li 拿掉，其他項目留著；整個清單空了就整塊拿掉', () => {
    const kept = removeImageFromBody('<ul><li><img class="wp-image-5" src="https://x/5.png"></li><li>x</li></ul>', 5);
    expect(kept.html).toBe('<ul><li>x</li></ul>');

    const gone = removeImageFromBody(`${P('一')}<ol><li><img class="wp-image-5" src="https://x/5.png"></li></ol>`, 5);
    expect(gone.html).toBe(P('一'));
    expect(gone.droppedIndexes).toEqual([1]);
  });

  it('containsImage／findImageBlockIndex 只認 img 的 class', () => {
    const html = `${P('檔名是 wp-image-5 的那張')}\n${P('二')}\n${FIG(5)}`;
    expect(containsImage(P('檔名是 wp-image-5 的那張'), 5)).toBe(false);
    expect(containsImage(html, 5)).toBe(true);
    expect(containsImage(html, 51)).toBe(false);
    expect(findImageBlockIndex(html, 5)).toBe(2);
    expect(findImageBlockIndex(P('檔名是 wp-image-5 的那張'), 5)).toBe(-1);
  });

  it('只有文字裡寫著 wp-image-5、class 對不上的不算', () => {
    const html = P('檔名是 wp-image-5 的那張') + '<p><img class="wp-image-51" src="https://x/51.png"></p>';
    const result = removeImageFromBody(html, 5);
    expect(result.touched).toBe(0);
    expect(result.html).toContain('wp-image-51');
    expect(result.html).toContain('檔名是 wp-image-5 的那張');
  });

  it('沒碰到的區塊原樣保留', () => {
    const html = `${P('一')}\n${FIG(5)}\n${P('二')}`;
    expect(removeImageFromBody(html, 7)).toEqual({ html, touched: 0, droppedIndexes: [] });
  });

  it('換圖：整塊是圖就原地換；段落裡還有字就留字、新圖接在那段後面', () => {
    const whole = replaceImageInBody(P('一') + FIG(5) + P('二'), 5, '<figure>NEW</figure>');
    expect(whole.replaced).toBe(1);
    expect(whole.html).toBe([P('一'), '<figure>NEW</figure>', P('二')].join('\n'));

    const mixed = replaceImageInBody(P('前文<img class="wp-image-5" src="https://x/5.png">後文') + P('二'), 5, '<figure>NEW</figure>');
    expect(mixed.replaced).toBe(1);
    expect(mixed.html).toBe([P('前文後文'), '<figure>NEW</figure>', P('二')].join('\n'));
  });
});
