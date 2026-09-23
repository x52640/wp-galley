import { useEffect, useRef, type JSX, type ReactNode } from 'react';
import { Icon } from '../icons.js';

/**
 * 從右邊滑出來的抽屜（B1 的「改原文」、B2 的「發布」）。
 *
 * 用抽屜而不是換頁：文章要一直留在左邊看得到（D-008，任何讓使用者離開畫面的
 * 都算 bug）。Esc 或點外面就關；打開時把焦點移進來，關掉時還給原本的按鈕。
 */
export function Sheet({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}): JSX.Element {
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="sheet-layer">
      <button type="button" className="sheet-backdrop" aria-label="關閉" tabIndex={-1} onClick={onClose} />
      <aside
        className="sheet"
        data-wide={wide ? 'yes' : 'no'}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={panelRef}
      >
        <header className="sheet-head">
          <h2 className="sheet-title">{title}</h2>
          <button type="button" className="icon-btn" aria-label="關閉" onClick={onClose}>
            <Icon name="x" size={18} />
          </button>
        </header>
        <div className="sheet-body">{children}</div>
      </aside>
    </div>
  );
}
