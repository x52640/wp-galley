import { afterEach, describe, expect, it } from 'vitest';
import { normalizeEditedBody } from '../src/core/html-blocks.js';
import { createCoreFixture, type CoreFixture } from './helpers/core-fixture.js';

/**
 * P5-T010：直接在文章上改。瀏覽器的 contenteditable 會產生一些模板不認得的東西，
 * 送去渲染之前先整理成模板允許的樣子，否則 sanitize 會靜靜地把粗體吃掉。
 */
describe('normalizeEditedBody', () => {
  it('b／i 換成 strong／em', () => {
    expect(normalizeEditedBody('<p>一<b>二</b><i>三</i></p>')).toBe('<p>一<strong>二</strong><em>三</em></p>');
  });

  it('拆掉 span、font 與標記用的 mark，文字留著', () => {
    expect(
      normalizeEditedBody('<p><span style="color:red">一</span><font>二</font><mark data-hl="3">三</mark></p>'),
    ).toBe('<p>一二三</p>');
  });

  it('拿掉 style 與 contenteditable，class 保留', () => {
    expect(normalizeEditedBody('<p class="wp-block-paragraph" style="margin:0" contenteditable="true">一</p>')).toBe(
      '<p class="wp-block-paragraph">一</p>',
    );
  });

  it('頂層 div 換成 p', () => {
    expect(normalizeEditedBody('<p>一</p>\n<div>二</div>')).toBe('<p>一</p>\n<p>二</p>');
  });

  it('刪掉 Chrome 留下的空段落，刻意的 &nbsp; 間隔段留著', () => {
    expect(normalizeEditedBody('<p>一</p>\n<p><br></p>\n<p></p>\n<p>&nbsp;</p>\n<p>二</p>')).toBe(
      '<p>一</p>\n<p>&nbsp;</p>\n<p>二</p>',
    );
  });

  it('段落裡的 br 不動（包括段尾的，可能是作者刻意的）', () => {
    expect(normalizeEditedBody('<p>一<br>二<br></p>')).toBe('<p>一<br>二<br></p>');
  });

  it('圖片段落不算空的', () => {
    const html = '<figure class="wp-block-image"><img src="https://example.com/a.png" alt=""></figure>';
    expect(normalizeEditedBody(html)).toBe(html);
  });
});

let fixture: CoreFixture | null = null;
afterEach(async () => {
  await fixture?.cleanup();
  fixture = null;
});

describe('createRevision({ editedBody })', () => {
  const SOURCE = '第一段，有「引號」與 & 符號。\n\n第二段。';

  it('沒改內容就存一次，發布的 HTML 逐字不變', async () => {
    fixture = await createCoreFixture();
    const { core } = fixture;
    const uuid = core.createJob({ targetKey: 'diary', sourceText: SOURCE, title: '20260923' }).uuid;
    const before = core.render(uuid);
    // 使用者在校樣上看到的就是 publishHtml；原封不動送回來。
    core.createRevision(uuid, { editedBody: before.publishHtml, origin: 'manual' });
    expect(core.render(uuid).publishHtml).toBe(before.publishHtml);
  });

  it('只換正文，標題照舊；編輯器的雜訊被整理掉', async () => {
    fixture = await createCoreFixture();
    const { core } = fixture;
    const uuid = core.createJob({ targetKey: 'diary', sourceText: SOURCE, title: '20260923' }).uuid;
    core.createRevision(uuid, { editedBody: '<p>改過的<b>第一段</b></p>\n<div>新的一段</div>\n<p><br></p>' });
    const detail = core.getJob(uuid);
    expect(detail.currentRevision?.templateData['title']).toBe('20260923');
    expect(core.render(uuid).publishHtml).toContain('<strong>第一段</strong>');
    expect(core.render(uuid).publishHtml).toContain('新的一段');
    expect(core.render(uuid).publishHtml).not.toContain('<br');
  });

  it('長文（hybrid）頂層裸文字也存得起來', async () => {
    fixture = await createCoreFixture();
    const { core } = fixture;
    const uuid = core.createJob({ targetKey: 'read-think', sourceText: SOURCE, title: '長文' }).uuid;
    expect(() => core.createRevision(uuid, { editedBody: '全選刪光重打的第一行<br>第二行' })).not.toThrow();
    expect(core.render(uuid).publishHtml).toContain('第二行');
  });

  it('整理之後跟原本一樣，就不建新版本', async () => {
    fixture = await createCoreFixture();
    const { core } = fixture;
    const uuid = core.createJob({ targetKey: 'diary', sourceText: SOURCE, title: '20260923' }).uuid;
    const before = core.render(uuid);
    const revision = core.createRevision(uuid, { editedBody: `${before.publishHtml}\n<p><br></p>` });
    expect(revision.id).toBe(before.revisionId);
    expect(core.listRevisions(uuid)).toHaveLength(1);
  });

  it('editedBody 與 templateData 不能同時給', async () => {
    fixture = await createCoreFixture();
    const { core } = fixture;
    const uuid = core.createJob({ targetKey: 'diary', sourceText: SOURCE, title: '20260923' }).uuid;
    expect(() => core.createRevision(uuid, { editedBody: '<p>一</p>', templateData: { title: 'x' } })).toThrow();
  });
});

