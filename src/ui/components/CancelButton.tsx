import type { JSX } from 'react';
import { api } from '../service/client.js';
import type { JobDetail } from '../service/types.js';
import { Icon } from '../icons.js';
import { isFinished } from '../lib/steps.js';
import type { useConfirm } from './ConfirmDialog.js';

/** 「取消這篇稿件」：發布面板底下、發布目標不見了的錯誤畫面各一顆。先問確認；取消後內容都留著，可以恢復（D-031）。 */
export function CancelButton({
  job,
  refresh,
  confirm,
}: {
  job: JobDetail;
  refresh: () => Promise<void>;
  confirm: ReturnType<typeof useConfirm>;
}): JSX.Element | null {
  if (isFinished(job.state)) return null;
  return (
    <button
      type="button"
      className="btn btn-quiet btn-tiny btn-danger-text"
      onClick={() =>
        confirm({
          title: '取消這篇稿件？',
          danger: true,
          body: (
            <p>
              「{job.title ?? '未命名'}」會標記為已取消，不能再編輯或發布；內容都留著，之後可以在這篇裡恢復。
              已經上傳到 WordPress 的東西不會被刪掉。
            </p>
          ),
          confirmLabel: '取消這篇',
          onConfirm: async () => {
            await api.cancelJob(job.uuid);
            await refresh();
          },
        })
      }
    >
      <Icon name="x" size={13} />
      取消這篇稿件
    </button>
  );
}
