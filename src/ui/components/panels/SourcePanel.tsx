import { useEffect, useState, useSyncExternalStore, type JSX } from 'react';
import { api, describeError } from '../../service/client.js';
import type { LoadedJob } from '../../service/types.js';
import { Icon } from '../../icons.js';
import { readString } from '../../lib/format.js';
import { PROVIDERS, loadProvider } from '../../lib/agent-tasks.js';
import { formatElapsed, useElapsedSeconds } from '../AgentProgress.js';
import {
  clearSlugSuggest,
  getSlugSuggest,
  startSlugSuggest,
  subscribeSlugSuggest,
} from '../../lib/slug-suggest-store.js';
import { ErrorNote, Field, Spinner, guardEdit, useAction } from './shared.js';
import { sourceTemplateData } from './template-data.js';

/**
 * 標題與網址片段。
 *
 * 正文不在這裡改：直接在文章上改（P5-T010）。以前這裡是一大格原始 HTML，對寫作者不友善。
 * 「渲染」留著：契約 §二 刻意保留 `SOURCE → RENDERED`，使用者可以完全不用 Agent。
 *
 * 日記的標題慣例是 YYYYMMDD（見 docs/specs/wordpress-site.md），所以給一個一鍵填入。
 * 長文與一般文章的網址欄旁有「建議網址」（D-026，P5-T026）：AI 給三個英文網址，**點了才填進欄位**，
 * 照原本的「儲存」存；絕不自動填、不自動存。
 *
 * **送出的是整份 templateData**，所以一定要帶上 `expectedContentHash`：那是這份
 * 表單的內容算出來的那一版。分類面板送的也是整份，兩邊撞在一起時要有人被擋下來，
 * 而不是誰晚到誰贏。
 */

function today(): string {
  const now = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
}

