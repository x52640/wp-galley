import { useEffect, useRef, useState, type ChangeEvent, type JSX } from 'react';
import { api, describeError } from '../../service/client.js';
import type {
  AutoFeatureResult,
  AutoPlaceResult,
  ImageBrief,
  ImageGenerationStatus,
  LoadedJob,
  MediaAsset,
} from '../../service/types.js';
import { Icon } from '../../icons.js';
import { formatBytes } from '../../lib/format.js';
import { prepareForUpload } from '../../lib/svg-to-png.js';
import { useConfirm } from '../ConfirmDialog.js';
import { formatElapsed, useElapsedSeconds, waitingNote } from '../AgentProgress.js';
import { agentStatusText } from '../../lib/agent-tasks.js';
import { ErrorNote, Field, Spinner, useAction } from './shared.js';

/**
 * 配圖。
 *
 * **SVG 在這裡就地轉成 PNG。** WordPress 核心不收 SVG，而「裝外掛」與「改 PHP」
 * 兩條路都是專案明文禁止的，所以只剩前端轉檔這一條。轉檔在 lib/svg-to-png.ts，
 * 不需要任何額外套件。使用者選了 SVG 會看到一行說明，不是默默換掉他的檔案。
 *
 * 縮圖的來源要分清楚：`MediaAsset.url` 是**發布後 WordPress 的公開網址**，
 * 還沒發布時是 null。所以本回合上傳的圖另外用 blob 網址記在下面這個表裡，
 * 讓使用者至少在這一次操作中看得到自己剛放進去的圖。重新整理後會退回占位圖，
 * 這是後端還沒有本機媒體檔案端點的必然結果，不是壞掉。
 *
 * **配圖需求（imageBriefs）**：「一鍵配圖」給的是一份採買清單——該配什麼圖、prompt
 * 長怎樣。每張卡片可以直接「用 Codex 生圖」（D-017，用訂閱，只有 Codex 做得到），
 * 生好的圖先放在卡片上給使用者看，按「用這張」才上傳；也可以自己上傳，靠 briefKey
 * 把圖跟需求接起來。封面那張上傳後自動設成精選；內文圖照 AI 引用的原文（錨點）自動放進
 * 正文那一段之後，找不到就講「請自己放」（P5-T016）。
 */
const sessionThumbs = new Map<number, string>();

interface Block {
  index: number;
  text: string;
}

interface Pending {
  blob: Blob;
  filename: string;
  mimeType: string;
  converted: boolean;
  objectUrl: string;
}

