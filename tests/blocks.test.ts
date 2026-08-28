import { describe, expect, it } from 'vitest';
import { toBlockMarkup } from '../src/wordpress/blocks.js';
import { BlockConversionError, BlockDefaultsSchema, DEFAULT_BLOCK_DEFAULTS } from '../src/wordpress/block-types.js';

/**
 * 這裡的期望值全部是從 www.remusplus.com 既有文章直接複製下來的真實標記，
 * 不是照著我對 Gutenberg 的理解寫的。理由：Gutenberg 開啟文章時會拿存檔內容跟
 * 區塊 save() 的輸出逐字比對，差一個空白或斜線就會判定「內容無效」。
 *
 * 所以修改序列化器時，判準是「跟正式站既有文章一模一樣」，不是「看起來合理」。
 */

const noFontSize = BlockDefaultsSchema.parse({
  paragraphFontSize: null,
  headingFontSize: null,
  imageAlign: null,
});

describe('段落', () => {
  it('產生跟正式站相同的 medium 段落標記', () => {
    const { markup } = toBlockMarkup('<p>多年前的某個晚上。</p>');
    expect(markup).toBe(
      '<!-- wp:paragraph {"fontSize":"medium"} -->\n' +
        '<p class="has-medium-font-size">多年前的某個晚上。</p>\n' +
        '<!-- /wp:paragraph -->',
    );
  });

  it('字級為 null 時不輸出 fontSize 屬性，也不加 class', () => {
    const { markup } = toBlockMarkup('<p>沒有指定字級。</p>', noFontSize);
    expect(markup).toBe('<!-- wp:paragraph -->\n<p>沒有指定字級。</p>\n<!-- /wp:paragraph -->');
  });

  it('HTML 已經帶字級 class 時以內容為準，不被預設值覆蓋', () => {
    const { markup } = toBlockMarkup('<p class="has-large-font-size">大字</p>');
    expect(markup).toContain('{"fontSize":"large"}');
    expect(markup).toContain('class="has-large-font-size"');
  });

  it('保留行內標籤', () => {
    const { markup } = toBlockMarkup('<p>看 <a href="https://example.com">連結</a> 與 <strong>粗體</strong></p>');
    expect(markup).toContain('<a href="https://example.com">連結</a>');
    expect(markup).toContain('<strong>粗體</strong>');
  });

  it('頂層區塊之間空一行', () => {
    const { markup } = toBlockMarkup('<p>一</p><p>二</p>');
    expect(markup).toContain('<!-- /wp:paragraph -->\n\n<!-- wp:paragraph');
  });

  it('丟掉空段落', () => {
    const { blocks } = toBlockMarkup('<p>有內容</p><p></p><p>  </p>');
    expect(blocks).toHaveLength(1);
  });
});

describe('標題', () => {
  it('h2 是核心預設階層，不寫 level 屬性', () => {
    const { markup } = toBlockMarkup('<h2><strong>理念美</strong></h2>', noFontSize);
    expect(markup).toBe(
      '<!-- wp:heading -->\n' +
        '<h2 class="wp-block-heading"><strong>理念美</strong></h2>\n' +
        '<!-- /wp:heading -->',
    );
  });

  it('h3 帶 level，且 level 排在 fontSize 前面', () => {
    const { markup } = toBlockMarkup('<h3 class="has-large-font-size">序言：卑鄙是卑鄙者的通行證</h3>');
    expect(markup).toBe(
      '<!-- wp:heading {"level":3,"fontSize":"large"} -->\n' +
        '<h3 class="wp-block-heading has-large-font-size">序言：卑鄙是卑鄙者的通行證</h3>\n' +
        '<!-- /wp:heading -->',
    );
  });

  it('正文的 h1 降成 h2，h1 保留給文章標題', () => {
    const { blocks } = toBlockMarkup('<h1>不該出現</h1>', noFontSize);
    expect(blocks[0]).toMatchObject({ type: 'heading', level: 2 });
  });
});

