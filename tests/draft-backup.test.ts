import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  afterSaveDraft,
  DRAFT_KEY_PREFIX,
  DRAFT_MAX_AGE_MS,
  DRAFT_RESTORE_WHILE_TYPING_NOTE,
  DRAFT_UNAVAILABLE_NOTE,
  DRAFT_WRITE_WAIT_MS,
  draftCheckReady,
  draftEligibility,
  draftKey,
  draftNoticeText,
  draftTimeLabel,
  type DraftBackup,
  type DraftPlan,
  type DraftStorage,
  newDraftId,
  openDraftStorage,
  parseDraft,
  parseDraftKey,
  pickDraftPlan,
  planDraftRestore,
  pruneDrafts,
  readDraft,
  readDrafts,
  removeDraft,
  removeDraftIfSame,
  restoreAllowed,
  restoreDroppedNote,
  safeRestoredEdit,
  sameDraft,
  DISMISS_KEY_PREFIX,
  dismissOnDiscard,
  markDismissed,
  planDraftLoad,
  readDismissed,
  visibleDrafts,
  removeAncestors,
  restoredLineage,
  writeDraft,
} from '../src/ui/lib/draft-backup.js';
import { cleanRichEdit, richUnits, serializeRichEdit, type RichNode } from '../src/contract/rich-text.js';

/**
 * D-047（P5-T048）：打字模式沒存的標題與內文自動留一份在瀏覽器儲存區。
 * 原則（審查）：任何順序都不能讓使用者打的字不見。規則都是純函式；接 iframe 與 React 的部分在
 * `lib/use-draft-backup.ts`（最後一段守著接法）。
 */

function memoryStorage(): DraftStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    get length() {
      return map.size;
    },
    key: (index) => [...map.keys()][index] ?? null,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, String(value));
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

/** 滿了：寫不進去，但讀、刪照樣可以（localStorage 滿了就是這樣）。 */
function fullStorage(base = memoryStorage()): DraftStorage & { map: Map<string, string> } {
  return Object.assign(Object.create(base) as typeof base, {
    map: base.map,
    setItem: () => {
      throw new Error('QuotaExceededError');
    },
  });
}

function brokenStorage(): DraftStorage {
  const fail = (): never => {
    throw new Error('SecurityError');
  };
  return { length: 0, key: () => null, getItem: fail, setItem: fail, removeItem: fail };
}

const NOW = new Date(2026, 9, 13, 21, 8, 0).getTime();

function backup(over: Partial<DraftBackup> = {}): DraftBackup {
  return { v: 2, uuid: 'job-a', id: 's1', title: '標題', body: '<p>沒存的字</p>', savedAt: NOW - 60_000, baseHash: 'h1', from: [], ...over };
}

