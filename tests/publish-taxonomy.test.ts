import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { isTaxonomyDirty, taxonomyPublishBlocker, withTermAdded } from '../src/ui/lib/publish-slug.js';
import {
  addTermToSelection,
  EDITING_SAVE_NOTE,
  clearTaxonomyDraft,
  holdTaxonomy,
  isPublishPanelSaving,
  isTaxonomySaving,
  markEditing,
  runSlugSave,
  runTaxonomySave,
  setTaxonomyDraft,
  subscribeSlugSave,
  taxonomyDraftFor,
  type SlugSaveSteps,
} from '../src/ui/lib/slug-save-store.js';
import { termAddedNote } from '../src/ui/lib/term-match.js';
import { PANEL_SAVING_NOTE, RUN_BLOCKED_NOTE, editBlockState } from '../src/ui/lib/workspace-view.js';
import { SYNC_PENDING_NOTE } from '../src/ui/lib/check-while-writing.js';

/**
 * P5-T051 跟進（D-050 2026-10-22）：
 * - 分類選了沒存時擋發布，跟網址沒存擋發布（P5-T040）同一套：模組層級、以稿件為 key 的草稿與「存的期間」。
 * - 建好新分類直接套到這篇並存；用既有（後端 200）時講「站上已有」。
 */

const SAVED: readonly string[] = ['隨筆'];

describe('isTaxonomyDirty／taxonomyPublishBlocker', () => {
  it('順序、內容都一樣才算沒改', () => {
    expect(isTaxonomyDirty(['隨筆'], ['隨筆'])).toBe(false);
    expect(isTaxonomyDirty([], [])).toBe(false);
    expect(isTaxonomyDirty(['隨筆', '藝術'], ['隨筆'])).toBe(true);
    expect(isTaxonomyDirty([], ['隨筆'])).toBe(true);
    expect(isTaxonomyDirty(['藝術', '隨筆'], ['隨筆', '藝術'])).toBe(true);
  });

  it('沒存擋發布、講怎麼解；存的期間也擋；都沒有就不擋', () => {
    expect(taxonomyPublishBlocker({ dirty: true, saving: false })).toBe(
      '分類改了還沒存：按「儲存分類」，或點掉剛選的改回原本的。',
    );
    expect(taxonomyPublishBlocker({ dirty: true, saving: true })).toBe('正在存分類，存好、成品重新載入之後才能發布。');
    expect(taxonomyPublishBlocker({ dirty: false, saving: true })).toBe('正在存分類，存好、成品重新載入之後才能發布。');
    expect(taxonomyPublishBlocker({ dirty: false, saving: false })).toBeNull();
  });
});

describe('分類草稿：模組層級、以稿件為 key（關面板再開、別處操作後仍在）', () => {
  afterEach(() => {
    clearTaxonomyDraft('a');
    clearTaxonomyDraft('b');
  });

  it('沒草稿就用已存的；有草稿就用草稿；別篇拿不到', () => {
    expect(taxonomyDraftFor('a', SAVED)).toBe(SAVED);
    setTaxonomyDraft('a', ['隨筆', '藝術'], SAVED);
    expect(taxonomyDraftFor('a', SAVED)).toEqual(['隨筆', '藝術']);
    // 面板關掉再開＝重新讀同一個 store。
    expect(taxonomyDraftFor('a', SAVED)).toEqual(['隨筆', '藝術']);
    expect(taxonomyDraftFor('b', SAVED)).toBe(SAVED);
  });

  it('同一份 store 讀兩次回同一個參考（useSyncExternalStore 不會無限重繪）', () => {
    setTaxonomyDraft('a', ['藝術'], SAVED);
    expect(taxonomyDraftFor('a', SAVED)).toBe(taxonomyDraftFor('a', SAVED));
  });

  it('改回跟已存的一樣：草稿清掉', () => {
    setTaxonomyDraft('a', ['藝術'], SAVED);
    setTaxonomyDraft('a', ['隨筆'], SAVED);
    expect(taxonomyDraftFor('a', SAVED)).toBe(SAVED);
  });

  it('別處存了新的一版（例如標題與網址），已存的分類沒變：草稿留著、照樣擋', () => {
    setTaxonomyDraft('a', ['藝術'], SAVED);
    const sameNamesNewArray = ['隨筆'];
    expect(taxonomyDraftFor('a', sameNamesNewArray)).toEqual(['藝術']);
  });

  it('已存的跟上草稿（別處存了一樣的分類）：草稿作廢', () => {
    setTaxonomyDraft('a', ['藝術'], SAVED);
    const caughtUp = ['藝術'];
    expect(taxonomyDraftFor('a', caughtUp)).toBe(caughtUp);
    expect(taxonomyDraftFor('a', SAVED)).toBe(SAVED);
  });

  it('改草稿會通知訂閱的面板', () => {
    const listener = vi.fn();
    const off = subscribeSlugSave(listener);
    setTaxonomyDraft('a', ['藝術'], SAVED);
    off();
    expect(listener).toHaveBeenCalled();
  });
});

