import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import type { RichNode } from '../src/contract/rich-text.js';
import { richUnits } from '../src/contract/rich-text.js';
import {
  besideFigureKeyAction,
  CLEAN_PARAGRAPH,
  figureKeyAction,
  figurePasteAction,
  type FigureCaret,
  type FigureKey,
} from '../src/ui/lib/figure-caret.js';
import {
  InsertSaveError,
  placedFigure,
  placedMatchesBase,
  placedOnBase,
  runInsertWhileWriting,
  targetIndex,
  savedAfterIndex,
  savedAnchor,
  topLevelCount,
  type InsertPrepare,
} from '../src/ui/lib/insert-while-writing.js';

/**
 * P5-T049（D-048）：打字模式也能「在這裡插圖」、圖片後按 Enter 不再變置中。
 */

const ALLOW = { tags: ['p', 'h2', 'h3', 'strong', 'em', 'a', 'ul', 'ol', 'li', 'blockquote', 'hr', 'figure', 'img', 'figcaption'], schemes: ['https'] };

const p = (text: string, attrs: { name: string; value: string }[] = []): RichNode => ({
  type: 'element',
  tag: 'p',
  attrs,
  children: [{ type: 'text', text }],
});
const nl: RichNode = { type: 'text', text: '\n' };
const emptyP: RichNode = { type: 'element', tag: 'p', attrs: [], children: [{ type: 'element', tag: 'br', attrs: [], children: [] }] };

describe('編輯區第幾塊 → 存好那一版的第幾塊（整理會拿掉空段落）', () => {
  it('最前面是 -1', () => {
    expect(savedAfterIndex([], null, ALLOW)).toBe(-1);
  });

  it('沒改過的區塊一塊算一塊', () => {
    const original = richUnits([p('一'), nl, p('二')]);
    expect(savedAfterIndex([p('一')], original, ALLOW)).toBe(0);
    expect(savedAfterIndex([p('一'), nl, p('二')], original, ALLOW)).toBe(1);
  });

  it('打字中多按的空段落存檔時會被拿掉：不算一塊', () => {
    const original = richUnits([p('一'), nl, p('二')]);
    expect(savedAfterIndex([p('一'), nl, emptyP, nl, p('二')], original, ALLOW)).toBe(1);
    expect(savedAfterIndex([p('一'), nl, emptyP], original, ALLOW)).toBe(0);
  });

  it('新寫的段落照樣算', () => {
    const original = richUnits([p('一')]);
    expect(savedAfterIndex([p('一'), nl, p('新的一段')], original, ALLOW)).toBe(1);
  });

  it('頂層塊數跟後端一樣：元素各一塊、空白文字不算', () => {
    expect(topLevelCount([p('一'), nl, { type: 'text', text: '裸字' }])).toBe(2);
  });
});

describe('錨點的字：往前第一個整理後還存在的區塊（審查 2：在自己剛開的空段落下面插圖）', () => {
  it('上一段後面按 Enter 開的空段落下面插：位置指到上一段、錨點是上一段的字', () => {
    const original = richUnits([p('一'), nl, p('二')]);
    expect(savedAnchor([p('一'), nl, emptyP], original, ALLOW)).toEqual({ afterIndex: 0, text: '一' });
  });

  it('開頭的空段落下面插：插在最前面、不比字', () => {
    const original = richUnits([p('一')]);
    expect(savedAnchor([emptyP], original, ALLOW)).toEqual({ afterIndex: -1, text: null });
  });

  it('最前面：-1、不比字', () => {
    expect(savedAnchor([], null, ALLOW)).toEqual({ afterIndex: -1, text: null });
  });

  it('一般段落：就是那一段的字；連續幾個空段落一樣往前找', () => {
    const original = richUnits([p('一'), nl, p('二')]);
    expect(savedAnchor([p('一'), nl, p('二')], original, ALLOW)).toEqual({ afterIndex: 1, text: '二' });
    expect(savedAnchor([p('一'), nl, emptyP, nl, emptyP], original, ALLOW)).toEqual({ afterIndex: 0, text: '一' });
  });

  it('錨點的字對得上新版本那一塊：不會被踢出打字模式', () => {
    const blocks = [
      { tag: 'p', text: '一', html: '<p>一</p>' },
      { tag: 'figure', text: '', html: '<figure><img class="wp-image-9"></figure>' },
    ];
    const anchor = savedAnchor([p('一'), nl, emptyP], richUnits([p('一')]), ALLOW);
    expect(placedFigure(blocks, anchor.afterIndex, anchor.text)).toBe(blocks[1]!.html);
  });
});

