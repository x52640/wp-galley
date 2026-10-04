import type { JSX } from 'react';
import { Icon } from '../icons.js';
import { FormatBar } from './FormatBar.js';
import { editBarNote } from '../lib/proof-editing.js';
import type { ProofEditing } from '../lib/use-proof-editing.js';

/**
 * 校樣打字模式的畫面（P5-T042 從 ProofView 抽出）；狀態與流程在 `lib/use-proof-editing.ts`。
 *
 * - `EditBar`：校樣上方工具列右邊的提示、取消、儲存（打字中取代平常的工具）。
 * - `EditToolbar`：格式工具列與連結輸入框（`FormatBar`），按鈕照模板的 allowedTags。
 * - `DropWarning`：存檔時有模板不支援、會被拿掉的格式：回去改／照樣存。
 */

export function EditBar({ edit }: { edit: ProofEditing }): JSX.Element {
  return (
    <div className="proof-editbar" role="status">
      <span className="proof-editbar-note">{editBarNote(edit.autoSaved)}</span>
      <button type="button" className="btn btn-quiet btn-tiny" disabled={edit.saving} onClick={edit.cancelEdit}>
        取消
      </button>
      <button type="button" className="btn btn-primary btn-tiny" disabled={edit.saving} onClick={() => void edit.saveEdit()}>
        <Icon name="check" size={13} />
        {edit.saving ? '儲存中…' : '儲存'}
      </button>
    </div>
  );
}

export function EditToolbar({ edit }: { edit: ProofEditing }): JSX.Element {
  return (
    <FormatBar
      commands={edit.commands}
      state={edit.formatState}
      onCommand={edit.doCommand}
      link={edit.linkEditor}
      schemes={edit.allow.schemes}
      onApplyLink={edit.applyLinkHref}
      onRemoveLink={edit.removeCurrentLink}
      onCloseLink={() => edit.closeLinkEditor()}
    />
  );
}

export function DropWarning({ edit }: { edit: ProofEditing }): JSX.Element | null {
  if (edit.dropWarning === null) return null;
  return (
    <div className="proof-status proof-status-warn" role="alert">
      <Icon name="alert" size={15} />
      <span>這個版型不支援：{edit.dropWarning.join('、')}。存檔時會拿掉這些格式，字會留著。</span>
      <button type="button" className="btn btn-quiet btn-tiny" onClick={edit.dismissDrop}>
        回去改
      </button>
      <button type="button" className="btn btn-primary btn-tiny" disabled={edit.saving} onClick={edit.confirmDrop}>
        照樣存
      </button>
    </div>
  );
}
