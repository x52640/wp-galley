import { describe, expect, it } from 'vitest';

import { editKeyAction, isShortcutEnabled, pasteAction, shouldBlockDrop, type EditKey } from '../src/ui/lib/proof-edit.js';
import type { FormatState } from '../src/ui/lib/rich-format.js';

/**
 * P5-T035：從 ProofView 抽出的「直接在文章上改」按鍵、貼上、拖放規則。純函式測，不碰 DOM。
 */

const PARAGRAPH: FormatState = { bold: false, italic: false, link: false, block: 'paragraph', list: null, quote: false };
const H2: FormatState = { ...PARAGRAPH, block: 'h2' };

function key(k: string, extra: Partial<EditKey> = {}): EditKey {
  return { key: k, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, isComposing: false, ...extra };
}

describe('isShortcutEnabled', () => {
  it('H2／H3 裡不加粗，斜體與連結照常', () => {
    expect(isShortcutEnabled('bold', H2)).toBe(false);
    expect(isShortcutEnabled('bold', { ...PARAGRAPH, block: 'h3' })).toBe(false);
    expect(isShortcutEnabled('italic', H2)).toBe(true);
    expect(isShortcutEnabled('link', H2)).toBe(true);
    expect(isShortcutEnabled('bold', PARAGRAPH)).toBe(true);
    expect(isShortcutEnabled('bold', { ...PARAGRAPH, block: 'list' })).toBe(true);
  });
});

describe('editKeyAction', () => {
  it('正文：⌘B／⌘I／⌘K 執行指令，Ctrl 也算', () => {
    expect(editKeyAction(key('b', { metaKey: true }), false, PARAGRAPH)).toEqual({ kind: 'run', command: 'bold' });
    expect(editKeyAction(key('I', { ctrlKey: true }), false, PARAGRAPH)).toEqual({ kind: 'run', command: 'italic' });
    expect(editKeyAction(key('k', { metaKey: true }), false, PARAGRAPH)).toEqual({ kind: 'run', command: 'link' });
  });

  it('正文：⌘U 擋掉不做事；一般按鍵與 ⌘Z 交給瀏覽器', () => {
    expect(editKeyAction(key('u', { metaKey: true }), false, PARAGRAPH)).toEqual({ kind: 'swallow' });
    expect(editKeyAction(key('a'), false, PARAGRAPH)).toEqual({ kind: 'pass' });
    expect(editKeyAction(key('Enter'), false, PARAGRAPH)).toEqual({ kind: 'pass' });
    expect(editKeyAction(key('z', { metaKey: true }), false, PARAGRAPH)).toEqual({ kind: 'pass' });
    expect(editKeyAction(key('b', { metaKey: true, shiftKey: true }), false, PARAGRAPH)).toEqual({ kind: 'pass' });
  });

  it('正文：H2 裡的 ⌘B 擋掉不做事；游標不在正文（state null）照樣執行', () => {
    expect(editKeyAction(key('b', { metaKey: true }), false, H2)).toEqual({ kind: 'swallow' });
    expect(editKeyAction(key('b', { metaKey: true }), false, null)).toEqual({ kind: 'run', command: 'bold' });
  });

  it('標題：Enter 跳到正文；選字中的 Enter 不攔', () => {
    expect(editKeyAction(key('Enter'), true, null)).toEqual({ kind: 'to-body' });
    expect(editKeyAction(key('Enter', { isComposing: true }), true, null)).toEqual({ kind: 'pass' });
  });

  it('標題：格式快捷鍵一律擋掉不做事，一般打字照常', () => {
    expect(editKeyAction(key('b', { metaKey: true }), true, PARAGRAPH)).toEqual({ kind: 'swallow' });
    expect(editKeyAction(key('k', { ctrlKey: true }), true, PARAGRAPH)).toEqual({ kind: 'swallow' });
    expect(editKeyAction(key('u', { metaKey: true }), true, PARAGRAPH)).toEqual({ kind: 'swallow' });
    expect(editKeyAction(key('x'), true, PARAGRAPH)).toEqual({ kind: 'pass' });
  });
});

describe('pasteAction', () => {
  const clean = (html: string): string => html.replace(/<span[^>]*>|<\/span>/g, '');

  it('標題：只插純文字，換行攤平、去頭尾空白，不看 HTML', () => {
    expect(pasteAction({ html: '<b>粗</b>', plain: '  第一行\n第二行  ' }, true, clean)).toEqual({
      command: 'insertText',
      value: '第一行 第二行',
    });
  });

  it('正文：有格式就插整理過的 HTML', () => {
    expect(pasteAction({ html: '<span>a<strong>b</strong></span>', plain: 'ab' }, false, clean)).toEqual({
      command: 'insertHTML',
      value: 'a<strong>b</strong>',
    });
  });

  it('正文：整理完是空的或沒有 HTML，就插純文字（原樣，不攤平）', () => {
    expect(pasteAction({ html: '<span> </span>', plain: 'x\ny' }, false, clean)).toEqual({ command: 'insertText', value: 'x\ny' });
    expect(pasteAction({ html: '  ', plain: '純文字' }, false, () => 'should-not-be-used')).toEqual({
      command: 'insertText',
      value: '純文字',
    });
  });
});

describe('shouldBlockDrop', () => {
  it('拖檔案或拖進標題擋掉；拖字進正文照常', () => {
    expect(shouldBlockDrop(['Files'], false)).toBe(true);
    expect(shouldBlockDrop(['text/plain'], true)).toBe(true);
    expect(shouldBlockDrop(['text/plain', 'text/html'], false)).toBe(false);
    expect(shouldBlockDrop([], false)).toBe(false);
  });
});
