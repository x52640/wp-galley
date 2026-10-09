import { afterEach, describe, expect, it } from 'vitest';
import {
  NEW_TAB_REL,
  isNewTabTarget,
  normalizeLinkAttrs,
  opensInNewTab,
  withNewTab,
  type LinkAttr,
} from '../src/contract/link-target.js';
import { cleanRich, serializeRich } from '../src/contract/rich-text.js';
import { htmlToRich, normalizeEditedBody } from '../src/core/html-blocks.js';
import { sanitizeBody } from '../src/templates/sanitize.js';
import type { TemplateManifest } from '../src/templates/types.js';
import { toBlockMarkup } from '../src/wordpress/blocks.js';
import { DEFAULT_BLOCK_DEFAULTS } from '../src/wordpress/block-types.js';
import { nextLinkEditor } from '../src/ui/lib/rich-format.js';
import { setLinkNewTab, type LinkAttrTarget } from '../src/ui/lib/rich-commands.js';
import { createCoreFixture, type CoreFixture } from './helpers/core-fixture.js';

/**
 * P5-T046（D-043）：連結可選「在新分頁開啟」。
 *
 * 期望的標記照 WordPress 區塊編輯器的輸出：format-library `createLinkFormat`
 * （WordPress 7.1.3 `wp-includes/js/dist/format-library.js`）在勾「Open in new tab」時
 * 設 `target = "_blank"`、`rel = "noopener"`，勾 nofollow 再接 ` nofollow`；
 * 連結格式的屬性依 url→href、target、rel 的順序寫出。站台是 7.1+（D-043）。
 */

const a = (pairs: Record<string, string>): LinkAttr[] => Object.entries(pairs).map(([name, value]) => ({ name, value }));
const NEW_TAB_LINK = '<a href="https://example.com/a?x=1&amp;y=2" target="_blank" rel="noopener">連結</a>';
const NOFOLLOW_LINK = '<a href="https://example.com/b" target="_blank" rel="noopener nofollow">贊助</a>';