describe('新版本裡放進來的那塊圖：對得上才合併回編輯區', () => {
  const blocks = [
    { tag: 'p', text: '第一段', html: '<p>第一段</p>' },
    { tag: 'figure', text: '', html: '<figure class="wp-block-image"><img class="wp-image-9"></figure>' },
    { tag: 'p', text: '第二段', html: '<p>第二段</p>' },
  ];

  it('第 afterIndex+1 塊是 figure、前一塊的字對得上：拿那塊的 HTML', () => {
    expect(placedFigure(blocks, 0, '第一段')).toBe(blocks[1]!.html);
    expect(placedFigure(blocks, 0, '  第一段 \n')).toBe(blocks[1]!.html);
  });

  it('前一塊的字對不上（索引換算錯了）：不合併', () => {
    expect(placedFigure(blocks, 0, '第二段')).toBeNull();
    expect(placedFigure(blocks, 0, null)).toBeNull();
  });

  it('那一塊不是 figure：不合併', () => {
    expect(placedFigure(blocks, 1, '')).toBeNull();
  });

  it('插在最前面：不用比前一塊', () => {
    expect(placedFigure([blocks[1]!, blocks[0]!], -1, null)).toBe(blocks[1]!.html);
  });
});

describe('新版本必須是「我們知道的那一版＋這張圖」（Codex P1：別的分頁改過就不合併）', () => {
  const base = [
    { tag: 'p', text: '一', html: '<p>一</p>' },
    { tag: 'p', text: '二', html: '<p>二</p>' },
  ];
  const fig = { tag: 'figure', text: '', html: '<figure class="wp-block-image"><img class="wp-image-9"></figure>' };

  it('只多了那張圖：對得上', () => {
    expect(placedOnBase([base[0]!, fig, base[1]!], base, 0)).toBe(true);
    expect(placedOnBase([fig, ...base], base, -1)).toBe(true);
    expect(placedOnBase([...base, fig], base, 1)).toBe(true);
  });

  it('別段被別處改過（前一塊照樣對得上）：對不上', () => {
    expect(placedOnBase([base[0]!, fig, { tag: 'p', text: '二改', html: '<p>二改</p>' }], base, 0)).toBe(false);
  });

  it('別處多加或刪了一段：對不上', () => {
    expect(placedOnBase([base[0]!, fig, base[1]!, { tag: 'p', text: '三', html: '<p>三</p>' }], base, 0)).toBe(false);
    expect(placedOnBase([base[0]!, fig], base, 0)).toBe(false);
  });

  it('只差格式（文字一樣）也算改過：對不上', () => {
    expect(placedOnBase([base[0]!, fig, { tag: 'p', text: '二', html: '<p><strong>二</strong></p>' }], base, 0)).toBe(false);
  });

  it('不知道基準：當成對不上（不硬合併）', () => {
    expect(placedOnBase([base[0]!, fig, base[1]!], null, 0)).toBe(false);
  });
});

describe('標題也要跟基準一樣（Codex 第二輪 3：別處只改標題）', () => {
  const blocks = [{ tag: 'p', text: '一', html: '<p>一</p>' }];
  const fig = { tag: 'figure', text: '', html: '<figure><img class="wp-image-9"></figure>' };

  it('正文＝基準＋圖、標題一樣：對得上', () => {
    expect(placedMatchesBase({ blocks: [...blocks, fig], title: '標題' }, { blocks, title: '標題' }, 0)).toBe(true);
  });

  it('標題被別處改過：對不上', () => {
    expect(placedMatchesBase({ blocks: [...blocks, fig], title: '別人改的標題' }, { blocks, title: '標題' }, 0)).toBe(false);
  });

  it('不知道基準：對不上', () => {
    expect(placedMatchesBase({ blocks: [...blocks, fig], title: '標題' }, null, 0)).toBe(false);
  });
});

