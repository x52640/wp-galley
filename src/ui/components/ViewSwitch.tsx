import type { JSX } from 'react';

/**
 * 主區的檢視切換（B1 頂列）。
 *
 * - **編輯**：校樣上標出建議，右邊是對應的卡片。預設就是這個。
 * - **對照**：跟 AI 的提案或上一版逐段比對。
 * - **成品**：跟網站上一模一樣，什麼都不標。發布前要在這裡看過才准核准。
 *
 * 三個就夠。查證的發現不會再開第四個，它跟校稿建議一起掛在右欄
 * （docs/specs/review-proposals.md「主區只要兩個模式」，B 版多了一個成品）。
 */

export type StageMode = 'edit' | 'compare' | 'final';

const MODES: { id: StageMode; label: string }[] = [
  { id: 'edit', label: '編輯' },
  { id: 'compare', label: '對照' },
  { id: 'final', label: '成品' },
];

export function ViewSwitch({
  mode,
  onMode,
}: {
  mode: StageMode;
  onMode: (next: StageMode) => void;
}): JSX.Element {
  return (
    <div className="seg" role="radiogroup" aria-label="檢視方式">
      {MODES.map((option) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={mode === option.id}
          className="seg-item"
          data-active={mode === option.id ? 'yes' : 'no'}
          onClick={() => onMode(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
