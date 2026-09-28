import { describe, expect, it } from 'vitest';
import {
  cleanRich,
  safeHref,
  serializeRich,
  type RichElement,
  type RichNode,
} from '../src/contract/rich-text.js';
import { htmlToRich } from '../src/core/html-blocks.js';

/**
 * P5-T028：直接在文章上改時可以加格式。
 *
 * 貼上（外來 HTML）與存檔（編輯區的 DOM）走同一套整理規則，放在共用契約裡，
 * 前端拿 DOM 轉成樹、後端拿 parse5 轉成樹，整理的是同一種樹。
 */

const LONGFORM_TAGS = ['p', 'h2', 'h3', 'ul', 'ol', 'li', 'a', 'strong', 'em', 'blockquote', 'figure', 'figcaption', 'img', 'br', 'hr'];
const SCHEMES = ['https', 'http', 'mailto'];

function paste(html: string, tags: readonly string[] = LONGFORM_TAGS): string {
  return serializeRich(cleanRich(htmlToRich(html), { mode: 'paste', allowedTags: tags, allowedSchemes: SCHEMES }).nodes);
}

function edit(html: string | RichNode[], tags: readonly string[] = LONGFORM_TAGS): { html: string; dropped: string[] } {
  const nodes = typeof html === 'string' ? htmlToRich(html) : html;
  const result = cleanRich(nodes, { mode: 'edit', allowedTags: tags, allowedSchemes: SCHEMES });
  return { html: serializeRich(result.nodes, '\n'), dropped: result.dropped };
}

const t = (text: string): RichNode => ({ type: 'text', text });
const el = (tag: string, children: RichNode[] = [], attrs: { name: string; value: string }[] = []): RichElement => ({
  type: 'element',
  tag,
  attrs,
  children,
});

