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