describe('共用規則（src/contract/link-target.ts）', () => {
  it('只有 _blank（不分大小寫）算新分頁', () => {
    expect(isNewTabTarget('_blank')).toBe(true);
    expect(isNewTabTarget(' _BLANK ')).toBe(true);
    expect(isNewTabTarget('_self')).toBe(false);
    expect(isNewTabTarget('blank')).toBe(false);
    expect(isNewTabTarget(null)).toBe(false);
    expect(opensInNewTab(a({ href: 'https://x.test/', target: '_blank' }))).toBe(true);
    expect(opensInNewTab(a({ href: 'https://x.test/' }))).toBe(false);
  });

  it('勾：加上 target 與 rel，順序 href → target → rel', () => {
    expect(withNewTab(a({ href: 'https://x.test/' }), true)).toEqual(
      a({ href: 'https://x.test/', target: '_blank', rel: NEW_TAB_REL }),
    );
    expect(NEW_TAB_REL).toBe('noopener');
  });

  it('勾：已經有的 target／rel 改值、位置不動；rel 的其他值接在後面', () => {
    expect(withNewTab(a({ href: 'h', rel: 'nofollow', title: 't', target: 'win' }), true)).toEqual(
      a({ href: 'h', rel: 'noopener nofollow', title: 't', target: '_blank' }),
    );
  });

  it('不勾：拿掉 target 與 noopener（連舊的 noreferrer）；rel 剩其他值就留著', () => {
    expect(withNewTab(a({ href: 'h', target: '_blank', rel: 'noreferrer noopener' }), false)).toEqual(a({ href: 'h' }));
    expect(withNewTab(a({ href: 'h', target: '_blank', rel: 'noopener nofollow' }), false)).toEqual(a({ href: 'h', rel: 'nofollow' }));
    expect(withNewTab(a({ href: 'h', target: '_blank', rel: 'noreferrer noopener nofollow' }), false)).toEqual(
      a({ href: 'h', rel: 'nofollow' }),
    );
  });

  it('勾了又取消，回到原樣', () => {
    const plain = a({ href: 'https://x.test/' });
    expect(withNewTab(withNewTab(plain, true), false)).toEqual(plain);
  });

  it('後端整理：target 只收 _blank，其他值拿掉', () => {
    expect(normalizeLinkAttrs(a({ href: 'h', target: '_self' }))).toEqual(a({ href: 'h' }));
    expect(normalizeLinkAttrs(a({ href: 'h', target: '_top', rel: 'noopener' }))).toEqual(a({ href: 'h' }));
    expect(normalizeLinkAttrs(a({ href: 'h', target: '_BLANK' }))).toEqual(a({ href: 'h', target: '_blank', rel: NEW_TAB_REL }));
  });

  it('後端整理：有 _blank 時 rel 正規化成 noopener（缺 noopener 也補；舊的 noreferrer 拿掉）', () => {
    expect(normalizeLinkAttrs(a({ href: 'h', target: '_blank', rel: 'noopener' }))).toEqual(
      a({ href: 'h', target: '_blank', rel: 'noopener' }),
    );
    expect(normalizeLinkAttrs(a({ href: 'h', target: '_blank', rel: 'noreferrer noopener' }))).toEqual(
      a({ href: 'h', target: '_blank', rel: 'noopener' }),
    );
    expect(normalizeLinkAttrs(a({ href: 'h', target: '_blank', rel: 'noopener nofollow' }))).toEqual(
      a({ href: 'h', target: '_blank', rel: 'noopener nofollow' }),
    );
    expect(normalizeLinkAttrs(a({ href: 'h', target: '_blank', rel: 'nofollow' }))).toEqual(
      a({ href: 'h', target: '_blank', rel: 'noopener nofollow' }),
    );
    expect(normalizeLinkAttrs(a({ href: 'h', target: '_blank', rel: 'noopener noreferrer' }))).toEqual(
      a({ href: 'h', target: '_blank', rel: NEW_TAB_REL }),
    );
    expect(normalizeLinkAttrs(a({ href: 'h', target: '_blank', rel: 'opener' }))).toEqual(
      a({ href: 'h', target: '_blank', rel: 'noopener opener' }),
    );
  });

  it('後端整理：沒有 target 時不留孤兒 rel；有其他值就照原樣', () => {
    expect(normalizeLinkAttrs(a({ href: 'h', rel: 'noopener noreferrer' }))).toEqual(a({ href: 'h' }));
    expect(normalizeLinkAttrs(a({ href: 'h', rel: 'nofollow noopener' }))).toEqual(a({ href: 'h', rel: 'nofollow noopener' }));
    expect(normalizeLinkAttrs(a({ href: 'h', title: 't' }))).toEqual(a({ href: 'h', title: 't' }));
  });
});

describe('連結編輯框狀態', () => {
  it('新連結預設不勾；改既有連結時帶它目前的狀態', () => {
    expect(nextLinkEditor(null, null, 1).newTab).toBe(false);
    expect(nextLinkEditor(null, 'https://x.test/', 1, true).newTab).toBe(true);
    expect(nextLinkEditor(null, 'https://x.test/', 1, false).newTab).toBe(false);
  });
});

/** 只有屬性操作的假元素：照瀏覽器的行為，新屬性接在最後。 */
function fakeLink(pairs: Record<string, string>): LinkAttrTarget & { html: () => string } {
  let attrs = a(pairs);
  return {
    get attributes() {
      return attrs;
    },
    setAttribute(name: string, value: string) {
      const index = attrs.findIndex((attr) => attr.name === name);
      if (index === -1) attrs = [...attrs, { name, value }];
      else attrs = attrs.map((attr, i) => (i === index ? { name, value } : attr));
    },
    removeAttribute(name: string) {
      attrs = attrs.filter((attr) => attr.name !== name);
    },
    html: () => attrs.map((attr) => `${attr.name}="${attr.value}"`).join(' '),
  };
}

