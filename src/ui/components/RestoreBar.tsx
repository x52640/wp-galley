import { useState, type JSX } from 'react';
import { api, describeError } from '../service/client.js';
import type { JobDetail } from '../service/types.js';
import { Icon } from '../icons.js';

/**
 * 已取消的稿件最上面那條（D-031）：講清楚取消了，給一顆「恢復這篇」。
 *
 * 恢復不是破壞性操作（取消時什麼都沒刪），所以不問確認。回到哪一步由後端決定；
 * 取消前已核准的會回到「還沒核准」，發布面板照常講要重新核准，這裡不另外說明。
 */
export function RestoreBar({
  job,
  refresh,
  onError,
}: {
  job: JobDetail;
  refresh: () => Promise<void>;
  onError: (message: string | null) => void;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  return (
    <div className="terminal-bar restore-bar" role="status">
      <Icon name="alert" size={15} />
      <span>這篇已經取消。內容都還在，恢復之後可以繼續編輯、發布。</span>
      <button
        type="button"
        className="btn btn-tiny"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          onError(null);
          void api
            .restoreJob(job.uuid)
            .then(() => refresh())
            .catch((cause: unknown) => onError(describeError(cause)))
            .finally(() => setBusy(false));
        }}
      >
        <Icon name="undo" size={13} />
        {busy ? '恢復中…' : '恢復這篇'}
      </button>
    </div>
  );
}