describe('貼上：保留 allowlist 內的格式，其餘丟掉、字留著', () => {
  it('Google 文件：外層 font-weight:normal 的 <b> 不是粗體；span 的樣式轉成 strong／em', () => {
    const html =
      '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1a2b">' +
      '<p dir="ltr" style="line-height:1.38;margin-top:0pt;">' +
      '<span style="font-size:11pt;font-family:Arial;color:#000000;font-weight:400;font-style:normal;">普通</span>' +
      '<span style="font-size:11pt;font-weight:700;">粗體</span>' +
      '<span style="font-style:italic;">斜體</span></p>' +
      '<p dir="ltr"><a href="https://example.com/" style="text-decoration:none;">' +
      '<span style="color:#1155cc;text-decoration:underline;">連結</span></a></p></b>';
    expect(paste(html)).toBe('<p>普通<strong>粗體</strong><em>斜體</em></p><p><a href="https://example.com/">連結</a></p>');
  });

  it('Google 文件的巢狀清單（子清單直接放在 ul 裡）收進上一個項目', () => {
    expect(paste('<ul><li dir="ltr"><p dir="ltr"><span>一</span></p></li><ul><li><p>一之一</p></li></ul><li><p>二</p></li></ul>')).toBe(
      '<ul><li>一<ul><li>一之一</li></ul></li><li>二</li></ul>',
    );
  });

  it('Word：class、mso 樣式、o:p、條件註解都丟掉，粗斜體留著', () => {
    const html =
      "<p class=MsoNormal><b><span lang=EN-US style='font-size:12.0pt;mso-bidi-font-size:11.0pt'>Word 粗體</span></b>" +
      "<span style='mso-spacerun:yes'>&nbsp; </span><i>斜</i><o:p></o:p></p>" +
      "<p class=MsoListParagraph style='mso-list:l0 level1 lfo1'><![if !supportLists]><span>·</span><![endif]>項目</p>";
    expect(paste(html)).toBe('<p><strong>Word 粗體</strong>&nbsp; <em>斜</em></p><p>·項目</p>');
  });

  it('網頁：h1→h2、h4→h3；font、u、script、圖片、表格外框拿掉；壞連結與相對連結只留字', () => {
    const html =
      '<div class="article"><h1 style="font-size:3em">大標</h1><h4>小節</h4>' +
      '<p>字<font color="red">紅</font><u>底線</u> <script>alert(1)</script><a href="javascript:alert(1)">壞連結</a> ' +
      '<a href="/relative">相對</a> <a href="https://ok.com" target="_blank" onclick="x()">好</a></p>' +
      '<img src="https://x.com/a.png" alt="圖"><table><tr><td>格子</td></tr></table></div>';
    expect(paste(html)).toBe(
      '<h2>大標</h2><h3>小節</h3><p>字紅底線 壞連結 相對 <a href="https://ok.com">好</a></p><p>格子</p>',
    );
  });

  it('b／i 轉成 strong／em；只有行內內容時不包段落（插在游標處）', () => {
    expect(paste('<b>粗</b>與<i>斜</i>')).toBe('<strong>粗</strong>與<em>斜</em>');
    expect(paste('純文字 <span style="color:red">片段</span>')).toBe('純文字 片段');
  });

  it('被混淆的 javascript: 連結擋掉', () => {
    expect(paste('<p><a href=" jav&#x09;ascript:alert(1)">x</a></p>')).toBe('<p>x</p>');
    expect(paste('<p><a href="JAVASCRIPT:alert(1)">y</a></p>')).toBe('<p>y</p>');
    expect(paste('<p><a href="data:text/html,hi">z</a></p>')).toBe('<p>z</p>');
  });

  it('模板沒允許的格式降級：只允許 p／strong／br 時標題變段落、清單變段落、連結只留字', () => {
    expect(paste('<h2>標題</h2><ul><li>一</li><li>二</li></ul><p><a href="https://a.com">連</a><strong>粗</strong></p>', ['p', 'strong', 'br'])).toBe(
      '<p>標題</p><p>一</p><p>二</p><p>連<strong>粗</strong></p>',
    );
  });

  it('只允許 h3 時 h1／h2 都變 h3', () => {
    expect(paste('<h1>一</h1><h2>二</h2>', ['p', 'h3'])).toBe('<h3>一</h3><h3>二</h3>');
  });

  it('分隔線保留、屬性全丟；空的格式標籤拿掉', () => {
    expect(paste('<p>上</p><hr style="border:1px" class="x"><p><strong></strong>下</p>')).toBe('<p>上</p><hr><p>下</p>');
  });

  it('mailto 保留，tel 不在允許清單就只留字', () => {
    expect(paste('<p><a href="mailto:a@b.c">信</a><a href="tel:123">電</a></p>')).toBe('<p><a href="mailto:a@b.c">信</a>電</p>');
  });

  it('原始碼裡的換行縮排是排版，貼上時摺成一個空白', () => {
    expect(paste('<p>第一行\n      第二行</p>')).toBe('<p>第一行 第二行</p>');
  });

  it('行內與區塊混在一起時，行內的部分包成段落', () => {
    expect(paste('前面<p>段落</p>後面')).toBe('<p>前面</p><p>段落</p><p>後面</p>');
  });

  it('引用裡的 div 變段落', () => {
    expect(paste('<blockquote><div>一</div><div>二</div></blockquote>')).toBe('<blockquote><p>一</p><p>二</p></blockquote>');
  });
});

