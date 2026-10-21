import { afterEach, describe, expect, it } from 'vitest';
import {
  TEXT_ALIGN_CLASSES,
  TEXT_ALIGN_CSS,
  normalizeTextAlignClass,
  textAlignOf,
  withTextAlign,
} from '../src/contract/text-align.js';
import { cleanRich, serializeRich } from '../src/contract/rich-text.js';
import { htmlToRich, normalizeEditedBody } from '../src/core/html-blocks.js';
import { sanitizeBody } from '../src/templates/sanitize.js';
import type { TemplateManifest } from '../src/templates/types.js';
import { toBlockMarkup } from '../src/wordpress/blocks.js';
import { DEFAULT_BLOCK_DEFAULTS, type BlockDefaults } from '../src/wordpress/block-types.js';
import {
  alignCommandValue,
  availableCommands,
  formatStateFrom,
  isCommandActive,
  isCommandEnabled,
  type FormatState,
} from '../src/ui/lib/rich-format.js';
import { setBlockTextAlign, type ClassTarget } from '../src/ui/lib/rich-commands.js';
import { readFileSync } from 'node:fs';
import { alignEnterAction, type AlignEnterCaret } from '../src/ui/lib/align-enter.js';
import { createCoreFixture, type CoreFixture } from './helpers/core-fixture.js';

/**
 * P5-T050（D-049）：段落與小標可選靠左／置中／靠右。
 *
 * 期望的標記照 WordPress 7.1.3 核心（站台 7.1+，D-043）。查證來源（Gutenberg dd294ab8，即 wordpress-develop 7.1.3
 * package.json 的 gutenberg.sha）：
 * - paragraph／heading 的 block.json 不再有 `align`／`textAlign` 屬性，改用 `supports.typography.textAlign`，
 *   值存在 `style.typography.textAlign`；
 * - `block-editor/src/hooks/text-align.js` 的 `addAssignedTextAlign` 把 `has-text-align-{值}` 放在 class 最前面，
 *   字級（font-size hook）接在後面，heading 的 `wp-block-heading` 由 generated-class-name 再放到最前面；
 * - 區塊屬性 JSON 裡 fontSize 在 style 前面（fixture `core__media-text__media-right-custom-width__deprecated`：
 *   `{"placeholder":"Content…","fontSize":"large","style":{"typography":{"textAlign":"right"}}}` 對
 *   `<p class="has-text-align-right has-large-font-size">`）；
 * - 不輸出 inline style（style-engine 的 typography 沒有 textAlign）。
 */

const previewSource = readFileSync(new URL('../src/preview/document.ts', import.meta.url), 'utf8');
const fixtureSource = readFileSync(new URL('../src/ui/service/fixtures/content.ts', import.meta.url), 'utf8');

const ALL_TAGS = ['p', 'h2', 'h3', 'ul', 'ol', 'li', 'a', 'strong', 'em', 'blockquote', 'figure', 'figcaption', 'img', 'br', 'hr'];

