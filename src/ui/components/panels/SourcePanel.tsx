import { useEffect, useState, type JSX } from 'react';
import { api } from '../../service/client.js';
import type { LoadedJob } from '../../service/types.js';
import { Icon } from '../../icons.js';
import { readString } from '../../lib/format.js';
import { ErrorNote, Field, Spinner, guardEdit, useAction } from './shared.js';

/**
 * 原稿。
 *
 * 契約 §二 刻意保留 `SOURCE → RENDERED`：使用者可以完全不用 Agent，貼完稿直接
 * 渲染發布。所以這張卡片必須自成一條完整的路，不能只是「等 Agent 的地方」。
 *
 * 日記的標題慣例是 YYYYMMDD（見 docs/specs/wordpress-site.md），所以給一個一鍵填入。
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
        // 否則儲存原稿會把分類清掉。
        templateData: { ...(data ?? {}), title, body, ...(slug === '' ? {} : { slug }) },
        sourceText: body,
        reason: '手動編輯原稿',
        ...(baseHash === null ? {} : { expectedContentHash: baseHash }),
      }),
    );
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

      <Field label="正文" hint="純文字或 HTML 都可以。渲染時會清成模板允許的標籤，多餘的會被移除。">
        <textarea
          className="input textarea"
          rows={12}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="把稿子貼進來…"
        />
      </Field>

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
          儲存原稿
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