describe('編輯框套到連結元素（setLinkNewTab）', () => {
  it('勾：createLink 產生的 <a href> 變成 href target rel', () => {
    const link = fakeLink({ href: 'https://x.test/' });
    setLinkNewTab(link, true);
    expect(link.html()).toBe('href="https://x.test/" target="_blank" rel="noopener"');
  });

  it('改既有連結：取消勾選拿掉 target 與 rel', () => {
    const link = fakeLink({ href: 'https://x.test/', target: '_blank', rel: 'noopener' });
    setLinkNewTab(link, false);
    expect(link.html()).toBe('href="https://x.test/"');
  });

  it('改既有連結：維持勾選不動到其他屬性的位置', () => {
    const link = fakeLink({ href: 'https://x.test/', title: 't', target: '_blank', rel: 'noopener' });
    setLinkNewTab(link, true);
    expect(link.html()).toBe('href="https://x.test/" title="t" target="_blank" rel="noopener"');
  });
});

const manifest = {
  allowedTags: ['p', 'a', 'strong', 'em', 'br'],
  allowedAttributes: { a: ['href', 'title', 'target', 'rel'] },
  allowedClasses: {},
  allowedSchemes: ['https', 'http', 'mailto'],
} as unknown as TemplateManifest;

describe('後端 sanitize 再驗', () => {
  const clean = (html: string): string => sanitizeBody(html, manifest).html;

  it('新分頁連結逐字保留（含 noopener nofollow）', () => {
    expect(clean(`<p>${NEW_TAB_LINK}</p>`)).toBe(`<p>${NEW_TAB_LINK}</p>`);
    expect(clean(`<p>${NOFOLLOW_LINK}</p>`)).toBe(`<p>${NOFOLLOW_LINK}</p>`);
  });

  it('非 _blank 的 target 拿掉；孤兒 rel 拿掉', () => {
    expect(clean('<p><a href="https://x.test/" target="_parent" rel="noopener">x</a></p>')).toBe('<p><a href="https://x.test/">x</a></p>');
  });

  it('_blank 沒有 noopener 時補上（含 noopener 是安全要求）', () => {
    expect(clean('<p><a href="https://x.test/" target="_blank">x</a></p>')).toBe(
      '<p><a href="https://x.test/" target="_blank" rel="noopener">x</a></p>',
    );
    expect(clean('<p><a href="https://x.test/" target="_blank" rel="opener">x</a></p>')).toBe(
      '<p><a href="https://x.test/" target="_blank" rel="noopener opener">x</a></p>',
    );
  });

  it('網址被拒的連結照舊整個拆掉，不會因為有 target 留下空殼', () => {
    expect(clean('<p><a href="javascript:alert(1)" target="_blank">x</a></p>')).toBe('<p>x</p>');
  });

  it('target／rel 的整理不算「移除屬性」（不觸發退回重試）', () => {
    expect(sanitizeBody('<p><a href="https://x.test/" target="_self">x</a></p>', manifest).removedAttributes).toEqual([]);
  });
});

describe('貼上仍只留 href（D-028）', () => {
  it('外面網站的 target、rel 不帶進來', () => {
    const nodes = cleanRich(htmlToRich(`<p>${NEW_TAB_LINK}</p>`), {
      mode: 'paste',
      allowedTags: ['p', 'a'],
      allowedSchemes: ['https'],
    }).nodes;
    expect(serializeRich(nodes)).toBe('<p><a href="https://example.com/a?x=1&amp;y=2">連結</a></p>');
  });
});

