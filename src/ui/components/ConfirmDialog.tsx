import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type ReactNode,
} from 'react';
import { Icon } from '../icons.js';

/**
 * 二次確認。
 *
 * 破壞性操作（取消稿件、移除圖片、撤銷核准）一律先問一次——這是設計系統的
 * 品質底線，也是核准模型的一部分：撤銷核准會讓已經走到最後一步的東西退回去，
 * 不該一個誤點就發生。
 *
 * 用原生 `<dialog>` 的 showModal()：ESC 關閉、焦點鎖在對話框內、背景不可點，
 * 這些全部是瀏覽器內建的，自己寫只會做得比較差。
 */

export interface ConfirmRequest {
  title: string;
  /** 說清楚會發生什麼事。不要只寫「確定嗎？」。 */
  body: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
}

type AskFn = (request: ConfirmRequest) => void;

const ConfirmContext = createContext<AskFn>(() => {
  throw new Error('ConfirmProvider 沒有包住這棵樹');
});

export function useConfirm(): AskFn {
  return useContext(ConfirmContext);
}

export function ConfirmProvider({ children }: { children: ReactNode }): JSX.Element {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  const ask = useCallback<AskFn>((next) => {
    setError(null);
    setBusy(false);
    setRequest(next);
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (request && !dialog.open) dialog.showModal();
    if (!request && dialog.open) dialog.close();
  }, [request]);

  const close = useCallback(() => {
    if (!busy) setRequest(null);
  }, [busy]);

  const run = useCallback(async () => {
    if (!request) return;
    setBusy(true);
    setError(null);
    try {
      await request.onConfirm();
      setRequest(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [request]);

  const value = useMemo(() => ask, [ask]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <dialog className="confirm" ref={dialogRef} onCancel={(event) => { event.preventDefault(); close(); }}>
        {request && (
          <div className="confirm-inner">
            <h2 className="confirm-title">
              {request.danger && <Icon name="alert" size={18} />}
              {request.title}
            </h2>
            <div className="confirm-body">{request.body}</div>
            {error && (
              <p className="confirm-error" role="alert">
                {error}
              </p>
            )}
            <div className="confirm-actions">
              <button type="button" className="btn btn-quiet" onClick={close} disabled={busy}>
                取消
              </button>
              <button
                type="button"
                className={request.danger ? 'btn btn-danger' : 'btn btn-primary'}
                onClick={() => void run()}
                disabled={busy}
                autoFocus
              >
                {busy ? '處理中…' : request.confirmLabel}
              </button>
            </div>
          </div>
        )}
      </dialog>
    </ConfirmContext.Provider>
  );
}
