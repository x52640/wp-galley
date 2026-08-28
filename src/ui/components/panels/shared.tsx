import { useCallback, useState, type JSX, type ReactNode } from 'react';
import { describeError } from '../../service/client.js';
import { Icon, type IconName } from '../../icons.js';

/** 右面板的共用外殼與狀態。每張卡片只做一件事，錯誤就顯示在那張卡片裡。 */

export function PanelCard({
  icon,
  title,
  hint,
  open,
  onToggle,
  children,
}: {
  icon: IconName;
  title: string;
  hint?: string | undefined;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}): JSX.Element {
  return (
    <section className="card" data-open={open ? 'yes' : 'no'}>
      <h2 className="card-head">
        <button type="button" className="card-toggle" onClick={onToggle} aria-expanded={open}>
          <Icon name={icon} size={15} className="card-icon" />
          <span className="card-title">{title}</span>
          {hint !== undefined && <span className="card-hint">{hint}</span>}
          <Icon name={open ? 'chevron-down' : 'chevron-right'} size={15} className="card-caret" />
        </button>
      </h2>
      {open && <div className="card-body">{children}</div>}
    </section>
  );
}

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
