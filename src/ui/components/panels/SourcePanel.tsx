import { useEffect, useState, type JSX } from 'react';
import { api } from '../../service/client.js';
import type { LoadedJob } from '../../service/types.js';
import { Icon } from '../../icons.js';
import { readString } from '../../lib/format.js';
import { clearSlugSuggest } from '../../lib/slug-suggest-store.js';
import { SlugSuggest } from '../SlugSuggest.js';
import { ErrorNote, Field, Spinner, guardEdit, useAction } from './shared.js';
import { sourceTemplateData } from './template-data.js';
import { checkPlainTitle } from '../../../contract/plain-title.js';

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
  // 跟在文章上改標題同一條規則（P5-T029）：一行、非空。改過才檢查，舊資料不擋。
  const titleCheck = checkPlainTitle(title, { diary: isDiary, maxLength: job.template.titleMaxLength });
  const titleProblem = titleDirty && !titleCheck.ok ? titleCheck.message : null;
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
          pickHint="點一個填進上面的網址欄，可以再改；還沒存，要按「儲存」。"
        />
      )}

      <ErrorNote message={titleProblem ?? save.error ?? render.error} />

      <div className="row row-end">
        <button
          type="button"
          className="btn btn-quiet"
          disabled={save.busy || !dirty || titleProblem !== null}
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
          disabled={render.busy || body.trim().length === 0 || titleProblem !== null}
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
