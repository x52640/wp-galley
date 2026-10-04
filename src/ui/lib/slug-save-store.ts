/**
 * 發布面板「存網址」進行中的狀態，放在模組層級、以稿件 uuid 為 key（P5-T039，PR #25 Codex 審查 P2）。
 *
 * 不放在元件裡：存的期間面板被關掉（關閉鈕、點外面、工作區換畫面）再打開，元件是新的，
 * 本地的 busy 會變回 false、發布按鈕又能按；這時發布請求若先到後端，會用舊網址發出去，
 * 之後那趟存檔因為稿件已不能改而被拒。放在這裡，重開的面板照樣知道「還在存」，照樣擋發布。
 *
 * 這個檔不碰 window 與 API，可以直接在 node 裡測。
 */

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