describe('runTaxonomySave：跟存網址同一套（存、重讀到套用才放開）', () => {
  afterEach(() => clearTaxonomyDraft('a'));

  it('存的期間 isTaxonomySaving，存好、重讀套用後草稿清掉、放開', async () => {
    setTaxonomyDraft('a', ['藝術'], SAVED);
    let during = false;
    await runTaxonomySave('a', {
      save: async () => {
        during = isTaxonomySaving('a');
      },
      sync: async () => 'applied',
    });
    expect(during).toBe(true);
    expect(isTaxonomySaving('a')).toBe(false);
    expect(taxonomyDraftFor('a', SAVED)).toBe(SAVED);
  });

  it('存失敗：放開、草稿（選取）留著可重按，錯誤丟回呼叫端', async () => {
    setTaxonomyDraft('a', ['藝術'], SAVED);
    await expect(
      runTaxonomySave('a', {
        save: async () => {
          throw new Error('連不上');
        },
        sync: async () => 'applied',
      }),
    ).rejects.toThrow('連不上');
    expect(isTaxonomySaving('a')).toBe(false);
    expect(taxonomyDraftFor('a', SAVED)).toEqual(['藝術']);
  });

  it('重讀沒套用：維持存的期間、再讀，讀到才放開', async () => {
    const outcomes: Array<'failed' | 'applied'> = ['failed', 'applied'];
    const waits: number[] = [];
    const steps: SlugSaveSteps = {
      save: async () => {},
      sync: async () => {
        expect(isTaxonomySaving('a')).toBe(true);
        return outcomes.shift()!;
      },
      wait: async (ms) => {
        waits.push(ms);
      },
    };
    await runTaxonomySave('a', steps);
    expect(waits).toEqual([3000]);
    expect(isTaxonomySaving('a')).toBe(false);
  });
});

describe('termAddedNote：建好／用既有之後講什麼', () => {
  it('真的建了、也套用了', () => {
    expect(termAddedNote({ name: '攝影', created: true, saveError: null })).toEqual({
      tone: 'good',
      text: '已建立「攝影」，已選上並套用到這篇。',
    });
  });

  it('站上本來就有（後端 200）：不說「已建立」', () => {
    expect(termAddedNote({ name: '隨筆', created: false, saveError: null })).toEqual({
      tone: 'good',
      text: '站上已有「隨筆」，已選上並套用。',
    });
  });

  it('存分類失敗：講清楚還沒套到這篇、怎麼重試', () => {
    expect(termAddedNote({ name: '攝影', created: true, saveError: '連不上後端' })).toEqual({
      tone: 'bad',
      text: '已建立「攝影」並選上，但還沒套到這篇（連不上後端）。按「儲存分類」再試一次。',
    });
    expect(termAddedNote({ name: '隨筆', created: false, saveError: '版本衝突' })).toEqual({
      tone: 'bad',
      text: '站上已有「隨筆」，已選上，但還沒套到這篇（版本衝突）。按「儲存分類」再試一次。',
    });
  });
});

describe('client.createTerm 把 201／200 的差別帶回來', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    [201, true],
    [200, false],
  ])('後端回 %s → created: %s', async (status, created) => {
    vi.stubGlobal('window', { location: { search: '?fixtures=0' }, localStorage: { getItem: () => null } });
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ id: 7, name: '攝影', slug: 'photo' }), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { api } = await import('../src/ui/service/client.js');
    const result = await api.createTerm('read-think-tag', '攝影');
    expect(result).toEqual({ term: { id: 7, name: '攝影', slug: 'photo' }, created });
    expect(fetchMock).toHaveBeenCalledWith('/api/wordpress/terms', expect.objectContaining({ method: 'POST' }));
  });
});

describe('發布面板接上分類的擋發布（守門：跟網址同一套）', () => {
  it('PublishSheet 用 taxonomyPublishBlocker 擋、旁邊有「儲存分類」', () => {
    const source = readFileSync(new URL('../src/ui/components/PublishSheet.tsx', import.meta.url), 'utf8');
    expect(source).toContain('taxonomyPublishBlocker(');
    expect(source).toContain('taxonomyDraftFor(');
    expect(source).toContain('runTaxonomySave(');
  });

  it('TaxonomyPanel 不再自己持有選取、不再叫人「按儲存分類才會套到這篇」', () => {
    const source = readFileSync(new URL('../src/ui/components/panels/TaxonomyPanel.tsx', import.meta.url), 'utf8');
    expect(source).not.toContain('才會套到這篇');
    expect(source).not.toMatch(/useState<string\[\]>\(current\)/);
  });
});