describe('共用規則（src/contract/text-align.ts）', () => {
  it('只認 left／center／right 三個值', () => {
    expect(textAlignOf('has-text-align-center')).toBe('center');
    expect(textAlignOf('wp-block-heading has-text-align-right has-medium-font-size')).toBe('right');
    expect(textAlignOf('has-text-align-left')).toBe('left');
    expect(textAlignOf('has-text-align-justify')).toBeNull();
    expect(textAlignOf('has-text-align-')).toBeNull();
    expect(textAlignOf(null)).toBeNull();
    expect(TEXT_ALIGN_CLASSES).toEqual(['has-text-align-left', 'has-text-align-center', 'has-text-align-right']);
  });

  it('換對齊：其他 class 不動，舊的對齊拿掉；null＝不對齊；變空回 null', () => {
    expect(withTextAlign('wp-block-paragraph has-medium-font-size', 'center')).toBe(
      'wp-block-paragraph has-medium-font-size has-text-align-center',
    );
    expect(withTextAlign('has-text-align-center wp-block-heading', 'right')).toBe('wp-block-heading has-text-align-right');
    expect(withTextAlign('has-text-align-center', null)).toBeNull();
    expect(withTextAlign(null, null)).toBeNull();
    expect(withTextAlign('has-text-align-justify x', null)).toBe('x');
  });

  it('編輯整理：不合法的值拿掉、只留一個；不能對齊的標籤全拿掉；沒有對齊 class 的原樣', () => {
    expect(normalizeTextAlignClass('p', 'wp-block-paragraph has-text-align-justify')).toBe('wp-block-paragraph');
    expect(normalizeTextAlignClass('p', 'has-text-align-center has-text-align-right')).toBe('has-text-align-center');
    expect(normalizeTextAlignClass('h2', 'wp-block-heading has-text-align-right')).toBe('wp-block-heading has-text-align-right');
    expect(normalizeTextAlignClass('li', 'has-text-align-center')).toBeNull();
    expect(normalizeTextAlignClass('blockquote', 'wp-block-quote has-text-align-center')).toBe('wp-block-quote');
    expect(normalizeTextAlignClass('p', '  a   b ')).toBe('  a   b ');
  });
});

describe('工具列（rich-format）', () => {
  const state = (ancestors: string[], align: 'left' | 'center' | 'right' | null = null): FormatState =>
    formatStateFrom(ancestors, null, align);

  it('三顆按鈕跟在「內文」那一組後面，只要模板有段落就出現', () => {
    const commands = availableCommands(ALL_TAGS);
    expect(commands.slice(6, 9)).toEqual(['align-left', 'align-center', 'align-right']);
    expect(availableCommands(['p'])).toEqual(['paragraph', 'align-left', 'align-center', 'align-right']);
    expect(availableCommands(['h3', 'ul', 'li'])).not.toContain('align-left');
  });

  it('亮起：沒設對齊時「靠左」亮；置中、靠右各自亮', () => {
    expect(isCommandActive('align-left', state(['p']))).toBe(true);
    expect(isCommandActive('align-center', state(['p']))).toBe(false);
    expect(isCommandActive('align-center', state(['strong', 'p'], 'center'))).toBe(true);
    expect(isCommandActive('align-left', state(['p'], 'center'))).toBe(false);
    expect(isCommandActive('align-right', state(['h3'], 'right'))).toBe(true);
    expect(isCommandActive('align-left', state(['p'], 'left'))).toBe(true);
  });

  it('段落與小標可以按；清單、引用、圖片（含圖說）裡反灰，也不亮', () => {
    for (const ancestors of [['p'], ['h2'], ['h3'], ['h4'], ['div']]) {
      expect(isCommandEnabled('align-center', state(ancestors))).toBe(true);
    }
    for (const ancestors of [['li', 'ul'], ['p', 'blockquote'], ['figcaption', 'figure'], ['a', 'figure']]) {
      expect(isCommandEnabled('align-center', state(ancestors))).toBe(false);
      expect(isCommandEnabled('align-left', state(ancestors))).toBe(false);
      expect(isCommandActive('align-left', state(ancestors))).toBe(false);
    }
  });

  it('套用／切換／取消：靠左＝拿掉；再按一次同一個＝取消', () => {
    expect(alignCommandValue('align-center', state(['p']))).toBe('center');
    expect(alignCommandValue('align-right', state(['p'], 'center'))).toBe('right');
    expect(alignCommandValue('align-center', state(['p'], 'center'))).toBeNull();
    expect(alignCommandValue('align-left', state(['p'], 'right'))).toBeNull();
    expect(alignCommandValue('align-left', state(['p']))).toBeNull();
  });
});

/** 只有 class 操作的假元素（照瀏覽器：拿掉 class 屬性就是沒有）。 */
function fakeBlock(tag: string, cls: string | null): ClassTarget & { cls: () => string | null } {
  let value = cls;
  return {
    tagName: tag.toUpperCase(),
    getAttribute: (name: string) => (name === 'class' ? value : null),
    setAttribute: (name: string, next: string) => {
      if (name === 'class') value = next;
    },
    removeAttribute: (name: string) => {
      if (name === 'class') value = null;
    },
    cls: () => value,
  };
}

