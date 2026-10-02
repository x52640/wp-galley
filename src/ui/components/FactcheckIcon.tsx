import type { JSX } from 'react';
import { Icon, type IconName } from '../icons.js';

/**
 * 查證用到、`icons.tsx` 還沒有的幾個 Lucide 圖示（手抄 inline SVG，同一套畫法）。
 * 放在這裡是因為 P6-T005 的寫入範圍不含 `icons.tsx`；之後要共用再搬過去。其他名字照舊交給 `Icon`。
 */
const LOCAL: Record<string, JSX.Element> = {
  // Lucide search-check
  'search-check': (
    <>
      <path d="m8 11 2 2 4-4" />
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </>
  ),
  // Lucide circle-help
  'circle-help': (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <path d="M12 17h.01" />
    </>
  ),
  // Lucide info
  info: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </>
  ),
  // Lucide circle-alert
  'circle-alert': (
    <>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" x2="12" y1="8" y2="12" />
      <line x1="12" x2="12.01" y1="16" y2="16" />
    </>
  ),
};

export type FactcheckIconName = IconName | 'search-check' | 'circle-help' | 'info' | 'circle-alert';

export function FcIcon({ name, size = 16, className }: { name: FactcheckIconName; size?: number; className?: string }): JSX.Element {
  const local = LOCAL[name];
  if (local === undefined) return <Icon name={name as IconName} size={size} {...(className === undefined ? {} : { className })} />;
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {local}
    </svg>
  );
}
