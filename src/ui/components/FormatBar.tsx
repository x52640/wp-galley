import { useEffect, useRef, useState, type JSX } from 'react';
import { Icon, type IconName } from '../icons.js';
import {
  COMMAND_LABELS,
  isCommandActive,
  isCommandEnabled,
  parseLinkInput,
  type FormatCommand,
  type FormatState,
} from '../lib/rich-format.js';

/**
 * 直接在文章上改時的格式工具列（P5-T028）。
 *
 * 按鈕由上層依模板的 allowedTags 決定（`availableCommands`）；亮起與停用照游標所在的狀態。
 * 按鈕在 mousedown 就擋掉預設動作：焦點與選取範圍留在 iframe 裡，按了才知道要套在哪段字上。
 */

const ICONS: Partial<Record<FormatCommand, IconName>> = {
  link: 'link',
  bold: 'bold',
  italic: 'italic',
  ul: 'list',
  ol: 'list-ordered',
  quote: 'text-quote',
  hr: 'minus',
};

/** 按鈕分組：行內格式｜段落種類｜清單與引用｜分隔線。 */
const GROUPS: readonly (readonly FormatCommand[])[] = [
  ['link', 'bold', 'italic'],
  ['h2', 'h3', 'paragraph'],
  ['ul', 'ol', 'quote'],
  ['hr'],
];

export interface LinkEditorState {
  /** 已經是連結時的網址；新連結是 null。 */
  readonly current: string | null;
}

export function FormatBar({
  commands,
  state,
  onCommand,
  link,
  schemes,
  onApplyLink,
  onRemoveLink,
  onCloseLink,
}: {
  commands: readonly FormatCommand[];
  /** null＝游標不在正文裡：按鈕都不能按。 */
  state: FormatState | null;
  onCommand: (command: FormatCommand) => void;
  /** 連結輸入框開著就不是 null。 */
  link: LinkEditorState | null;
  schemes: readonly string[];
  onApplyLink: (href: string) => void;
  onRemoveLink: () => void;
  onCloseLink: () => void;
}): JSX.Element | null {
  if (commands.length === 0) return null;
  const groups = GROUPS.map((group) => group.filter((command) => commands.includes(command))).filter((group) => group.length > 0);

  return (
    <div className="format-bar-wrap">
      <div className="format-bar" role="toolbar" aria-label="格式">
        {groups.map((group, index) => (
          <div key={index} className="format-group">
            {group.map((command) => {
              const { label, hint } = COMMAND_LABELS[command];
              const icon = ICONS[command];
              const enabled = state !== null && isCommandEnabled(command, state);
              const active = state !== null && isCommandActive(command, state);
              return (
                <button
                  key={command}
                  type="button"
                  className="format-btn"
                  data-command={command}
                  aria-pressed={command === 'hr' ? undefined : active}
                  disabled={!enabled}
                  title={hint}
                  // 焦點留在 iframe：按下去不搶焦點，選取範圍才不會消失。
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => onCommand(command)}
                >
                  {icon === undefined ? (
                    <span className="format-btn-text" aria-hidden="true">
                      {label}
                    </span>
                  ) : (
                    <Icon name={icon} size={15} />
                  )}
                  <span className="sr-only">{label}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
      {link !== null && (
        <LinkEditor
          current={link.current}
          schemes={schemes}
          onApply={onApplyLink}
          onRemove={onRemoveLink}
          onClose={onCloseLink}
        />
      )}
    </div>
  );
}

/** 發布台裡的連結輸入框（不用 window.prompt）。Enter 套用、Esc 關掉。 */
function LinkEditor({
  current,
  schemes,
  onApply,
  onRemove,
  onClose,
}: {
  current: string | null;
  schemes: readonly string[];
  onApply: (href: string) => void;
  onRemove: () => void;
  onClose: () => void;
}): JSX.Element {
  const [value, setValue] = useState(current ?? '');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const submit = (): void => {
    const parsed = parseLinkInput(value, schemes);
    if (!parsed.ok) {
      setError(parsed.message);
      inputRef.current?.focus();
      return;
    }
    onApply(parsed.href);
  };

  return (
    <form
      className="link-editor"
      role="group"
      aria-label={current === null ? '加上連結' : '修改連結'}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <label className="link-editor-label" htmlFor="link-editor-input">
        {current === null ? '連結網址' : '改連結網址'}
      </label>
      <input
        ref={inputRef}
        id="link-editor-input"
        className="input link-editor-input"
        type="text"
        inputMode="url"
        autoComplete="off"
        spellCheck={false}
        placeholder="https://"
        value={value}
        aria-invalid={error !== null}
        aria-describedby={error === null ? undefined : 'link-editor-error'}
        onChange={(event) => {
          setValue(event.target.value);
          setError(null);
        }}
      />
      <button type="submit" className="btn btn-primary btn-tiny">
        {current === null ? '加上連結' : '更新'}
      </button>
      {current !== null && (
        <button type="button" className="btn btn-quiet btn-tiny btn-danger-text" onClick={onRemove}>
          移除連結
        </button>
      )}
      <button type="button" className="btn btn-quiet btn-tiny" onClick={onClose}>
        取消
      </button>
      {error !== null && (
        <p id="link-editor-error" className="link-editor-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
