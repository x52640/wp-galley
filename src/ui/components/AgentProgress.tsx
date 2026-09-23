import { useEffect, useState, type JSX } from 'react';
import type { AgentRun } from '../service/types.js';
import { Icon } from '../icons.js';

/**
 * 「Agent 還在跑」的畫面。
 *
 * 真實的 CLI 一趟要幾十秒到幾分鐘，那段時間裡使用者只看得到一個轉圈圈的話，
 * 會分不出「還在想」與「卡死了」。所以這裡給三樣東西：
 *
 * 1. **一直在動的計時器**（每秒跳一次）。動的東西才代表活著。
 * 2. **講出它在做什麼**，而且用這一趟的 task 決定講法——「校稿」跟「想配圖」
 *    是兩件事，講錯會讓人以為按錯按鈕。
 * 3. **講出大概要多久**。沒有期待值的等待，三十秒就開始像壞掉。
 *
 * 沒有百分比進度條，因為我們**真的不知道**進度——子行程只會在結束時回話。
 * 畫一個假的進度條比誠實的不確定更糟。
 */

const TASK_VERB: Record<AgentRun['task'], string> = {
  review: '正在讀你的文章',
  images: '正在想該配什麼圖',
};

/** 每秒跳一次的經過秒數。跑完就停下來，不留著空轉的計時器。 */
export function useElapsedSeconds(startedAt: string | undefined, active: boolean): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active, startedAt]);

  if (startedAt === undefined) return 0;
  const started = new Date(startedAt).getTime();
  if (Number.isNaN(started)) return 0;
  return Math.max(0, Math.round((now - started) / 1000));
}

export function formatElapsed(seconds: number): string {
  const mm = Math.floor(seconds / 60);
  const ss = seconds % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

/** 一條不知道進度的進度條。動，但不假裝自己知道跑到哪了。 */
export function IndeterminateBar(): JSX.Element {
  return (
    <div className="agent-bar" role="presentation">
      <div className="agent-bar-run" />
    </div>
  );
}

/**
 * 頂端那條長條。稿件工作區任何時候都看得到它——使用者在看校樣或左右對照的時候
 * 不會把右面板打開，那時候「還在跑」這件事必須自己找上門。
 */
export function AgentBanner({
  run,
  onCancel,
  cancelling,
}: {
  run: AgentRun;
  onCancel: () => void;
  cancelling: boolean;
}): JSX.Element {
  const seconds = useElapsedSeconds(run.startedAt, true);

  return (
    <div className="agent-banner" role="status" aria-live="polite">
      <Icon name="spinner" size={14} className="spin" />
      <span className="agent-banner-text">
        <strong>{run.provider}</strong> {TASK_VERB[run.task]}…
      </span>
      <span className="agent-banner-time mono">{formatElapsed(seconds)}</span>
      <IndeterminateBar />
      <span className="agent-banner-note">通常 30 秒到 3 分鐘</span>
      <button type="button" className="btn btn-quiet btn-tiny" disabled={cancelling} onClick={onCancel}>
        <Icon name="x" size={13} />
        停止
      </button>
    </div>
  );
}

/**
 * 面板裡的版本。比長條多講一些：它現在沒有哪些權限。
 *
 * 那句話不是裝飾。這個專案的賣點就是「Agent 進不了你的 WordPress」，
 * 而使用者唯一會盯著它想的時刻，就是等它跑完的這幾分鐘。
 */
export function AgentBusy({ run }: { run: AgentRun }): JSX.Element {
  const seconds = useElapsedSeconds(run.startedAt, true);

  return (
    <div className="agent-busy" role="status" aria-live="polite">
      <p className="agent-busy-head">
        <Icon name="spinner" size={15} className="spin" />
        <span>
          <strong>{run.provider}</strong> {TASK_VERB[run.task]}…
        </span>
        <span className="agent-busy-time mono">{formatElapsed(seconds)}</span>
      </p>
      <IndeterminateBar />
      <p className="field-hint">
        {seconds < 90
          ? '通常 30 秒到 3 分鐘。文章越長越久，這段時間可以先去看校樣。'
          : '比平常久一點。長文本來就會跑比較久；真的等太久就按停止再試一次。'}
      </p>
      <p className="field-hint">
        它現在沒有 shell、檔案寫入、網路與 WordPress 權限，只會回傳結構化資料。
      </p>
    </div>
  );
}