describe('套到區塊元素（setBlockTextAlign）', () => {
  it('置中加 class、其他 class 不動；靠左拿掉；沒有別的 class 就整個拿掉 class 屬性', () => {
    const p = fakeBlock('p', 'wp-block-paragraph has-medium-font-size');
    expect(setBlockTextAlign(p, 'center')).toBe(true);
    expect(p.cls()).toBe('wp-block-paragraph has-medium-font-size has-text-align-center');
    expect(setBlockTextAlign(p, 'right')).toBe(true);
    expect(p.cls()).toBe('wp-block-paragraph has-medium-font-size has-text-align-right');
    expect(setBlockTextAlign(p, null)).toBe(true);
    expect(p.cls()).toBe('wp-block-paragraph has-medium-font-size');

    const bare = fakeBlock('h3', null);
    setBlockTextAlign(bare, 'center');
    expect(bare.cls()).toBe('has-text-align-center');
    setBlockTextAlign(bare, null);
    expect(bare.cls()).toBeNull();
  });

  it('沒變就回 false（不算動到正文）', () => {
    expect(setBlockTextAlign(fakeBlock('p', 'x'), null)).toBe(false);
    expect(setBlockTextAlign(fakeBlock('p', 'has-text-align-center'), 'center')).toBe(false);
  });

  it('清單、引用、圖片不動', () => {
    for (const tag of ['ul', 'li', 'blockquote', 'figure', 'hr']) {
      const block = fakeBlock(tag, 'x');
      expect(setBlockTextAlign(block, 'center')).toBe(false);
      expect(block.cls()).toBe('x');
    }
  });
});

const EDIT = { mode: 'edit' as const, allowedTags: ALL_TAGS, allowedSchemes: ['https'] };

describe('編輯整理（rich-text edit，前後端同一套）', () => {
  const edit = (html: string): string => serializeRich(cleanRich(htmlToRich(html), EDIT).nodes);

  it('p、h2、h3 的三種對齊保留', () => {
    expect(edit('<p class="wp-block-paragraph has-text-align-center">中</p>')).toBe(
      '<p class="wp-block-paragraph has-text-align-center">中</p>',
    );
    expect(edit('<h2 class="wp-block-heading has-text-align-right">右</h2>')).toBe('<h2 class="wp-block-heading has-text-align-right">右</h2>');
    expect(edit('<h3 class="has-text-align-left">左</h3>')).toBe('<h3 class="has-text-align-left">左</h3>');
  });

  it('不合法的值（justify、亂寫）拿掉；inline style（含 text-align）拿掉；align 屬性不帶', () => {
    expect(edit('<p class="has-text-align-justify">字</p>')).toBe('<p>字</p>');
    expect(edit('<p class="has-text-align-center" style="text-align: right">字</p>')).toBe('<p class="has-text-align-center">字</p>');
    expect(edit('<p style="text-align:center">字</p>')).toBe('<p>字</p>');
  });

  it('h4 變 h3、div 變段落時對齊跟著走；清單項目、引用身上的拿掉', () => {
    expect(edit('<h4 class="has-text-align-center">四</h4>')).toBe('<h3 class="has-text-align-center">四</h3>');
    expect(edit('<div class="has-text-align-right">字</div>')).toBe('<p class="has-text-align-right">字</p>');
    expect(edit('<ul class="wp-block-list"><li class="has-text-align-center">項</li></ul>')).toBe('<ul class="wp-block-list"><li>項</li></ul>');
    expect(edit('<blockquote class="wp-block-quote has-text-align-center"><p>引</p></blockquote>')).toBe(
      '<blockquote class="wp-block-quote"><p>引</p></blockquote>',
    );
  });

  it('貼上照舊不帶進來', () => {
    const nodes = cleanRich(htmlToRich('<p class="has-text-align-center" style="text-align:center">貼</p><h2 class="has-text-align-right">標</h2>'), {
      mode: 'paste',
      allowedTags: ALL_TAGS,
      allowedSchemes: ['https'],
    }).nodes;
    expect(serializeRich(nodes)).toBe('<p>貼</p><h2>標</h2>');
  });
});

