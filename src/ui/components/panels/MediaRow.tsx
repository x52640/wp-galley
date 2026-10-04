import type { JSX } from 'react';
import { api } from '../../service/client.js';
import type { LoadedJob, MediaAsset } from '../../service/types.js';
import { Icon } from '../../icons.js';
import { formatBytes } from '../../lib/format.js';
import { prepareForUpload } from '../../lib/svg-to-png.js';
import { useConfirm } from '../ConfirmDialog.js';
import { runLocksContent } from '../../lib/agent-tasks.js';
import { IMAGE_FILE_ACCEPT, assetLabel, isPlacedInBody } from '../../lib/media-view.js';
import { sessionThumbs } from '../../lib/session-thumbs.js';
import { ErrorNote, useAction } from './shared.js';

/** 校樣量出來的一段（給「插入位置」下拉）。 */
export interface Block {
  index: number;
  text: string;
}

/** 已經放進這篇的一張圖：縮圖、插入位置、設精選、換圖、移除。 */
export function MediaRow({
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
   * 整趟結果會被丟掉（後端 assertAgentResultStillApplies）。生圖與建議網址不檢查內容，不擋。
   */
  const contentRunActive = runLocksContent(job.agentRun);
  const placedInBody = isPlacedInBody(asset);

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
              accept={IMAGE_FILE_ACCEPT}
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