export function SourcePanel({
  job,
  refresh,
}: {
  job: LoadedJob;
  refresh: () => Promise<void>;
}): JSX.Element {
  const data = job.currentRevision?.templateData ?? null;
  const [title, setTitle] = useState(() => readString(data, 'title', job.title ?? ''));
  const [slug, setSlug] = useState(() => readString(data, 'slug'));
  const [body, setBody] = useState(() => readString(data, 'body', job.sourceText ?? ''));
  const save = useAction();
  const render = useAction();

  const revisionId = job.currentRevision?.id ?? 0;
  useEffect(() => {
    setTitle(readString(data, 'title', job.title ?? ''));
    setSlug(readString(data, 'slug'));
    setBody(readString(data, 'body', job.sourceText ?? ''));
    // 換了版本才重新灌值，否則使用者打到一半會被蓋掉。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revisionId]);

  const isDiary = job.target.contentType === 'diary';
  const titleDirty = title !== readString(data, 'title', job.title ?? '');
  const dirty =
    title !== readString(data, 'title', job.title ?? '') ||
    slug !== readString(data, 'slug') ||
    body !== readString(data, 'body', job.sourceText ?? '');

  // 表單的值是從這一版灌進來的，送出時就報這一版的 hash。
  const baseHash = job.currentRevision?.contentHash ?? null;

  const saveRevision = async (): Promise<void> => {
    await guardEdit(() =>
      api.createRevision(job.uuid, {
        origin: 'manual',
        // templateData 是整份取代，所以一定要把現有欄位（分類、tags…）帶上，
        // 否則儲存原稿會把分類清掉。網址片段清空時要拿掉舊的 slug 鍵（P5-T021）。
        templateData: sourceTemplateData(data, { title, body, slug }),
        sourceText: body,
        reason: '手動編輯原稿',
        ...(baseHash === null ? {} : { expectedContentHash: baseHash }),
      }),
    );
    // 存了（可能就是點了建議的那個）：建議收起來，要再看就再按一次。
    clearSlugSuggest(job.uuid);
  };

  return (
    <div className="stack">
      <Field label="標題" hint={isDiary ? '日記的慣例是 YYYYMMDD，跟網址片段相同。' : undefined}>
        <div className="row">
          <input
            className="input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={isDiary ? today() : '文章標題'}
          />
          {isDiary && (
            <button
              type="button"
              className="btn btn-quiet"
              onClick={() => {
                setTitle(today());
                setSlug(today());
              }}
            >
              用今天
            </button>
          )}
        </div>
      </Field>

      <Field label="網址片段" hint="留空的話由 WordPress 依標題產生。">
        <input
          className="input mono"
          value={slug}
          onChange={(event) => setSlug(event.target.value)}
          placeholder={isDiary ? today() : 'article-slug'}
        />
      </Field>

      {!isDiary && (
        <SlugSuggest
          job={job}
          refresh={refresh}
          slug={slug}
          titleDirty={titleDirty}
          pick={setSlug}
        />
      )}

      <ErrorNote message={save.error ?? render.error} />

      <div className="row row-end">
        <button
          type="button"
          className="btn btn-quiet"
          disabled={save.busy || !dirty}
          onClick={() =>
            void save.run(async () => {
              await saveRevision();
              await refresh();
            })
          }
        >
          {save.busy ? <Spinner /> : <Icon name="file-text" size={14} />}
          儲存
        </button>

        <button
          type="button"
          className="btn btn-primary"
          disabled={render.busy || body.trim().length === 0}
          onClick={() =>
            void render.run(async () => {
              if (dirty) await saveRevision();
              await api.render(job.uuid);
              await refresh();
            })
          }
        >
          {render.busy ? <Spinner /> : <Icon name="eye" size={14} />}
          渲染
        </button>
      </div>
    </div>
  );
}

/**
 * 「建議網址」（D-026，P5-T026）：跑一趟本機 Agent（使用者在「請 AI 看一遍」選單裡選的那家），
 * 讀**已存的**標題＋內文開頭，回三個英文網址。候選是按鈕，點了才填進網址欄（還沒存）；絕不自動填。
 *
 * 等待期間跟其他 Agent 動作一樣：計時器、停止、頂端長條（AgentBanner），不畫進度條（D-010）。
 * 標題改了還沒存時不給按：AI 看的是已存的那一版，送出去只會拿到舊標題的建議。
 */
function SlugSuggest({
  job,
  refresh,
  slug,
  titleDirty,
  pick,
}: {
  job: LoadedJob;
  refresh: () => Promise<void>;
  slug: string;
  titleDirty: boolean;
  pick: (slug: string) => void;
}): JSX.Element {
  // 請求與結果在模組層級（slug-suggest-store.ts）：跑的時候關掉抽屜，重開照樣接得回結果或失敗訊息。
  const state = useSyncExternalStore(subscribeSlugSuggest, () => getSlugSuggest(job.uuid));
  const stop = useAction();

  const run = job.agentRun;
  const runningHere = run?.status === 'running' && run.task === 'suggest-slug';
  const runningElsewhere = run?.status === 'running' && !runningHere;
  const thinking = state.running || runningHere;
  const seconds = useElapsedSeconds(runningHere ? run.startedAt : (state.startedAt ?? undefined), thinking);
  const provider = loadProvider();
  const providerLabel = PROVIDERS.find((option) => option.id === provider)?.label ?? provider;
  const canAsk = !thinking && !runningElsewhere && !titleDirty && job.currentRevision !== null;
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
        <button
          type="button"
          className="btn btn-quiet"
          disabled={!canAsk}
          onClick={ask}
          aria-describedby="slug-suggest-why"
        >
          {thinking ? <Spinner /> : <Icon name="sparkles" size={14} />}
          建議網址
        </button>
        {!thinking && (
          <span id="slug-suggest-why" className="field-hint">
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
          <p className="field-hint">點一個填進上面的網址欄，可以再改；還沒存，要按「儲存」。</p>
          <div className="chips" role="group" aria-label="AI 建議的網址">
            {ideas.slugs.map((idea) => (
              <button
                key={idea}
                type="button"
                className="chip mono"
                data-active={slug === idea ? 'yes' : 'no'}
                aria-pressed={slug === idea}
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