const manifest = {
  allowedTags: ['p', 'h2', 'h3', 'ul', 'li', 'blockquote', 'strong'],
  // 跟三個模板一樣：li 不收 class；有收 class 的標籤都列了 allowedClasses。
  allowedAttributes: { p: ['class'], h2: ['class'], h3: ['class'], ul: ['class'], blockquote: ['class'] },
  allowedClasses: {
    p: ['wp-block-paragraph', 'has-medium-font-size'],
    h2: ['wp-block-heading'],
    h3: ['wp-block-heading'],
    ul: ['wp-block-list'],
    blockquote: ['wp-block-quote'],
  },
  allowedSchemes: ['https'],
} as unknown as TemplateManifest;

describe('後端 sanitize 再驗（唯一的關卡）', () => {
  const clean = (html: string, m: TemplateManifest = manifest): string => sanitizeBody(html, m).html;

  it('p、h2、h3 收三個對齊 class', () => {
    const html =
      '<p class="wp-block-paragraph has-medium-font-size has-text-align-center">中</p>' +
      '<h2 class="wp-block-heading has-text-align-right">右</h2><h3 class="has-text-align-left">左</h3>';
    expect(clean(html)).toBe(html);
  });

  it('其他值、其他標籤、inline style 一律拿掉', () => {
    expect(clean('<p class="has-text-align-justify has-text-align-centerx">字</p>')).toBe('<p>字</p>');
    expect(clean('<p style="text-align:center">字</p>')).toBe('<p>字</p>');
    expect(sanitizeBody('<p style="text-align:center">字</p>', manifest).removedAttributes).toEqual(['p.style']);
    expect(clean('<ul class="wp-block-list has-text-align-center"><li class="has-text-align-center">項</li></ul>')).toBe(
      '<ul class="wp-block-list"><li>項</li></ul>',
    );
    expect(clean('<blockquote class="wp-block-quote has-text-align-center"><p>引</p></blockquote>')).toBe(
      '<blockquote class="wp-block-quote"><p>引</p></blockquote>',
    );
  });

  it('模板不收 class 屬性的標籤，不因為對齊就放行', () => {
    const noClass = { ...manifest, allowedAttributes: {} } as unknown as TemplateManifest;
    expect(clean('<p class="has-text-align-center">字</p>', noClass)).toBe('<p>字</p>');
  });
});

const noFontSize: BlockDefaults = { ...DEFAULT_BLOCK_DEFAULTS, paragraphFontSize: null, headingFontSize: null, listItemFontSize: null };

