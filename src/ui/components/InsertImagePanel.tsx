import { useEffect, useRef, useState, type ChangeEvent, type JSX } from 'react';
import { api, describeError } from '../service/client.js';
import type { LoadedJob, MediaAsset } from '../service/types.js';
import { Icon } from '../icons.js';
import { formatBytes } from '../lib/format.js';
import { prepareForUpload } from '../lib/svg-to-png.js';
import { ErrorNote, Field, Spinner, useAction } from './panels/shared.js';
import { assetLabel, useImageGenerationStatus } from './panels/MediaPanel.js';
import { USER_NOTE_MAX as NOTE_MAX, userNoteLength } from '../../contract/user-note.js';

/**
 * 「在這裡插圖」打開的小面板（D-020，P5-T016）。
 *
 * 三條路：
 * - 挑一張已經上傳、還沒放進正文的圖（`placeMedia`）。
 * - 請 AI 配一張（D-022，P5-T018）：選填一句想要的樣子，後端建一條使用者發起的配圖需求、同一趟開始
 *   用 Codex 生圖，**不等畫完**就回來。面板隨即關掉，進度在右欄那張卡片與頂端長條；生好之後照一般的
 *   「用這張」上傳並放回這個位置。Codex 不能用、或有 Agent 動作在跑時停用並講原因。
 * - 直接上傳新圖：先進 WordPress 媒體庫（`addMedia`），再放到這裡。上傳本身不會發布文章，
 *   但圖會留在媒體庫——這件事要在按下去之前講清楚。
 *
 * 放進正文會建新版本；目前有有效的核准時，面板上先講「核准會失效」。
 */

interface Pending {
  blob: Blob;
  filename: string;
  mimeType: string;
  converted: boolean;
  objectUrl: string;
}

/** 可以拿來插的圖：已經在 WordPress 媒體庫、還沒放進正文、不是封面（封面由佈景主題放，不進正文）。 */
export function insertableMedia(job: LoadedJob): MediaAsset[] {
  return job.media.filter(
    (asset) => asset.wordpressMediaId !== null && !asset.placed && job.featuredMediaId !== asset.id,
  );
}

