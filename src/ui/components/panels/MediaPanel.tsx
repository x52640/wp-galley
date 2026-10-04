import { useEffect, useState, type ChangeEvent, type JSX } from 'react';
import { api } from '../../service/client.js';
import type { LoadedJob } from '../../service/types.js';
import { Icon } from '../../icons.js';
import { formatBytes } from '../../lib/format.js';
import { prepareForUpload } from '../../lib/svg-to-png.js';
import { useImageGenerationStatus } from '../../lib/image-generation-status.js';
import { IMAGE_FILE_ACCEPT } from '../../lib/media-view.js';
import { sessionThumbs } from '../../lib/session-thumbs.js';
import { ErrorNote, Field, Spinner, useAction } from './shared.js';
import { BriefCard } from './BriefCard.js';
import { MediaRow, type Block } from './MediaRow.js';

// 其他畫面（Workspace、InsertImagePanel）從這裡拿；本體在 lib/（P5-T044）。
export { useImageGenerationStatus } from '../../lib/image-generation-status.js';
export { assetLabel } from '../../lib/media-view.js';

/**
 * 配圖。
 *
 * **SVG 在這裡就地轉成 PNG。** WordPress 核心不收 SVG，而「裝外掛」與「改 PHP」
 * 兩條路都是專案明文禁止的，所以只剩前端轉檔這一條。轉檔在 lib/svg-to-png.ts，
 * 不需要任何額外套件。使用者選了 SVG 會看到一行說明，不是默默換掉他的檔案。
 *
 * 縮圖的來源要分清楚：`MediaAsset.url` 是**發布後 WordPress 的公開網址**，
 * 還沒發布時是 null。本回合上傳的圖另外用 blob 網址記在 `lib/session-thumbs.ts`。
 *
 * **配圖需求（imageBriefs）**：「一鍵配圖」給的是一份採買清單——該配什麼圖、prompt
 * 長怎樣。每張卡片可以直接「用 Codex 生圖」（D-017，用訂閱，只有 Codex 做得到），
 * 生好的圖先放在卡片上給使用者看，按「用這張」才上傳；也可以自己上傳，靠 briefKey
 * 把圖跟需求接起來。封面那張上傳後自動設成精選；內文圖照 AI 引用的原文（錨點）自動放進
 * 正文那一段之後，找不到就講「請自己放」（P5-T016）。
 *
 * 檔案分工（P5-T044）：這裡只組清單與底下的「選擇圖片」；一條配圖需求是 `BriefCard.tsx`，
 * 一張已放進來的圖是 `MediaRow.tsx`，畫面的判斷在 `lib/media-view.ts`。
 */

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
  editing = false,
}: {
  job: LoadedJob;
  refresh: () => Promise<void>;
  blocks: Block[];
  /** 正在打字（P5-T038 審查 1）：卡片上會把圖放進正文的「用這張」「上傳這張」反灰。 */
  editing?: boolean;
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
                writing={editing}
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
                accept={IMAGE_FILE_ACCEPT}
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
