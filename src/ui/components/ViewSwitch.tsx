import type { JSX } from 'react';
import { Icon } from '../icons.js';

/**
 * 主區的檢視切換。
 *
 * **只有兩個。** 校樣是讀整篇的地方（預設），左右對照是逐字比對的地方。
 * 單人工具不該有四個分頁——階段 6 的查證發現不會再開第三個檢視，它跟校稿改動
 * 一起掛在右邊的待處理清單上（見 docs/STAGE-6-FACTCHECK.md 第二節）。
 */

export type StageMode = 'proof' | 'compare';

const MODES: { id: StageMode; label: string; icon: 'file-text' | 'columns' }[] = [
  { id: 'proof', label: '校樣', icon: 'file-text' },
  { id: 'compare', label: '左右對照', icon: 'columns' },
];

export function ViewSwitch({
  mode,
  onMode,
}: {
  mode: StageMode;
  onMode: (next: StageMode) => void;
}): JSX.Element {
  return (
    <div className="segmented view-switch" role="radiogroup" aria-label="檢視方式">
      {MODES.map((option) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={mode === option.id}
          className="segmented-item"
          data-active={mode === option.id ? 'yes' : 'no'}
          onClick={() => onMode(option.id)}
        >
          <Icon name={option.icon} size={13} />
          {option.label}
        </button>
      ))}
    </div>
  );
}