describe('上傳中在插入點前面加刪段落：用開始放圖時記住的那一塊算目前位置（Codex 第二輪 1）', () => {
  const a = { id: 'a' };
  const b = { id: 'b' };
  const c = { id: 'c' };

  it('前面多了一段：位置跟著那一塊走', () => {
    expect(targetIndex([a, c, b], b)).toBe(2);
  });

  it('插在最前面（沒有錨點那一塊）：一律 -1', () => {
    expect(targetIndex([a, b], null)).toBe(-1);
  });

  it('那一塊不見了：null（不放、講原因）', () => {
    expect(targetIndex([a, c], b)).toBeNull();
  });
});

describe('打字模式插圖的順序：先擋打字、先存再放、出錯一定放開打字', () => {
  function harness(options: {
    prepare?: InsertPrepare<string>;
    saveFails?: boolean;
    putFails?: boolean;
    merge?: boolean;
    still?: boolean;
  }) {
    const log: string[] = [];
    const run = runInsertWhileWriting<string, string>({
      done: async () => {
        log.push('done');
      },
      lock: () => {
        log.push('lock');
        return () => log.push('unlock');
      },
      prepare: () => {
        log.push('prepare');
        return options.prepare ?? { kind: 'go', save: 'body', afterIndex: 2 };
      },
      save: async (save) => {
        log.push(`save:${save}`);
        if (options.saveFails) throw new Error('沒存成功：409');
      },
      put: async (afterIndex) => {
        log.push(`put:${afterIndex}`);
        if (options.putFails) throw new Error('放不進去');
        return 'H2';
      },
      merge: (placed, afterIndex) => {
        log.push(`merge:${placed}:${afterIndex}`);
        return options.merge ?? true;
      },
      reload: () => log.push('reload'),
      still: () => options.still ?? true,
    });
    return { run, log };
  }

  it('有改動：擋打字 → 先存 → 放在換算後的位置 → 合併 → 放開打字（插完留在打字模式）', async () => {
    const { run, log } = harness({});
    await expect(run).resolves.toBe('placed');
    expect(log).toEqual(['lock', 'prepare', 'save:body', 'put:2', 'merge:H2:2', 'unlock', 'done']);
  });

  it('沒改動：不存，直接放', async () => {
    const { run, log } = harness({ prepare: { kind: 'go', save: null, afterIndex: -1 } });
    await expect(run).resolves.toBe('placed');
    expect(log).toEqual(['lock', 'prepare', 'put:-1', 'merge:H2:-1', 'unlock', 'done']);
  });

  it('存失敗：不放圖、講「沒存成功」（是存檔錯誤，不是「已存但動作沒做成」，審查 3）、放開打字', async () => {
    const { run, log } = harness({ saveFails: true });
    const error = await run.catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(InsertSaveError);
    expect((error as Error).message).toContain('沒存成功');
    expect(log).toEqual(['lock', 'prepare', 'save:body', 'unlock']);
  });

  it('放圖失敗：講原因、放開打字（存好的那一版照留）；不算存檔錯誤', async () => {
    const { run, log } = harness({ putFails: true });
    const error = await run.catch((cause: unknown) => cause);
    expect(error).not.toBeInstanceOf(InsertSaveError);
    expect((error as Error).message).toBe('放不進去');
    expect(log).toEqual(['lock', 'prepare', 'save:body', 'put:2', 'unlock']);
  });

  it('插入點那一段不見了：不存不放、講原因，不算存檔錯誤', async () => {
    const { run, log } = harness({ prepare: { kind: 'missing', message: '要插的那一段已經不見了' } });
    const error = await run.catch((cause: unknown) => cause);
    expect(error).not.toBeInstanceOf(InsertSaveError);
    expect((error as Error).message).toBe('要插的那一段已經不見了');
    expect(log).toEqual(['lock', 'prepare', 'unlock']);
  });

  it('標題清空之類存不了：不存不放，算存檔錯誤', async () => {
    const { run, log } = harness({ prepare: { kind: 'invalid', message: '標題不能是空的' } });
    const error = await run.catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(InsertSaveError);
    expect((error as Error).message).toBe('標題不能是空的');
    expect(log).toEqual(['lock', 'prepare', 'unlock']);
  });

  it('有會被拿掉的格式：先問照樣存，這次什麼都不做', async () => {
    const { run, log } = harness({ prepare: { kind: 'confirm' } });
    await expect(run).resolves.toBe('confirm');
    expect(log).toEqual(['lock', 'prepare', 'unlock']);
  });

  it('合併不回編輯區：結束打字模式照後端版本重載（之前都存過、期間擋著打字，不掉字）', async () => {
    const { run, log } = harness({ merge: false });
    await expect(run).resolves.toBe('reloaded');
    expect(log).toEqual(['lock', 'prepare', 'save:body', 'put:2', 'merge:H2:2', 'reload', 'unlock', 'done']);
  });

  it('存好時已經換篇或離開打字模式：不放、也不呼叫 done（不動新的那篇，審查 7）', async () => {
    const { run, log } = harness({ still: false });
    await expect(run).resolves.toBe('abandoned');
    expect(log).toEqual(['lock', 'prepare', 'save:body', 'unlock']);
  });
});

