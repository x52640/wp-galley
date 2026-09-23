import { beforeAll, describe, expect, it } from 'vitest';
import { loadTemplateRegistry, type TemplateRegistry } from '../src/templates/registry.js';
import { renderRevision, RenderError } from '../src/templates/render.js';
import { toBlockMarkup } from '../src/wordpress/blocks.js';
import { BlockDefaultsSchema, DEFAULT_BLOCK_DEFAULTS, type BlockDefaults } from '../src/wordpress/block-types.js';
import { paths } from '../src/config/paths.js';

/**
 * 通用模板 article-v1（D-016，P8-T001）。
 *
 * 期望的區塊標記是照 WordPress 核心各區塊 save() 在**預設屬性**下的輸出寫的：
 * 沒有 fontSize、沒有佈景主題 class、圖片不預設置中。跟 tests/blocks.test.ts 不同，
 * 這裡**沒有**拿真實的通用站台逐字比對過——作者手上只有 remusplus 一個站。
 * 格式本身跟 remusplus 驗證過的序列化器是同一套，差別只在預設值（見 docs/specs/templates.md）。
 */

let registry: TemplateRegistry;
let articleDefaults: BlockDefaults;

beforeAll(async () => {
  registry = await loadTemplateRegistry(paths.templates);
  articleDefaults = BlockDefaultsSchema.parse(registry.get('article-v1').manifest.blockDefaults ?? {});
});

/** 走一次真實的管線：schema → sanitize → 結構規則 → 區塊標記。 */
function publish(body: string): string {
  const rendered = renderRevision(registry.get('article-v1'), { title: '標題', body });
  return toBlockMarkup(rendered.publishHtml, articleDefaults).markup;
}

describe('article-v1 manifest', () => {
  it('內容類型 article、hybrid、不綁特定 target（post 與 page 共用）', () => {
    const { manifest } = registry.get('article-v1');
    expect(manifest.contentType).toBe('article');
    expect(manifest.strictness).toBe('hybrid');
    expect(manifest.wordpressTargetKey).toBeNull();
    expect(manifest.structureRules.allowedHeadingLevels).toEqual([2, 3]);
  });

  it('區塊預設值全部不帶佈景主題設定：沒有字級、圖片不置中', () => {
    expect(articleDefaults).toEqual({
      paragraphFontSize: null,
      headingFontSize: null,
      listItemFontSize: null,
      imageSizeSlug: 'large',
      imageAlign: null,
    });
  });

  it('allowlist 裡沒有任何字級、顏色 class', () => {
    const classes = Object.values(registry.get('article-v1').manifest.allowedClasses).flat();
    expect(classes.filter((c) => /^has-/.test(c) && c !== 'has-alpha-channel-opacity')).toEqual([]);
  });

  it('remusplus 的兩個模板沒寫 blockDefaults，照舊用作者站台慣例（輸出逐字不變）', () => {
    for (const id of ['longform-v1', 'diary-v1']) {
      const { manifest } = registry.get(id);
      expect(manifest.blockDefaults).toBeUndefined();
      expect(BlockDefaultsSchema.parse(manifest.blockDefaults ?? {})).toEqual(DEFAULT_BLOCK_DEFAULTS);
    }
  });
});