describe('清單', () => {
  it('巢狀寫法與正式站逐字相同', () => {
    const { markup } = toBlockMarkup(
      '<ul><li>權利（Right）</li><li>權力（Power）</li><li>特權（Privilege）</li></ul>',
      noFontSize,
    );
    expect(markup).toBe(
      '<!-- wp:list -->\n' +
        '<ul class="wp-block-list"><!-- wp:list-item -->\n' +
        '<li>權利（Right）</li>\n' +
        '<!-- /wp:list-item -->\n' +
        '\n' +
        '<!-- wp:list-item -->\n' +
        '<li>權力（Power）</li>\n' +
        '<!-- /wp:list-item -->\n' +
        '\n' +
        '<!-- wp:list-item -->\n' +
        '<li>特權（Privilege）</li>\n' +
        '<!-- /wp:list-item --></ul>\n' +
        '<!-- /wp:list -->',
    );
  });

  it('有序清單帶 ordered 屬性', () => {
    const { markup } = toBlockMarkup('<ol><li>一</li></ol>', noFontSize);
    expect(markup).toContain('<!-- wp:list {"ordered":true} -->');
    expect(markup).toContain('<ol class="wp-block-list">');
  });

  it('丟掉沒有項目的空清單', () => {
    const { blocks } = toBlockMarkup('<ul></ul>', noFontSize);
    expect(blocks).toHaveLength(0);
  });

  // 迴歸：巢狀清單一度被當成 li 的純 HTML 內容輸出，Gutenberg 會認不出那是清單區塊。
  // 期望值取自 read-think #1404。
  it('巢狀清單變成 li 裡面的獨立 wp:list 區塊', () => {
    const { markup } = toBlockMarkup(
      '<ol><li>價格傳遞稀缺訊號時，是用最經濟的方式傳遞。<ul><li>王大胖買木材蓋狗窩。</li></ul></li></ol>',
      noFontSize,
    );
    expect(markup).toBe(
      '<!-- wp:list {"ordered":true} -->\n' +
        '<ol class="wp-block-list"><!-- wp:list-item -->\n' +
        '<li>價格傳遞稀缺訊號時，是用最經濟的方式傳遞。<!-- wp:list -->\n' +
        '<ul class="wp-block-list"><!-- wp:list-item -->\n' +
        '<li>王大胖買木材蓋狗窩。</li>\n' +
        '<!-- /wp:list-item --></ul>\n' +
        '<!-- /wp:list --></li>\n' +
        '<!-- /wp:list-item --></ol>\n' +
        '<!-- /wp:list -->',
    );
  });
});

describe('分隔線與圖片', () => {
  it('分隔線的 hr 是自閉合寫法', () => {
    const { markup } = toBlockMarkup('<hr>');
    expect(markup).toBe(
      '<!-- wp:separator -->\n' +
        '<hr class="wp-block-separator has-alpha-channel-opacity"/>\n' +
        '<!-- /wp:separator -->',
    );
  });

  it('已上傳的圖片產生跟正式站相同的標記', () => {
    const { markup } = toBlockMarkup(
      '<figure class="wp-block-image aligncenter size-large">' +
        '<img src="https://www.remusplus.com/wp-content/uploads/2025/08/Sprengs-1-1024x723.webp" ' +
        'alt="Spreng&apos;s triangle-1" class="wp-image-1379"></figure>',
    );
    expect(markup).toBe(
      '<!-- wp:image {"id":1379,"sizeSlug":"large","linkDestination":"none","align":"center"} -->\n' +
        '<figure class="wp-block-image aligncenter size-large">' +
        '<img src="https://www.remusplus.com/wp-content/uploads/2025/08/Sprengs-1-1024x723.webp" ' +
        'alt="Spreng\'s triangle-1" class="wp-image-1379"/></figure>\n' +
        '<!-- /wp:image -->',
    );
  });

  it('還沒上傳的圖片不輸出 id 與 wp-image class', () => {
    const { markup } = toBlockMarkup('<figure><img src="https://example.com/a.png" alt="a"></figure>');
    expect(markup).toContain('<!-- wp:image {"sizeSlug":"large","linkDestination":"none","align":"center"} -->');
    expect(markup).not.toContain('wp-image-');
  });

  it('圖說用 wp-element-caption', () => {
    const { markup } = toBlockMarkup(
      '<figure><img src="https://example.com/a.png" alt="a"><figcaption>說明</figcaption></figure>',
    );
    expect(markup).toContain('<figcaption class="wp-element-caption">說明</figcaption>');
  });

  it('屬性值裡的引號會被跳脫，不會跳出屬性', () => {
    const { markup } = toBlockMarkup('<img src="https://example.com/a.png" alt=\'他說"嗨"\'>');
    expect(markup).toContain('alt="他說&quot;嗨&quot;"');
  });
});

