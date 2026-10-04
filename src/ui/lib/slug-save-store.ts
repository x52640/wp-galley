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
 * 跑一趟存網址。同一篇已經在存就什麼都不做；結束（成功或失敗）才放開。錯誤原樣丟回給呼叫端顯示。
 */
export async function runSlugSave(uuid: string, task: () => Promise<void>): Promise<void> {
  if (saving.has(uuid)) return;
  saving.add(uuid);
  notify();
  try {
    await task();
  } finally {
    saving.delete(uuid);
    notify();
  }
}

/**
 * 發布面板網址框沒存的字（P5-T040 #2，#25 補審）：按 × 或點遮罩關掉面板，元件換新，框裡的字跟「沒存」的擋發布會一起不見。
 * 記在這裡，以稿件為 key：重開時拿回來、照樣擋發布；按取消（框回到已存的值）或存成功（已存的值跟上框）就清掉。
 * 只在記憶體裡，重新整理頁面就沒了（那時本來就沒有開著的面板）。
 */
const drafts = new Map<string, string>();

/** 面板打開時框裡該放什麼：這篇有沒存的字就用它，沒有就用已存的網址。別篇的不會拿到。 */
export function slugDraftFor(uuid: string, saved: string): string {
  return drafts.get(uuid) ?? saved;
}

/** 框裡的字變了（或已存的網址變了）時同步：跟已存的不一樣才記，一樣就清掉。 */
export function keepSlugDraft(uuid: string, draft: string, saved: string): void {
  if (isSlugDirty(draft, saved)) drafts.set(uuid, draft);
  else drafts.delete(uuid);
}

export function clearSlugDraft(uuid: string): void {
  drafts.delete(uuid);
}

/** 「標題與網址」抽屜這次存檔有沒有改到網址（跟送出的值比，P5-T040 #3）。 */
export function sourceSaveTouchesSlug(data: Readonly<Record<string, unknown>> | null | undefined, slug: string): boolean {
  const saved = typeof data?.slug === 'string' ? data.slug : '';
  return slug !== saved;
}

/**
 * 「標題與網址」抽屜的存檔（P5-T040 #3，#25 補審）：改到網址就登記成「存網址進行中」，跟發布面板同一個狀態，
 * 抽屜關掉去開發布面板照樣擋發布；`task` 要包含存完之後的重讀，結束（成功或失敗）才放開，錯誤丟回給抽屜顯示。
 * 發布面板那邊已經在存網址時不默默跳過（`runSlugSave` 會什麼都不做），直接講。
 */
export async function runSourceSave(uuid: string, touchesSlug: boolean, task: () => Promise<void>): Promise<void> {
  if (!touchesSlug) return task();
  if (saving.has(uuid)) throw new Error('正在存網址，等它存好再存。');
  return runSlugSave(uuid, task);
}