describe('古騰堡區塊：逐字跟 WordPress 7.1 編輯器相同', () => {
  it('段落置中（站台預設 medium 字級）', () => {
    expect(toBlockMarkup('<p class="wp-block-paragraph has-medium-font-size has-text-align-center">中</p>').markup).toBe(
      '<!-- wp:paragraph {"fontSize":"medium","style":{"typography":{"textAlign":"center"}}} -->\n' +
        '<p class="has-text-align-center has-medium-font-size">中</p>\n' +
        '<!-- /wp:paragraph -->',
    );
  });

  it('段落靠右（沒有字級＝Gutenberg fixture core__paragraph__align-right 的寫法）', () => {
    expect(toBlockMarkup('<p class="has-text-align-right">右</p>', noFontSize).markup).toBe(
      '<!-- wp:paragraph {"style":{"typography":{"textAlign":"right"}}} -->\n' +
        '<p class="has-text-align-right">右</p>\n' +
        '<!-- /wp:paragraph -->',
    );
  });

  it('小標 h3 靠右（level → fontSize → style；class 是 wp-block-heading → 對齊 → 字級）', () => {
    expect(toBlockMarkup('<h3 class="wp-block-heading has-medium-font-size has-text-align-right">標</h3>').markup).toBe(
      '<!-- wp:heading {"level":3,"fontSize":"medium","style":{"typography":{"textAlign":"right"}}} -->\n' +
        '<h3 class="wp-block-heading has-text-align-right has-medium-font-size">標</h3>\n' +
        '<!-- /wp:heading -->',
    );
  });

  it('h2 置中、沒有字級', () => {
    expect(toBlockMarkup('<h2 class="has-text-align-center">大</h2>', noFontSize).markup).toBe(
      '<!-- wp:heading {"style":{"typography":{"textAlign":"center"}}} -->\n' +
        '<h2 class="wp-block-heading has-text-align-center">大</h2>\n' +
        '<!-- /wp:heading -->',
    );
  });

  it('靠左（WordPress 後台設的 has-text-align-left）照樣保留', () => {
    expect(toBlockMarkup('<p class="has-text-align-left">左</p>', noFontSize).markup).toBe(
      '<!-- wp:paragraph {"style":{"typography":{"textAlign":"left"}}} -->\n<p class="has-text-align-left">左</p>\n<!-- /wp:paragraph -->',
    );
  });

  it('沒有對齊的段落與小標輸出不變', () => {
    expect(toBlockMarkup('<p>字</p>').markup).toBe('<!-- wp:paragraph {"fontSize":"medium"} -->\n<p class="has-medium-font-size">字</p>\n<!-- /wp:paragraph -->');
    expect(toBlockMarkup('<h3>標</h3>', noFontSize).markup).toBe('<!-- wp:heading {"level":3} -->\n<h3 class="wp-block-heading">標</h3>\n<!-- /wp:heading -->');
  });

  it('不合法的對齊 class 不進區塊（到不了這裡也不會寫壞註解）', () => {
    expect(toBlockMarkup('<p class="has-text-align-justify">字</p>', noFontSize).markup).toBe('<!-- wp:paragraph -->\n<p>字</p>\n<!-- /wp:paragraph -->');
  });

  it('引用裡帶對齊的段落（後台設的）也保留', () => {
    expect(toBlockMarkup('<blockquote><p class="has-text-align-center">引</p></blockquote>', noFontSize).markup).toBe(
      '<!-- wp:quote -->\n<blockquote class="wp-block-quote"><!-- wp:paragraph {"style":{"typography":{"textAlign":"center"}}} -->\n' +
        '<p class="has-text-align-center">引</p>\n<!-- /wp:paragraph --></blockquote>\n<!-- /wp:quote -->',
    );
  });
});

describe('讀回再存不掉對齊', () => {
  // 拿掉區塊註解就是 post_content 裡的 HTML；走一遍我們的整條路（編輯整理 → sanitize → 區塊序列化）。
  const roundTrip = (markup: string, defaults: BlockDefaults = DEFAULT_BLOCK_DEFAULTS): string => {
    const html = markup.replace(/<!-- \/?wp:[^>]*-->\n?/g, '').trim();
    const full = {
      ...manifest,
      allowedClasses: { ...manifest.allowedClasses, h3: ['wp-block-heading', 'has-medium-font-size'] },
    } as unknown as TemplateManifest;
    return toBlockMarkup(sanitizeBody(normalizeEditedBody(html, { allowedSchemes: ['https'] }), full).html, defaults).markup;
  };

  it('WordPress 7.1 存出的置中段落、靠右小標，逐字不變', () => {
    const fromWordPress =
      '<!-- wp:paragraph {"fontSize":"medium","style":{"typography":{"textAlign":"center"}}} -->\n' +
      '<p class="has-text-align-center has-medium-font-size">置中的一段。</p>\n' +
      '<!-- /wp:paragraph -->\n\n' +
      '<!-- wp:heading {"level":3,"fontSize":"medium","style":{"typography":{"textAlign":"right"}}} -->\n' +
      '<h3 class="wp-block-heading has-text-align-right has-medium-font-size"><strong>靠右</strong></h3>\n' +
      '<!-- /wp:heading -->';
    expect(roundTrip(fromWordPress)).toBe(fromWordPress);
  });

  it('WordPress 7.0 以前的寫法（段落 align、小標 textAlign 屬性）HTML 一樣，讀回後改寫成新格式、對齊不掉', () => {
    const old =
      '<!-- wp:paragraph {"align":"center"} -->\n<p class="has-text-align-center">舊段落</p>\n<!-- /wp:paragraph -->\n\n' +
      '<!-- wp:heading {"textAlign":"right"} -->\n<h2 class="wp-block-heading has-text-align-right">舊標題</h2>\n<!-- /wp:heading -->';
    expect(roundTrip(old, noFontSize)).toBe(
      '<!-- wp:paragraph {"style":{"typography":{"textAlign":"center"}}} -->\n<p class="has-text-align-center">舊段落</p>\n<!-- /wp:paragraph -->\n\n' +
        '<!-- wp:heading {"style":{"typography":{"textAlign":"right"}}} -->\n<h2 class="wp-block-heading has-text-align-right">舊標題</h2>\n<!-- /wp:heading -->',
    );
  });
});

