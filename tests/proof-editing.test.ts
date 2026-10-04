import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { decideEditSave, EDIT_BAR_NOTE, editBarNote, replaceWithSavedBody } from '../src/ui/lib/proof-editing.js';

/**
 * 校樣打字模式（P5-T042 從 ProofView 抽出 `useProofEditing`）：「儲存」與「先存再做」共用的判斷。
 */

describe('decideEditSave：儲存與先存再做共用的存檔判斷', () => {
  const base = {
    dropped: [] as string[],
    force: false,
    originalClean: '<p>原本</p>',
    originalBody: '<p>原本</p>\n',
    titleText: '標題',
    originalTitle: '標題',
    savedTitle: '存著的標題',
    diary: false,
    titleMaxLength: 120,
  };

  it('正文跟整理過的基準一樣、標題沒改：不算改', () => {
    expect(decideEditSave({ ...base, html: '<p>原本</p>' })).toEqual({ kind: 'unchanged' });
  });

  it('正文有改：只送正文', () => {
    expect(decideEditSave({ ...base, html: '<p>原本，多一句。</p>' })).toEqual({
      kind: 'save',
      editedBody: '<p>原本，多一句。</p>',
    });
  });

  it('沒有整理過的基準：拿原始正文去掉前後空白比', () => {
    expect(decideEditSave({ ...base, originalClean: null, html: '<p>原本</p>' })).toEqual({ kind: 'unchanged' });
    expect(decideEditSave({ ...base, originalClean: null, originalBody: null, html: '' })).toEqual({ kind: 'unchanged' });
  });

  it('沒記下進入編輯時的標題：跟稿件存著的標題比', () => {
    expect(decideEditSave({ ...base, originalTitle: null, titleText: '存著的標題', html: '<p>原本</p>' })).toEqual({
      kind: 'unchanged',
    });
    expect(decideEditSave({ ...base, originalTitle: null, titleText: '標題', html: '<p>原本</p>' })).toEqual({
      kind: 'save',
      editedTitle: '標題',
    });
  });

  it('有會被拿掉的格式：先問；照樣存（force）才存', () => {
    const changed = { ...base, html: '<p>原本改了</p>', dropped: ['底線'] };
    expect(decideEditSave(changed)).toEqual({ kind: 'confirm-drop', dropped: ['底線'] });
    expect(decideEditSave({ ...changed, force: true })).toEqual({ kind: 'save', editedBody: '<p>原本改了</p>' });
  });

  it('標題清空：不准存', () => {
    expect(decideEditSave({ ...base, titleText: '  ', html: '<p>原本</p>' }).kind).toBe('invalid-title');
  });

  it('沒有標題元素：只看正文', () => {
    expect(decideEditSave({ ...base, titleText: null, originalTitle: null, html: '<p>原本</p>' })).toEqual({
      kind: 'unchanged',
    });
  });

  it('標題上限照模板', () => {
    expect(decideEditSave({ ...base, titleMaxLength: 3, titleText: '很長的標題', html: '<p>原本</p>' }).kind).toBe(
      'invalid-title',
    );
  });
});

describe('editBarNote：打字模式提示列', () => {
  it('平常講怎麼改', () => {
    expect(editBarNote(false)).toBe(EDIT_BAR_NOTE);
    expect(EDIT_BAR_NOTE).toBe(
      '直接在文章上打字，標題也可以點進去改；貼上時保留粗體、連結、標題與清單，其他樣式會拿掉。',
    );
  });

  it('打字中自動存過一版：講按取消會回到這一版', () => {
    expect(editBarNote(true)).toBe('已自動存一版；按取消會回到這一版');
  });
});

describe('replaceWithSavedBody：照樣存之後畫面換成存進去的樣子', () => {
  const base = { force: true, savedBody: '<p>整理後</p>', rawNow: '<p><u>原</u></p>', rawAtSave: '<p><u>原</u></p>' };

  it('照樣存、存了正文、等回應時沒再打字：換', () => {
    expect(replaceWithSavedBody(base)).toBe(true);
  });

  it('不是照樣存：不換', () => {
    expect(replaceWithSavedBody({ ...base, force: false })).toBe(false);
  });

  it('只存了標題：不換', () => {
    expect(replaceWithSavedBody({ ...base, savedBody: undefined })).toBe(false);
  });

  it('等回應的期間又打了字：不換（換了會丟字）', () => {
    expect(replaceWithSavedBody({ ...base, rawNow: '<p><u>原</u>又打了</p>' })).toBe(false);
  });
});

describe('useProofEditing 的 effect 順序（P5-T042）', () => {
  // React 照呼叫順序跑 effect。抽出前這個 hook 裡只有「離開打字模式清掉 hold」一個 effect 排在這個位置；
  // 進入／離開編輯、版本被換掉的 effect 要排在 ProofView 其他 effect 之間，所以留在 ProofView、只呼叫 hook 給的函式。
  const hook = readFileSync(new URL('../src/ui/lib/use-proof-editing.ts', import.meta.url), 'utf8');
  const view = readFileSync(new URL('../src/ui/components/ProofView.tsx', import.meta.url), 'utf8');

  it('hook 裡只有一個 effect', () => {
    expect(hook.match(/\buseEffect\(/g)).toHaveLength(1);
  });

  it('ProofView 在渲染世代的 effect 之後、載校樣的 effect 之前呼叫 hook；進出編輯的 effect 在標記與捲動之後', () => {
    const epoch = view.indexOf("if (job.state === 'RENDERED') setRenderEpoch");
    const hookCall = view.indexOf('useProofEditing({');
    const fetchPreview = view.indexOf('.fetchPreview(job.uuid)');
    const highlights = view.indexOf('unwrapHighlightMarks(body);');
    const sync = view.indexOf('edit.syncEditing();');
    const selection = view.indexOf('useSelectionActions({');
    expect(epoch).toBeGreaterThan(0);
    expect(hookCall).toBeGreaterThan(epoch);
    expect(fetchPreview).toBeGreaterThan(hookCall);
    expect(sync).toBeGreaterThan(highlights);
    expect(selection).toBeGreaterThan(sync);
  });
});