describe('寫進儲存區、讀回來、刪掉', () => {
  it('每一次打字一個鍵（uuid＋id）；內容含標題、內文、寫下時間、基準 hash', () => {
    const storage = memoryStorage();
    expect(writeDraft(storage, backup())).toBe(true);
    expect([...storage.map.keys()]).toEqual([draftKey('job-a', 's1')]);
    expect(draftKey('job-a', 's1').startsWith(DRAFT_KEY_PREFIX)).toBe(true);
    expect(parseDraftKey(draftKey('job-a', 's1'))).toEqual({ uuid: 'job-a', id: 's1' });
    expect(parseDraftKey('publisher.agentProvider')).toBeNull();
    expect(readDraft(storage, 'job-a', 's1')).toEqual(backup());
    expect(readDraft(storage, 'job-b', 's1')).toBeNull();
  });

  it('審查 2：同一篇的兩次打字是兩份，新的不蓋掉舊的；讀出來新的在前', () => {
    const storage = memoryStorage();
    writeDraft(storage, backup({ id: 'old', savedAt: NOW - 3_600_000, baseHash: 'h0' }));
    writeDraft(storage, backup({ id: 'new', savedAt: NOW }));
    writeDraft(storage, backup({ uuid: 'job-b', id: 'x' }));
    expect(readDrafts(storage, 'job-a').map((d) => d.id)).toEqual(['new', 'old']);
    removeDraft(storage, 'job-a', 'new');
    expect(readDrafts(storage, 'job-a').map((d) => d.id)).toEqual(['old']);
  });

  it('新的 id 每次不一樣', () => {
    expect(newDraftId(NOW, () => 0.1)).not.toBe(newDraftId(NOW, () => 0.2));
    expect(newDraftId(NOW)).not.toContain('/');
  });

  it('儲存區被擋：寫回 false、讀回空、刪不丟錯', () => {
    const storage = brokenStorage();
    expect(writeDraft(storage, backup())).toBe(false);
    expect(readDraft(storage, 'job-a', 's1')).toBeNull();
    expect(readDrafts(storage, 'job-a')).toEqual([]);
    expect(() => removeDraft(storage, 'job-a', 's1')).not.toThrow();
    expect(() => pruneDrafts(storage, NOW)).not.toThrow();
    expect(writeDraft(null, backup())).toBe(false);
    expect(readDrafts(null, 'job-a')).toEqual([]);
  });

  it('壞掉或形狀不對的內容當成沒有', () => {
    expect(parseDraft(null, 'job-a', 's1')).toBeNull();
    expect(parseDraft('not json', 'job-a', 's1')).toBeNull();
    expect(parseDraft(JSON.stringify({ ...backup(), v: 1 }), 'job-a', 's1')).toBeNull();
    expect(parseDraft(JSON.stringify({ ...backup(), body: 3 }), 'job-a', 's1')).toBeNull();
    expect(parseDraft(JSON.stringify({ ...backup(), savedAt: 'x' }), 'job-a', 's1')).toBeNull();
    // 鍵跟內容對不上（被別人改過）：不認。
    expect(parseDraft(JSON.stringify(backup()), 'job-b', 's1')).toBeNull();
    expect(parseDraft(JSON.stringify(backup()), 'job-a', 's2')).toBeNull();
    expect(parseDraft(JSON.stringify(backup({ title: null })), 'job-a', 's1')).toEqual(backup({ title: null }));
    // 來源（從哪幾份恢復來的）：沒有就是空的；形狀不對不認。
    const { from: _from, ...noFrom } = backup();
    expect(parseDraft(JSON.stringify(noFrom), 'job-a', 's1')).toEqual(backup());
    expect(parseDraft(JSON.stringify(backup({ from: [{ id: 'x', savedAt: 1 }] })), 'job-a', 's1')?.from).toEqual([{ id: 'x', savedAt: 1 }]);
    expect(parseDraft(JSON.stringify({ ...backup(), from: [{ id: 3 }] }), 'job-a', 's1')).toBeNull();
  });

  it('節流在 0.5～1 秒之間', () => {
    expect(DRAFT_WRITE_WAIT_MS).toBeGreaterThanOrEqual(500);
    expect(DRAFT_WRITE_WAIT_MS).toBeLessThanOrEqual(1000);
  });
});

describe('Codex 第一輪 2：恢復的那份打了字才寫進自己的新鍵，不接手別人的鍵', () => {
  const orig = backup({ id: 'orig', savedAt: NOW - 5000 });

  it('恢復來的那份記下來源鏈（來源自己的來源也算）', () => {
    expect(restoredLineage(orig)).toEqual([{ id: 'orig', savedAt: NOW - 5000 }]);
    const copy = backup({ id: 'copy', savedAt: NOW, from: restoredLineage(orig) });
    expect(restoredLineage(copy)).toEqual([
      { id: 'copy', savedAt: NOW },
      { id: 'orig', savedAt: NOW - 5000 },
    ]);
  });

  it('存檔成功時刪來源鏈：只刪寫下時間沒變的那幾份', () => {
    const storage = memoryStorage();
    writeDraft(storage, orig);
    writeDraft(storage, backup({ id: 'older', savedAt: NOW - 9000 }));
    const moved = backup({ id: 'moved', savedAt: NOW - 8000 });
    writeDraft(storage, { ...moved, savedAt: NOW + 1, body: '<p>別的分頁後來寫的</p>' });
    removeAncestors(storage, 'job-a', [
      { id: 'orig', savedAt: NOW - 5000 },
      { id: 'older', savedAt: NOW - 9000 },
      { id: 'moved', savedAt: NOW - 8000 },
      { id: 'gone', savedAt: 1 },
    ]);
    expect(readDrafts(storage, 'job-a').map((d) => d.id)).toEqual(['moved']);
  });
});