describe('normalizeEditedBody：頂層的裸文字（全選刪光重打之後常見）', () => {
  it('包成段落；br 當作分段', () => {
    expect(normalizeEditedBody('第一行<br>第二行<strong>粗</strong>')).toBe(
      '<p class="wp-block-paragraph">第一行</p>\n<p class="wp-block-paragraph">第二行<strong>粗</strong></p>',
    );
  });

  it('行內元素之間的空白留著', () => {
    expect(normalizeEditedBody('<strong>a</strong> <em>b</em>')).toBe(
      '<p class="wp-block-paragraph"><strong>a</strong> <em>b</em></p>',
    );
  });

  it('夾在區塊之間的裸文字自成一段', () => {
    expect(normalizeEditedBody('<p>一</p>\n二\n<p>三</p>')).toBe(
      '<p>一</p>\n<p class="wp-block-paragraph">二</p>\n<p>三</p>',
    );
  });
});

/**
 * P5-T028：直接在文章上改時可以加格式。前端存檔前整理過一次；後端不信任前端，
 * 照同一套規則再整理，再走 schema、sanitize、結構驗證。這裡鎖住「存檔 → 渲染 → 古騰堡區塊」整條。
 */
describe('P5-T028：格式存檔後渲染與區塊正確', () => {
  const SOURCE = '第一段。\n\n第二段。';
  it('巢狀結構：子清單直接在 ul 裡、清單項目裡的 div、引用裡的 div', () => {
    expect(normalizeEditedBody('<ul><li>一</li><ul><li>一之一</li></ul></ul>')).toBe(
      '<ul><li>一<ul><li>一之一</li></ul></li></ul>',
    );
    expect(normalizeEditedBody('<ul><li><div>一</div><div>二</div></li></ul>')).toBe('<ul><li>一<br>二</li></ul>');
    expect(normalizeEditedBody('<blockquote><div>一</div><div>二</div></blockquote>')).toBe(
      '<blockquote><p>一</p><p>二</p></blockquote>',
    );
  });

  it('Chrome 的 <p><ul> 字串（瀏覽器序列化後）不留空段落', () => {
    expect(normalizeEditedBody('<p>前</p><p><ul><li>項</li></ul></p><p>後</p>')).toBe(
      '<p>前</p>\n<ul><li>項</li></ul>\n<p>後</p>',
    );
  });

  it('span 的粗斜體樣式轉成 strong／em；font-weight:normal 的 b 不是粗體', () => {
    expect(normalizeEditedBody('<p><span style="font-weight:700">粗</span><b style="font-weight:normal">不粗</b></p>')).toBe(
      '<p><strong>粗</strong>不粗</p>',
    );
  });

  it('h1 變 h2、h4 變 h3（長文只准 h2／h3，不然整份退回）', () => {
    expect(normalizeEditedBody('<h1>一</h1><h4>二</h4>')).toBe('<h2>一</h2>\n<h3>二</h3>');
  });

  it('給了 allowedSchemes 就把 javascript: 連結拆成純文字', () => {
    expect(normalizeEditedBody('<p><a href="javascript:alert(1)">x</a></p>', { allowedSchemes: ['https'] })).toBe('<p>x</p>');
  });

  it('長文：連結、粗斜體、H2、H3、清單、引用、分隔線存得起來，區塊標記正確、沒有 wp:html', async () => {
    fixture = await createCoreFixture();
    const { core } = fixture;
    const uuid = core.createJob({ targetKey: 'read-think', sourceText: SOURCE, title: '長文' }).uuid;
    // 模擬 Chrome 的 contenteditable 在各種操作之後的 innerHTML。
    const edited = [
      '<p>有<b>粗體</b>、<i>斜體</i>與<a href="https://example.com/">連結</a></p>',
      '<h2>大標</h2>',
      '<h3>小標</h3>',
      '<p><ul><li>項目一</li><li>項目二</li></ul></p>',
      '<p><ol><li>第一</li><ul><li>第一之一</li></ul></ol></p>',
      '<blockquote>引用一<br>引用二</blockquote>',
      '<hr>',
      '<p><a href="javascript:alert(1)">壞連結</a>結尾</p>',
    ].join('');
    core.createRevision(uuid, { editedBody: edited, origin: 'manual' });
    const rendered = core.render(uuid);
    const html = rendered.publishHtml;
    expect(html).toContain('<strong>粗體</strong>');
    expect(html).toContain('<em>斜體</em>');
    expect(html).toContain('<a href="https://example.com/">連結</a>');
    expect(html).not.toContain('javascript');
    expect(html).toContain('壞連結結尾');

    const { toBlockMarkup } = await import('../src/wordpress/blocks.js');
    const { DEFAULT_BLOCK_DEFAULTS } = await import('../src/wordpress/block-types.js');
    // 字級用 null（通用站台的樣子），比對的是區塊的形狀，不是這個站的字級設定。
    const result = toBlockMarkup(html, {
      ...DEFAULT_BLOCK_DEFAULTS,
      paragraphFontSize: null,
      headingFontSize: null,
      listItemFontSize: null,
    });
    expect(result.fallbackCount).toBe(0);
    const markup = result.markup;
    expect(markup).toContain('<!-- wp:heading -->\n<h2 class="wp-block-heading">大標</h2>\n<!-- /wp:heading -->');
    expect(markup).toContain('<!-- wp:heading {"level":3} -->\n<h3 class="wp-block-heading">小標</h3>\n<!-- /wp:heading -->');
    expect(markup).toContain(
      '<!-- wp:list -->\n<ul class="wp-block-list"><!-- wp:list-item -->\n<li>項目一</li>\n<!-- /wp:list-item -->\n\n<!-- wp:list-item -->\n<li>項目二</li>\n<!-- /wp:list-item --></ul>\n<!-- /wp:list -->',
    );
    expect(markup).toContain('<!-- wp:list {"ordered":true} -->\n<ol class="wp-block-list"><!-- wp:list-item -->\n<li>第一<!-- wp:list -->');
    expect(markup).toContain(
      '<!-- wp:quote -->\n<blockquote class="wp-block-quote"><!-- wp:paragraph -->\n<p>引用一</p>\n<!-- /wp:paragraph -->\n\n<!-- wp:paragraph -->\n<p>引用二</p>\n<!-- /wp:paragraph --></blockquote>\n<!-- /wp:quote -->',
    );
    expect(markup).toContain('<!-- wp:separator -->\n<hr class="wp-block-separator has-alpha-channel-opacity"/>\n<!-- /wp:separator -->');
    expect(markup).not.toContain('wp:html');
  });

  it('審查 #5：沒動到的「子清單後面還有字」清單，改別段存檔後結構不變，發布照舊走 wp:html 保底', async () => {
    fixture = await createCoreFixture();
    const { core } = fixture;
    const list = '<ol><li>A<ul><li>B</li></ul>Conclusion</li><li>C</li></ol>';
    const uuid = core.createJob({
      targetKey: 'diary',
      sourceText: SOURCE,
      title: '20260928',
      templateData: { title: '20260928', body: `<p>一</p>\n${list}` },
    }).uuid;
    // 使用者只改了第一段。
    core.createRevision(uuid, { editedBody: `<p>一改過</p>\n${list}` });
    const html = core.render(uuid).publishHtml;
    expect(html).toBe(`<p>一改過</p>\n${list}`);
    const { toBlockMarkup } = await import('../src/wordpress/blocks.js');
    const result = toBlockMarkup(html);
    expect(result.fallbackCount).toBe(1);
    expect(result.markup).toContain(`<!-- wp:html -->\n${list}\n<!-- /wp:html -->`);
  });

  it('審查 #2：清單身上的粗體，後端整理與古騰堡輸出都還是兩個項目', async () => {
    const normalized = normalizeEditedBody('<ul style="font-weight:bold"><li>A</li><li>B</li></ul>');
    expect(normalized).toBe('<ul><li><strong>A</strong></li><li><strong>B</strong></li></ul>');
    const { toBlockMarkup } = await import('../src/wordpress/blocks.js');
    const result = toBlockMarkup(normalized);
    expect(result.blocks[0]).toMatchObject({ type: 'list', items: [{ html: '<strong>A</strong>' }, { html: '<strong>B</strong>' }] });
  });

  it('日記（flexible）同樣存得起來', async () => {
    fixture = await createCoreFixture();
    const { core } = fixture;
    const uuid = core.createJob({ targetKey: 'diary', sourceText: SOURCE, title: '20260928' }).uuid;
    core.createRevision(uuid, { editedBody: '<p>一<b>二</b></p><h3>標</h3><ul><li>項</li></ul><hr>' });
    const html = core.render(uuid).publishHtml;
    expect(html).toBe('<p>一<strong>二</strong></p>\n<h3>標</h3>\n<ul><li>項</li></ul>\n<hr />');
  });

  it('稿件詳情帶著模板的 allowedTags 與 allowedSchemes（工具列靠它決定按鈕）', async () => {
    fixture = await createCoreFixture();
    const { core } = fixture;
    const uuid = core.createJob({ targetKey: 'read-think', sourceText: SOURCE, title: '長文' }).uuid;
    const detail = core.getJob(uuid);
    expect(detail.template?.allowedTags).toEqual(expect.arrayContaining(['a', 'strong', 'em', 'h2', 'h3', 'ul', 'ol', 'blockquote', 'hr']));
    expect(detail.template?.allowedSchemes).toEqual(['https', 'http', 'mailto']);
  });
});
