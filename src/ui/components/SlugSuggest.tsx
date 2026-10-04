import { useId, useSyncExternalStore, type JSX } from 'react';
import { api, describeError } from '../service/client.js';
import type { LoadedJob } from '../service/types.js';
import { Icon } from '../icons.js';
import { PROVIDERS, loadProvider } from '../lib/agent-tasks.js';
import { getSlugSuggest, startSlugSuggest, subscribeSlugSuggest } from '../lib/slug-suggest-store.js';
import { formatElapsed, useElapsedSeconds } from './AgentProgress.js';
import { ErrorNote, Spinner, useAction } from './panels/shared.js';

/**
 * 「建議網址」（D-026，P5-T026）：跑一趟本機 Agent（使用者在「請 AI 看一遍」選單裡選的那家），
 * 讀**已存的**標題＋內文開頭，回三個英文網址。候選是按鈕，點了才交給呼叫端填進它的網址欄（還沒存）；絕不自動填。
 *
 * 兩處共用這一個（D-038，P5-T039）：「標題與網址」抽屜（`panels/SourcePanel.tsx`）與發布面板（`PublishSheet.tsx`）。
 * 請求與結果在模組層級（`lib/slug-suggest-store.ts`），以稿件為 key，所以一邊想好的候選另一邊也看得到。
 *
 * 等待期間跟其他 Agent 動作一樣：計時器、停止、頂端長條（AgentBanner），不畫進度條（D-010）。
 * 標題改了還沒存時不給按：AI 看的是已存的那一版，送出去只會拿到舊標題的建議。
 */
export function SlugSuggest({
  job,
  refresh,
  slug,
  titleDirty,
  pick,
  pickHint,
  disabled = false,
}: {
  job: LoadedJob;
  refresh: () => Promise<void>;
  /** 呼叫端網址欄現在的值：等於某個候選時那顆標成選中。 */
  slug: string;
  titleDirty: boolean;
  pick: (slug: string) => void;
  /** 候選上面那句：點了會填到哪、要按什麼才存。 */
  pickHint: string;
  /** 呼叫端自己在忙（例如正在存、正在發布）。 */
  disabled?: boolean;
}): JSX.Element {
  const state = useSyncExternalStore(subscribeSlugSuggest, () => getSlugSuggest(job.uuid));
  const stop = useAction();
  const whyId = useId();

  const run = job.agentRun;
  const runningHere = run?.status === 'running' && run.task === 'suggest-slug';
  const runningElsewhere = run?.status === 'running' && !runningHere;
  const thinking = state.running || runningHere;
  const seconds = useElapsedSeconds(runningHere ? run.startedAt : (state.startedAt ?? undefined), thinking);
  const provider = loadProvider();
  const providerLabel = PROVIDERS.find((option) => option.id === provider)?.label ?? provider;
  const canAsk = !disabled && !thinking && !runningElsewhere && !titleDirty && job.currentRevision !== null;
  const ideas = state.ideas;
  const stopped = state.stopped;

  const ask = (): void => {
    if (!canAsk) return;
    const uuid = job.uuid;
    void startSlugSuggest(uuid, {
      request: () => {
        const pending = api.suggestSlugs(uuid, { provider: loadProvider() });
        // 要等 Agent 跑完才回來。先重讀一次，工作區才看到「執行中」、頂端長條與其他按鈕的鎖定才跟得上。
        window.setTimeout(() => void refresh(), 500);
        return pending;
      },
      wasCancelled: async () => {
        const last = (await api.getJob(uuid)).agentRun;
        return last?.task === 'suggest-slug' && last.status === 'cancelled';
      },
      describe: describeError,
      refresh,
    });
  };

  const why = titleDirty
    ? '標題改過還沒存：先按「儲存」，AI 才看得到新標題。'
    : runningElsewhere
      ? '另一個 AI 動作正在跑，等它跑完再建議網址。'
      : `交給 ${providerLabel}：讀標題和內文開頭，給 3 個英文網址（知道作品的官方英文名就用它）。點了才會填進去。`;

  return (
    <div className="slug-suggest">
      <div className="row">
        <button type="button" className="btn btn-quiet" disabled={!canAsk} onClick={ask} aria-describedby={whyId}>
          {thinking ? <Spinner /> : <Icon name="sparkles" size={14} />}
          建議網址
        </button>
        {!thinking && (
          <span id={whyId} className="field-hint">
            {why}
          </span>
        )}
      </div>

      {thinking && (
        <div className="slug-thinking" role="status" aria-live="polite">
          <Icon name="spinner" size={14} className="spin" />
          <span className="slug-thinking-text">{runningHere ? run.provider : providerLabel} 正在想英文網址…</span>
          <span className="slug-thinking-time mono">{formatElapsed(seconds)}</span>
          <button
            type="button"
            className="btn btn-quiet btn-tiny"
            disabled={stop.busy}
            onClick={() =>
              void stop.run(async () => {
                await api.cancelAgent(job.uuid);
                await refresh();
              })
            }
          >
            <Icon name="x" size={13} />
            停止
          </button>
          <p className="slug-thinking-note">通常十幾秒到一分鐘。想好會列在這裡，點了才填進網址欄。</p>
        </div>
      )}

      {stopped && !thinking && <p className="field-hint" role="status">已停止。</p>}
      <ErrorNote message={thinking ? stop.error : (state.error ?? stop.error)} />

      {ideas !== null && !thinking && (
        <div className="slug-ideas">
          <p className="field-hint">{pickHint}</p>
          <div className="chips" role="group" aria-label="AI 建議的網址">
            {ideas.slugs.map((idea) => (
              <button
                key={idea}
                type="button"
                className="chip mono"
                data-active={slug === idea ? 'yes' : 'no'}
                aria-pressed={slug === idea}
                disabled={disabled}
                onClick={() => pick(idea)}
              >
                {slug === idea && <Icon name="check" size={12} />}
                {idea}
              </button>
            ))}
          </div>
          {ideas.dropped > 0 && (
            <p className="field-hint">另外 {ideas.dropped} 個格式不合格（要小寫英數與連字號），已經丟掉。</p>
          )}
        </div>
      )}
    </div>
  );
}