describe('Codex 第二輪：讀留底時隱藏不刪；已捨棄標記', () => {
  const x = backup({ id: 'x', savedAt: NOW - 5000, body: '<p>A 打的 X</p>' });
  const y = backup({ id: 'y', savedAt: NOW, body: '<p>B 改成的 Y</p>', from: restoredLineage(x) });

  it('有副本指著、寫下時間沒變的來源：先不提示（只處理副本），但不刪', () => {
    expect(visibleDrafts([y, x], [])).toEqual({ candidates: [y], hidden: [x] });
  });

  it('來源之後又被寫過（別的分頁還在打）：照常提示', () => {
    const xAgain = { ...x, savedAt: NOW + 10 };
    expect(visibleDrafts([xAgain, y], []).candidates.map((d) => d.id)).toEqual(['x', 'y']);
  });

  it('已捨棄標記：那個寫下時間的那份不提示；之後又被寫（寫下時間變了）照常提示；被捨棄的副本不再遮住它的來源', () => {
    expect(visibleDrafts([x], [{ id: 'x', savedAt: x.savedAt }]).candidates).toEqual([]);
    expect(visibleDrafts([{ ...x, savedAt: NOW + 1 }], [{ id: 'x', savedAt: x.savedAt }]).candidates).toHaveLength(1);
    expect(visibleDrafts([y, x], [{ id: 'y', savedAt: y.savedAt }]).candidates).toEqual([x]);
  });

  it('標記存在儲存區、按篇讀回；跟留底的鍵分開', () => {
    const storage = memoryStorage();
    markDismissed(storage, 'job-a', { id: 'x', savedAt: 5 }, NOW);
    markDismissed(storage, 'job-b', { id: 'z', savedAt: 6 }, NOW);
    expect(readDismissed(storage, 'job-a')).toEqual([{ id: 'x', savedAt: 5 }]);
    expect([...storage.map.keys()].every((k) => k.startsWith(DISMISS_KEY_PREFIX))).toBe(true);
    expect(DISMISS_KEY_PREFIX.startsWith(DRAFT_KEY_PREFIX)).toBe(false);
    expect(readDrafts(storage, 'job-a')).toEqual([]);
  });

  it('過期清理連標記一起：30 天前記的、或那份留底已經不在的標記清掉', () => {
    const storage = memoryStorage();
    writeDraft(storage, x);
    markDismissed(storage, 'job-a', { id: 'x', savedAt: x.savedAt }, NOW);
    markDismissed(storage, 'job-a', { id: 'gone', savedAt: 1 }, NOW);
    markDismissed(storage, 'job-a', { id: 'x2', savedAt: 2 }, NOW - DRAFT_MAX_AGE_MS - 1);
    pruneDrafts(storage, NOW);
    expect(readDismissed(storage, 'job-a')).toEqual([{ id: 'x', savedAt: x.savedAt }]);
  });

  it('捨棄／取消：只有「恢復了來源但還沒打字」才記標記（記直接來源），打過字或沒恢復都不記', () => {
    expect(dismissOnDiscard({ wrote: false, from: restoredLineage(y) })).toEqual({ id: 'y', savedAt: y.savedAt });
    expect(dismissOnDiscard({ wrote: true, from: restoredLineage(y) })).toBeNull();
    expect(dismissOnDiscard({ wrote: false, from: [] })).toBeNull();
  });
});