describe('存檔：整理瀏覽器編輯器產生的形狀', () => {
  it('Chrome 的清單會長在段落裡（<p><ul>）：拉出來', () => {
    const tree = [el('p', [el('ul', [el('li', [t('一')])])]), el('p', [t('二')])];
    expect(edit(tree).html).toBe('<ul><li>一</li></ul>\n<p>二</p>');
  });

  it('Chrome 縮排出來的子清單直接放在 ul 裡：收進上一個項目', () => {
    expect(edit('<ul><li>一</li><ul><li>一之一</li></ul><li>二</li></ul>').html).toBe(
      '<ul><li>一<ul><li>一之一</li></ul></li><li>二</li></ul>',
    );
  });

  it('子清單後面還有字：拆成下一個項目（古騰堡存不了「子清單在字前面」）', () => {
    expect(edit('<ul><li>一<ul><li>一之一</li></ul>尾巴</li></ul>').html).toBe(
      '<ul><li>一<ul><li>一之一</li></ul></li><li>尾巴</li></ul>',
    );
  });

  it('清單項目裡的 div／p 攤平成一行一行（br 分開）', () => {
    expect(edit('<ul><li><div>一</div><div>二</div></li><li><p>三</p></li></ul>').html).toBe(
      '<ul><li>一<br>二</li><li>三</li></ul>',
    );
  });

  it('清單項目裡的標題（Chrome 在清單裡按 H2 的產物）只留字', () => {
    const tree = [el('ul', [el('li', [el('h2', [t('標題')])])])];
    expect(edit(tree).html).toBe('<ul><li>標題</li></ul>');
  });

  it('標題裡包清單（<h2><ul>）：清單拉出來，不留空標題', () => {
    const tree = [el('h2', [el('ul', [el('li', [t('項')])])])];
    expect(edit(tree).html).toBe('<ul><li>項</li></ul>');
  });

  it('清單最後一個空項目（<li><br></li>）拿掉；空清單整個拿掉', () => {
    expect(edit('<ul><li>一</li><li><br></li></ul><ol><li></li></ol>').html).toBe('<ul><li>一</li></ul>');
  });

  it('引用裡的裸文字與 br（Chrome 選多段按引用的產物）變成一段一段', () => {
    expect(edit('<blockquote>一<br>二</blockquote>').html).toBe('<blockquote><p>一</p><p>二</p></blockquote>');
  });

  it('巢狀 div 都變段落', () => {
    expect(edit('<div><div>一</div><div>二</div></div>').html).toBe('<p>一</p>\n<p>二</p>');
  });

  it('Chrome 在標題裡按粗體留下的 <span style="font-weight: normal"> 拆掉', () => {
    expect(edit('<h2 class="wp-block-heading"><span style="font-weight: normal;">ab</span>c</h2>').html).toBe(
      '<h2 class="wp-block-heading">abc</h2>',
    );
  });

  it('span 的粗體樣式轉成 strong（不會默默消失）', () => {
    expect(edit('<p><span style="font-weight: bold;">粗</span><span style="font-style: italic;">斜</span></p>').html).toBe(
      '<p><strong>粗</strong><em>斜</em></p>',
    );
  });

  it('模板不支援的格式拿掉並回報，字留著', () => {
    expect(edit('<p><u>底線</u><s>刪</s><span>普通</span></p>')).toEqual({
      html: '<p>底線刪普通</p>',
      dropped: ['底線', '刪除線'],
    });
  });

  it('空的標題拿掉', () => {
    expect(edit('<p>一</p><h2><br></h2>').html).toBe('<p>一</p>');
  });

  it('沒動過的正文逐字不變（class、圖片、引用、分隔線都在）', () => {
    const body = [
      '<p class="wp-block-paragraph has-medium-font-size">一 &amp; &lt;二&gt;&nbsp;"三"</p>',
      '<h3 class="wp-block-heading">標題</h3>',
      '<ul class="wp-block-list"><li>c</li><li>d<ul class="wp-block-list"><li>e</li></ul></li></ul>',
      '<blockquote class="wp-block-quote"><p>引</p>\n<p>用</p></blockquote>',
      '<figure class="wp-block-image size-large"><img src="https://x.test/a.jpg?a=1&amp;b=2" alt="說&quot;明" class="wp-image-5"><figcaption class="wp-element-caption">圖說</figcaption></figure>',
      '<hr class="wp-block-separator has-alpha-channel-opacity">',
      '<p>有<a href="https://a.test/" target="_blank" rel="noopener">連結</a>與<strong>粗</strong><em>斜</em><br>換行</p>',
    ].join('\n');
    expect(edit(body)).toEqual({ html: body, dropped: [] });
  });

  it('編輯中的 javascript: 連結也只留字', () => {
    expect(edit('<p><a href="javascript:alert(1)">x</a></p>').html).toBe('<p>x</p>');
  });

  it('沒給 allowedTags 時不擋標籤（後端 sanitize 才是關卡），只整理形狀', () => {
    const result = cleanRich(htmlToRich('<p><u>底</u><b>粗</b></p>'), { mode: 'edit' });
    expect(serializeRich(result.nodes)).toBe('<p><u>底</u><strong>粗</strong></p>');
    expect(result.dropped).toEqual([]);
  });
});

describe('safeHref', () => {
  it('只收允許的 scheme，去掉前後空白', () => {
    expect(safeHref(' https://a.com/x ', SCHEMES)).toBe('https://a.com/x');
    expect(safeHref('mailto:a@b.c', SCHEMES)).toBe('mailto:a@b.c');
    expect(safeHref('javascript:alert(1)', SCHEMES)).toBeNull();
    expect(safeHref('java\nscript:alert(1)', SCHEMES)).toBeNull();
    expect(safeHref('/relative', SCHEMES)).toBeNull();
    expect(safeHref('//evil.com', SCHEMES)).toBeNull();
    expect(safeHref('https://a.com/x', ['http'])).toBeNull();
  });
});
