import { describe, expect, it } from 'vitest';
import {
  cleanRich,
  cleanRichEdit,
  richUnits,
  serializeRichEdit,
  safeHref,
  serializeRich,
  type RichElement,
  type RichNode,
} from '../src/contract/rich-text.js';
import { htmlToRich, htmlToRichUnits, normalizeEditedBody } from '../src/core/html-blocks.js';

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
      '<a href="../relative">相對</a> <a href="https://ok.com" target="_blank" onclick="x()">好</a></p>' +
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

  it('子清單後面還有字：照原本順序留在同一個項目，不自己造新項目（審查 #5）', () => {
    const body = '<ol><li>A<ul><li>B</li></ul>Conclusion</li><li>C</li></ol>';
    expect(edit(body).html).toBe(body);
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

describe('Codex 審查 #2–#5 的回歸', () => {
  it('#2 清單身上的粗體套進每個項目，不包住整個清單、不吃掉項目邊界', () => {
    const html = '<ul style="font-weight:bold"><li>A</li><li>B</li></ul>';
    expect(paste(html)).toBe('<ul><li><strong>A</strong></li><li><strong>B</strong></li></ul>');
    expect(edit(html).html).toBe('<ul><li><strong>A</strong></li><li><strong>B</strong></li></ul>');
  });

  it('#2 粗體／斜體包著好幾段：各段各自粗／斜，段落還是段落', () => {
    expect(paste('<b><p>一</p><p>二</p></b>')).toBe('<p><strong>一</strong></p><p><strong>二</strong></p>');
    expect(paste('<span style="font-style:italic"><ul><li>項<ul><li>子</li></ul></li></ul></span>')).toBe(
      '<ul><li><em>項</em><ul><li><em>子</em></li></ul></li></ul>',
    );
  });

  it('#3 項目裡的區塊跟後面的字之間要分開', () => {
    expect(edit('<ul><li><div>First</div>Second</li></ul>').html).toBe('<ul><li>First<br>Second</li></ul>');
    expect(edit('<ul><li>Zero<div>First</div>Second</li></ul>').html).toBe('<ul><li>Zero<br>First<br>Second</li></ul>');
  });

  it('#4 包裝元素裡的子清單照樣是子清單，層級不消失', () => {
    expect(edit('<ul><li><div>A<ul><li>B</li></ul></div></li></ul>').html).toBe('<ul><li>A<ul><li>B</li></ul></li></ul>');
    expect(paste('<ol><li><p>A</p><div><ol><li>B</li></ol></div></li></ol>')).toBe('<ol><li>A<ol><li>B</li></ol></li></ol>');
  });
});

describe('不變式：沒改過的合法正文，整理後逐字不變（審查 #5）', () => {
  // 站上實際會出現的形狀（wordpress-site.md 的區塊詞彙）加上 sanitize 放得過的合法 HTML。
  const LEGAL: readonly string[] = [
    '<p class="wp-block-paragraph has-medium-font-size">段落 <strong>粗<em>粗斜</em></strong> <a href="https://a.test/?a=1&amp;b=2" title="t">連</a><br>換行</p>',
    '<p>&nbsp;</p>',
    '<p><img src="https://a.test/i.png" alt="" class="wp-image-3"> 圖旁的字</p>',
    '<h2 class="wp-block-heading">大標</h2>',
    '<h3 class="wp-block-heading has-medium-font-size"><strong>小標</strong></h3>',
    '<ul class="wp-block-list"><li>a</li><li>b<ul class="wp-block-list"><li>c<ol class="wp-block-list"><li>d</li></ol></li></ul></li></ul>',
    '<ul>\n<li>有換行縮排</li>\n<li>第二項</li>\n</ul>',
    '<ol start="3" reversed=""><li>A<ul><li>B</li></ul>Conclusion</li><li>C</li></ol>',
    '<ol><li>A<ul><li>B</li></ul> <strong>尾巴</strong> 字</li></ol>',
    '<ul><li><strong>粗項目</strong>與<a href="mailto:a@b.c">信</a></li></ul>',
    '<blockquote class="wp-block-quote"><p>一</p>\n<p>二</p></blockquote>',
    '<blockquote class="wp-block-quote"><p>引</p><ul><li>引用裡的清單</li></ul></blockquote>',
    '<figure class="wp-block-image size-large"><img src="https://a.test/x.jpg" alt="說&quot;明" class="wp-image-5" width="800" height="600"></figure>',
    '<figure class="wp-block-image aligncenter size-full is-resized"><img src="https://a.test/y.jpg" alt=""><figcaption class="wp-element-caption">圖說 <em>斜</em></figcaption></figure>',
    '<hr class="wp-block-separator has-alpha-channel-opacity is-style-wide">',
    '<hr>',
  ];

  it.each(LEGAL)('%s', (html) => {
    expect(edit(html)).toEqual({ html, dropped: [] });
  });

  it('新策略：全部接在一起、只改最前面加的一段，其他每一塊逐字不變（前端與後端兩條路）', () => {
    const original = ['<p>會改的一段</p>', ...LEGAL].join('\n');
    const edited = original.replace('會改的一段', '改過了');
    expect(editAgainst(original, edited)).toEqual({ html: edited, dropped: [] });
    expect(normalizeEditedBody(edited, { previousBody: original })).toBe(edited);
  });

  it('全部接在一起（最外層用換行分隔，同後端的慣例）也不變', () => {
    const body = LEGAL.join('\n');
    expect(edit(body)).toEqual({ html: body, dropped: [] });
  });
});

describe('safeHref', () => {
  it('只收允許的 scheme，去掉前後空白', () => {
    expect(safeHref(' https://a.com/x ', SCHEMES)).toBe('https://a.com/x');
    expect(safeHref('mailto:a@b.c', SCHEMES)).toBe('mailto:a@b.c');
    expect(safeHref('javascript:alert(1)', SCHEMES)).toBeNull();
    expect(safeHref('java\nscript:alert(1)', SCHEMES)).toBeNull();
    expect(safeHref('../relative', SCHEMES)).toBeNull();
    expect(safeHref('//evil.com', SCHEMES)).toBeNull();
    expect(safeHref('https://a.com/x', ['http'])).toBeNull();
  });
});

/** 編輯存檔：只整理改過的頂層區塊（前端的走法：原始的區塊從同一種樹切出來）。 */
function editAgainst(original: string, edited: string, tags: readonly string[] = LONGFORM_TAGS): { html: string; dropped: string[] } {
  const result = cleanRichEdit(htmlToRich(edited), richUnits(htmlToRich(original)), { allowedTags: tags, allowedSchemes: SCHEMES });
  return { html: serializeRichEdit(result), dropped: result.dropped };
}

describe('新策略：沒改的頂層區塊原樣保留，只整理改過的（審查 F3／F5／#5）', () => {
  // 整理規則會改寫的合法形狀：以前使用者沒碰也會被改。
  const TOUCHY = [
    '<ul><li><h2>Heading</h2><blockquote><p>Quote</p></blockquote></li></ul>',
    '<ul><li>A<hr>B</li></ul>',
    '<p><a href="../post">相對</a></p>',
    '<ol><li>A<ul><li>B</li></ul>Conclusion</li><li>C</li></ol>',
    '<p><b>舊的 b</b><span style="color:red">紅</span></p>',
    '<div>頂層 div</div>',
  ];
  const ORIGINAL = ['<p>第一段</p>', ...TOUCHY, '<p>最後一段</p>'].join('\n');

  it('只改第一段：其他區塊（含整理規則會動的形狀）逐字不變，不提醒', () => {
    const edited = ORIGINAL.replace('第一段', '第一段改過');
    expect(editAgainst(ORIGINAL, edited)).toEqual({ html: edited, dropped: [] });
  });

  it('中間插入一段：前後的區塊都還是原樣（序列比對，不是位置對齊）', () => {
    const edited = ORIGINAL.replace('<p>第一段</p>', '<p>第一段</p>\n<p>新插的<b>一段</b></p>');
    const expected = ORIGINAL.replace('<p>第一段</p>', '<p>第一段</p>\n<p>新插的<strong>一段</strong></p>');
    expect(editAgainst(ORIGINAL, edited)).toEqual({ html: expected, dropped: [] });
  });

  it('刪掉一段：其他區塊都還是原樣', () => {
    const edited = ORIGINAL.replace('<p>第一段</p>\n', '');
    expect(editAgainst(ORIGINAL, edited)).toEqual({ html: edited, dropped: [] });
  });

  it('Enter 多出空段落、又刪掉一段：整理只作用在新的空段落', () => {
    const edited = ORIGINAL.replace('<p>最後一段</p>', '<p><br></p>').replace('<p>第一段</p>', '<p>第一段</p><p><br></p>');
    expect(editAgainst(ORIGINAL, edited).html).toBe(ORIGINAL.replace('\n<p>最後一段</p>', ''));
  });

  it('改過的區塊照樣整理，丟掉的格式一定要提醒（審查 F3）', () => {
    const edited = ORIGINAL.replace('<ul><li>A<hr>B</li></ul>', '<ul><li>A改<hr>B</li></ul>').replace(
      '<ul><li><h2>Heading</h2>',
      '<ul><li><h2>Heading改</h2>',
    );
    const result = editAgainst(ORIGINAL, edited);
    expect(result.html).toContain('<ul><li>A改<br>B</li></ul>');
    expect(result.html).toContain('<ul><li>Heading改<br>Quote</li></ul>');
    expect(result.dropped).toEqual(['標題', '引用', '分隔線']);
  });

  it('改過的區塊裡不收的相對連結：只留字並提醒', () => {
    const edited = ORIGINAL.replace('相對</a>', '相對改</a>');
    const result = editAgainst(ORIGINAL, edited);
    expect(result.html).toContain('<p>相對改</p>');
    expect(result.dropped).toEqual(['連結']);
  });

  it('後端：沒改的區塊逐字用上一版的原始片段（連 <br/>、單引號這種寫法都不動）', () => {
    const previous = "<p class='a'>一<br/>二</p>\n\n<ul><li>A<ul><li>B</li></ul>尾</li></ul>\n<p>三</p>";
    // 前端送回來的是瀏覽器序列化過的樣子。
    const edited = '<p class="a">一<br>二</p>\n<ul><li>A<ul><li>B</li></ul>尾</li></ul>\n<p>三改過</p>';
    expect(normalizeEditedBody(edited, { previousBody: previous })).toBe(
      "<p class='a'>一<br/>二</p>\n<ul><li>A<ul><li>B</li></ul>尾</li></ul>\n<p>三改過</p>",
    );
  });

  it('後端：區塊切法與原始片段', () => {
    const units = htmlToRichUnits('前面的字 <b>粗</b>\n<p>段</p>\n  \n<hr/>');
    expect(units.map((unit) => unit.source)).toEqual(['前面的字 <b>粗</b>', '<p>段</p>', '<hr/>']);
  });

  it('頂層的字改過：跟前後的區塊分開整理，包成段落', () => {
    const result = editAgainst('<p>一</p>', '<p>一</p>新打的字');
    expect(result.html).toBe('<p>一</p>\n<p class="wp-block-paragraph">新打的字</p>');
  });
});

describe('Codex 第二輪 F1／F2／F4 的回歸', () => {
  it('F1 項目裡段落的字與字之間的空白不能被修掉', () => {
    expect(edit('<ul><li><p>Hello <strong>world</strong></p></li></ul>').html).toBe('<ul><li>Hello <strong>world</strong></li></ul>');
    expect(edit('<ul><li><div>A <em>b</em> c</div><div> d </div></li></ul>').html).toBe('<ul><li>A <em>b</em> c<br>d</li></ul>');
    expect(paste('<ul><li><p><span>Hello</span> <b>world</b></p></li></ul>')).toBe('<ul><li>Hello <strong>world</strong></li></ul>');
  });

  it('F2 連結包著子清單：子清單留著，連結拆到兩段字上', () => {
    expect(edit('<ul><li><a href="https://a.test">A<ul><li>B</li></ul></a></li></ul>').html).toBe(
      '<ul><li><a href="https://a.test">A</a><ul><li><a href="https://a.test">B</a></li></ul></li></ul>',
    );
  });

  it('F2 連結包著區塊與後面的字：分段、連結都在', () => {
    expect(edit('<ul><li><a href="https://a.test"><div>First</div>Second</a></li></ul>').html).toBe(
      '<ul><li><a href="https://a.test">First</a><br><a href="https://a.test">Second</a></li></ul>',
    );
    expect(paste('<a href="https://a.test"><p>一</p><p>二</p></a>')).toBe(
      '<p><a href="https://a.test">一</a></p><p><a href="https://a.test">二</a></p>',
    );
  });

  it('F2 粗體包著連結包著區塊（多層透明包裝）', () => {
    expect(paste('<b><a href="https://a.test"><p>一</p><ul><li>二</li></ul></a></b>')).toBe(
      '<p><strong><a href="https://a.test">一</a></strong></p><ul><li><strong><a href="https://a.test">二</a></strong></li></ul>',
    );
  });

  it('F4 粗體裡明講不粗的字：拆開包，不會整理回整段粗', () => {
    expect(edit('<p><strong>A<span style="font-weight:normal">B</span>C</strong></p>').html).toBe(
      '<p><strong>A</strong>B<strong>C</strong></p>',
    );
    expect(edit('<p><strong>A<span style="font-weight:400">B</span></strong></p>').html).toBe('<p><strong>A</strong>B</p>');
  });

  it('F4 不粗的字藏在連結裡：連結跟著切開', () => {
    expect(edit('<p><b>A<a href="https://a.test">L<span style="font-weight:normal">N</span></a></b></p>').html).toBe(
      '<p><strong>A<a href="https://a.test">L</a></strong><a href="https://a.test">N</a></p>',
    );
  });

  it('F4 斜體同理（font-style:normal），b／i 本身帶 normal 也算', () => {
    expect(edit('<p><em>A<span style="font-style:normal">B</span></em></p>').html).toBe('<p><em>A</em>B</p>');
    expect(edit('<p><i>A<i style="font-style:normal">B</i></i></p>').html).toBe('<p><em>A</em>B</p>');
    expect(edit('<p><b>A<b style="font-weight:normal">B</b></b></p>').html).toBe('<p><strong>A</strong>B</p>');
  });

  it('F4 外面沒有粗體時，不粗的標記單純拿掉', () => {
    expect(edit('<p>A<span style="font-weight:normal">B</span></p>').html).toBe('<p>AB</p>');
  });

  it('F4 樣式粗體（span）裡面有不粗的字', () => {
    expect(paste('<span style="font-weight:700">A<span style="font-weight:400">B</span></span>')).toBe('<strong>A</strong>B');
  });
});

describe('F5 連結網址規則（使用者 2026-09-28 裁定）', () => {
  it('收：絕對網址、#錨點、單一 / 開頭的站內路徑（含 %2F 編碼，那仍是站內路徑）', () => {
    expect(safeHref('#s2', SCHEMES)).toBe('#s2');
    expect(safeHref('/about', SCHEMES)).toBe('/about');
    expect(safeHref(' /about?x=1#y ', SCHEMES)).toBe('/about?x=1#y');
    expect(safeHref('/%2F%2Fevil.test', SCHEMES)).toBe('/%2F%2Fevil.test');
  });

  it('不收：其他相對路徑、協定相對、反斜線與空白／控制字元的變形', () => {
    for (const href of ['../post', 'post', './x', '?q=1', '//evil.test', '/\\evil.test', '/ /evil.test', '/\t/evil.test', '\n//evil.test', '/\u0000/evil.test', '']) {
      expect(safeHref(href, SCHEMES), JSON.stringify(href)).toBeNull();
    }
  });

  it('貼上照同一套：站內路徑與錨點留、其他相對路徑只留字', () => {
    expect(paste('<p><a href="/about">站內</a><a href="#x">錨</a><a href="../p">相對</a><a href="//evil.test">外</a></p>')).toBe(
      '<p><a href="/about">站內</a><a href="#x">錨</a>相對外</p>',
    );
  });

  it('編輯整理照同一套，丟掉的要提醒', () => {
    expect(edit('<p><a href="/about">站內</a><a href="./x">相對</a></p>')).toEqual({
      html: '<p><a href="/about">站內</a>相對</p>',
      dropped: ['連結'],
    });
  });
});
