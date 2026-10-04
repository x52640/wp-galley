import { useEffect, useRef, useState, type ChangeEvent, type JSX } from 'react';
import { api } from '../../service/client.js';
import type { AutoFeatureResult, AutoPlaceResult, ImageBrief, ImageGenerationStatus, LoadedJob } from '../../service/types.js';
import { Icon } from '../../icons.js';
import { formatBytes } from '../../lib/format.js';
import { prepareForUpload } from '../../lib/svg-to-png.js';
import { useConfirm } from '../ConfirmDialog.js';
import { formatElapsed, useElapsedSeconds, waitingNote } from '../AgentProgress.js';
import { ErrorNote, Field, Spinner, useAction } from './shared.js';
import { placeBlockedWhileWriting } from '../../lib/check-while-writing.js';
import {
  IMAGE_FILE_ACCEPT,
  briefDraftHint,
  briefDraftStatus,
  briefEditTitle,
  briefIdleHint,
  briefLastFailure,
  briefRunState,
  briefWhere,
  canGenerateBrief,
  canSaveBriefDraft,
  candidateHint,
  changedBody,
  generationUnavailableReason,
  minePurposeText,
} from '../../lib/media-view.js';
import { sessionThumbs } from '../../lib/session-thumbs.js';

/**
 * 一條配圖需求。
 *
 * 主要的路是「用 Codex 生圖」→ 看候選圖 →「用這張」。生圖要一分鐘左右，卡片上用計時器
 * 與說明撐住那段時間（D-010：不畫假的進度條）；頂端的 AgentBanner 也會出現。
 * 「複製 prompt」與「上傳這張」留著：不想用 Codex、或想自己找圖的時候用。
 * 描述可以在卡片上直接改（D-025，P5-T025）：Agent 那條改 prompt，使用者那條改「想要：…」那句。
 */