describe('PR #39 Codex 第一輪：建立期間也擋發布、套用讀最新的選取', () => {
  afterEach(() => clearTaxonomyDraft('a'));

  it('holdTaxonomy：請求送出前就登記「存分類中」（擋發布），結束（含失敗）才放開', async () => {
    let during = false;
    let release!: () => void;
    const pending = holdTaxonomy('a', async () => {
      during = isTaxonomySaving('a');
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    expect(isTaxonomySaving('a')).toBe(true);
    expect(taxonomyPublishBlocker({ dirty: false, saving: isTaxonomySaving('a') })).not.toBeNull();
    release();
    await pending;
    expect(during).toBe(true);
    expect(isTaxonomySaving('a')).toBe(false);

    await expect(
      holdTaxonomy('a', async () => {
        throw new Error('建不起來');
      }),
    ).rejects.toThrow('建不起來');
    expect(isTaxonomySaving('a')).toBe(false);
  });

  it('holdTaxonomy 期間照樣能跑 runTaxonomySave（建好接著存，不會被自己擋掉）', async () => {
    let saved = false;
    await holdTaxonomy('a', async () => {
      await runTaxonomySave('a', {
        save: async () => {
          saved = true;
        },
        sync: async () => 'applied',
      });
    });
    expect(saved).toBe(true);
  });

  it('withTermAdded：從最新的選取加上新項目；多選保留別的、單選取代、已選的不重複', () => {
    expect(withTermAdded(['A', 'B'], 'C', true)).toEqual(['A', 'B', 'C']);
    expect(withTermAdded(['A'], 'C', false)).toEqual(['C']);
    const current = ['A', 'C'];
    expect(withTermAdded(current, 'C', true)).toBe(current);
  });

  it('TaxonomyPanel 建立整段包在 holdTaxonomy 裡、套用交給發布面板讀最新值、選取控制在忙時鎖住', () => {
    const source = readFileSync(new URL('../src/ui/components/panels/TaxonomyPanel.tsx', import.meta.url), 'utf8');
    expect(source).toContain('holdTaxonomy(');
    expect(source).toContain('onAddTerm(');
    expect(source).not.toContain('withTerm = ');
    // 既有 chip、站上沒有的 chip、手動輸入框都要在忙時鎖住。
    expect(source.match(/disabled=\{busy\}/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
    const sheet = readFileSync(new URL('../src/ui/components/PublishSheet.tsx', import.meta.url), 'utf8');
    expect(sheet).toContain('addTermToSelection(');
    expect(sheet).toContain('latestTerms.current');
  });
});

describe('PR #39 Codex 第二輪：存分類／網址期間擋進打字模式；已在打字模式就不自動存', () => {
  afterEach(() => {
    clearTaxonomyDraft('a');
    markEditing('a', false);
  });

  it('holdTaxonomy 期間 editBlockState 為真、講原因；結束就放開', async () => {
    let inside: ReturnType<typeof editBlockState> | null = null;
    await holdTaxonomy('a', async () => {
      inside = editBlockState({ runBlocked: false, pendingSync: false, panelSaving: isPublishPanelSaving('a') });
    });
    expect(inside).toEqual({ blocked: true, note: PANEL_SAVING_NOTE });
    expect(editBlockState({ runBlocked: false, pendingSync: false, panelSaving: isPublishPanelSaving('a') })).toEqual({
      blocked: false,
      note: RUN_BLOCKED_NOTE,
    });
  });

  it('一般「儲存分類」與存網址的期間也擋（同一個判斷）', async () => {
    let duringTerms = false;
    await runTaxonomySave('a', {
      save: async () => {
        duringTerms = isPublishPanelSaving('a');
      },
      sync: async () => 'applied',
    });
    let duringSlug = false;
    await runSlugSave('a', {
      save: async () => {
        duringSlug = isPublishPanelSaving('a');
      },
      sync: async () => 'applied',
    });
    expect(duringTerms).toBe(true);
    expect(duringSlug).toBe(true);
    expect(isPublishPanelSaving('a')).toBe(false);
  });

  it('擋住時講哪一句：AI 在跑優先，再來是存分類／網址，最後才是待同步', () => {
    expect(editBlockState({ runBlocked: true, pendingSync: true, panelSaving: true }).note).toBe(RUN_BLOCKED_NOTE);
    expect(editBlockState({ runBlocked: false, pendingSync: true, panelSaving: true }).note).toBe(PANEL_SAVING_NOTE);
    expect(editBlockState({ runBlocked: false, pendingSync: true, panelSaving: false }).note).toBe(SYNC_PENDING_NOTE);
    expect(PANEL_SAVING_NOTE).toBe('正在存分類或網址，存好再改原文。');
  });

  it('這篇此刻在打字模式：不自動存，選取留成「選了沒存」（會擋發布）', async () => {
    markEditing('a', true);
    const save = vi.fn(async () => null);
    const outcome = await addTermToSelection({ uuid: 'a', name: '攝影', saved: SAVED, multiple: true, save });
    expect(outcome).toEqual({ kind: 'deferred' });
    expect(save).not.toHaveBeenCalled();
    expect(taxonomyDraftFor('a', SAVED)).toEqual(['隨筆', '攝影']);
    expect(taxonomyPublishBlocker({ dirty: isTaxonomyDirty(taxonomyDraftFor('a', SAVED), SAVED), saving: false })).not.toBeNull();
  });

  it('不在打字模式：照常存；存失敗回原因、選取留著', async () => {
    const ok = await addTermToSelection({ uuid: 'a', name: '攝影', saved: SAVED, multiple: true, save: async () => null });
    expect(ok).toEqual({ kind: 'saved' });
    clearTaxonomyDraft('a');
    const bad = await addTermToSelection({ uuid: 'a', name: '藝術', saved: SAVED, multiple: false, save: async () => '版本衝突' });
    expect(bad).toEqual({ kind: 'failed', error: '版本衝突' });
    expect(taxonomyDraftFor('a', SAVED)).toEqual(['藝術']);
  });

  it('termAddedNote：延後時講「正在改原文，先沒套到這篇」', () => {
    expect(termAddedNote({ name: '攝影', created: true, saveError: null, deferred: true })).toEqual({
      tone: 'warn',
      text: '已建立「攝影」並選上，但你正在改原文，先沒有套到這篇。改完按「儲存分類」。',
    });
  });

  it('Workspace 把打字模式登記到 store、use-job-workspace 用 editBlockState 算進 isPublishPanelSaving', () => {
    const ws = readFileSync(new URL('../src/ui/components/Workspace.tsx', import.meta.url), 'utf8');
    expect(ws).toContain('markEditing(');
    const hook = readFileSync(new URL('../src/ui/lib/use-job-workspace.ts', import.meta.url), 'utf8');
    expect(hook).toContain('isPublishPanelSaving(');
    expect(hook).toContain('editBlockState(');
    const sheet = readFileSync(new URL('../src/ui/components/PublishSheet.tsx', import.meta.url), 'utf8');
    expect(sheet).toContain('addTermToSelection(');
  });
});

describe('打字模式中，發布面板會建新版本的按鈕一律擋（PR #39 跟進，同一個 markEditing 判斷）', () => {
  afterEach(() => {
    markEditing('a', false);
    clearTaxonomyDraft('a');
  });

  it('講原因的那一句', () => {
    expect(EDITING_SAVE_NOTE).toBe('你正在改原文，先按上方『儲存』或『取消』再存。');
  });

  it('markEditing 會通知訂閱者（發布面板的按鈕跟著反灰）', () => {
    const listener = vi.fn();
    const off = subscribeSlugSave(listener);
    markEditing('a', true);
    markEditing('a', false);
    off();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('打字模式中 runTaxonomySave／runSlugSave 不存、丟回原因（就算畫面沒擋到也不會建新版本）', async () => {
    markEditing('a', true);
    const save = vi.fn(async () => {});
    await expect(runTaxonomySave('a', { save, sync: async () => 'applied' })).rejects.toThrow(EDITING_SAVE_NOTE);
    await expect(runSlugSave('a', { save, sync: async () => 'applied' })).rejects.toThrow(EDITING_SAVE_NOTE);
    expect(save).not.toHaveBeenCalled();
    expect(isPublishPanelSaving('a')).toBe(false);
  });

  it('發布面板與分類面板都接上同一個判斷', () => {
    const sheet = readFileSync(new URL('../src/ui/components/PublishSheet.tsx', import.meta.url), 'utf8');
    expect(sheet).toContain('isEditingJob(job.uuid)');
    expect(sheet).toContain('EDITING_SAVE_NOTE');
    const panel = readFileSync(new URL('../src/ui/components/panels/TaxonomyPanel.tsx', import.meta.url), 'utf8');
    expect(panel).toContain('editingLock');
  });

  it('右欄在打字模式整條 inert（點不到、Tab 不到），跟 markEditing 用同一個 editing 狀態', () => {
    const ws = readFileSync(new URL('../src/ui/components/Workspace.tsx', import.meta.url), 'utf8');
    expect(ws).toMatch(/<aside className="margin"[^>]*inert=\{editing !== null\}/);
    expect(ws).toMatch(/<header className="docbar" inert=\{editing !== null\}>/);
    expect(ws).toContain('markEditing(uuid, isEditingNow)');
  });
});