describe('圖片上按 Enter／方向鍵／打字（實際原因：Chrome 在 figure 裡按 Enter 會複製整個 figure 連同 aligncenter）', () => {
  const key = (k: string, extra: Partial<FigureKey> = {}): FigureKey => ({
    key: k,
    isComposing: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    ...extra,
  });
  const afterImage: FigureCaret = { inCaption: false, atStart: false, atEnd: true, isLast: true, collapsed: true };
  const beforeImage: FigureCaret = { ...afterImage, atStart: true, atEnd: false };
  const inCaption: FigureCaret = { ...afterImage, inCaption: true, atEnd: false };

  it('圖片後、圖片前、圖說裡按 Enter：一律在圖片下方開新段落', () => {
    for (const caret of [afterImage, beforeImage, inCaption, { ...afterImage, isLast: false }]) {
      expect(figureKeyAction(key('Enter'), caret)).toEqual({ kind: 'escape', where: 'after' });
    }
  });

  it('輸入法選字的 Enter 不管', () => {
    expect(figureKeyAction(key('Enter', { isComposing: true }), afterImage)).toEqual({ kind: 'pass' });
  });

  it('最後一塊是圖片：↓ 或在結尾按 → 開新段落，游標才有地方接著寫', () => {
    expect(figureKeyAction(key('ArrowDown'), afterImage)).toEqual({ kind: 'escape', where: 'after' });
    expect(figureKeyAction(key('ArrowDown'), beforeImage)).toEqual({ kind: 'escape', where: 'after' });
    expect(figureKeyAction(key('ArrowRight'), afterImage)).toEqual({ kind: 'escape', where: 'after' });
    expect(figureKeyAction(key('ArrowRight'), beforeImage)).toEqual({ kind: 'pass' });
    expect(figureKeyAction(key('ArrowDown'), { ...inCaption, atEnd: true })).toEqual({ kind: 'escape', where: 'after' });
  });

  it('不是最後一塊：方向鍵交給瀏覽器（下面本來就有段落）', () => {
    expect(figureKeyAction(key('ArrowDown'), { ...afterImage, isLast: false })).toEqual({ kind: 'pass' });
    expect(figureKeyAction(key('ArrowRight'), { ...afterImage, isLast: false })).toEqual({ kind: 'pass' });
  });

  it('圖片旁邊直接打字（含輸入法）：字放進新段落，圖片前放上方、圖片後放下方', () => {
    expect(figureKeyAction(key('a'), afterImage)).toEqual({ kind: 'move', where: 'after' });
    expect(figureKeyAction(key('Process', { keyCode: 229 }), afterImage)).toEqual({ kind: 'move', where: 'after' });
    expect(figureKeyAction(key('a'), beforeImage)).toEqual({ kind: 'move', where: 'before' });
  });

  it('圖說裡打字、⌘ 組合鍵、選取範圍不是一個點：交給瀏覽器', () => {
    expect(figureKeyAction(key('a'), inCaption)).toEqual({ kind: 'pass' });
    expect(figureKeyAction(key('z', { metaKey: true }), afterImage)).toEqual({ kind: 'pass' });
    expect(figureKeyAction(key('a'), { ...afterImage, collapsed: false })).toEqual({ kind: 'pass' });
    expect(figureKeyAction(key('Backspace'), afterImage)).toEqual({ kind: 'pass' });
  });

  it('新段落是乾淨的 <p>：不帶 figure 的 class 或 style', () => {
    expect(CLEAN_PARAGRAPH).toBe('<p><br></p>');
  });
});