export function MediaPanel({
  job,
  refresh,
  blocks,
  focusBriefId = null,
}: {
  job: LoadedJob;
  refresh: () => Promise<void>;
  blocks: Block[];
  /** 剛在文章上「請 AI 配一張」建出來的那條（P5-T018）：捲到它，讓人看得到計時器。 */
  focusBriefId?: number | null;
}): JSX.Element {
  const [pending, setPending] = useState<Pending | null>(null);
  const [alt, setAlt] = useState('');
  const pick = useAction();
  const upload = useAction();
  const generation = useImageGenerationStatus(job.imageBriefs.length > 0);

  useEffect(() => {
    return () => {
      if (pending) URL.revokeObjectURL(pending.objectUrl);
    };
  }, [pending]);

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

  const needsFeatured = job.target.requireFeaturedImage && job.featuredMediaId === null;

  return (
    <div className="stack">
      {needsFeatured && (
        <p className="note note-warn">
          <Icon name="alert" size={14} />
          <span>這個發布目標一定要有精選圖片。上傳一張，然後按「設為精選」。</span>
        </p>
      )}

      {job.imageBriefs.length > 0 && (
        <section className="briefs" aria-label="配圖需求">
          <h3 className="briefs-head">
            <Icon name="image-plus" size={14} />
            配圖需求（{job.imageBriefs.filter((brief) => !brief.fulfilled).length} 張待處理）
          </h3>
          <ul className="brief-list">
            {job.imageBriefs.map((brief) => (
              <BriefCard
                key={brief.id}
                job={job}
                brief={brief}
                refresh={refresh}
                generation={generation}
                focused={brief.id === focusBriefId}
              />
            ))}
          </ul>
        </section>
      )}

      {job.media.length === 0 && !needsFeatured && job.imageBriefs.length === 0 && (
        <p className="empty-line">
          還沒有圖片。日記多半用不到，長文一定要有精選圖片。
          想不到配什麼圖的話，按上面「請 AI 看一遍」旁的箭頭，選「一鍵配圖」。
        </p>
      )}

      <ul className="media-list">
        {job.media.map((asset) => (
          <MediaRow key={asset.id} job={job} asset={asset} blocks={blocks} refresh={refresh} />
        ))}
      </ul>

      <div className="upload">
        <ErrorNote message={pick.error ?? upload.error} />

        {!pending && (
          <>
            <label className="btn btn-quiet btn-file">
              <Icon name="image-plus" size={14} />
              {pick.busy ? '處理中…' : '選擇圖片'}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,.svg"
                onChange={choose}
                disabled={pick.busy}
              />
            </label>
            <p className="field-hint">
              可用 PNG、JPEG、WebP、GIF。選了 SVG 會自動轉成 PNG——WordPress 不收 SVG。
            </p>
          </>
        )}

        {pending && (
          <div className="upload-pending">
            <img className="media-thumb" src={pending.objectUrl} alt="" />
            <div className="upload-pending-main">
              <p className="upload-filename mono">{pending.filename}</p>
              <p className="field-hint">{formatBytes(pending.blob.size)}</p>
              {pending.converted && (
                <p className="note note-info">
                  <Icon name="check" size={14} />
                  <span>已把 SVG 轉成 PNG。WordPress 不接受 SVG，上傳的是轉好的 PNG。</span>
                </p>
              )}
              <Field label="替代文字" hint="給讀不到圖的人看，也會被搜尋引擎讀到。">
                <input
                  className="input"
                  value={alt}
                  onChange={(event) => setAlt(event.target.value)}
                  placeholder="例如：雨天的路口"
                />
              </Field>
              <div className="row row-end">
                <button
                  type="button"
                  className="btn btn-quiet"
                  disabled={upload.busy}
                  onClick={() => {
                    URL.revokeObjectURL(pending.objectUrl);
                    setPending(null);
                  }}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={upload.busy}
                  onClick={() =>
                    void upload.run(async () => {
                      const trimmed = alt.trim();
                      const { media: asset } = await api.addMedia(job.uuid, {
                        file: pending.blob,
                        filename: pending.filename,
                        mimeType: pending.mimeType,
                        ...(trimmed === '' ? {} : { altText: trimmed }),
                      });
                      // 這一回合先用 blob 網址當縮圖；發布後才有 WordPress 的網址。
                      sessionThumbs.set(asset.id, pending.objectUrl);
                      setPending(null);
                      await refresh();
                    })
                  }
                >
                  {upload.busy ? <Spinner /> : <Icon name="upload" size={14} />}
                  新增圖片
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * 能不能生圖。有配圖需求時才去問（後端要跑一次 `codex login status`）。
 * 問不到就當作不能生，原因照實講——不要讓按鈕看起來能按、按下去才失敗。
 */
export function useImageGenerationStatus(wanted: boolean): ImageGenerationStatus | null {
  const [status, setStatus] = useState<ImageGenerationStatus | null>(null);
  useEffect(() => {
    if (!wanted) return;
    let alive = true;
    api
      .getImageGenerationStatus()
      .then((next) => {
        if (alive) setStatus(next);
      })
      .catch((cause: unknown) => {
        if (alive) {
          setStatus({ available: false, provider: null, reason: `無法確認 Codex 能不能用：${describeError(cause)}` });
        }
      });
    return () => {
      alive = false;
    };
  }, [wanted]);
  return status;
}

/**
 * 一條配圖需求。
 *
 * 主要的路是「用 Codex 生圖」→ 看候選圖 →「用這張」。生圖要一分鐘左右，卡片上用計時器
 * 與說明撐住那段時間（D-010：不畫假的進度條）；頂端的 AgentBanner 也會出現。
 * 「複製 prompt」與「上傳這張」留著：不想用 Codex、或想自己找圖的時候用。
 */
function BriefCard({
  job,
  brief,
  refresh,
  generation,
  focused,
}: {
  job: LoadedJob;
  brief: ImageBrief;
  refresh: () => Promise<void>;
  generation: ImageGenerationStatus | null;
  focused: boolean;
}): JSX.Element {
  const rootRef = useRef<HTMLLIElement>(null);
  // 從文章上「請 AI 配一張」過來的：捲到這張卡片（右欄可能很長，計時器要看得到）。
  useEffect(() => {
    if (focused) rootRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [focused]);
  /** 使用者在文章上請 AI 配的（P5-T018）：沒有 AI 寫的描述，位置是使用者選的。 */
  const mine = brief.origin === 'user';
  const where = brief.anchor === null ? null : `「${brief.anchor}」那段${brief.anchorPosition === 'before' ? '之前' : '之後'}`;
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

  const run = job.agentRun;
  const runningHere = run?.status === 'running' && run.task === 'generate-image' && run.briefId === brief.id;
  const runningElsewhere = run?.status === 'running' && !runningHere;
  const generating = generate.busy || runningHere;
  const seconds = useElapsedSeconds(runningHere ? run.startedAt : localStart, generating);
  const busy = action.busy || generate.busy || use.busy;
  const candidate = brief.candidate;
  // 重新整理之後 generate.error 就沒了；上一趟這張卡片生圖失敗的話，照樣講出來。
  const lastFailure =
    run !== null &&
    run.task === 'generate-image' &&
    run.briefId === brief.id &&
    (run.status === 'failed' || run.status === 'timeout')
      ? `上次生圖${agentStatusText(run.status)}${run.errorMessage ? `：${run.errorMessage}` : ''}`
      : null;

  const unavailableReason =
    generation === null
      ? null
      : !generation.available
        ? (generation.reason ?? '現在不能生圖')
        : null;
  const canGenerate = generation?.available === true && !generating && !runningElsewhere && !busy;

  const upload = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    void action.run(async () => {
      const prepared = await prepareForUpload(file);
      setFeatureNote(null);
      setPlaceNote(null);
      const approved = job.approval?.valid === true;
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
        <p className="brief-purpose">
          {brief.note !== null ? `想要：${brief.note}` : '沒有特別要求：Codex 讀前後段落自己決定畫面'}
        </p>
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
      {!mine && <p className="brief-prompt">{brief.prompt}</p>}
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
          <p className="field-hint">
            {brief.isFeatured
              ? '按「用這張」會上傳到 WordPress 媒體庫；還沒有別的封面時會自動設成精選圖片。'
              : brief.fulfilled
                ? '按「用這張」會上傳到 WordPress 媒體庫；原本那張在正文裡的話，新圖放到它的位置。'
                : where !== null
                ? mine
                  ? `按「用這張」會上傳到 WordPress 媒體庫，並放回你選的位置（${where}；找不到那段就不放）。不滿意就再生一張，不用它也沒關係。`
                  : '按「用這張」會上傳到 WordPress 媒體庫，並自動放進正文上面那段之後（找不到那段就不放）。'
                : '按「用這張」會上傳到 WordPress 媒體庫，位置要自己選。不滿意就再生一張，不用它也沒關係。'}
            {brief.isFeatured && job.approval?.valid === true && ' 換封面會讓目前的核准失效。'}
            {!brief.isFeatured && (brief.anchor !== null || brief.fulfilled) && job.approval?.valid === true && ' 放進正文會讓目前的核准失效。'}
          </p>
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
              disabled={busy || runningElsewhere}
              onClick={() =>
                void use.run(async () => {
                  setFeatureNote(null);
                  setPlaceNote(null);
                  const approved = job.approval?.valid === true;
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
      {brief.isFeatured && candidate === null && !generating && (
        <p className="field-hint">
          這是封面：上傳（或生圖後「用這張」）的圖，在還沒有別的封面時會自動設成精選。
          {job.approval?.valid === true && ' 換封面會讓目前的核准失效。'}
        </p>
      )}
      {!brief.isFeatured && brief.anchor !== null && !brief.fulfilled && candidate === null && !generating && (
        <p className="field-hint">
          {mine ? `上傳（或生圖後「用這張」）的圖會放回你選的位置。` : '上傳（或生圖後「用這張」）的圖會自動放進正文上面那段之後。'}
          {job.approval?.valid === true && ' 放進正文會讓目前的核准失效。'}
        </p>
      )}
      {!brief.isFeatured && brief.fulfilled && candidate === null && !generating && (
        <p className="field-hint">
          「換一張」：原本那張在正文裡的話，新圖會放到它的位置，舊圖拿出正文（留在媒體庫）。
          {job.approval?.valid === true && ' 換進正文會讓目前的核准失效。'}
        </p>
      )}
      {runningElsewhere && !generating && (
        <p className="field-hint">另一個 Agent 動作還在跑，跑完才能生圖或上傳（同一篇一次只跑一個）。</p>
      )}

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
            accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,.svg"
            onChange={upload}
            // 另一個 Agent 動作在跑時不給上傳：上傳完會自動放進正文或設精選，那會讓跑到一半的結果作廢
            // （後端也會擋下自動放，這裡先不讓人按，跟「用這張」一樣）。這張卡片自己在生圖時也不給：
            // 從文章上「請 AI 配一張」開始的那趟不經過這張卡片的 generate，busy 看不到它。
            disabled={busy || runningElsewhere || generating}
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
                  要再配，在文章上那個位置按「在這裡插圖」→「請 AI 配一張」。
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

/** 這次自動放位置有沒有動到正文（放進去或換掉舊圖）。 */
function changedBody(result: AutoPlaceResult): boolean {
  return result.outcome === 'placed' || result.outcome === 'replaced';
}

export function assetLabel(asset: MediaAsset): string {
  // 使用者在文章上請 AI 配的（key `user-…`，P5-T018）：key 是亂數，給人看的是替代文字。
  const mine = asset.briefKey?.startsWith('user-') === true;
  if (asset.briefKey && !mine) return asset.briefKey;
  if (asset.altText) return asset.altText;
  if (mine) return `AI 配的圖 #${asset.id}`;
  return `圖片 #${asset.id}`;
}

function MediaRow({
  job,
  asset,
  blocks,
  refresh,
}: {
  job: LoadedJob;
  asset: MediaAsset;
  blocks: Block[];
  refresh: () => Promise<void>;
}): JSX.Element {
  const action = useAction();
  const confirm = useConfirm();
  const featured = job.featuredMediaId === asset.id;
  const thumb = asset.url ?? sessionThumbs.get(asset.id) ?? null;
  /**
   * 校樣量完了才有段落可以指定。
   *
   * ProofView 換版本時會把 blocks 清空，因為上一版的第 3 段在新版本可能是別的
   * 東西——這段期間不能讓人送出索引，寧可先鎖住。
   */
  const measured = blocks.length > 0;
  /**
   * 校稿／一鍵配圖跑的時候，任何會產生新版本的動作都要鎖住：Agent 跑完發現內容變了，
   * 整趟結果會被丟掉（後端 assertAgentResultStillApplies）。生圖那一趟不檢查內容，不擋。
   */
  const contentRunActive = job.agentRun?.status === 'running' && job.agentRun.task !== 'generate-image';
  const placedInBody =
    asset.placedAfterBlockIndex !== null && asset.placedAfterBlockIndex >= 0;

  return (
    <li className="media-row">
      {thumb ? (
        <img className="media-thumb" src={thumb} alt="" loading="lazy" />
      ) : (
        <span className="media-thumb media-thumb-empty" aria-hidden="true">
          <Icon name="image" size={18} />
        </span>
      )}

      <div className="media-main">
        <p className="media-name">{assetLabel(asset)}</p>
        <p className="media-meta">
          <span className="mono">{asset.mimeType.replace('image/', '')}</span>
          <span>{formatBytes(asset.byteSize)}</span>
          {featured && <span className="media-badge">精選</span>}
          {asset.wordpressMediaId === null && <span className="media-badge media-badge-quiet">尚未上傳</span>}
        </p>

        {!featured && (
          <>
            <label className="media-place">
              <span className="sr-only">插入位置</span>
              <select
                className="input select"
                value={asset.placedAfterBlockIndex ?? ''}
                disabled={action.busy || !measured || contentRunActive}
                onChange={(event) => {
                  const value = event.target.value;
                  if (value === '') return;
                  void action.run(async () => {
                    await api.placeMedia(job.uuid, asset.id, Number(value));
                    await refresh();
                  });
                }}
              >
                <option value="">尚未放進正文</option>
                <option value="-1">放在最前面</option>
                {/*
                  校樣還沒量完時 blocks 是空的，但目前的位置還是要顯示出來，
                  否則下拉會變成一片空白，看起來像位置被清掉了。
                */}
                {!measured && placedInBody && (
                  <option value={asset.placedAfterBlockIndex ?? ''}>
                    第 {(asset.placedAfterBlockIndex ?? 0) + 1} 段之後
                  </option>
                )}
                {blocks.map((block) => (
                  <option key={block.index} value={block.index}>
                    第 {block.index + 1} 段之後：{block.text || '（空段）'}
                  </option>
                ))}
              </select>
            </label>
            {!measured && (
              <p className="field-hint">要等校樣量出段落，才能指定插入位置。</p>
            )}
          </>
        )}

        <ErrorNote message={action.error} />

        <div className="media-actions">
          {!featured && (
            <button
              type="button"
              className="btn btn-quiet btn-tiny"
              disabled={action.busy || contentRunActive}
              onClick={() =>
                void action.run(async () => {
                  await api.setFeaturedMedia(job.uuid, asset.id);
                  await refresh();
                })
              }
            >
              <Icon name="star" size={13} />
              設為精選
            </button>
          )}

          {featured && (
            <button
              type="button"
              className="btn btn-quiet btn-tiny"
              disabled={action.busy || contentRunActive}
              onClick={() =>
                void action.run(async () => {
                  await api.setFeaturedMedia(job.uuid, null);
                  await refresh();
                })
              }
            >
              <Icon name="minus" size={13} />
              取消精選
            </button>
          )}

          <label className="btn btn-quiet btn-tiny btn-file">
            <Icon name="refresh" size={13} />
            換圖
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,.svg"
              disabled={action.busy || contentRunActive}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (!file) return;
                void action.run(async () => {
                  const prepared = await prepareForUpload(file);
                  await api.replaceMedia(job.uuid, asset.id, {
                    file: prepared.blob,
                    filename: prepared.filename,
                    mimeType: prepared.blob.type || 'image/png',
                    ...(asset.altText === null ? {} : { altText: asset.altText }),
                  });
                  sessionThumbs.set(asset.id, URL.createObjectURL(prepared.blob));
                  await refresh();
                });
              }}
            />
          </label>

          <button
            type="button"
            className="btn btn-quiet btn-tiny btn-danger-text"
            disabled={action.busy || contentRunActive}
            onClick={() =>
              confirm({
                title: '移除這張圖片？',
                danger: true,
                body: (
                  <>
                    <p>{assetLabel(asset)} 會從這篇稿件移除，正文裡的位置也會一起清掉。</p>
                    {job.approval?.valid === true && (
                      <p>目前的核准會因為內容改變而失效，要重新核准。</p>
                    )}
                  </>
                ),
                confirmLabel: '移除',
                onConfirm: async () => {
                  await api.removeMedia(job.uuid, asset.id);
                  sessionThumbs.delete(asset.id);
                  await refresh();
                },
              })
            }
          >
            <Icon name="trash" size={13} />
            移除
          </button>
        </div>
      </div>
    </li>
  );
}
