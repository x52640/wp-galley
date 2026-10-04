/**
 * 發布面板「存網址」進行中的狀態，放在模組層級、以稿件 uuid 為 key（P5-T039，PR #25 Codex 審查 P2）。
 *
 * 不放在元件裡：存的期間面板被關掉（關閉鈕、點外面、工作區換畫面）再打開，元件是新的，
 * 本地的 busy 會變回 false、發布按鈕又能按；這時發布請求若先到後端，會用舊網址發出去，
 * 之後那趟存檔因為稿件已不能改而被拒。放在這裡，重開的面板照樣知道「還在存」，照樣擋發布。
 *
 * 這個檔不碰 window 與 API，可以直接在 node 裡測。
 */

import { isSlugDirty } from './publish-slug.js';

const saving = new Set<string>();
/** 發布面板網址框沒存的字，以稿件為 key（見 `slugDraftFor`）。 */
const drafts = new Map<string, string>();
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
  if (saving.has(uuid)) return;
  saving.add(uuid);
  notify();
  try {
    await steps.save();
    await syncUntilApplied(steps);
    // 存好、畫面也讀到新值：這篇的草稿一律清掉（PR #28 第二輪 Codex P2）。面板關著時沒有元件替它清；
    // 開著的面板訂閱這裡，跟著讀到新的已存值。
    drafts.delete(uuid);
  } finally {
    saving.delete(uuid);
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
