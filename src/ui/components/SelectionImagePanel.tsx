import { useEffect, useRef, useState, type JSX } from 'react';
import { Icon } from '../icons.js';
import { Spinner } from './panels/shared.js';
import { USER_NOTE_MAX as NOTE_MAX, userNoteLength } from '../../contract/user-note.js';
import type { SelectionSpotsResponse } from '../service/types.js';

/**
 * 選一段文字「用此段配圖」按下去之後的小面板（D-037，P5-T038）。互動跟插圖面板「請 AI 配一張」同一套：
 * 選填一句想要的樣子（上限 200 字，同一套計數），可以直接送。多一步：圖放在選取範圍的哪裡
 * （「這段開頭」預設、兩段之間、「這段結尾」）。位置只影響放哪，不影響 AI 讀什麼。
 * 位置選項由後端在存好的那一版上算（第二輪審查），這裡只照抄；還在問的時候講「正在找位置…」、送出鈕不給按。
 *
 * 送出由上層決定怎麼做（打字模式先存再送）；送出期間鎖住，送完由上層關掉。
 */
export function SelectionImagePanel({
  heading,
  spots,
  loadError,
  blockedReason,
  editing,
  busy,
  onSend,
  onClose,
}: {
  heading: { excerpt: string; length: number };
  /** 後端給的位置選項；null＝還在問。 */
  spots: SelectionSpotsResponse['spots'] | null;
  /** 問位置選項失敗（找不到、太長、文章剛被改過…）：照講，不給送。 */
  loadError: string | null;
  /** 現在不能送的原因（Codex 不能用、另一個 Agent 在跑…）；null＝可以。 */
  blockedReason: string | null;
  /** 打字模式：送出前會先自動存一版。 */
  editing: boolean;
  busy: boolean;
  onSend: (input: { note: string | null; spot: number }) => void;
  onClose: () => void;
}): JSX.Element {
  const [note, setNote] = useState('');
  const [spot, setSpot] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const noteLength = userNoteLength(note);
  const noteTooLong = noteLength > NOTE_MAX;
  const canSend = blockedReason === null && !busy && !noteTooLong && spots !== null && loadError === null;

  useEffect(() => {
    rootRef.current?.querySelector<HTMLElement>('.insert-ai-note:not(:disabled)')?.focus({ preventScroll: true });
  }, []);

  const send = (): void => {
    if (!canSend) return;
    const trimmed = note.trim();
    onSend({ note: trimmed === '' ? null : trimmed, spot });
  };

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      className="insert-panel sel-image-panel"
      role="dialog"
      aria-label="用此段配圖"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !busy) onClose();
      }}
    >
      <div className="insert-panel-head">
        <p className="insert-panel-title">
          <Icon name="image-plus" size={14} />
          用此段配圖
        </p>
        <button type="button" className="icon-btn" aria-label="關閉" title="關閉" disabled={busy} onClick={onClose}>
          <Icon name="x" size={15} />
        </button>
      </div>
      <p className="insert-panel-where">
        依選取段落：「{heading.excerpt}」（共 {heading.length} 字）
      </p>

      <fieldset className="insert-panel-section sel-image-spots">
        <legend className="insert-panel-label">圖放在</legend>
        {spots === null && loadError === null && <p className="field-hint">正在找這段在文章裡的位置…</p>}
        {loadError !== null && (
          <p className="field-hint insert-ai-blocked" role="alert">
            <Icon name="alert" size={13} />
            {loadError}
          </p>
        )}
        {(spots ?? []).map((option) => (
          <label key={option.spot} className="sel-image-spot">
            <input
              type="radio"
              name="sel-image-spot"
              value={option.spot}
              checked={spot === option.spot}
              disabled={busy}
              onChange={() => setSpot(option.spot)}
            />
            <span>
              {option.label}
              {option.kind === 'start' && <span className="sel-image-default">（預設）</span>}
            </span>
          </label>
        ))}
      </fieldset>

      <section className="insert-panel-section" aria-label="想要什麼樣的圖">
        <div className="insert-ai-row">
          <label className="sr-only" htmlFor="sel-image-note">
            想要什麼樣的圖（選填）
          </label>
          <input
            id="sel-image-note"
            className="input insert-ai-note"
            value={note}
            disabled={busy || blockedReason !== null}
            aria-invalid={noteTooLong}
            placeholder="想要什麼樣的圖？選填，例如：水彩風"
            onChange={(event) => setNote(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                event.preventDefault();
                send();
              }
            }}
          />
          <button
            type="button"
            className="btn btn-tiny"
            disabled={!canSend}
            title={blockedReason ?? '用 Codex 的訂閱，只讀你選的這段配一張圖'}
            onClick={send}
          >
            {busy ? <Spinner /> : <Icon name="sparkles" size={13} />}
            請 AI 配一張
          </button>
        </div>
        {blockedReason !== null ? (
          <p className="field-hint insert-ai-blocked">
            <Icon name="alert" size={13} />
            {blockedReason}
          </p>
        ) : (
          <p className="field-hint">
            {noteLength > 0 && (
              <span className={noteTooLong ? 'mono insert-ai-over' : 'mono'}>
                {noteLength}／{NOTE_MAX}
                {noteTooLong && '（太長了，刪短一點）'}
              </span>
            )}
            {editing && '已先自動存一版（只存本機），位置照存好的那一版算；留在打字模式。'}
            Codex 只讀你選的這段（文章標題與小節標題當背景）決定畫面，一分鐘左右；進度看右欄「圖片」那張卡片。
            生好先給你看，按「用這張」才會上傳並放到選的位置。
          </p>
        )}
      </section>
    </div>
  );
}
