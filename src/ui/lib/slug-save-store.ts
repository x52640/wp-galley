/**
 * 發布面板「存網址」進行中的狀態，放在模組層級、以稿件 uuid 為 key（P5-T039，PR #25 Codex 審查 P2）。
 * 分類／標籤的「沒存的選取」與「存分類進行中」也放這裡、走同一套（P5-T051 跟進，D-050）：沒存擋發布，關面板再開照樣擋。
 *
 * 不放在元件裡：存的期間面板被關掉（關閉鈕、點外面、工作區換畫面）再打開，元件是新的，
 * 本地的 busy 會變回 false、發布按鈕又能按；這時發布請求若先到後端，會用舊網址發出去，
 * 之後那趟存檔因為稿件已不能改而被拒。放在這裡，重開的面板照樣知道「還在存」，照樣擋發布。
 *
 * 這個檔不碰 window 與 API，可以直接在 node 裡測。
 */

import { isSlugDirty, isTaxonomyDirty, withTermAdded } from './publish-slug.js';

const saving = new Set<string>();
/** 發布面板網址框沒存的字，以稿件為 key（見 `slugDraftFor`）。 */
const drafts = new Map<string, string>();
/** 分類：存的期間與沒存的選取（見 `taxonomyDraftFor`）。 */
const taxonomySaving = new Set<string>();
/** 建立新項目＋套用＋存的整段（`holdTaxonomy`）。跟 taxonomySaving 分開記，存的那一步才不會被自己擋掉。 */
const taxonomyHolds = new Map<string, number>();
const taxonomyDrafts = new Map<string, readonly string[]>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function isSlugSaving(uuid: string): boolean {
  return saving.has(uuid);
}

