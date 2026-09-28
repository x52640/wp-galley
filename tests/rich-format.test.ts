import { describe, expect, it } from 'vitest';
import {
  availableCommands,
  formatStateFrom,
  isCommandActive,
  decideEditSave,
  isCommandEnabled,
  nextLinkEditor,
  parseLinkInput,
  shortcutCommand,
} from '../src/ui/lib/rich-format.js';

/** P5-T028：格式工具列的純規則（哪些按鈕出現、亮起、能按；連結網址怎麼收）。 */

const ALL = ['p', 'h2', 'h3', 'ul', 'ol', 'li', 'a', 'strong', 'em', 'blockquote', 'figure', 'figcaption', 'img', 'br', 'hr'];

describe('按鈕依模板 allowedTags 決定', () => {
  it('全部允許時十顆都在，順序固定', () => {
    expect(availableCommands(ALL)).toEqual(['link', 'bold', 'italic', 'h2', 'h3', 'paragraph', 'ul', 'ol', 'quote', 'hr']);
  });

  it('沒有 h2／blockquote／hr 的模板就不出現那幾顆', () => {
    expect(availableCommands(['p', 'h3', 'ul', 'li', 'a', 'strong', 'em', 'br'])).toEqual([
      'link',
      'bold',
      'italic',
      'h3',
      'paragraph',
      'ul',
    ]);
  });

  it('只有 li 沒有 ul 不算有項目清單', () => {
    expect(availableCommands(['p', 'li', 'ol'])).toEqual(['paragraph', 'ol']);
  });
});

describe('游標所在的狀態', () => {
  it('在粗體連結裡', () => {
    const state = formatStateFrom(['a', 'strong', 'p']);
    expect(state).toMatchObject({ bold: true, italic: false, link: true, block: 'paragraph', list: null, quote: false });
    expect(isCommandActive('bold', state)).toBe(true);
    expect(isCommandActive('link', state)).toBe(true);
    expect(isCommandActive('paragraph', state)).toBe(true);
  });

  it('b／i（瀏覽器產物）也算粗斜體', () => {
    expect(formatStateFrom(['i', 'b', 'p'])).toMatchObject({ bold: true, italic: true });
  });

  it('在編號清單裡：段落不亮、編號清單亮，H2／H3 不能按', () => {
    const state = formatStateFrom(['li', 'ol', 'blockquote']);
    expect(state).toMatchObject({ block: 'list', list: 'ol', quote: true });
    expect(isCommandActive('ol', state)).toBe(true);
    expect(isCommandActive('ul', state)).toBe(false);
    expect(isCommandActive('paragraph', state)).toBe(false);
    expect(isCommandEnabled('h2', state)).toBe(false);
    expect(isCommandEnabled('h3', state)).toBe(false);
    expect(isCommandEnabled('paragraph', state)).toBe(true);
  });

  it('巢狀清單看最近的那一層', () => {
    expect(formatStateFrom(['li', 'ul', 'li', 'ol']).list).toBe('ul');
  });

  it('在標題裡：粗體不能按（標題本來就粗），H2 亮', () => {
    const state = formatStateFrom(['h2']);
    expect(isCommandActive('h2', state)).toBe(true);
    expect(isCommandEnabled('bold', state)).toBe(false);
    expect(isCommandEnabled('ul', state)).toBe(true);
  });

  it('引用裡的段落：引用亮、段落也亮', () => {
    const state = formatStateFrom(['p', 'blockquote']);
    expect(isCommandActive('quote', state)).toBe(true);
    expect(isCommandActive('paragraph', state)).toBe(true);
  });

  it('游標不在任何區塊裡（正文最外層）當作段落', () => {
    expect(formatStateFrom([]).block).toBe('paragraph');
  });
});