describe('圖片前後按 Backspace／Delete、在圖片上貼上（審查 4：字不准併進 figure）', () => {
  const key = (k: string, extra: Partial<FigureKey> = {}): FigureKey => ({
    key: k,
    isComposing: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    ...extra,
  });
  const atStart = { atBlockStart: true, atBlockEnd: false, blockEmpty: false, prevIsFigure: true, nextIsFigure: false, collapsed: true };

  it('圖片下一段段首按 Backspace：不併進圖片，游標移到圖片後面', () => {
    expect(besideFigureKeyAction(key('Backspace'), atStart)).toEqual({ kind: 'to-figure', where: 'end', removeBlock: false });
  });

  it('圖片下面的空段落按 Backspace：刪掉空段落，游標移到圖片後面', () => {
    expect(besideFigureKeyAction(key('Backspace'), { ...atStart, atBlockEnd: true, blockEmpty: true })).toEqual({
      kind: 'to-figure',
      where: 'end',
      removeBlock: true,
    });
  });

  it('圖片上一段段尾按 Delete：不把圖片併進段落；空段落就刪掉、游標移到圖片前面', () => {
    const atEnd = { atBlockStart: false, atBlockEnd: true, blockEmpty: false, prevIsFigure: false, nextIsFigure: true, collapsed: true };
    expect(besideFigureKeyAction(key('Delete'), atEnd)).toEqual({ kind: 'to-figure', where: 'start', removeBlock: false });
    expect(besideFigureKeyAction(key('Delete'), { ...atEnd, atBlockStart: true, blockEmpty: true })).toEqual({
      kind: 'to-figure',
      where: 'start',
      removeBlock: true,
    });
  });

  it('不在段首／段尾、旁邊不是圖片、選了一段字、輸入法中：交給瀏覽器', () => {
    expect(besideFigureKeyAction(key('Backspace'), { ...atStart, atBlockStart: false })).toEqual({ kind: 'pass' });
    expect(besideFigureKeyAction(key('Backspace'), { ...atStart, prevIsFigure: false })).toEqual({ kind: 'pass' });
    expect(besideFigureKeyAction(key('Backspace'), { ...atStart, collapsed: false })).toEqual({ kind: 'pass' });
    expect(besideFigureKeyAction(key('Backspace', { isComposing: true }), atStart)).toEqual({ kind: 'pass' });
    expect(besideFigureKeyAction(key('a'), atStart)).toEqual({ kind: 'pass' });
  });

  const afterImage: FigureCaret = { inCaption: false, atStart: false, atEnd: true, isLast: true, collapsed: true };
  it('游標在圖片旁貼上：先跳到新段落再貼（圖前放上方、圖後放下方）；圖說裡照常貼', () => {
    expect(figurePasteAction(afterImage)).toEqual({ kind: 'move', where: 'after' });
    expect(figurePasteAction({ ...afterImage, atStart: true, atEnd: false })).toEqual({ kind: 'move', where: 'before' });
    expect(figurePasteAction({ ...afterImage, inCaption: true })).toEqual({ kind: 'pass' });
    expect(figurePasteAction({ ...afterImage, collapsed: false })).toEqual({ kind: 'pass' });
  });
});

