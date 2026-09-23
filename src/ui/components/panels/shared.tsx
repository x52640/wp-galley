import { useCallback, useState, type JSX, type ReactNode } from 'react';
import { ApiError, describeError } from '../../service/client.js';
import { Icon } from '../../icons.js';

/** 面板共用的欄位與狀態。每個區塊只做一件事，錯誤就顯示在那個區塊裡。 */

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string | undefined;
  children: ReactNode;
}): JSX.Element {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint !== undefined && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function ErrorNote({ message }: { message: string | null }): JSX.Element | null {
  if (message === null) return null;
  return (
    <p className="note note-bad" role="alert">
      <Icon name="alert" size={14} />
      <span>{message}</span>
    </p>
  );
}

export function InfoNote({ children }: { children: ReactNode }): JSX.Element {
  return (
    <p className="note note-info">
      <Icon name="check" size={14} />
      <span>{children}</span>
    </p>
  );
}

export interface ActionState {
  busy: boolean;
  error: string | null;
  run: (fn: () => Promise<unknown>) => Promise<void>;
  clear: () => void;
}

/** 每個動作都要有：忙碌中不能重按、失敗訊息說得出「發生什麼事」。 */
export function useAction(): ActionState {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  }, []);

  return { busy, error, run, clear: () => setError(null) };
}

export function Spinner(): JSX.Element {
  return <Icon name="spinner" size={14} className="spin" />;
}

/**
 * 「我改的東西是根據舊版算的」這種衝突。
 *
 * 每個面板送出的 `templateData` 都是**整份取代**，所以兩邊各自送出時，晚到的
 * 那一份會把先到的欄位悄悄蓋掉。送出時帶 `expectedContentHash`，後端對不上就
 * 拒絕；這裡負責把那個拒絕講成人話——重點是「沒有蓋掉別人的東西」與「接下來
 * 該做什麼」，不是丟一個錯誤碼。
 *
 * 後端用哪個 code 由 CoreService 決定（現有的 `CONTENT_CHANGED` 最貼近），
 * 所以這裡認一組同義的 code 加上 HTTP 409，不押單一個字串。
 */
const CONFLICT_CODES = new Set([
  'CONTENT_CHANGED',
  'CONTENT_CONFLICT',
  'REVISION_CONFLICT',
  'REVISION_MISMATCH',
  'STALE_REVISION',
]);

export const REVISION_CONFLICT_MESSAGE =
  '這一版在你編輯的期間被改過了（可能是 Agent 剛跑完，或另一個分頁動過）。' +
  '這次沒有存進去，也沒有蓋掉那些修改。按上面的「重新讀取」拿最新的內容，再改一次。';

export function isRevisionConflict(cause: unknown): boolean {
  if (!(cause instanceof ApiError)) return false;
  return cause.status === 409 || CONFLICT_CODES.has(cause.code);
}

/** 包住「整份取代」的送出。衝突換成人話，其他錯誤原樣往上丟。 */
export async function guardEdit<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (cause) {
    if (isRevisionConflict(cause)) throw new Error(REVISION_CONFLICT_MESSAGE);
    throw cause;
  }
}
