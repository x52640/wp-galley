import { useCallback, useEffect, useRef, useState, type JSX, type ReactNode, type RefObject } from 'react';
import { Icon } from '../icons.js';
import { insertSlots, type BlockBox } from '../lib/proof-frame.js';

/**
 * 在這裡插圖（P5-T016；P5-T043 從 ProofView 抽出）。
 *
 * 段落之間（含最前面與最後面）滑鼠移過去出現「在這裡插圖」。跟頁邊符號一樣畫在 iframe 外層，
 * 位置用同一份量到的區塊座標算（上一段的底與下一段的頂的中間，`lib/proof-frame.ts` 的 `insertSlots`），iframe 裡什麼都不加。
 * 要不要出現由上層決定（`insertImage` 給 null 就不畫），編輯中這裡再擋一次。
 *
 * 狀態與 effect 在 `useInsertSlots`，ProofView 在原本的位置呼叫（React 照呼叫順序跑 effect，要排在選字膠囊之後）；
 * 畫面在 `InsertSlots`。
 */

export interface InsertSlotsState {
  /** 打開了哪一個「在這裡插圖」（插在第幾塊之後）；null＝沒打開。 */
  inserting: number | null;
  /** 換版本時收掉打開的面板。 */
  reset: () => void;
  toggle: (after: number) => void;
  slots: { after: number; y: number }[];
  openSlot: { after: number; y: number } | undefined;
  closeInsert: () => void;
  popRef: RefObject<HTMLDivElement | null>;
}

export function useInsertSlots({
  canInsert,
  blocks,
  scrollRef,
}: {
  /** 給不給插：上層給了 `insertImage`、看文章模式、沒在打字、校樣載完、量到區塊。 */
  canInsert: boolean;
  blocks: readonly BlockBox[];
  scrollRef: RefObject<HTMLDivElement | null>;
}): InsertSlotsState {
  const [inserting, setInserting] = useState<number | null>(null);
  // 不給插了（進了對照、打開發布面板、開始改字…）就把打開的面板收掉。
  useEffect(() => {
    if (!canInsert) setInserting(null);
  }, [canInsert]);
  const slots = canInsert ? insertSlots(blocks) : [];
  const openSlot = inserting === null ? undefined : slots.find((slot) => slot.after === inserting);
  /** 關掉插圖面板，焦點回到打開它的那顆「在這裡插圖」（放好之後版本換了、按鈕不在了就算了）。 */
  const closeInsert = useCallback(() => {
    const after = inserting;
    setInserting(null);
    if (after === null) return;
    window.requestAnimationFrame(() => {
      scrollRef.current?.querySelector<HTMLElement>(`.insert-slot-btn[data-after='${after}']`)?.focus({ preventScroll: true });
    });
  }, [inserting]);
  // 面板打開在段落下面，靠近視窗底時會被切掉；捲到看得見整個面板為止。
  const popRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (inserting === null) return;
    popRef.current?.scrollIntoView({
      block: 'nearest',
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
  }, [inserting]);
  return {
    inserting,
    reset: () => setInserting(null),
    toggle: (after) => setInserting((current) => (current === after ? null : after)),
    slots,
    openSlot,
    closeInsert,
    popRef,
  };
}

/** 段落之間的「在這裡插圖」與打開的面板。沒有位置或量不到正文欄就不畫。 */
export function InsertSlots({
  state,
  column,
  insertImage,
}: {
  state: InsertSlotsState;
  column: { left: number; width: number } | null;
  insertImage: ((afterBlockIndex: number, close: () => void) => ReactNode) | null;
}): JSX.Element | null {
  const { slots, inserting, openSlot, popRef, closeInsert, toggle } = state;
  if (slots.length === 0 || column === null) return null;
  return (
    <div className="proof-inserts" aria-label="插入圖片的位置">
      {slots.map((slot) => (
        <div
          key={slot.after}
          className="insert-slot"
          data-open={inserting === slot.after ? 'yes' : 'no'}
          style={{ top: `${slot.y - 12}px`, left: `${column.left}px`, width: `${column.width}px` }}
        >
          <button
            type="button"
            className="insert-slot-btn"
            data-after={slot.after}
            aria-expanded={inserting === slot.after}
            onClick={() => toggle(slot.after)}
          >
            <Icon name="image-plus" size={13} />
            在這裡插圖
            <span className="sr-only">
              {slot.after < 0 ? '（文章最前面）' : `（第 ${slot.after + 1} 段之後）`}
            </span>
          </button>
        </div>
      ))}
      {openSlot !== undefined && insertImage !== null && (
        <div
          ref={popRef}
          className="insert-pop"
          style={{ top: `${openSlot.y + 16}px`, left: `${column.left}px`, width: `${Math.min(column.width, 416)}px` }}
        >
          {insertImage(openSlot.after, closeInsert)}
        </div>
      )}
    </div>
  );
}