describe('接線：校樣在打字模式也畫「在這裡插圖」、圖片按鍵掛在 iframe 文件上', () => {
  const proofView = readFileSync(new URL('../src/ui/components/ProofView.tsx', import.meta.url), 'utf8');
  const frame = readFileSync(new URL('../src/ui/lib/use-proof-frame.ts', import.meta.url), 'utf8');

  it('插圖位置不再因為打字模式擋掉', () => {
    const canInsert = /canInsert:([^\n]*)/.exec(proofView)?.[1] ?? '';
    expect(canInsert).not.toContain('!isEditing');
  });

  it('iframe 載入時掛上圖片按鍵處理', () => {
    expect(frame).toContain('attachFigureKeys(doc');
  });

  const caretSource = readFileSync(new URL('../src/ui/lib/figure-caret.ts', import.meta.url), 'utf8');
  const editing = readFileSync(new URL('../src/ui/lib/use-proof-editing.ts', import.meta.url), 'utf8');

  it('擋打字期間（正文不可編輯）圖片的按鍵與貼上處理不動 DOM（審查 5）', () => {
    expect(caretSource).toMatch(/function writable\(/);
    expect(caretSource.match(/if \(!writable\(body\)\) return;/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it('擋打字期間：恢復留底、連結套用、格式指令都不做（審查 1）', () => {
    expect(proofView).toMatch(/canRestore: false/);
    for (const name of ['restoreDraft', 'applyLinkHref', 'removeCurrentLink', 'doCommand']) {
      const at = editing.indexOf(`const ${name} =`);
      expect(at, name).toBeGreaterThan(0);
      expect(editing.slice(at, at + 400), name).toContain('placingRef.current');
    }
  });

  it('合併前核對整份新版本＝已知那一版＋這張圖；存檔基準合併成功才推進（Codex P1）', () => {
    const at = editing.indexOf('merge: (placed');
    const merge = editing.slice(at, at + 2000);
    expect(merge).toContain('placedMatchesBase(');
    expect(merge).toContain('request.merged');
    const workspace = readFileSync(new URL('../src/ui/components/Workspace.tsx', import.meta.url), 'utf8');
    const start = workspace.indexOf('placeAsset={');
    const place = workspace.slice(start, workspace.indexOf('onMerged={', start));
    expect(place).not.toContain('rememberSaved');
    expect(workspace.slice(workspace.indexOf('onMerged={', start), workspace.indexOf('onMerged={', start) + 400)).toContain('rememberSaved(contentHash)');
  });

  it('放圖不准重入；照樣存等待中與放圖中面板都鎖住（Codex 第二輪 2）', () => {
    const at = editing.indexOf('const placeWhileWriting =');
    expect(editing.slice(at, at + 600)).toContain('if (placingRef.current || insertAwaitingRef.current)');
    expect(proofView).toMatch(/busy: edit\.placing \|\| edit\.insertAwaiting/);
    const panel = readFileSync(new URL('../src/ui/components/InsertImagePanel.tsx', import.meta.url), 'utf8');
    expect(panel).toMatch(/const busy = place\.busy \|\| pick\.busy \|\| ai\.busy \|\| writer\?\.busy === true/);
  });

  it('合併前標題也核對；存檔回呼帶回標題（Codex 第二輪 3）', () => {
    const at = editing.indexOf('merge: (placed');
    expect(editing.slice(at, at + 2000)).toContain('placedMatchesBase(');
    const workspace = readFileSync(new URL('../src/ui/components/Workspace.tsx', import.meta.url), 'utf8');
    expect(workspace).toContain('onSaved?.(saved.contentHash, saved.publishHtml, saved.templateData)');
  });

  it('合併的基準是存檔那一刻的內容＋插入的圖，不拿當下畫面（審查 1）', () => {
    const at = editing.indexOf('merge: (placed');
    const merge = editing.slice(at, at + 2000);
    expect(merge).toContain('withFigure(doc, snapshot');
    expect(merge).not.toContain('originalBody.current = body.innerHTML');
  });
});