describe('存檔 → 渲染 → 古騰堡標記：逐字跟 WordPress 編輯器相同', () => {
  let fixture: CoreFixture | null = null;
  afterEach(async () => {
    await fixture?.cleanup();
    fixture = null;
  });

  const blocksOf = (html: string): string =>
    toBlockMarkup(html, { ...DEFAULT_BLOCK_DEFAULTS, paragraphFontSize: null, headingFontSize: null, listItemFontSize: null }).markup;

  it('編輯整理（normalizeEditedBody）保留 target 與 rel', () => {
    expect(normalizeEditedBody(`<p>看${NEW_TAB_LINK}</p>`, { allowedSchemes: ['https'] })).toBe(`<p>看${NEW_TAB_LINK}</p>`);
  });

  it('區塊序列化逐字', () => {
    expect(blocksOf(`<p>看${NEW_TAB_LINK}。</p>`)).toBe(`<!-- wp:paragraph -->\n<p>看${NEW_TAB_LINK}。</p>\n<!-- /wp:paragraph -->`);
  });

  // 拿掉區塊註解就是 post_content 裡的 HTML；走一遍我們的整條路（編輯整理 → sanitize → 區塊序列化）。
  const roundTrip = (markup: string): string => {
    const html = markup.replace(/<!-- \/?wp:[^>]*-->\n?/g, '').trim();
    return blocksOf(sanitizeBody(normalizeEditedBody(html, { allowedSchemes: ['https'] }), manifest).html);
  };
  const paragraph = (inner: string): string => `<!-- wp:paragraph -->\n<p>${inner}</p>\n<!-- /wp:paragraph -->`;

  it('WordPress 7.1 存出的區塊（rel="noopener"、rel="noopener nofollow"）讀回再走一遍，逐字不變', () => {
    const fromWordPress = paragraph(`看${NEW_TAB_LINK}與${NOFOLLOW_LINK}。`);
    expect(roundTrip(fromWordPress)).toBe(fromWordPress);
  });

  it('舊格式（WordPress 7.0 以前）的 rel="noreferrer noopener" 整理成 noopener', () => {
    const old = paragraph('看<a href="https://example.com/c" target="_blank" rel="noreferrer noopener">舊連結</a>。');
    expect(roundTrip(old)).toBe(paragraph('看<a href="https://example.com/c" target="_blank" rel="noopener">舊連結</a>。'));
  });

  it('長文：存檔帶新分頁連結 → publishHtml 與區塊都保留；取消後再存，屬性消失', async () => {
    fixture = await createCoreFixture();
    const { core } = fixture;
    const uuid = core.createJob({ targetKey: 'read-think', sourceText: '第一段。\n\n第二段。', title: '長文' }).uuid;

    core.createRevision(uuid, { editedBody: `<p>看${NEW_TAB_LINK}</p><p>第二段。</p>`, origin: 'manual' });
    const withTab = core.render(uuid).publishHtml;
    expect(withTab).toContain(NEW_TAB_LINK);
    expect(blocksOf(withTab)).toContain(`<p>看${NEW_TAB_LINK}</p>`);

    const off = withTab.replace(' target="_blank" rel="noopener"', '');
    core.createRevision(uuid, { editedBody: off, origin: 'manual' });
    const html = core.render(uuid).publishHtml;
    expect(html).toContain('<a href="https://example.com/a?x=1&amp;y=2">連結</a>');
    expect(html).not.toContain('target=');
    expect(html).not.toContain('rel=');
  });

  it('日記：Agent 或編輯送來的 target="_self" 在發布前被拿掉', async () => {
    fixture = await createCoreFixture();
    const { core } = fixture;
    const uuid = core.createJob({ targetKey: 'diary', sourceText: '一段。', title: '20261009' }).uuid;
    core.createRevision(uuid, { editedBody: '<p><a href="https://x.test/" target="_self" rel="noopener">x</a></p>', origin: 'manual' });
    expect(core.render(uuid).publishHtml).toContain('<a href="https://x.test/">x</a>');
  });
});