describe('Codex 第二輪：載入時整篇怎麼處理（planDraftLoad）', () => {
  const ctx = (over: Partial<Parameters<typeof planDraftLoad>[0]> = {}): Parameters<typeof planDraftLoad>[0] => ({
    drafts: [],
    dismissed: [],
    now: NOW,
    state: 'PREVIEWED',
    currentHash: 'h1',
    canEdit: true,
    differs: () => true,
    contentKey: (d) => d.body,
    ...over,
  });

  it('自動刪別人的只有一種：內容跟另一份或目前存好的完全相同（留新的那份）', () => {
    const older = backup({ id: 'o', savedAt: NOW - 10 });
    const newer = backup({ id: 'n', savedAt: NOW });
    expect(planDraftLoad(ctx({ drafts: [newer, older] })).remove).toEqual([older]);
    const saved = backup({ id: 's', body: '<p>跟存好的一樣</p>' });
    const result = planDraftLoad(ctx({ drafts: [saved], differs: (d) => d.id !== 's' }));
    expect(result.remove).toEqual([saved]);
    expect(result.pick).toBeNull();
  });

  it('Codex 重現 2：B 恢復 X 改成 Y（沒存）、兩邊都當掉 → 重開只處理 Y，X 不刪；Y 被捨棄（消失）後 X 重新出現', () => {
    const x = backup({ id: 'x', savedAt: NOW - 5000, body: '<p>X</p>' });
    const y = backup({ id: 'y', savedAt: NOW, body: '<p>Y</p>', from: restoredLineage(x) });
    const first = planDraftLoad(ctx({ drafts: [y, x] }));
    expect(first.remove).toEqual([]);
    expect(first.pick?.draft.id).toBe('y');
    const later = planDraftLoad(ctx({ drafts: [x] }));
    expect(later.pick?.draft.id).toBe('x');
  });

  it('Codex 重現 1：A 在打（鍵 a）、B 恢復了沒打字就捨棄 → a 還在、只在 B 記標記；A 再打（寫下時間變了）又會提示', () => {
    const storage = memoryStorage();
    const a = backup({ id: 'a', savedAt: NOW - 1000 });
    writeDraft(storage, a);
    const dismiss = dismissOnDiscard({ wrote: false, from: restoredLineage(a) });
    markDismissed(storage, 'job-a', dismiss!, NOW);
    expect(readDraft(storage, 'job-a', 'a')).toEqual(a);
    expect(planDraftLoad(ctx({ drafts: readDrafts(storage, 'job-a'), dismissed: readDismissed(storage, 'job-a') })).pick).toBeNull();
    writeDraft(storage, { ...a, savedAt: NOW + 5, body: '<p>A 又打的</p>' });
    expect(planDraftLoad(ctx({ drafts: readDrafts(storage, 'job-a'), dismissed: readDismissed(storage, 'job-a') })).pick?.draft.id).toBe('a');
  });

  it('單一分頁：打字→重新整理→恢復→打字→重新整理→恢復→存檔：中途沒有「之後又改過」，最後儲存區乾淨', () => {
    const storage = memoryStorage();
    const load = (): ReturnType<typeof planDraftLoad> =>
      planDraftLoad(ctx({ drafts: readDrafts(storage, 'job-a'), dismissed: readDismissed(storage, 'job-a') }));
    // 第一次打字（session s1）。
    const s1 = backup({ id: 's1', savedAt: NOW, body: '<p>一</p>' });
    writeDraft(storage, s1);
    // 重新整理：自動恢復 s1；填回不寫。接著打字 → 寫進 s2（記來源）。
    const p1 = load();
    expect(p1.pick?.plan).toEqual({ kind: 'auto' });
    const s2 = backup({ id: 's2', savedAt: NOW + 1, body: '<p>一二</p>', from: restoredLineage(p1.pick!.draft) });
    writeDraft(storage, s2);
    // 重新整理：s1 被 s2 遮住（不提示「之後又改過」），自動恢復 s2。
    const p2 = load();
    expect(p2.remove).toEqual([]);
    expect(p2.pick).toEqual({ draft: s2, plan: { kind: 'auto' } });
    // 恢復 s2 之後沒打字就存檔：刪來源鏈（寫下時間沒變的）。
    removeAncestors(storage, 'job-a', restoredLineage(p2.pick!.draft));
    expect(storage.map.size).toBe(0);
  });

  it('恢復後沒打字就連續重新整理：一份都不多', () => {
    const storage = memoryStorage();
    writeDraft(storage, backup({ id: 's1' }));
    for (let i = 0; i < 3; i += 1) {
      const plan = planDraftLoad(ctx({ drafts: readDrafts(storage, 'job-a') }));
      expect(plan.pick?.draft.id).toBe('s1');
      // 填回不寫任何東西（hook 的 afterFill 只丟掉變動紀錄，守門測試在下面「接法」）。
    }
    expect(storage.map.size).toBe(1);
  });
});

describe('審查 3：只刪自己最後寫的那份', () => {
  it('儲存區那份被別的分頁改寫過：不刪', () => {
    const storage = memoryStorage();
    const mine = backup();
    writeDraft(storage, backup({ body: '<p>另一個分頁剛寫的</p>', savedAt: NOW }));
    expect(removeDraftIfSame(storage, mine)).toBe(false);
    expect(readDraft(storage, 'job-a', 's1')?.body).toBe('<p>另一個分頁剛寫的</p>');
  });

  it('還是自己寫的那份：刪', () => {
    const storage = memoryStorage();
    writeDraft(storage, backup());
    expect(removeDraftIfSame(storage, backup())).toBe(true);
    expect(readDraft(storage, 'job-a', 's1')).toBeNull();
  });

  it('同一份＝寫下時間、內文、標題都一樣', () => {
    expect(sameDraft(backup(), backup())).toBe(true);
    expect(sameDraft(backup(), backup({ savedAt: NOW }))).toBe(false);
    expect(sameDraft(backup(), backup({ title: '別的' }))).toBe(false);
    expect(sameDraft(backup(), null)).toBe(false);
  });
});

describe('審查 8：儲存區滿了照樣讀得到、刪得掉，只是不能寫', () => {
  it('探測寫不進去：storage 還在、writable 是 false', () => {
    const base = memoryStorage();
    writeDraft(base, backup());
    const full = fullStorage(base);
    const opened = openDraftStorage(() => full);
    expect(opened.writable).toBe(false);
    expect(opened.storage).not.toBeNull();
    expect(readDrafts(opened.storage, 'job-a')).toHaveLength(1);
    expect(writeDraft(opened.storage, backup({ id: 's2' }))).toBe(false);
    removeDraft(opened.storage, 'job-a', 's1');
    expect(base.map.size).toBe(0);
  });

  it('拿不到儲存區（被擋）：null', () => {
    expect(
      openDraftStorage(() => {
        throw new Error('SecurityError');
      }),
    ).toEqual({ storage: null, writable: false });
    expect(openDraftStorage(() => memoryStorage()).writable).toBe(true);
  });
});

