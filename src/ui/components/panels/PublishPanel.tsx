import { useState, type JSX } from 'react';
import { api } from '../../service/client.js';
import type { LoadedJob, PublishResult, PublishStatus } from '../../service/types.js';
import { Icon } from '../../icons.js';
import { useConfirm } from '../ConfirmDialog.js';
import { ErrorNote, Spinner, useAction } from './shared.js';

/**
 * 發布。
 *
 * 「存成草稿」與「直接公開」是兩個不同的決定，所以是兩個選項一顆按鈕，不是
 * 兩顆長得一樣的按鈕。預設草稿——這是本機工具，寧可多按一次。
 *
 * 送出前後用同一個詞：按鈕寫「發布」，成功訊息就寫「已發布」。
 */

export function PublishPanel({
  job,
  refresh,
}: {
  job: LoadedJob;
  refresh: () => Promise<void>;
}): JSX.Element {
  const [status, setStatus] = useState<PublishStatus>('draft');
  const [result, setResult] = useState<PublishResult | null>(null);
  const action = useAction();
  const confirm = useConfirm();

  if (job.state === 'PUBLISHING') {
    return (
      <p className="agent-running" role="status">
        <Spinner />
        <span>正在送去 WordPress…</span>
      </p>
    );
  }

  if (job.published) {
    return (
      <div className="stack">
        <p className="note note-good">
          <Icon name="check-circle" size={14} />
          <span>
            已發布為{job.published.status === 'publish' ? '公開文章' : '草稿'}
            <span className="mono"> #{job.published.wordpressId}</span>
          </span>
        </p>
        {result && result.unknownTerms.length > 0 && (
          <p className="note note-warn">
            <Icon name="alert" size={14} />
            <span>
              站上沒有「{result.unknownTerms.join('」「')}」這個分類項目，這次沒有套上。
              在「分類」那一步改選既有項目，或明確建立新項目後再發布一次。
            </span>
          </p>
        )}
        {result && result.fallbackBlocks > 0 && (
          <p className="note note-warn">
            <Icon name="alert" size={14} />
            <span>
              有 {result.fallbackBlocks} 個區塊轉不成 Gutenberg 區塊，改用原始 HTML 送出。
              在 WordPress 編輯器裡它們會顯示成「自訂 HTML」，可以編輯但不是區塊。
            </span>
          </p>
        )}
        <a className="btn btn-quiet" href={job.published.link} target="_blank" rel="noreferrer">
          <Icon name="external-link" size={14} />
          在 WordPress 開啟
        </a>
        <p className="mono publish-link">{job.published.link}</p>
      </div>
    );
  }

  const ready = job.state === 'APPROVED' && job.blockers.length === 0;

  return (
    <div className="stack">
      <fieldset className="radios">
        <legend className="field-label">送出的狀態</legend>
        <label className="radio">
          <input
            type="radio"
            name="publish-status"
            checked={status === 'draft'}
            onChange={() => setStatus('draft')}
          />
          <span>
            <strong>存成草稿</strong>
            <span className="radio-hint">文章會出現在 WordPress 後台，不會公開。</span>
          </span>
        </label>
        <label className="radio">
          <input
            type="radio"
            name="publish-status"
            checked={status === 'publish'}
            onChange={() => setStatus('publish')}
          />
          <span>
            <strong>直接公開</strong>
            <span className="radio-hint">立刻出現在網站上，任何人都看得到。</span>
          </span>
        </label>
      </fieldset>

      {!ready && (
        <p className="note note-warn">
          <Icon name="alert" size={14} />
          <span>
            {job.blockers.length > 0
              ? `還不能發布：${job.blockers.join('、')}。`
              : '還不能發布：要先核准這一版內容。'}
          </span>
        </p>
      )}

      <ErrorNote message={action.error} />

      <div className="row row-end">
        <button
          type="button"
          className="btn btn-primary"
          disabled={action.busy || !ready}
          onClick={() =>
            confirm({
              title: status === 'publish' ? '直接公開這篇文章？' : '存成草稿？',
              danger: status === 'publish',
              body: (
                <>
                  <p>
                    {job.title ?? '未命名'} 會送到 {job.target.displayName}
                    {status === 'publish' ? '，並立刻公開在網站上。' : '，狀態為草稿。'}
                  </p>
                  <p>發布前會再檢查一次遠端有沒有被別人改過；有的話會中止，不會覆蓋。</p>
                </>
              ),
              confirmLabel: '發布',
              onConfirm: async () => {
                // confirm: true 就是「使用者剛剛在這個對話框按了發布」。
                // 設了 requireSecondConfirmation 的發布目標，後端只認這個旗標；
                // 不送的話那種目標永遠會被擋下來，而且錯誤訊息還看不出原因。
                setResult(await api.publish(job.uuid, { status, confirm: true }));
                await refresh();
              },
            })
          }
        >
          {action.busy ? <Spinner /> : <Icon name="send" size={14} />}
          發布
        </button>
      </div>
    </div>
  );
}