describe('article-v1 → 核心區塊（預設屬性）', () => {
  it('段落：沒有屬性、沒有 class', () => {
    expect(publish('<p>第一段。</p>')).toBe('<!-- wp:paragraph -->\n<p>第一段。</p>\n<!-- /wp:paragraph -->');
  });

  it('Agent 偷塞字級 class 會被 sanitize 拿掉，不會變成 fontSize', () => {
    expect(publish('<p class="has-medium-font-size">字</p>')).toBe(
      '<!-- wp:paragraph -->\n<p>字</p>\n<!-- /wp:paragraph -->',
    );
    expect(publish('<h3 class="wp-block-heading has-large-font-size">小節</h3>')).toBe(
      '<!-- wp:heading {"level":3} -->\n<h3 class="wp-block-heading">小節</h3>\n<!-- /wp:heading -->',
    );
  });

  it('h2 不寫 level，h3 寫 level 3', () => {
    expect(publish('<h2 class="wp-block-heading">大章節</h2><h3>小節</h3>')).toBe(
      '<!-- wp:heading -->\n<h2 class="wp-block-heading">大章節</h2>\n<!-- /wp:heading -->\n\n' +
        '<!-- wp:heading {"level":3} -->\n<h3 class="wp-block-heading">小節</h3>\n<!-- /wp:heading -->',
    );
  });

  it('項目清單與編號清單', () => {
    expect(publish('<ul><li>一</li><li>二</li></ul>')).toBe(
      '<!-- wp:list -->\n' +
        '<ul class="wp-block-list"><!-- wp:list-item -->\n<li>一</li>\n<!-- /wp:list-item -->\n\n' +
        '<!-- wp:list-item -->\n<li>二</li>\n<!-- /wp:list-item --></ul>\n' +
        '<!-- /wp:list -->',
    );
    expect(publish('<ol class="wp-block-list"><li>一</li></ol>')).toBe(
      '<!-- wp:list {"ordered":true} -->\n' +
        '<ol class="wp-block-list"><!-- wp:list-item -->\n<li>一</li>\n<!-- /wp:list-item --></ol>\n' +
        '<!-- /wp:list -->',
    );
  });

  it('巢狀清單：子清單在 list-item 裡面', () => {
    expect(publish('<ul><li>外<ul><li>內</li></ul></li></ul>')).toBe(
      '<!-- wp:list -->\n' +
        '<ul class="wp-block-list"><!-- wp:list-item -->\n' +
        '<li>外<!-- wp:list -->\n' +
        '<ul class="wp-block-list"><!-- wp:list-item -->\n<li>內</li>\n<!-- /wp:list-item --></ul>\n' +
        '<!-- /wp:list --></li>\n' +
        '<!-- /wp:list-item --></ul>\n' +
        '<!-- /wp:list -->',
    );
  });

  it('引言：裡面的段落一樣不帶字級', () => {
    expect(publish('<blockquote class="wp-block-quote"><p>引用的話</p></blockquote>')).toBe(
      '<!-- wp:quote -->\n' +
        '<blockquote class="wp-block-quote"><!-- wp:paragraph -->\n<p>引用的話</p>\n<!-- /wp:paragraph --></blockquote>\n' +
        '<!-- /wp:quote -->',
    );
  });

  it('圖片：沒有對齊 class 就不寫 align', () => {
    expect(
      publish(
        '<figure class="wp-block-image size-large"><img src="https://example.test/a.jpg" alt="說明" class="wp-image-12" /></figure>',
      ),
    ).toBe(
      '<!-- wp:image {"id":12,"sizeSlug":"large","linkDestination":"none"} -->\n' +
        '<figure class="wp-block-image size-large"><img src="https://example.test/a.jpg" alt="說明" class="wp-image-12"/></figure>\n' +
        '<!-- /wp:image -->',
    );
  });

  it('圖片：有圖說；發布台插圖帶的 aligncenter 照核心格式輸出', () => {
    expect(
      publish(
        '<figure class="wp-block-image size-large aligncenter"><img src="https://example.test/b.png" alt="" class="wp-image-7" />' +
          '<figcaption class="wp-element-caption">圖說</figcaption></figure>',
      ),
    ).toBe(
      '<!-- wp:image {"id":7,"sizeSlug":"large","linkDestination":"none","align":"center"} -->\n' +
        '<figure class="wp-block-image aligncenter size-large"><img src="https://example.test/b.png" alt="" class="wp-image-7"/>' +
        '<figcaption class="wp-element-caption">圖說</figcaption></figure>\n' +
        '<!-- /wp:image -->',
    );
  });

  it('分隔線：預設與 wide', () => {
    expect(publish('<p>上</p><hr /><p>下</p>')).toBe(
      '<!-- wp:paragraph -->\n<p>上</p>\n<!-- /wp:paragraph -->\n\n' +
        '<!-- wp:separator -->\n<hr class="wp-block-separator has-alpha-channel-opacity"/>\n<!-- /wp:separator -->\n\n' +
        '<!-- wp:paragraph -->\n<p>下</p>\n<!-- /wp:paragraph -->',
    );
    expect(publish('<hr class="wp-block-separator is-style-wide" />')).toBe(
      '<!-- wp:separator {"className":"is-style-wide"} -->\n' +
        '<hr class="wp-block-separator has-alpha-channel-opacity is-style-wide"/>\n' +
        '<!-- /wp:separator -->',
    );
  });

  it('同一段 HTML 用作者站台的預設值會帶 medium——證明差別只在 manifest 的 blockDefaults', () => {
    const rendered = renderRevision(registry.get('article-v1'), { title: '標題', body: '<p>字</p>' });
    expect(toBlockMarkup(rendered.publishHtml).markup).toContain('{"fontSize":"medium"}');
    expect(toBlockMarkup(rendered.publishHtml, articleDefaults).markup).not.toContain('fontSize');
  });
});

describe('article-v1 資料與版型規則', () => {
  it('post 用的分類與 page 都用同一份 schema；category 是選填', () => {
    expect(() => renderRevision(registry.get('article-v1'), { title: 'x', body: '<p>y</p>' })).not.toThrow();
    expect(() =>
      renderRevision(registry.get('article-v1'), { title: 'x', body: '<p>y</p>', category: '未分類' }),
    ).not.toThrow();
    // 分類只能一個（D-004 的名稱比對一次一個，對不上的原樣回報）。
    expect(() =>
      renderRevision(registry.get('article-v1'), { title: 'x', body: '<p>y</p>', category: ['a', 'b'] }),
    ).toThrow(RenderError);
  });

  it('不收 tags 這種 schema 以外的欄位', () => {
    expect(() =>
      renderRevision(registry.get('article-v1'), { title: 'x', body: '<p>y</p>', tags: ['a'] }),
    ).toThrow(RenderError);
  });

  it('h4 不在版型裡：整份退回，不默默降級', () => {
    expect(() => renderRevision(registry.get('article-v1'), { title: 'x', body: '<h4>太深</h4>' })).toThrow(
      /h4/,
    );
  });

  it('預覽外框不會進 publishHtml', () => {
    const rendered = renderRevision(
      registry.get('article-v1'),
      { title: '外框標題', body: '<p>正文</p>', category: '雜記' },
      { displayDate: '2026-09-23' },
    );
    expect(rendered.publishHtml).toBe('<p>正文</p>');
    expect(rendered.previewHtml).toContain('外框標題');
    expect(rendered.previewHtml).toContain('雜記');
  });
});