describe('校樣預覽看得到對齊（跟前台同一份 CSS）', () => {
  it('三條規則照核心 common.css；預覽文件與示範資料都帶', () => {
    expect(previewSource).toContain('TEXT_ALIGN_CSS');
    expect(fixtureSource).toContain('TEXT_ALIGN_CSS');
    expect(TEXT_ALIGN_CSS).toContain(':root .has-text-align-center{text-align:center}');
    expect(TEXT_ALIGN_CSS).toContain(':root .has-text-align-left{text-align:left}');
    expect(TEXT_ALIGN_CSS).toContain(':root .has-text-align-right{text-align:right}');
  });
});

describe('沒存的內容自動留底看得到對齊（P5-T048）', () => {
  it('MutationObserver 也看 class：對齊是直接改 class，不經過打字', () => {
    const source = readFileSync(new URL('../src/ui/lib/use-draft-backup.ts', import.meta.url), 'utf8');
    expect(source).toContain("attributeFilter: ['class']");
  });
});

describe('整條路：存檔 → 渲染 → 預覽 → 區塊', () => {
  let fixture: CoreFixture | null = null;
  afterEach(async () => {
    await fixture?.cleanup();
    fixture = null;
  });

  it('長文：置中段落、靠右小標存得進去，預覽帶 CSS；非法值與 inline style 被後端拿掉', async () => {
    fixture = await createCoreFixture();
    const { core } = fixture;
    const uuid = core.createJob({ targetKey: 'read-think', sourceText: '第一段。\n\n第二段。', title: '長文' }).uuid;

    core.createRevision(uuid, {
      editedBody:
        '<p class="wp-block-paragraph has-medium-font-size has-text-align-center">置中。</p>' +
        '<h3 class="wp-block-heading has-medium-font-size has-text-align-right">靠右</h3>' +
        '<p class="has-text-align-justify" style="text-align:justify">兩端。</p>',
      origin: 'manual',
    });
    const rendered = core.render(uuid);
    expect(rendered.publishHtml).toContain('<p class="wp-block-paragraph has-medium-font-size has-text-align-center">置中。</p>');
    expect(rendered.publishHtml).toContain('<h3 class="wp-block-heading has-medium-font-size has-text-align-right">靠右</h3>');
    expect(rendered.publishHtml).not.toContain('justify');
    expect(rendered.publishHtml).not.toContain('style=');
    expect(core.getPreviewDocument(uuid).html).toContain(TEXT_ALIGN_CSS);

    const markup = toBlockMarkup(rendered.publishHtml).markup;
    expect(markup).toContain(
      '<!-- wp:paragraph {"fontSize":"medium","style":{"typography":{"textAlign":"center"}}} -->\n<p class="has-text-align-center has-medium-font-size">置中。</p>',
    );
    expect(markup).toContain(
      '<!-- wp:heading {"level":3,"fontSize":"medium","style":{"typography":{"textAlign":"right"}}} -->\n' +
        '<h3 class="wp-block-heading has-text-align-right has-medium-font-size">靠右</h3>',
    );
  });

  it('日記：Agent 塞的 inline style 對齊照樣拿掉', async () => {
    fixture = await createCoreFixture();
    const { core } = fixture;
    const uuid = core.createJob({ targetKey: 'diary', sourceText: '一段。', title: '20261021' }).uuid;
    core.createRevision(uuid, { editedBody: '<p style="text-align:center" align="center">一段。</p>', origin: 'manual' });
    const html = core.render(uuid).publishHtml;
    expect(html).not.toContain('text-align');
    expect(html).not.toContain('align=');
  });
});