describe('過期清理：超過 30 天的留底載入時清掉', () => {
  it('只清本功能的鍵；過期、壞掉的清掉，30 天內的留著', () => {
    const storage = memoryStorage();
    writeDraft(storage, backup({ uuid: 'fresh', savedAt: NOW - DRAFT_MAX_AGE_MS + 60_000 }));
    writeDraft(storage, backup({ uuid: 'old', savedAt: NOW - DRAFT_MAX_AGE_MS - 1 }));
    storage.setItem(`${DRAFT_KEY_PREFIX}broken/x`, '{');
    storage.setItem(`${DRAFT_KEY_PREFIX}no-slash`, '{}');
    storage.setItem('publisher.agentProvider', 'codex');
    expect(pruneDrafts(storage, NOW)).toBe(3);
    expect([...storage.map.keys()].sort()).toEqual([draftKey('fresh', 's1'), 'publisher.agentProvider'].sort());
    expect(DRAFT_MAX_AGE_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });
});

describe('審查 4：哪些稿件留底', () => {
  it('能改的狀態恢復；其他（發布中、已取消、失敗、已發布、被取代）一律先不動，不刪（靠 30 天過期清）', () => {
    for (const state of ['SOURCE', 'REVIEWED', 'MEDIA_READY', 'RENDERED', 'PREVIEWED', 'APPROVED'] as const) {
      expect(draftEligibility(state)).toBe('restore');
    }
    for (const state of ['PUBLISHING', 'CANCELLED', 'FAILED', 'PUBLISHED', 'SUPERSEDED'] as const) {
      expect(draftEligibility(state)).toBe('wait');
    }
  });
});

describe('審查 1：什麼時候可以拿留底跟校樣比', () => {
  const base = { enabled: true, isEditing: false, holding: false, hasRevision: true, loadedKey: 'h2', revisionKey: 'h2' };

  it('iframe 載入的就是目前這一版、不在打字模式：可以', () => {
    expect(draftCheckReady(base)).toBe(true);
  });

  it('編輯中版本被換掉、新版本還沒載好（iframe 裡還是剛打的字）：不比', () => {
    expect(draftCheckReady({ ...base, loadedKey: 'h1' })).toBe(false);
    expect(draftCheckReady({ ...base, loadedKey: null })).toBe(false);
  });

  it('打字中、hold 中、沒有版本、沒接留底：不比', () => {
    expect(draftCheckReady({ ...base, isEditing: true })).toBe(false);
    expect(draftCheckReady({ ...base, holding: true })).toBe(false);
    expect(draftCheckReady({ ...base, hasRevision: false })).toBe(false);
    expect(draftCheckReady({ ...base, enabled: false })).toBe(false);
  });
});

describe('打開一篇稿件時一份留底要怎麼辦（planDraftRestore）', () => {
  const base = { now: NOW, state: 'PREVIEWED' as const, currentHash: 'h1', canEdit: true };
  const differs = (): boolean => true;
  const same = (): boolean => false;

  it('沒有留底：什麼都不做', () => {
    expect(planDraftRestore({ ...base, draft: null, differs })).toEqual({ kind: 'none' });
  });

  it('基準 hash 等於目前版本、內容不同：直接進打字模式填回', () => {
    expect(planDraftRestore({ ...base, draft: backup(), differs })).toEqual({ kind: 'auto' });
  });

  it('基準 hash 不等於目前版本：只問，不自動蓋掉', () => {
    expect(planDraftRestore({ ...base, currentHash: 'h2', draft: backup(), differs })).toEqual({ kind: 'offer', changedSince: true });
    expect(planDraftRestore({ ...base, currentHash: undefined, draft: backup(), differs })).toEqual({ kind: 'offer', changedSince: true });
  });

  it('Codex 第二輪：內容跟目前存好的完全相同才自動刪（基準不同也一樣，刪了不少任何字）', () => {
    expect(planDraftRestore({ ...base, currentHash: 'h2', draft: backup(), differs: same })).toEqual({ kind: 'drop' });
    expect(planDraftRestore({ ...base, currentHash: 'h2', draft: backup(), differs })).toEqual({ kind: 'offer', changedSince: true });
  });

  it('基準相同但現在不能進打字模式（AI 在跑）：先問', () => {
    expect(planDraftRestore({ ...base, canEdit: false, draft: backup(), differs })).toEqual({ kind: 'offer', changedSince: false });
  });

  it('基準相同、內容也跟目前一樣：默默刪掉', () => {
    expect(planDraftRestore({ ...base, draft: backup(), differs: same })).toEqual({ kind: 'drop' });
  });

  it('超過 30 天：刪掉，不比對內容', () => {
    let compared = false;
    const plan = planDraftRestore({
      ...base,
      draft: backup({ savedAt: NOW - DRAFT_MAX_AGE_MS - 1 }),
      differs: () => {
        compared = true;
        return true;
      },
    });
    expect(plan).toEqual({ kind: 'drop' });
    expect(compared).toBe(false);
  });

  it('讀取時唯一自動刪別人的是內容完全相同：已發布、被取代也只隱藏不刪；已取消、失敗、發布中同樣先不動', () => {
    for (const state of ['PUBLISHED', 'SUPERSEDED', 'CANCELLED', 'FAILED', 'PUBLISHING'] as const) {
      expect(planDraftRestore({ ...base, state, draft: backup(), differs })).toEqual({ kind: 'none' });
    }
  });
});

describe('審查 2：同一篇有好幾份留底（pickDraftPlan）', () => {
  const a = backup({ id: 'a', savedAt: NOW });
  const b = backup({ id: 'b', savedAt: NOW - 1000 });
  const c = backup({ id: 'c', savedAt: NOW - 2000 });

  it('要刪的刪掉、繼續看下一份；第一份要恢復或要問的就停在它', () => {
    const plans: Record<string, DraftPlan> = { a: { kind: 'drop' }, b: { kind: 'offer', changedSince: true }, c: { kind: 'auto' } };
    const result = pickDraftPlan([a, b, c], (d) => plans[d.id]!);
    expect(result.drop.map((d) => d.id)).toEqual(['a']);
    expect(result.pick).toEqual({ draft: b, plan: { kind: 'offer', changedSince: true } });
  });

  it('先不動的（發布中之類）：整篇都先不動', () => {
    const result = pickDraftPlan([a, b], () => ({ kind: 'none' }));
    expect(result).toEqual({ drop: [], pick: null });
  });

  it('全部都要刪：刪完沒有要處理的', () => {
    expect(pickDraftPlan([a, b], () => ({ kind: 'drop' }))).toEqual({ drop: [a, b], pick: null });
  });
});

describe('審查 2：「恢復」按不按得下去', () => {
  const base = { isEditing: false, canEdit: true, typedThisSession: false, blockedNote: 'AI 還在處理這篇，等它跑完再改。' };

  it('看稿時：能進打字模式才能按，不能就講原因', () => {
    expect(restoreAllowed(base)).toEqual({ allowed: true, reason: null });
    expect(restoreAllowed({ ...base, canEdit: false })).toEqual({ allowed: false, reason: base.blockedNote });
  });

  it('打字中還沒打字：可以（填回目前的編輯區）', () => {
    expect(restoreAllowed({ ...base, isEditing: true })).toEqual({ allowed: true, reason: null });
  });

  it('打字中這次已經打了字：不准，不能把剛打的整個換掉', () => {
    expect(restoreAllowed({ ...base, isEditing: true, typedThisSession: true })).toEqual({
      allowed: false,
      reason: DRAFT_RESTORE_WHILE_TYPING_NOTE,
    });
  });
});

describe('審查 5：存檔成功之後留底怎麼辦', () => {
  const sent = { title: '標題', body: '<p>送出的</p>' };

  it('送出之後沒再打字：刪', () => {
    expect(afterSaveDraft({ sent, now: { ...sent } })).toBe('remove');
  });

  it('送出之後到回應之間又打了字（正文或標題）：留著', () => {
    expect(afterSaveDraft({ sent, now: { ...sent, body: '<p>送出的，又多打的</p>' } })).toBe('keep');
    expect(afterSaveDraft({ sent, now: { ...sent, title: '標題改了' } })).toBe('keep');
  });
});

describe('審查 6：填回時拿掉的格式要講', () => {
  it('列出拿掉的格式', () => {
    expect(restoreDroppedNote(['底線', '刪除線'])).toBe('恢復的內容裡有這個版型不支援的格式：底線、刪除線。已經拿掉，字留著。');
  });
});

describe('提示列文字', () => {
  it('時間：同一天 HH:MM，不同天加上月／日', () => {
    expect(draftTimeLabel(new Date(2026, 9, 13, 9, 5).getTime(), NOW)).toBe('09:05');
    expect(draftTimeLabel(new Date(2026, 9, 12, 23, 40).getTime(), NOW)).toBe('10/12 23:40');
  });

  it('已恢復／之後又改過／先不能進打字模式／不能留底', () => {
    const at = new Date(2026, 9, 13, 21, 3).getTime();
    expect(draftNoticeText({ kind: 'restored', savedAt: at }, NOW)).toBe('已恢復 21:03 沒存的內容，還沒儲存。');
    expect(draftNoticeText({ kind: 'offer', changedSince: true, savedAt: at }, NOW)).toBe('有 21:03 沒存的內容，但這篇之後又改過。');
    expect(draftNoticeText({ kind: 'offer', changedSince: false, savedAt: at }, NOW)).toBe('有 21:03 沒存的內容還沒恢復。');
    expect(DRAFT_UNAVAILABLE_NOTE).toBe('這個視窗沒辦法自動留底，記得常按儲存。');
  });
});

describe('填回內文前的整理（safeRestoredEdit）', () => {
  const allow = { allowedTags: ['p', 'strong', 'em', 'a', 'figure', 'img', 'h2'], allowedSchemes: ['https', 'mailto'] };
  const el = (tag: string, attrs: [string, string][], children: RichNode[]): RichNode => ({
    type: 'element',
    tag,
    attrs: attrs.map(([name, value]) => ({ name, value })),
    children,
  });
  const t = (text: string): RichNode => ({ type: 'text', text });
  const restore = (edited: RichNode[], original: RichNode[] | null): string =>
    serializeRichEdit(safeRestoredEdit(cleanRichEdit(edited, original === null ? null : richUnits(original), allow)));

  it('跟目前版本一樣的區塊原樣保留（圖片、class 都在）', () => {
    const figure = el('figure', [['class', 'wp-block-image']], [el('img', [['src', 'https://x.test/a.jpg'], ['alt', 'a']], [])]);
    expect(restore([figure, el('p', [], [t('新寫的')])], [figure])).toBe(
      '<figure class="wp-block-image"><img src="https://x.test/a.jpg" alt="a"></figure>\n<p>新寫的</p>',
    );
  });

  it('改過的區塊照共用規則整理：模板不支援的格式拿掉並回報、b 變 strong、不收的連結拆掉', () => {
    const result = safeRestoredEdit(
      cleanRichEdit([el('p', [], [el('b', [], [t('粗')]), el('u', [], [t('底線')]), el('a', [['href', 'javascript:alert(1)']], [t('壞')])])], null, allow),
    );
    expect(serializeRichEdit(result)).toBe('<p><strong>粗</strong>底線壞</p>');
    expect(result.dropped).toContain('底線');
  });

  it('事件屬性（on*）與 javascript: 的 src 一律拿掉', () => {
    const html = restore(
      [el('p', [['onclick', 'x()']], [t('字')]), el('figure', [], [el('img', [['src', ' javascript:x()'], ['onerror', 'y()'], ['alt', 'b']], [])])],
      null,
    );
    expect(html).not.toMatch(/onclick|onerror|javascript/i);
    expect(html).toContain('<p>字</p>');
    expect(html).toContain('alt="b"');
  });

  it('script、iframe 等連內容丟掉', () => {
    expect(restore([el('script', [], [t('alert(1)')]), el('p', [], [t('留著')])], null)).toBe('<p>留著</p>');
  });
});

describe('接法（use-draft-backup／use-proof-editing／use-proof-frame／ProofView／Workspace）', () => {
  const hook = readFileSync(new URL('../src/ui/lib/use-draft-backup.ts', import.meta.url), 'utf8');
  const editing = readFileSync(new URL('../src/ui/lib/use-proof-editing.ts', import.meta.url), 'utf8');
  const frame = readFileSync(new URL('../src/ui/lib/use-proof-frame.ts', import.meta.url), 'utf8');
  const view = readFileSync(new URL('../src/ui/components/ProofView.tsx', import.meta.url), 'utf8');
  const workspace = readFileSync(new URL('../src/ui/components/Workspace.tsx', import.meta.url), 'utf8');
  const toolbar = readFileSync(new URL('../src/ui/components/EditToolbar.tsx', import.meta.url), 'utf8');

  it('分頁被藏起來或關掉時立刻寫，不等節流', () => {
    expect(hook).toContain("'visibilitychange'");
    expect(hook).toContain("'pagehide'");
  });

  it('留底只進瀏覽器儲存區，不送後端、不寫 log', () => {
    expect(hook).not.toMatch(/\bapi\.|fetch\(|console\./);
  });

  it('審查 1：讀留底之前先確認 iframe 載的是目前這一版（載入時記下 key）', () => {
    expect(hook).toContain('draftCheckReady(');
    const load = frame.slice(frame.indexOf('const handleLoad'), frame.indexOf('setLoadCount((count)'));
    expect(load).toContain('setLoadedKey(shownKeyRef.current)');
    expect(view).toContain('loadedKey: frame.loadedKey');
  });

  it('Codex 第一輪 1：基準只在本次編輯自己的存檔成功回呼裡換，外部版本變動（輪詢讀到別的分頁存的）不換', () => {
    expect(hook).not.toMatch(/\[draft\?\.baseHash\]/);
    const assigns = [...hook.matchAll(/session\.base = /g)].map((m) => m.index!);
    const finish = hook.indexOf('const finishSave');
    const rebase = hook.indexOf('const rebase');
    expect(rebase).toBeGreaterThan(0);
    expect(assigns.length).toBeGreaterThan(0);
    // 所有改基準的地方都在 rebase／finishSave 裡（兩個放在檔案最後面，前面的 effect 都不准改）。
    expect(assigns.every((at) => at > Math.min(finish, rebase))).toBe(true);
    // 先存再做（stay）也帶 onSaved，交給 rebase。
    const wrap = view.slice(view.indexOf('onSaveEdit:'), view.indexOf('onDiscardDraft:'));
    expect(wrap).toContain('rebase(');
  });

  it('Codex 第一輪 2：恢復不接手別人的鍵', () => {
    expect(hook).not.toMatch(/session\.id = /);
    expect(hook).toContain('restoredLineage(');
    expect(hook).not.toContain('supersededDrafts');
    // 填回之後不寫：使用者打了字才寫（連續重新整理不累積副本）。
    const fill = hook.slice(hook.indexOf('afterFill: () => {'), hook.indexOf('const throttle = createThrottle'));
    expect(fill).toContain('takeRecords()');
    expect(fill).not.toContain('write()');
  });

  it('Codex 第二輪：捨棄／取消只刪自己的鍵，不刪來源（沒打字就記已捨棄標記）；問恢復的「捨棄」也只記標記', () => {
    const discardSession = hook.slice(hook.indexOf('const discardSession'), hook.indexOf('const beginSave'));
    expect(discardSession).not.toContain('removeAncestors');
    expect(discardSession).toContain('dismissOnDiscard(');
    const discard = hook.slice(hook.indexOf('const discard = '), hook.indexOf('const notice'));
    expect(discard).not.toMatch(/removeDraft|removeAncestors/);
    expect(discard).toContain('markDismissed(');
    expect(hook).toContain('planDraftLoad(');
    // 刪來源鏈只在存檔成功（finishSave）。
    const finish = hook.indexOf('const finishSave');
    const after = hook.indexOf('const rebase');
    const uses = [...hook.matchAll(/removeAncestors\(/g)].map((m) => m.index!);
    expect(uses.length).toBeGreaterThan(0);
    expect(uses.every((at) => at > finish && at < after)).toBe(true);
  });

  it('審查 3：刪留底一律經過「還是自己寫的那份」的確認', () => {
    expect(hook).not.toMatch(/\bremoveDraft\(/);
  });

  it('取消與「沒改」都作廢留底；存檔成功由工作區在重讀之前帶著新 hash 通知', () => {
    const cancel = editing.slice(editing.indexOf('const cancelEdit'), editing.indexOf('const titleElement'));
    expect(cancel).toContain('onDiscardDraft');
    const unchanged = editing.slice(editing.indexOf("decision.kind === 'unchanged'"), editing.indexOf("decision.kind === 'invalid-title'"));
    expect(unchanged).toContain('onDiscardDraft');
    const save = workspace.slice(workspace.indexOf('onSaveEdit={async'), workspace.indexOf('tools={'));
    expect(save).toContain('onSaved?.(saved.contentHash)');
    expect(save.indexOf('onSaved?.(')).toBeGreaterThan(save.indexOf('api.createRevision'));
    expect(save.indexOf('onSaved?.(')).toBeLessThan(save.indexOf('await refresh()'));
  });

  it('審查 5：送出那一刻記下內容（beginSave），存好之後再比（finishSave）', () => {
    const wrap = view.slice(view.indexOf('onSaveEdit:'), view.indexOf('onDiscardDraft:'));
    expect(wrap.indexOf('beginSave()')).toBeGreaterThan(0);
    expect(wrap).toContain('finishSave(token, savedHash)');
  });

  it('審查 6：填回時拿掉的格式在 DropWarning 那裡講', () => {
    expect(editing).toContain('setRestoreDropped(dropped.length > 0');
    expect(toolbar).toContain('restoreDroppedNote(edit.restoreDropped)');
  });

  it('hook 排在 ProofView 既有的 hook 之後（不動原本 effect 的順序），useProofEditing 仍只有一個 effect', () => {
    expect(view.indexOf('useDraftBackup({')).toBeGreaterThan(view.indexOf('useWordCount({'));
    expect(editing.match(/\buseEffect\(/g)).toHaveLength(1);
  });
});
