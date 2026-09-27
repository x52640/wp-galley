/**
 * 「建議網址」（D-026，P5-T026）的請求與結果，放在模組層級、以 job uuid 為 key。
 *
 * 不放在「標題與網址」抽屜元件裡：跑的時候把抽屜關掉，元件就卸載了，結果（或失敗訊息）沒地方接，
 * 重開什麼都看不到——額度卻照花。放在這裡，抽屜重開就接得回來。
 *
 * 什麼時候清：開始新的一趟、在這個抽屜按了「儲存」（`clearSlugSuggest`），以及換到別篇稿件時把
 * 別篇已經結束的結果丟掉（`forgetOtherSlugSuggests`；還在跑的留著，跑完回來還接得到）。
 *
 * 這個檔不碰 window 與 API：請求怎麼送、錯誤怎麼講由呼叫端傳進來，所以可以直接在 node 裡測。
 */

export interface SlugIdeas {
  readonly slugs: string[];
  readonly dropped: number;
}

export interface SlugSuggestState {
  readonly running: boolean;
  /** 這一趟開始的時間（ISO），給計時器在後端的 agentRun 還沒出現前先跑。 */
  readonly startedAt: string | null;
  readonly ideas: SlugIdeas | null;
  readonly error: string | null;
  /** 使用者按了停止：那一趟的請求會以錯誤結束，但那不是錯誤。 */
  readonly stopped: boolean;
}

export const IDLE_SLUG_SUGGEST: SlugSuggestState = {
  running: false,
  startedAt: null,
  ideas: null,
  error: null,
  stopped: false,
};

const states = new Map<string, SlugSuggestState>();
const listeners = new Set<() => void>();

function set(uuid: string, next: SlugSuggestState): void {
  states.set(uuid, next);
  for (const listener of listeners) listener();
}

export function getSlugSuggest(uuid: string): SlugSuggestState {
  return states.get(uuid) ?? IDLE_SLUG_SUGGEST;
}

export function subscribeSlugSuggest(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export interface SlugSuggestDeps {
  /** 送出請求（`api.suggestSlugs`）。 */
  readonly request: () => Promise<SlugIdeas>;
  /** 失敗時問一次後端：這一趟是不是被停止的（停止可能是抽屜裡的、也可能是頂端長條的）。 */
  readonly wasCancelled: () => Promise<boolean>;
  /** 錯誤 → 給人看的一句話。 */
  readonly describe: (cause: unknown) => string;
  /** 送出後、結束後重讀稿件（頂端長條與按鈕鎖定才跟得上）。抽屜關了也會呼叫。 */
  readonly refresh?: () => Promise<void> | void;
}

/**
 * 開始一趟。同一篇已經在跑就什麼都不做（後端也會擋）。回傳的 promise 永遠不 reject：
 * 結果與錯誤都存進 state。
 */
export async function startSlugSuggest(uuid: string, deps: SlugSuggestDeps, now = new Date()): Promise<void> {
  if (getSlugSuggest(uuid).running) return;
  set(uuid, { ...IDLE_SLUG_SUGGEST, running: true, startedAt: now.toISOString() });
  try {
    const ideas = await deps.request();
    set(uuid, { ...IDLE_SLUG_SUGGEST, ideas });
  } catch (cause) {
    let cancelled = false;
    try {
      cancelled = await deps.wasCancelled();
    } catch {
      cancelled = false;
    }
    set(uuid, cancelled ? { ...IDLE_SLUG_SUGGEST, stopped: true } : { ...IDLE_SLUG_SUGGEST, error: deps.describe(cause) });
  } finally {
    try {
      await deps.refresh?.();
    } catch {
      /* 重讀失敗不影響結果；工作區自己的輪詢會再試。 */
    }
  }
}

/** 收起這一篇的結果（還在跑的不動：那一趟回來還要有地方接）。 */
export function clearSlugSuggest(uuid: string): void {
  const current = states.get(uuid);
  if (!current || current.running) return;
  states.delete(uuid);
  for (const listener of listeners) listener();
}

/** 換到別篇：別篇已經結束的結果丟掉，還在跑的留著。 */
export function forgetOtherSlugSuggests(uuid: string): void {
  let changed = false;
  for (const [key, state] of states) {
    if (key !== uuid && !state.running) {
      states.delete(key);
      changed = true;
    }
  }
  if (changed) for (const listener of listeners) listener();
}