export function BriefCard({
  job,
  brief,
  refresh,
  generation,
  focused,
  writing,
}: {
  job: LoadedJob;
  brief: ImageBrief;
  refresh: () => Promise<void>;
  generation: ImageGenerationStatus | null;
  focused: boolean;
  /** 正在打字（文章上的打字模式）。 */
  writing: boolean;
}): JSX.Element {
  /** 打字中不放圖（放圖建新版本，打的字之後存不進去）。 */
  const writingBlock = placeBlockedWhileWriting(writing);
  const rootRef = useRef<HTMLLIElement>(null);
  // 從文章上「請 AI 配一張」過來的：捲到這張卡片（右欄可能很長，計時器要看得到）。
  useEffect(() => {
    if (focused) rootRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [focused]);
  /** 使用者在文章上請 AI 配的（P5-T018）：沒有 AI 寫的描述，位置是使用者選的。 */
  const mine = brief.origin === 'user';
  const where = briefWhere(brief);
  const [copied, setCopied] = useState(false);
  const [localStart, setLocalStart] = useState<string | undefined>(undefined);
  const action = useAction();
  const generate = useAction();
  const use = useAction();
  const confirm = useConfirm();
  /** 封面自動設精選的結果（沒設成的時候要講出來）。 */
  const [featureNote, setFeatureNote] = useState<AutoFeatureResult | null>(null);
  /** 內文圖照錨點自動放進正文的結果（P5-T016）；`approvalLost`＝放之前有有效的核准，現在失效了。 */
  const [placeNote, setPlaceNote] = useState<{ result: AutoPlaceResult; approvalLost: boolean } | null>(null);
  /** 使用者按了停止：那一趟的 POST 會以錯誤結束，但那不是錯誤。 */
  const [stopped, setStopped] = useState(false);
  /**
   * 「用這張」時一起送的替代文字（P5-T018）。使用者在文章上請 AI 配的那條沒有替代文字
   * （那句話是風格，不是圖的描述），在候選圖底下請人寫一句；選填。
   */
  const [candidateAlt, setCandidateAlt] = useState('');
  const askAlt = brief.altText === '';
  /**
   * 在卡片上改描述（D-025，P5-T025）：Agent 那條改畫面描述（prompt），使用者那條改「想要：…」那句。
   * `draft` 是 null＝沒在改。存了之後生圖一律用改過的版本；候選圖留著。
   */
  const [draft, setDraft] = useState<string | null>(null);
  const save = useAction();
  /** 存了，但有件事要講（使用者那條的前後段落沿用當初的）。 */
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const editing = draft !== null;

  const run = job.agentRun;
  const { runningElsewhere, generating, runStartedAt } = briefRunState(run, brief.id, generate.busy);
  const seconds = useElapsedSeconds(runStartedAt ?? localStart, generating);
  const busy = action.busy || generate.busy || use.busy || save.busy;
  const candidate = brief.candidate;
  // 重新整理之後 generate.error 就沒了；上一趟這張卡片生圖失敗的話，照樣講出來。
  const lastFailure = briefLastFailure(run, brief.id);
  const unavailableReason = generationUnavailableReason(generation);
  // 改到一半不給生圖：生的會是還沒存的那一版以外的東西，按下去不知道照哪一版畫。
  const canGenerate = canGenerateBrief({ generation, generating, runningElsewhere, busy, editing });

  // 跟後端同一套算法（contract/brief-prompt.ts、contract/user-note.ts）。
  const {
    length: draftLength,
    max: draftMax,
    tooLong: draftTooLong,
    empty: draftEmpty,
  } = briefDraftStatus(draft, mine);
  const canSave = canSaveBriefDraft({ editing, tooLong: draftTooLong, empty: draftEmpty, generating, saving: save.busy });
  const approvalValid = job.approval?.valid === true;
  const startEdit = (): void => {
    setSaveNotice(null);
    setDraft(mine ? (brief.note ?? '') : brief.prompt);
  };
  const cancelEdit = (): void => {
    setDraft(null);
    save.clear();
  };
  const saveEdit = (): void => {
    if (!canSave || draft === null) return;
    void save.run(async () => {
      const { notice } = await api.updateImageBrief(job.uuid, brief.id, mine ? { note: draft } : { prompt: draft });
      setDraft(null);
      setSaveNotice(notice);
      await refresh();
    });
  };
  const editButton = !editing && (
    <button
      type="button"
      className="btn btn-quiet btn-tiny brief-edit"
      disabled={generating || busy}
      title={briefEditTitle(generating, mine)}
      onClick={startEdit}
    >
      <Icon name="pencil" size={12} />
      改
    </button>
  );
  const editor = editing && (
    <div className="brief-editor">
      {mine ? (
        <input
          className="input"
          value={draft ?? ''}
          autoFocus
          aria-label="想要什麼樣的圖"
          placeholder="例如：水彩風、黃昏的顏色（可以留空）"
          disabled={save.busy}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) saveEdit();
            if (event.key === 'Escape') cancelEdit();
          }}
        />
      ) : (
        <textarea
          className="input textarea brief-editor-text"
          value={draft ?? ''}
          autoFocus
          aria-label="畫面描述（prompt）"
          rows={5}
          disabled={save.busy}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') cancelEdit();
          }}
        />
      )}
      <p className="field-hint">
        <span className={draftTooLong || draftEmpty ? 'mono insert-ai-over' : 'mono'}>
          {draftLength}／{draftMax}
          {draftTooLong && '（太長了，刪短一點）'}
          {draftEmpty && '（不能是空的）'}
        </span>
        {'　'}
        {briefDraftHint({ generating, mine, hasCandidate: candidate !== null })}
      </p>
      <div className="brief-actions">
        <button type="button" className="btn btn-primary btn-tiny" disabled={!canSave} onClick={saveEdit}>
          {save.busy ? <Spinner /> : <Icon name="check" size={13} />}
          存
        </button>
        <button type="button" className="btn btn-quiet btn-tiny" disabled={save.busy} onClick={cancelEdit}>
          取消
        </button>
      </div>
    </div>
  );

  const upload = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    void action.run(async () => {
      const prepared = await prepareForUpload(file);
      setFeatureNote(null);
      setPlaceNote(null);
      const approved = approvalValid;
      const { media: asset, autoFeature, autoPlace } = await api.addMedia(job.uuid, {
        file: prepared.blob,
        filename: prepared.filename,
        mimeType: prepared.blob.type || 'image/png',
        altText: brief.altText,
        briefKey: brief.key,
        ...(brief.caption === null ? {} : { caption: brief.caption }),
      });
      sessionThumbs.set(asset.id, URL.createObjectURL(prepared.blob));
      setFeatureNote(autoFeature);
      if (autoPlace) setPlaceNote({ result: autoPlace, approvalLost: approved && changedBody(autoPlace) });
      await refresh();
    });
  };

  const startGenerate = (): void => {
    setLocalStart(new Date().toISOString());
    setStopped(false);
    setFeatureNote(null);
    void generate.run(async () => {
      const pending = api.generateBriefImage(job.uuid, brief.id);
      // 這個請求要等 Codex 畫完才回來。先重讀一次，工作區才會看到「執行中」並開始輪詢，
      // 頂端長條與其他按鈕的鎖定才跟得上。
      window.setTimeout(() => void refresh(), 500);
      try {
        await pending;
      } catch (cause) {
        // 停止可能是按卡片上的、也可能是頂端長條的。問一次後端：這一趟是被取消的，
        // 就講「已停止」，不當成錯誤。
        const latest = await api.getJob(job.uuid).catch(() => null);
        const last = latest?.agentRun;
        if (last?.task === 'generate-image' && last.briefId === brief.id && last.status === 'cancelled') {
          setStopped(true);
          return;
        }
        throw cause;
      } finally {
        await refresh();
      }
    });
  };

  // 沒有候選圖、也沒在生圖時，卡片上那行「之後會怎樣」。
  const idleHint = candidate === null && !generating ? briefIdleHint(brief, approvalValid) : null;

  return (
    <li ref={rootRef} className="brief" data-fulfilled={brief.fulfilled ? 'yes' : 'no'} data-focused={focused ? 'yes' : 'no'}>
      <div className="brief-head">
        {mine ? (
          <span className="brief-mine">
            <Icon name="sparkles" size={12} />
            你請 AI 配的
          </span>
        ) : (
          <span className="brief-key mono">{brief.key}</span>
        )}
        {brief.isFeatured && (
          <span className="brief-cover">
            <Icon name="star" size={12} />
            封面
          </span>
        )}
        {!mine && brief.promptEdited && (
          <span className="brief-edited" title="這段描述是你改過的；之後 AI 再給建議也不會蓋掉">
            <Icon name="pencil" size={11} />
            你改過
          </span>
        )}
        <span className="brief-ratio mono">{brief.aspectRatio}</span>
        {brief.placement !== null && <span className="brief-where">{brief.placement}</span>}
        {brief.fulfilled && (
          <span className="brief-done">
            <Icon name="check" size={13} />
            已上傳
          </span>
        )}
      </div>

      {mine ? (
        editing ? (
          editor
        ) : (
          <>
            {/* 選一段文字配的（P5-T038）：講清楚這張是照哪段配的。 */}
            {brief.fromSelection && <p className="brief-basis">{brief.purpose}</p>}
            <div className="brief-editable">
              <p className="brief-purpose">{minePurposeText(brief)}</p>
              {editButton}
            </div>
          </>
        )
      ) : (
        <p className="brief-purpose">{brief.purpose}</p>
      )}
      {!brief.isFeatured && where !== null && (
        <p className="brief-anchor">
          <span className="brief-alt-tag">放在</span>
          <span>{where}</span>
        </p>
      )}
      {/* 使用者那條的 prompt 是系統組的整份指令（含前後段落），很長；要看就按「複製 prompt」。 */}
      {!mine &&
        (editing ? (
          editor
        ) : (
          <div className="brief-editable">
            <p className="brief-prompt">{brief.prompt}</p>
            {editButton}
          </div>
        ))}
      <ErrorNote message={save.error} />
      {saveNotice !== null && (
        <p className="note note-info" role="status">
          <Icon name="alert" size={14} />
          <span>{saveNotice}</span>
        </p>
      )}
      {brief.altText !== '' && (
        <p className="brief-alt">
          <span className="brief-alt-tag">alt</span>
          {brief.altText}
        </p>
      )}

      {generating && (
        <div className="brief-generating" role="status" aria-live="polite">
          <Icon name="spinner" size={14} className="spin" />
          <span className="brief-generating-text">Codex 正在畫這張圖…</span>
          <span className="brief-generating-time mono">{formatElapsed(seconds)}</span>
          <button
            type="button"
            className="btn btn-quiet btn-tiny"
            onClick={() =>
              void action.run(async () => {
                await api.cancelAgent(job.uuid);
                await refresh();
              })
            }
          >
            <Icon name="x" size={13} />
            停止
          </button>
          <p className="brief-generating-note">{waitingNote('generate-image', seconds)}</p>
          <p className="brief-generating-note">Codex 正在畫這張，等它跑完再改{mine ? '想要的那句' : '描述'}。</p>
        </div>
      )}

      {candidate !== null && !generating && (
        <figure className="brief-candidate">
          <img
            className="brief-candidate-img"
            src={candidate.url}
            alt={`Codex 生成的候選圖：${brief.altText}`}
            width={candidate.width ?? undefined}
            height={candidate.height ?? undefined}
          />
          <figcaption className="brief-candidate-meta">
            <span>Codex 生成</span>
            {candidate.width !== null && candidate.height !== null && (
              <span className="mono">
                {candidate.width}×{candidate.height}
              </span>
            )}
            <span className="mono">{formatBytes(candidate.byteSize)}</span>
            <span className="media-badge media-badge-quiet">尚未上傳</span>
          </figcaption>
          <p className="field-hint">{candidateHint(brief, approvalValid)}</p>
          {askAlt && (
            <Field label="替代文字（選填）" hint="用一句話講圖裡有什麼，給讀不到圖的人與搜尋引擎。跟著「用這張」一起送出。">
              <input
                className="input"
                value={candidateAlt}
                maxLength={300}
                disabled={busy}
                onChange={(event) => setCandidateAlt(event.target.value)}
                placeholder="例如：雨後路口的積水映著紅燈"
              />
            </Field>
          )}
          <div className="brief-actions">
            <button
              type="button"
              className="btn btn-primary btn-tiny"
              disabled={busy || runningElsewhere || writingBlock !== null}
              title={writingBlock ?? undefined}
              onClick={() =>
                void use.run(async () => {
                  setFeatureNote(null);
                  setPlaceNote(null);
                  const approved = approvalValid;
                  const typed = candidateAlt.trim();
                  const { autoFeature, autoPlace } = await api.useImageCandidate(
                    job.uuid,
                    candidate.id,
                    askAlt && typed !== '' ? typed : undefined,
                  );
                  setCandidateAlt('');
                  setFeatureNote(autoFeature);
                  if (autoPlace) {
                    setPlaceNote({ result: autoPlace, approvalLost: approved && changedBody(autoPlace) });
                  }
                  await refresh();
                })
              }
            >
              {use.busy ? <Spinner /> : <Icon name="upload" size={13} />}
              用這張
            </button>
            <button type="button" className="btn btn-quiet btn-tiny" disabled={!canGenerate} onClick={startGenerate}>
              <Icon name="refresh" size={13} />
              再生一張
            </button>
          </div>
          {writingBlock !== null && (
            <p className="field-hint insert-ai-blocked" role="status">
              <Icon name="alert" size={13} />
              {writingBlock}
            </p>
          )}
        </figure>
      )}

      <ErrorNote message={generate.error ?? use.error ?? action.error ?? (generating || stopped ? null : lastFailure)} />
      {stopped && !generating && <p className="note note-info">已停止。要的話再按一次「用 Codex 生圖」。</p>}
      {featureNote !== null && featureNote.outcome !== 'set' && (
        <p className={featureNote.outcome === 'failed' ? 'note note-warn' : 'note note-info'} role="status">
          <Icon name="alert" size={14} />
          <span>{featureNote.message}</span>
        </p>
      )}

      {placeNote !== null && (
        <p className={changedBody(placeNote.result) ? 'note note-good' : 'note note-warn'} role="status">
          <Icon name={changedBody(placeNote.result) ? 'check' : 'alert'} size={14} />
          <span>
            {placeNote.result.message}
            {placeNote.approvalLost && ' 內容改了，原本的核准已失效，要重新核准。'}
          </span>
        </p>
      )}

      {unavailableReason !== null && !brief.fulfilled && (
        <p className="field-hint brief-unavailable">
          <Icon name="alert" size={13} />
          {unavailableReason}
        </p>
      )}
      {idleHint !== null && <p className="field-hint">{idleHint}</p>}
      {runningElsewhere && !generating && (
        <p className="field-hint">另一個 Agent 動作還在跑，跑完才能生圖或上傳（同一篇一次只跑一個）。</p>
      )}
      {editing && !generating && <p className="field-hint">先按「存」或「取消」，才能生圖。</p>}

      <div className="brief-actions">
        {candidate === null && !generating && (
          <button
            type="button"
            className={brief.fulfilled ? 'btn btn-quiet btn-tiny' : 'btn btn-tiny'}
            disabled={!canGenerate}
            title={unavailableReason ?? '用 Codex 的訂閱照這段描述生一張圖，生好先給你看'}
            onClick={startGenerate}
          >
            <Icon name="sparkles" size={13} />
            {brief.fulfilled ? '用 Codex 再生一張' : '用 Codex 生圖'}
          </button>
        )}

        <button
          type="button"
          className="btn btn-quiet btn-tiny"
          onClick={() =>
            void action.run(async () => {
              await navigator.clipboard.writeText(brief.prompt);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 2000);
            })
          }
        >
          <Icon name={copied ? 'check' : 'scissors'} size={13} />
          {copied ? '已複製' : '複製 prompt'}
        </button>

        <label className="btn btn-quiet btn-tiny btn-file">
          <Icon name="upload" size={13} />
          {action.busy ? '處理中…' : brief.fulfilled ? '換一張' : '上傳這張'}
          <input
            type="file"
            accept={IMAGE_FILE_ACCEPT}
            onChange={upload}
            // 另一個 Agent 動作在跑時不給上傳：上傳完會自動放進正文或設精選，那會讓跑到一半的結果作廢
            // （後端也會擋下自動放，這裡先不讓人按，跟「用這張」一樣）。這張卡片自己在生圖時也不給：
            // 從文章上「請 AI 配一張」開始的那趟不經過這張卡片的 generate，busy 看不到它。
            // 打字中也不給（P5-T038 審查 1）：上傳完會照錨點放進正文、建新版本。
            disabled={busy || runningElsewhere || generating || writingBlock !== null}
          />
        </label>

        <button
          type="button"
          className="btn btn-quiet btn-tiny btn-danger-text brief-drop"
          disabled={generating}
          onClick={() =>
            confirm({
              title: '不要這張配圖？',
              danger: true,
              body: mine ? (
                <p>
                  這條會從清單上消失，還沒用的候選圖也不會再出現。已經上傳的圖片不受影響。
                  {brief.fromSelection
                    ? '要再配，在文章上再選一次那段，按「用此段配圖」。'
                    : '要再配，在文章上那個位置按「在這裡插圖」→「請 AI 配一張」。'}
                </p>
              ) : (
                <p>
                  「{brief.key}」這條建議會從清單上消失。已經上傳的圖片不受影響。
                  要再拿到建議只能重跑一次「一鍵配圖」。
                </p>
              ),
              confirmLabel: '不要了',
              onConfirm: async () => {
                await api.dismissImageBrief(job.uuid, brief.id);
                await refresh();
              },
            })
          }
        >
          不要了
        </button>
      </div>
    </li>
  );
}
