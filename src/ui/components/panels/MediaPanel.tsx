import { useEffect, useState, type ChangeEvent, type JSX } from 'react';
import { api } from '../../service/client.js';
import type { ImageBrief, LoadedJob, MediaAsset } from '../../service/types.js';
import { Icon } from '../../icons.js';
import { formatBytes } from '../../lib/format.js';
import { prepareForUpload } from '../../lib/svg-to-png.js';
import { useConfirm } from '../ConfirmDialog.js';
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
 * **配圖需求（imageBriefs）在這裡只做前半段。** 三個 Agent CLI 都不能生圖，
 * 生圖 API 也還沒選，所以「一鍵配圖」給的是一份採買清單：該配什麼圖、prompt
 * 長怎樣。使用者按「複製 prompt」拿去生圖，回來在同一張卡片上傳，靠 briefKey
 * 把圖跟需求接起來。不假裝自己會生圖，但也不讓使用者為了這件事離開發布台。
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
}: {
  job: LoadedJob;
  refresh: () => Promise<void>;
  blocks: Block[];
}): JSX.Element {
  const [pending, setPending] = useState<Pending | null>(null);
  const [alt, setAlt] = useState('');
  const pick = useAction();
  const upload = useAction();

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
            Agent 建議的配圖（{job.imageBriefs.filter((brief) => !brief.fulfilled).length} 張待處理）
          </h3>
          <ul className="brief-list">
            {job.imageBriefs.map((brief) => (
              <BriefCard key={brief.id} job={job} brief={brief} refresh={refresh} />
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
                      const asset = await api.addMedia(job.uuid, {
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
 * 一條配圖需求。
 *
 * 「複製 prompt」是這張卡片的重點：使用者要拿它去別的地方生圖，那一步我們幫不上，
 * 但至少不要讓他自己反白選字。複製失敗（沒有剪貼簿權限）就說出來，不要靜靜地失敗。
 */
function BriefCard({
  job,
  brief,
  refresh,
}: {
  job: LoadedJob;
  brief: ImageBrief;
  refresh: () => Promise<void>;
}): JSX.Element {
  const [copied, setCopied] = useState(false);
  const action = useAction();
  const confirm = useConfirm();

  const upload = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    void action.run(async () => {
      const prepared = await prepareForUpload(file);
      const asset = await api.addMedia(job.uuid, {
        file: prepared.blob,
        filename: prepared.filename,
        mimeType: prepared.blob.type || 'image/png',
        altText: brief.altText,
        briefKey: brief.key,
        ...(brief.caption === null ? {} : { caption: brief.caption }),
      });
      sessionThumbs.set(asset.id, URL.createObjectURL(prepared.blob));
      await refresh();
    });
  };

  return (
    <li className="brief" data-fulfilled={brief.fulfilled ? 'yes' : 'no'}>
      <div className="brief-head">
        <span className="brief-key mono">{brief.key}</span>
        <span className="brief-ratio mono">{brief.aspectRatio}</span>
        {brief.placement !== null && <span className="brief-where">{brief.placement}</span>}
        {brief.fulfilled && (
          <span className="brief-done">
            <Icon name="check" size={13} />
            已上傳
          </span>
        )}
      </div>

      <p className="brief-purpose">{brief.purpose}</p>
      <p className="brief-prompt">{brief.prompt}</p>
      <p className="brief-alt">
        <span className="brief-alt-tag">alt</span>
        {brief.altText}
      </p>

      <ErrorNote message={action.error} />

      <div className="brief-actions">
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
            disabled={action.busy}
          />
        </label>

        <button
          type="button"
          className="btn btn-quiet btn-tiny btn-danger-text brief-drop"
          onClick={() =>
            confirm({
              title: '不要這張配圖？',
              danger: true,
              body: (
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

function assetLabel(asset: MediaAsset): string {
  if (asset.briefKey) return asset.briefKey;
  if (asset.altText) return asset.altText;
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
                disabled={action.busy || !measured}
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
              disabled={action.busy}
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
              disabled={action.busy}
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
              disabled={action.busy}
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
            disabled={action.busy}
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
