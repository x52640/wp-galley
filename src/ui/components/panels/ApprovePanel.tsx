import type { JSX } from 'react';
import { api } from '../../service/client.js';
import type { LoadedJob } from '../../service/types.js';
import { Icon } from '../../icons.js';
import { shortHash } from '../../lib/format.js';
import { ErrorNote, Spinner, useAction } from './shared.js';

/**
 * 核准。
 *
 * 核准綁的是**這一版內容的 hash**，不是這篇稿件。任何會改變內容的操作
 * （改字、換圖、移動圖片、換精選）都會讓它失效並退回 RENDERED——這件事由
 * CoreService 做，UI 只負責事先講清楚，以及事後把「印章被撕掉」畫出來。
 *
 * 這顆按鈕是整個畫面唯一需要人真正做決定的地方，所以強調色只給它。
 *
 * **核准的 hash 一定要是眼前那一份的 hash。** 送出的值來自
 * `GET /api/jobs/:uuid`，但畫面中央那張校樣是 iframe 另外去載的，兩者之間有
 * 可能被別的東西（Agent 跑完、另一個分頁、階段 6 的 MCP）插進來改過。校樣回應
 * 的 ETag 就是後端當下算出來的 hash：兩邊對不上就代表「你在看的」跟「你要簽的」
 * 不是同一份，這時寧可不給簽，請使用者重新渲染。
 */

export function ApprovePanel({
  job,
  refresh,
  previewHash,
}: {
  job: LoadedJob;
  refresh: () => Promise<void>;
  /** 校樣回應的 ETag。null = 還沒問到或後端沒給，這時不阻擋，只是不做保證。 */
  previewHash: string | null;
}): JSX.Element {
  const action = useAction();
  const render = useAction();
  const hash = job.currentRevision?.contentHash ?? null;
  const invalidated = job.approval !== null && !job.approval.valid;
  const stateAllows = hash !== null && (job.state === 'RENDERED' || job.state === 'PREVIEWED');
  const mismatch = hash !== null && previewHash !== null && previewHash !== hash;
  const canApprove = stateAllows && !mismatch;

  return (
    <div className="stack">
      {invalidated && (
        <p className="note note-warn">
          <Icon name="scissors" size={14} />
          <span>
            內容在核准之後又改過了，舊的核准已經作廢。重看一次校樣，再核准一次。
          </span>
        </p>
      )}

      <p className="approve-copy">
        核准會綁住現在這一版的內容
        <span className="mono approve-hash">{shortHash(hash)}</span>。
        核准之後只要再動一個字、換一張圖，核准就會失效，要重新核准。
      </p>

      {mismatch && (
        <p className="note note-bad" role="alert">
          <Icon name="alert" size={14} />
          <span>
            畫面上這份校樣是
            <span className="mono approve-hash">{shortHash(previewHash)}</span>
            ，跟要核准的
            <span className="mono approve-hash">{shortHash(hash)}</span>
            不是同一份——內容在你看校樣的期間被改過了。按「重新渲染」，看過新的校樣再核准。
          </span>
        </p>
      )}

      {!stateAllows && (
        <p className="note note-warn">
          <Icon name="alert" size={14} />
          <span>
            {job.currentRevision === null
              ? '還沒有內容可以核准。先貼上原稿並渲染。'
              : `目前狀態是「${job.state}」，這一步不能核准。先按「重新渲染」。`}
          </span>
        </p>
      )}

      <ErrorNote message={action.error ?? render.error} />

      <div className="row row-end">
        <button
          type="button"
          className="btn btn-quiet"
          disabled={render.busy}
          onClick={() =>
            void render.run(async () => {
              await api.render(job.uuid);
              await refresh();
            })
          }
        >
          {render.busy ? <Spinner /> : <Icon name="refresh" size={14} />}
          重新渲染
        </button>

        <button
          type="button"
          className="btn btn-seal"
          disabled={action.busy || !canApprove}
          onClick={() =>
            void action.run(async () => {
              if (hash === null) return;
              await api.approve(job.uuid, hash);
              await refresh();
            })
          }
        >
          {action.busy ? <Spinner /> : <Icon name="stamp" size={15} />}
          核准
        </button>
      </div>
    </div>
  );
}