describe('引用', () => {
  it('引用內部是巢狀區塊', () => {
    const { markup } = toBlockMarkup('<blockquote><p>引用的話</p></blockquote>', noFontSize);
    expect(markup).toBe(
      '<!-- wp:quote -->\n' +
        '<blockquote class="wp-block-quote"><!-- wp:paragraph -->\n' +
        '<p>引用的話</p>\n' +
        '<!-- /wp:paragraph --></blockquote>\n' +
        '<!-- /wp:quote -->',
    );
  });
});

describe('不靜默丟內容', () => {
  it('認不得的區塊級元素落到 wp:html 逃生門', () => {
    const { markup, fallbackCount } = toBlockMarkup('<table><tr><td>格</td></tr></table>');
    expect(fallbackCount).toBe(1);
    expect(markup).toContain('<!-- wp:html -->');
    expect(markup).toContain('<td>格</td>');
  });

  it('頂層的裸文字與行內標籤會併成一個段落', () => {
    const { blocks, markup } = toBlockMarkup('沒有被包住的字 <strong>還有粗體</strong>');
    expect(blocks).toHaveLength(1);
    expect(markup).toContain('<p class="has-medium-font-size">沒有被包住的字 <strong>還有粗體</strong></p>');
  });

  it('裸文字裡的角括號會被跳脫', () => {
    const { markup } = toBlockMarkup('a < b & c');
    expect(markup).toContain('a &lt; b &amp; c');
  });

  it('正常內容不會用到逃生門', () => {
    const { fallbackCount } = toBlockMarkup('<p>段落</p><h3>標題</h3><ul><li>項目</li></ul><hr>');
    expect(fallbackCount).toBe(0);
  });
});

/**
 * 以下全部來自 Codex 的 code review（2026-08-28）。每一條都是「輸出看起來成功、
 * 實際上內容被丟掉或被改動」的情況——比整份轉換失敗更危險，因為不會有人發現。
 */