export function InsertImagePanel({
  job,
  afterBlockIndex,
  blockText,
  onPlaced,
  onRefresh,
  onClose,
  onAiStarted,
}: {
  job: LoadedJob;
  /** 插在第幾個頂層區塊之後；-1＝最前面。跟 `placeMedia` 同一套索引。 */
  afterBlockIndex: number;
  /** 那一段開頭的字，讓人確認位置沒點錯。 */
  blockText: string | null;
  /** 放好了：上層重新讀取並關掉面板。 */
  onPlaced: () => Promise<void>;
  /** 只重新讀取、不關面板（上傳成功但沒放進去時，讓新圖出現在清單上）。 */
  onRefresh: () => Promise<void>;
  onClose: () => void;
  /** 「請 AI 配一張」已經開始生圖：上層關掉面板、打開右欄圖片區並捲到那張卡片。 */
  onAiStarted: (briefId: number) => Promise<void>;
}): JSX.Element {
  const place = useAction();
  const pick = useAction();
  const ai = useAction();
  const [pending, setPending] = useState<Pending | null>(null);
  const [alt, setAlt] = useState('');
  const [note, setNote] = useState('');
  const generation = useImageGenerationStatus(true);
  const choices = insertableMedia(job);
  const busy = place.busy || pick.busy || ai.busy;
  // 另一個 Agent 動作在跑（沿用配圖卡片 runningElsewhere 的規則）：同一篇一次只跑一個。
  const agentRunning = job.agentRun?.status === 'running';
  // 確定不能用（Codex 沒裝／沒登入、Agent 在跑）才把輸入格一起鎖住；還在確認時只鎖按鈕，
  // 輸入格照樣可以打字、打開面板時焦點也能落在這裡。
  const aiUnavailableReason =
    generation !== null && !generation.available
      ? (generation.reason ?? '現在不能生圖')
      : agentRunning
        ? '另一個 Agent 動作還在跑，跑完才能請 AI 配圖（同一篇一次只跑一個）。'
        : null;
  // 跟後端同一套算法：摺疊空白之後數 code point（contract/user-note.ts）。
  const noteLength = userNoteLength(note);
  const noteTooLong = noteLength > NOTE_MAX;
  const canAskAi = aiUnavailableReason === null && generation !== null && !busy && !noteTooLong;

  const askAi = (): void => {
    if (!canAskAi) return;
    const contentHash = job.currentRevision?.contentHash;
    void ai.run(async () => {
      if (contentHash === undefined) throw new Error('這篇稿件還沒有內容，沒辦法指定位置');
      const trimmed = note.trim();
      const brief = await api.requestImageAtPosition(job.uuid, {
        afterBlockIndex,
        contentHash,
        ...(trimmed === '' ? {} : { note: trimmed }),
      });
      await onAiStarted(brief.id);
    });
  };
  const rootRef = useRef<HTMLDivElement>(null);

  // 打開就把焦點移進來（第一張可選的圖，沒有就「請 AI 配一張」那一格，再沒有就「選擇圖片」），Escape 才關得掉、鍵盤才接得下去。
  // 關掉時焦點回到「在這裡插圖」那顆按鈕，由 ProofView 負責。
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const first =
      root.querySelector<HTMLElement>('.insert-choice:not(:disabled)') ??
      root.querySelector<HTMLElement>('.insert-ai-note:not(:disabled)') ??
      root.querySelector<HTMLElement>('input[type="file"]:not(:disabled)') ??
      root;
    first.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    return () => {
      if (pending) URL.revokeObjectURL(pending.objectUrl);
    };
  }, [pending]);

  const where =
    afterBlockIndex < 0 ? '插在文章最前面' : `插在第 ${afterBlockIndex + 1} 段之後`;

  const choose = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    void pick.run(async () => {
      const prepared = await prepareForUpload(file);
      setPending((current) => {
        if (current) URL.revokeObjectURL(current.objectUrl);
        return {
          blob: prepared.blob,
          filename: prepared.filename,
          mimeType: prepared.blob.type || 'image/png',
          converted: prepared.converted,
          objectUrl: URL.createObjectURL(prepared.blob),
        };
      });
      setAlt('');
    });
  };

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      className="insert-panel"
      role="dialog"
      aria-label={where}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !busy) onClose();
      }}
    >
      <div className="insert-panel-head">
        <p className="insert-panel-title">
          <Icon name="image-plus" size={14} />
          {where}
        </p>
        <button type="button" className="icon-btn" aria-label="關閉" title="關閉" disabled={busy} onClick={onClose}>
          <Icon name="x" size={15} />
        </button>
      </div>
      {blockText !== null && blockText !== '' && <p className="insert-panel-where">接在「{blockText}」後面</p>}

      {job.approval?.valid === true && (
        <p className="note note-warn">
          <Icon name="alert" size={14} />
          <span>放進正文會建立新版本，目前的核准會失效，要重新核准。</span>
        </p>
      )}

      <ErrorNote message={place.error ?? pick.error ?? ai.error} />

      {!pending && (
        <section className="insert-panel-section" aria-label="已上傳的圖">
          <h3 className="insert-panel-label">已上傳、還沒放進正文的圖</h3>
          {choices.length === 0 ? (
            <p className="field-hint">沒有。用下面「上傳新圖」。</p>
          ) : (
            <ul className="insert-choices">
              {choices.map((asset) => (
                <li key={asset.id}>
                  <button
                    type="button"
                    className="insert-choice"
                    disabled={busy}
                    onClick={() =>
                      void place.run(async () => {
                        await api.placeMedia(job.uuid, asset.id, afterBlockIndex);
                        await onPlaced();
                      })
                    }
                  >
                    {asset.url ? (
                      <img className="media-thumb" src={asset.url} alt="" loading="lazy" />
                    ) : (
                      <span className="media-thumb media-thumb-empty" aria-hidden="true">
                        <Icon name="image" size={16} />
                      </span>
                    )}
                    <span className="insert-choice-name">{assetLabel(asset)}</span>
                    <span className="insert-choice-go">{place.busy ? <Spinner /> : '放這裡'}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {!pending && (
        <section className="insert-panel-section" aria-label="請 AI 配一張">
          <h3 className="insert-panel-label">請 AI 配一張</h3>
          <div className="insert-ai-row">
            <label className="sr-only" htmlFor={`insert-ai-note-${afterBlockIndex}`}>
              想要什麼樣的圖（選填）
            </label>
            <input
              id={`insert-ai-note-${afterBlockIndex}`}
              className="input insert-ai-note"
              value={note}
              disabled={busy || aiUnavailableReason !== null}
              aria-invalid={noteTooLong}
              placeholder="想要什麼樣的圖？選填，例如：水彩風、黃昏的街角"
              onChange={(event) => setNote(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  askAi();
                }
              }}
            />
            <button
              type="button"
              className="btn btn-tiny"
              disabled={!canAskAi}
              title={
                aiUnavailableReason ??
                (generation === null ? '正在確認 Codex 能不能用…' : '用 Codex 的訂閱，讀這裡前後的段落配一張圖')
              }
              onClick={askAi}
            >
              {ai.busy ? <Spinner /> : <Icon name="sparkles" size={13} />}
              請 AI 配一張
            </button>
          </div>
          {aiUnavailableReason !== null ? (
            <p className="field-hint insert-ai-blocked">
              <Icon name="alert" size={13} />
              {aiUnavailableReason}
            </p>
          ) : (
            <p className="field-hint">
              {noteLength > 0 && (
                <span className={noteTooLong ? 'mono insert-ai-over' : 'mono'}>
                  {noteLength}／{NOTE_MAX}
                  {noteTooLong && '（太長了，刪短一點）'}　
                </span>
              )}
              {generation === null && '正在確認 Codex 能不能用…　'}
              Codex 讀這裡前後的段落自己決定畫面，一分鐘左右；面板可以關，進度看右欄「圖片」那張卡片。
              生好先給你看，按「用這張」才會上傳到 WordPress 媒體庫並放到這裡。
              {job.approval?.valid !== true && '放進正文會建立新版本。'}
            </p>
          )}
        </section>
      )}

      <section className="insert-panel-section" aria-label="上傳新圖">
        <h3 className="insert-panel-label">上傳新圖</h3>
        {!pending ? (
          <>
            <label className="btn btn-quiet btn-tiny btn-file">
              <Icon name="upload" size={13} />
              {pick.busy ? '處理中…' : '選擇圖片'}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,.svg"
                onChange={choose}
                disabled={busy}
              />
            </label>
            <p className="field-hint">
              上傳會把圖放進 WordPress 媒體庫（不會發布文章），再插到這裡。PNG、JPEG、WebP、GIF；SVG 會自動轉成 PNG。
            </p>
          </>
        ) : (
          <div className="upload-pending">
            <img className="media-thumb" src={pending.objectUrl} alt="" />
            <div className="upload-pending-main">
              <p className="upload-filename mono">{pending.filename}</p>
              <p className="field-hint">{formatBytes(pending.blob.size)}</p>
              {pending.converted && (
                <p className="field-hint">已把 SVG 轉成 PNG。WordPress 不接受 SVG，上傳的是轉好的 PNG。</p>
              )}
              <Field label="替代文字" hint="給讀不到圖的人看，也會被搜尋引擎讀到。">
                <input
                  className="input"
                  value={alt}
                  onChange={(event) => setAlt(event.target.value)}
                  placeholder="例如：雨天的路口"
                />
              </Field>
              <p className="field-hint">按下去會上傳到 WordPress 媒體庫，然後放進正文這個位置。</p>
              <div className="row row-end">
                <button
                  type="button"
                  className="btn btn-quiet btn-tiny"
                  disabled={busy}
                  onClick={() => {
                    URL.revokeObjectURL(pending.objectUrl);
                    setPending(null);
                  }}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-tiny"
                  disabled={busy}
                  onClick={() =>
                    void place.run(async () => {
                      const trimmed = alt.trim();
                      const { media: asset } = await api.addMedia(job.uuid, {
                        file: pending.blob,
                        filename: pending.filename,
                        mimeType: pending.mimeType,
                        ...(trimmed === '' ? {} : { altText: trimmed }),
                      });
                      // 圖已經在媒體庫了：不管接下來放不放得進去，都不能再讓人按一次、重複上傳。
                      URL.revokeObjectURL(pending.objectUrl);
                      setPending(null);
                      try {
                        await api.placeMedia(job.uuid, asset.id, afterBlockIndex);
                      } catch (cause) {
                        await onRefresh();
                        throw new Error(`圖已經上傳到媒體庫，但沒放進正文：${describeError(cause)}。可以在上面的清單再選一次。`);
                      }
                      await onPlaced();
                    })
                  }
                >
                  {place.busy ? <Spinner /> : <Icon name="upload" size={13} />}
                  上傳並放在這裡
                </button>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