/**
 * 段尾按 Enter 不帶對齊（P5-T050 跟進）。照 Gutenberg `block-editor/src/store/actions.js` 的 `__unstableSplitSelection`
 * （7.1.3 對應的 dd294ab8）：游標是一個點、在段尾（含空段）→ 後面插一個 `createBlock(預設區塊)`＝沒有任何屬性的段落、游標移過去；
 * 在段首（段落有字）→ 前面插一個沒有屬性的空段落、游標留在原段；在段中 → 拆開，兩半都帶原本的屬性（對齊保留）。
 */
describe('對齊的段落／小標按 Enter（alignEnterAction）', () => {
  const key = (k: string, extra: Partial<Parameters<typeof alignEnterAction>[0]> = {}) => ({
    key: k,
    isComposing: false,
    shiftKey: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    ...extra,
  });
  const caret = (extra: Partial<AlignEnterCaret> = {}): AlignEnterCaret => ({
    aligned: true,
    collapsed: true,
    atStart: false,
    atEnd: true,
    ...extra,
  });

  it('段尾（含空段）：後面開一個不帶對齊的新段落', () => {
    expect(alignEnterAction(key('Enter'), caret())).toEqual({ kind: 'new-after' });
    expect(alignEnterAction(key('Enter'), caret({ atStart: true, atEnd: true }))).toEqual({ kind: 'new-after' });
  });

  it('段首（有字）：前面開一個不帶對齊的空段落，原段不動', () => {
    expect(alignEnterAction(key('Enter'), caret({ atStart: true, atEnd: false }))).toEqual({ kind: 'new-before' });
  });

  it('段中：交給瀏覽器拆開，兩半都保留對齊', () => {
    expect(alignEnterAction(key('Enter'), caret({ atEnd: false }))).toEqual({ kind: 'pass' });
  });

  it('沒對齊的段落、選了字、Shift／⌘ 組合、輸入法組字中、其他鍵：不攔', () => {
    expect(alignEnterAction(key('Enter'), caret({ aligned: false }))).toEqual({ kind: 'pass' });
    expect(alignEnterAction(key('Enter'), caret({ collapsed: false }))).toEqual({ kind: 'pass' });
    expect(alignEnterAction(key('Enter', { shiftKey: true }), caret())).toEqual({ kind: 'pass' });
    expect(alignEnterAction(key('Enter', { metaKey: true }), caret())).toEqual({ kind: 'pass' });
    expect(alignEnterAction(key('Enter', { isComposing: true }), caret())).toEqual({ kind: 'pass' });
    expect(alignEnterAction(key('Enter', { keyCode: 229 }), caret())).toEqual({ kind: 'pass' });
    expect(alignEnterAction(key('a'), caret())).toEqual({ kind: 'pass' });
  });

  it('掛在圖片按鍵處理後面，圖片優先（已被擋掉的 Enter 不再處理）', () => {
    const frame = readFileSync(new URL('../src/ui/lib/use-proof-frame.ts', import.meta.url), 'utf8');
    expect(frame.indexOf('attachAlignEnter(doc')).toBeGreaterThan(frame.indexOf('attachFigureKeys(doc'));
    const dom = readFileSync(new URL('../src/ui/lib/align-enter.ts', import.meta.url), 'utf8');
    expect(dom).toContain('event.defaultPrevented');
  });
});