describe('快捷鍵', () => {
  const key = (k: string, extra: Partial<{ metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) => ({
    key: k,
    metaKey: true,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...extra,
  });

  it('⌘B／⌘I／⌘K', () => {
    expect(shortcutCommand(key('b'))).toBe('bold');
    expect(shortcutCommand(key('I'))).toBe('italic');
    expect(shortcutCommand(key('k'))).toBe('link');
  });

  it('Ctrl 也算（非 Mac）', () => {
    expect(shortcutCommand(key('b', { metaKey: false, ctrlKey: true }))).toBe('bold');
  });

  it('⌘U 攔下來但不做事（底線不在 allowlist）', () => {
    expect(shortcutCommand(key('u'))).toBe('block');
  });

  it('其他組合不管', () => {
    expect(shortcutCommand(key('b', { metaKey: false }))).toBeNull();
    expect(shortcutCommand(key('b', { shiftKey: true }))).toBeNull();
    expect(shortcutCommand(key('z'))).toBeNull();
  });
});

describe('連結網址輸入', () => {
  const schemes = ['https', 'http', 'mailto'];

  it('站內路徑與錨點照收（F5）', () => {
    expect(parseLinkInput('/about', schemes)).toEqual({ ok: true, href: '/about' });
    expect(parseLinkInput('#section-2', schemes)).toEqual({ ok: true, href: '#section-2' });
  });

  it('完整網址原樣收', () => {
    expect(parseLinkInput('https://example.com/a?b=1', schemes)).toEqual({ ok: true, href: 'https://example.com/a?b=1' });
    expect(parseLinkInput('  mailto:me@example.com ', schemes)).toEqual({ ok: true, href: 'mailto:me@example.com' });
  });

  it('只打網域就補 https://', () => {
    expect(parseLinkInput('example.com/path', schemes)).toEqual({ ok: true, href: 'https://example.com/path' });
    expect(parseLinkInput('www.example.com', schemes)).toEqual({ ok: true, href: 'https://www.example.com' });
  });

  it('javascript: 與不允許的 scheme 擋下，講清楚收哪些', () => {
    const bad = parseLinkInput('javascript:alert(1)', schemes);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.message).toContain('https');
    expect(parseLinkInput('tel:123', schemes).ok).toBe(false);
  });

  it('空的、有空白、看不出是網址的都不收', () => {
    expect(parseLinkInput('   ', schemes).ok).toBe(false);
    expect(parseLinkInput('hello world', schemes).ok).toBe(false);
    expect(parseLinkInput('../relative', schemes).ok).toBe(false);
    expect(parseLinkInput('//evil.test', schemes).ok).toBe(false);
  });
});

describe('審查 #1：沒實質改動就存檔', () => {
  it('整理後相同＝unchanged（畫面要還原、不送出），就算有會被拿掉的格式也一樣', () => {
    expect(decideEditSave({ cleaned: '<p>a</p>', originalClean: '<p>a</p>', dropped: [], force: false })).toBe('unchanged');
    expect(decideEditSave({ cleaned: '<p>a</p>', originalClean: '<p>a</p>', dropped: ['底線'], force: false })).toBe('unchanged');
  });

  it('有改動：有會被拿掉的格式先確認，按了照樣存才送', () => {
    expect(decideEditSave({ cleaned: '<p>b</p>', originalClean: '<p>a</p>', dropped: ['底線'], force: false })).toBe('confirm-drop');
    expect(decideEditSave({ cleaned: '<p>b</p>', originalClean: '<p>a</p>', dropped: ['底線'], force: true })).toBe('save');
    expect(decideEditSave({ cleaned: '<p>b</p>', originalClean: '<p>a</p>', dropped: [], force: false })).toBe('save');
  });
});

describe('審查 #6：開著連結 A 的輸入框時改開連結 B', () => {
  it('每次打開都是新的一次（輸入框以 session 當 key 重建），網址換成 B 的', () => {
    const a = nextLinkEditor(null, 'https://a.test/', 1);
    const b = nextLinkEditor(a, 'https://b.test/', 2);
    expect(b.current).toBe('https://b.test/');
    expect(b.session).not.toBe(a.session);
  });

  it('同一個連結再按一次也重新開始（打到一半的字丟掉）', () => {
    const first = nextLinkEditor(null, 'https://a.test/', 1);
    const again = nextLinkEditor(first, 'https://a.test/', 2);
    expect(again.session).not.toBe(first.session);
  });

  it('計數器落後也不會撞到上一次的 session', () => {
    const first = nextLinkEditor(null, null, 5);
    expect(nextLinkEditor(first, null, 3).session).toBeGreaterThan(first.session);
  });
});

describe('F6：清單項目裡還包著段落（Google 文件貼上）', () => {
  it('祖先是 p、li、ul 時仍是清單情境', () => {
    const state = formatStateFrom(['p', 'li', 'ul']);
    expect(state).toMatchObject({ block: 'list', list: 'ul' });
    expect(isCommandActive('ul', state)).toBe(true);
    expect(isCommandActive('paragraph', state)).toBe(false);
    expect(isCommandEnabled('h2', state)).toBe(false);
    expect(isCommandEnabled('h3', state)).toBe(false);
  });

  it('div、標題、粗體夾在中間也一樣', () => {
    expect(formatStateFrom(['strong', 'div', 'li', 'ol']).block).toBe('list');
    expect(formatStateFrom(['h2', 'li', 'ul']).block).toBe('list');
    expect(isCommandEnabled('h2', formatStateFrom(['h2', 'li', 'ul']))).toBe(false);
  });

  it('清單外面的引用段落不受影響', () => {
    expect(formatStateFrom(['p', 'blockquote']).block).toBe('paragraph');
  });
});