export function subscribeSlugSave(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * 工作區重讀的結果：`applied`＝讀到並寫進畫面了；`failed`＝沒套用（讀失敗、或被更新的一次重讀取代），要再試；
 * `gone`＝工作區已經不在這一篇（換篇、離開），再試也不會套用。
 */
export type SyncOutcome = 'applied' | 'failed' | 'gone';

/** 存網址的步驟：`save` 存（含渲染之類）、`sync` 重讀工作區。`wait` 給測試換掉。 */
export interface SlugSaveSteps {
  readonly save: () => Promise<void>;
  readonly sync: () => Promise<SyncOutcome>;
  readonly wait?: (ms: number) => Promise<void>;
}

/** 重讀沒套用時隔多久再試；上一次結束才排下一次（跟工作區的待同步同一個節奏）。 */
export const SLUG_SYNC_RETRY_MS = 3000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** 重讀到套用（或工作區已經不在這一篇）為止。一次只跑一個。 */
async function syncUntilApplied(steps: SlugSaveSteps): Promise<void> {
  const wait = steps.wait ?? sleep;
  for (;;) {
    let outcome: SyncOutcome;
    try {
      outcome = await steps.sync();
    } catch {
      outcome = 'failed';
    }
    if (outcome !== 'failed') return;
    await wait(SLUG_SYNC_RETRY_MS);
  }
}

/**
 * 跑一趟存網址。同一篇已經在存就什麼都不做。`save` 失敗：放開、草稿留著、錯誤原樣丟回給呼叫端顯示。
 * `save` 成功之後要**重讀真的套用到畫面**才算存好（PR #28 第三輪 Codex P2：重讀吞掉錯誤照樣 resolve，
 * 以前會在畫面還是舊值時就清草稿、放開發布）：沒套用就維持「存網址進行中」，每 3 秒再讀一次，套用了才清掉這篇的草稿、放開。
 * 工作區已經不在這一篇（`gone`）就不再等：存是成功的，草稿一樣清掉（下次進來會重新讀）。
 */
export async function runSlugSave(uuid: string, steps: SlugSaveSteps): Promise<void> {
  return runSave(saving, drafts, uuid, steps);
}

/** 網址與分類共用：同一篇已經在存就什麼都不做；存好、重讀到套用才清草稿、放開；存失敗放開、草稿留著、錯誤丟回。 */
async function runSave(busy: Set<string>, pending: Map<string, unknown>, uuid: string, steps: SlugSaveSteps): Promise<void> {
  // 打字模式中不存（PR #39 跟進）：存了會出新版本，編輯區重載、打到一半的字被換掉。畫面上的按鈕已經反灰，這裡是最後一道。
  if (editingJobs.has(uuid)) throw new Error(EDITING_SAVE_NOTE);
  if (busy.has(uuid)) return;
  busy.add(uuid);
  notify();
  try {
    await steps.save();
    await syncUntilApplied(steps);
    // 存好、畫面也讀到新值：這篇的草稿一律清掉（PR #28 第二輪 Codex P2）。面板關著時沒有元件替它清；
    // 開著的面板訂閱這裡，跟著讀到新的已存值。
    pending.delete(uuid);
  } finally {
    busy.delete(uuid);
    notify();
  }
}

/**
 * 發布面板網址框沒存的字（P5-T040 #2，#25 補審）：按 × 或點遮罩關掉面板，元件換新，框裡的字跟「沒存」的擋發布會一起不見。
 * 記在這裡，以稿件為 key，**而且只有這一份**（PR #28 第三輪 Codex P2）：面板不自己持有草稿，打字寫進來、畫面從這裡讀
 * （`useSyncExternalStore`），存成功時這裡清掉，開著的面板也跟著變，不會有過期的一份把舊字寫回來或拿去存。
 * 只在記憶體裡，重新整理頁面就沒了（那時本來就沒有開著的面板）。
 */

/** 框裡該放什麼：這篇有沒存的字就用它，沒有（或已存的值已經跟上它）就用已存的網址。別篇的不會拿到。 */
export function slugDraftFor(uuid: string, saved: string): string {
  const draft = drafts.get(uuid);
  if (draft === undefined) return saved;
  // 已存的值跟上了草稿：草稿作廢（之後已存的再變也跟著走）。刪掉不改變這次回傳的值。
  if (!isSlugDirty(draft, saved)) {
    drafts.delete(uuid);
    return saved;
  }
  return draft;
}

/** 框裡打字（或取消、Escape 還原）：跟已存的不一樣才記，一樣就清掉；通知訂閱的面板。 */
export function setSlugDraft(uuid: string, draft: string, saved: string): void {
  if (isSlugDirty(draft, saved)) drafts.set(uuid, draft);
  else drafts.delete(uuid);
  notify();
}

export function clearSlugDraft(uuid: string): void {
  drafts.delete(uuid);
  notify();
}

/** 「標題與網址」抽屜這次存檔有沒有改到網址（跟送出的值比，P5-T040 #3）。 */
export function sourceSaveTouchesSlug(data: Readonly<Record<string, unknown>> | null | undefined, slug: string): boolean {
  const saved = typeof data?.slug === 'string' ? data.slug : '';
  return slug !== saved;
}

/**
 * 「標題與網址」抽屜的存檔（P5-T040 #3，#25 補審）：改到網址就登記成「存網址進行中」，跟發布面板同一個狀態，
 * 抽屜關掉去開發布面板照樣擋發布；存好之後重讀到套用才放開（同 `runSlugSave`），存失敗也放開，錯誤丟回給抽屜顯示。
 * 沒改到網址：存、重讀一次（跟以前一樣，不等）。發布面板那邊已經在存網址時不默默跳過，直接講。
 */
export async function runSourceSave(uuid: string, touchesSlug: boolean, steps: SlugSaveSteps): Promise<void> {
  if (!touchesSlug) {
    await steps.save();
    await steps.sync();
    return;
  }
  if (saving.has(uuid)) throw new Error('正在存網址，等它存好再存。');
  return runSlugSave(uuid, steps);
}

// --- 分類／標籤（P5-T051 跟進，D-050）：跟網址同一套 ---------------------------------------

export function isTaxonomySaving(uuid: string): boolean {
  return taxonomySaving.has(uuid) || (taxonomyHolds.get(uuid) ?? 0) > 0;
}

/**
 * 在發布面板建立新的分類項目時，**請求送出前**就登記「存分類中」（擋發布），建立、套用、存整段跑完（含失敗）才放開
 * （PR #39 Codex 第一輪：以前只有面板裡的 busy，發布按鈕看不到，建立回來前按發布會送出舊分類）。
 * 登記在模組層級、以稿件為 key：面板關掉再開照樣擋。
 */
export async function holdTaxonomy<T>(uuid: string, fn: () => Promise<T>): Promise<T> {
  taxonomyHolds.set(uuid, (taxonomyHolds.get(uuid) ?? 0) + 1);
  notify();
  try {
    return await fn();
  } finally {
    const left = (taxonomyHolds.get(uuid) ?? 1) - 1;
    if (left > 0) taxonomyHolds.set(uuid, left);
    else taxonomyHolds.delete(uuid);
    notify();
  }
}

/**
 * 分類面板該顯示哪些選取：這篇有沒存的選取就用它，沒有（或已存的已經跟上它）就用已存的。別篇拿不到。
 * 回傳的一定是傳進來的 `saved` 或存著的那一份（同一個參考），給 `useSyncExternalStore` 用。
 */
export function taxonomyDraftFor(uuid: string, saved: readonly string[]): readonly string[] {
  const draft = taxonomyDrafts.get(uuid);
  if (draft === undefined) return saved;
  if (!isTaxonomyDirty(draft, saved)) {
    taxonomyDrafts.delete(uuid);
    return saved;
  }
  return draft;
}

/** 點選／取消某個項目：跟已存的不一樣才記，一樣就清掉；通知訂閱的面板。 */
export function setTaxonomyDraft(uuid: string, draft: readonly string[], saved: readonly string[]): void {
  if (isTaxonomyDirty(draft, saved)) taxonomyDrafts.set(uuid, [...draft]);
  else taxonomyDrafts.delete(uuid);
  notify();
}

export function clearTaxonomyDraft(uuid: string): void {
  taxonomyDrafts.delete(uuid);
  notify();
}

/** 跑一趟存分類（「儲存分類」與建好新項目後自動存都走這裡）。規則同 `runSlugSave`。 */
export async function runTaxonomySave(uuid: string, steps: SlugSaveSteps): Promise<void> {
  return runSave(taxonomySaving, taxonomyDrafts, uuid, steps);
}

// --- 跟打字模式的關係（PR #39 Codex 第二輪）-----------------------------------------------

/**
 * 發布面板這篇正在存東西（存網址、存分類、建立分類的整段）。這期間存好會出新版本、校樣重載，
 * 所以**所有進打字模式的入口**都要擋（`use-job-workspace.ts` 的 editBlocked 用它）。
 */
export function isPublishPanelSaving(uuid: string): boolean {
  return saving.has(uuid) || isTaxonomySaving(uuid);
}

/** 哪幾篇此刻在打字模式（Workspace 登記；不管是怎麼進去的）。 */
const editingJobs = new Set<string>();

/** 打字模式中，發布面板會建新版本的按鈕（儲存分類、存網址、建立分類、核准並發布）反灰時講的話。 */
export const EDITING_SAVE_NOTE = '你正在改原文，先按上方『儲存』或『取消』再存。';

/** 登記這篇在不在打字模式；有變才通知訂閱的面板（按鈕跟著反灰／恢復）。 */
export function markEditing(uuid: string, on: boolean): void {
  if (on === editingJobs.has(uuid)) return;
  if (on) editingJobs.add(uuid);
  else editingJobs.delete(uuid);
  notify();
}

export function isEditingJob(uuid: string): boolean {
  return editingJobs.has(uuid);
}

export type AddTermOutcome =
  | { readonly kind: 'saved' }
  | { readonly kind: 'failed'; readonly error: string }
  /** 這篇正在打字模式：不自動存（會出新版本、編輯區重載、打到一半的字被換掉），留成「選了沒存」。 */
  | { readonly kind: 'deferred' };

/**
 * 建好（或選了既有的）新項目：加進**最新的**選取（單選取代）、記成草稿；這篇不在打字模式才自動存。
 * `save` 回傳失敗原因，成功是 null。
 */
export async function addTermToSelection(input: {
  readonly uuid: string;
  readonly name: string;
  readonly saved: readonly string[];
  readonly multiple: boolean;
  readonly save: (selection: readonly string[]) => Promise<string | null>;
}): Promise<AddTermOutcome> {
  const next = withTermAdded(taxonomyDraftFor(input.uuid, input.saved), input.name, input.multiple);
  setTaxonomyDraft(input.uuid, next, input.saved);
  if (isEditingJob(input.uuid)) return { kind: 'deferred' };
  const error = await input.save(next);
  return error === null ? { kind: 'saved' } : { kind: 'failed', error };
}