describe('review 迴歸：不得靜默丟失或竄改內容', () => {
  it('巢狀清單後面還有文字時整份退到逃生門，順序不被偷改', () => {
    // 核心的 list-item 永遠先存文字再存子區塊，硬轉會把 after 搬到子清單前面。
    const { markup, fallbackCount } = toBlockMarkup(
      '<ul><li>before<ol><li>nested</li></ol>after</li></ul>',
      noFontSize,
    );
    expect(fallbackCount).toBe(1);
    expect(markup).toContain('before');
    expect(markup).toContain('nested');
    expect(markup).toContain('after');
    // 原本的順序必須原封不動
    expect(markup.indexOf('before')).toBeLessThan(markup.indexOf('nested'));
    expect(markup.indexOf('nested')).toBeLessThan(markup.indexOf('after'));
  });

  it('清單裡不是 li 的內容不會被吃掉', () => {
    // sanitize 會把 <ul><div>字</div> 的 div 拆掉但留下文字。
    const { markup, fallbackCount } = toBlockMarkup('<ul>重要<li>A</li></ul>', noFontSize);
    expect(fallbackCount).toBe(1);
    expect(markup).toContain('重要');
    expect(markup).toContain('A');
  });

  it('figure 有多張圖或額外內容時完整保留', () => {
    const { markup, fallbackCount } = toBlockMarkup(
      '<figure><img src="https://e.test/a.jpg" alt="A"><p>來源</p><img src="https://e.test/b.jpg" alt="B"></figure>',
    );
    expect(fallbackCount).toBe(1);
    expect(markup).toContain('a.jpg');
    expect(markup).toContain('b.jpg');
    expect(markup).toContain('來源');
  });

  it('figure 包表格時完整保留（不是裸 table）', () => {
    const { markup, fallbackCount } = toBlockMarkup(
      '<figure class="wp-block-table"><table><tbody><tr><td>格</td></tr></tbody></table></figure>',
    );
    expect(fallbackCount).toBe(1);
    expect(markup).toContain('wp-block-table');
    expect(markup).toContain('<td>格</td>');
  });

  it('裸 img 也會保留 media id', () => {
    const { markup } = toBlockMarkup('<img src="https://e.test/a.jpg" alt="A" class="wp-image-42">');
    expect(markup).toContain('"id":42');
    expect(markup).toContain('class="wp-image-42"');
  });

  it('清單各項的字級各自保留，不會被壓成第一項', () => {
    const { markup } = toBlockMarkup(
      '<ul><li class="has-small-font-size">A</li><li class="has-large-font-size">B</li></ul>',
      noFontSize,
    );
    expect(markup).toContain('{"fontSize":"small"}');
    expect(markup).toContain('{"fontSize":"large"}');
    expect(markup).toContain('<li class="has-small-font-size">A</li>');
    expect(markup).toContain('<li class="has-large-font-size">B</li>');
  });

  it('圖片的指定寬度與 is-resized 不被丟掉', () => {
    // 期望值取自 read-think #1369。
    const { markup } = toBlockMarkup(
      '<figure class="wp-block-image aligncenter size-large is-resized">' +
        '<img src="https://e.test/a.webp" alt="" class="wp-image-1370" style="width:800px"></figure>',
    );
    expect(markup).toBe(
      '<!-- wp:image {"id":1370,"width":"800px","sizeSlug":"large","linkDestination":"none","align":"center"} -->\n' +
        '<figure class="wp-block-image aligncenter size-large is-resized">' +
        '<img src="https://e.test/a.webp" alt="" class="wp-image-1370" style="width:800px"/></figure>\n' +
        '<!-- /wp:image -->',
    );
  });

  it('分隔線的樣式不被丟掉', () => {
    // 期望值取自 diary #1708。
    const { markup } = toBlockMarkup('<hr class="wp-block-separator is-style-wide">');
    expect(markup).toBe(
      '<!-- wp:separator {"className":"is-style-wide"} -->\n' +
        '<hr class="wp-block-separator has-alpha-channel-opacity is-style-wide"/>\n' +
        '<!-- /wp:separator -->',
    );
  });

  it('空的圖說整個略過——核心會略過，多輸出就判定內容無效', () => {
    const { markup } = toBlockMarkup(
      '<figure><img src="https://e.test/a.jpg" alt="A"><figcaption></figcaption></figure>',
    );
    expect(markup).not.toContain('figcaption');
  });

  it('過深但仍算真實內容（40 層）退到逃生門，內容保住', () => {
    const deep = '<ul><li>'.repeat(40) + 'X' + '</li></ul>'.repeat(40);
    const result = toBlockMarkup(deep, noFontSize);
    expect(result.fallbackCount).toBe(1);
    expect(result.markup).toContain('X');
  });

  it('荒謬的巢狀深度給出看得懂的錯誤，而不是爆堆疊', () => {
    const absurd = '<ul><li>'.repeat(2000) + 'X' + '</li></ul>'.repeat(2000);
    expect(() => toBlockMarkup(absurd, noFontSize)).toThrow(BlockConversionError);
    expect(() => toBlockMarkup(absurd, noFontSize)).toThrow(/巢狀深度/);
  });
});

describe('review 迴歸：區塊註解不可被內容破壞', () => {
  it('內容裡的假字級 class 不會進到區塊註解', () => {
    // has---->x-font-size 若原樣採用，`-->` 會把區塊註解提早關掉。
    const { markup } = toBlockMarkup('<p class="has---&gt;x-font-size">A</p>', noFontSize);
    expect(markup).toBe('<!-- wp:paragraph -->\n<p>A</p>\n<!-- /wp:paragraph -->');
  });

  it('manifest 填了不合法的字級 slug 會在載入時就被擋下', () => {
    expect(() => BlockDefaultsSchema.parse({ paragraphFontSize: '--><x' })).toThrow();
    expect(() => BlockDefaultsSchema.parse({ imageSizeSlug: 'a b' })).toThrow();
    expect(BlockDefaultsSchema.parse({ paragraphFontSize: 'x-large' }).paragraphFontSize).toBe('x-large');
  });
});

describe('決定性', () => {
  it('同樣的輸入永遠產生位元組相同的輸出', () => {
    const html = '<p>一</p><h3>二</h3><ul><li>三</li></ul>';
    expect(toBlockMarkup(html).markup).toBe(toBlockMarkup(html).markup);
  });

  it('預設值來自 schema，未指定時是 medium', () => {
    expect(DEFAULT_BLOCK_DEFAULTS.paragraphFontSize).toBe('medium');
    expect(DEFAULT_BLOCK_DEFAULTS.imageSizeSlug).toBe('large');
  });
});
