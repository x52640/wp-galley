import { useEffect, useState, type JSX } from 'react';
import { api, describeError } from '../service/client.js';
import type { PublishTargetSummary } from '../service/types.js';
import { Icon } from '../icons.js';
import { NO_TARGETS_MESSAGE, typeLabel } from './JobList.js';
import { ErrorNote, Field, Spinner, useAction } from './panels/shared.js';

/**
 * 新稿件：選類型、貼原稿，其他都等進了工作區再說。
 *
 * 從總覽按「新長文／新日記」進來時類型已經定了，不再問；從拖放或貼上進來時文字
 * 已經在了，只差一個類型。**類型決定發到哪裡**，所以選完就寫出來，不讓人猜。
 */

function today(): string {
  const now = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
}

/** 第一行當標題：常見的稿子第一行就是標題，太長的不算。 */
function firstLineTitle(text: string): string {
  const line = text.split('\n').find((row) => row.trim().length > 0)?.trim() ?? '';
  return line.length > 0 && line.length <= 60 ? line : '';
}

export function NewJob({
  presetTarget,
  initialText,
  onCreated,
  onCancel,
}: {
  /** 從「新長文／新日記」進來時帶的 target key。 */
  presetTarget?: string | undefined;
  /** 從拖放或貼上進來時帶的原稿。 */
  initialText?: string | undefined;
  onCreated: (uuid: string) => void;
  onCancel: () => void;
}): JSX.Element {
  const [targets, setTargets] = useState<PublishTargetSummary[] | null>(null);
  const [targetKey, setTargetKey] = useState<string | null>(presetTarget ?? null);
  const [source, setSource] = useState(initialText ?? '');
  const [title, setTitle] = useState(() => firstLineTitle(initialText ?? ''));
  const [loadError, setLoadError] = useState<string | null>(null);
  const create = useAction();

  useEffect(() => {
    let cancelled = false;
    api
      .listTargets()
      .then((list) => {
        if (cancelled) return;
        setTargets(list);
        // 只有一種類型就不用問了。
        if (list.length === 1) setTargetKey((current) => current ?? list[0]?.key ?? null);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setLoadError(describeError(cause));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const target = targets?.find((item) => item.key === targetKey) ?? null;
  const isDiary = target?.contentType === 'diary';
  const locked = presetTarget !== undefined && target !== null;
  const chars = source.replace(/\s/g, '').length;

  return (
    <div className="b0">
      <header className="appbar">
        <button type="button" className="btn btn-quiet btn-tiny" onClick={onCancel}>
          <Icon name="arrow-left" size={14} />
          全部稿件
        </button>
      </header>

      <main className="compose">
        <h1 className="compose-title">{locked ? `新${typeLabel(target.contentType, target.postType)}` : '新稿件'}</h1>

        <ErrorNote message={loadError} />

        {!locked && (
          <div className="field">
            <span className="field-label">類型</span>
            <div className="type-cards" role="radiogroup" aria-label="類型">
              {targets === null && !loadError && <span className="field-hint">讀取發布目標…</span>}
              {targets?.length === 0 && (
                <p className="note note-warn" role="alert">
                  <Icon name="alert" size={14} />
                  <span>{NO_TARGETS_MESSAGE}</span>
                </p>
              )}
              {targets?.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  role="radio"
                  aria-checked={targetKey === item.key}
                  className="type-card"
                  data-active={targetKey === item.key ? 'yes' : 'no'}
                  onClick={() => setTargetKey(item.key)}
                >
                  <span className="type-card-name">{typeLabel(item.contentType, item.postType)}</span>
                  <span className="type-card-note">
                    發到「{item.displayName}」{item.requireFeaturedImage ? '・要有封面圖' : ''}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {target && (
          <p className="compose-dest">
            <Icon name="globe" size={14} />
            會發到「{target.displayName}」，WordPress 裡的 <span className="mono">{target.postType}</span>
          </p>
        )}

        <Field label="標題" hint={isDiary ? '日記的慣例是 YYYYMMDD。' : '留空的話進去再補。'}>
          <div className="row">
            <input
              className="input input-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={isDiary ? today() : '文章標題'}
            />
            {isDiary && (
              <button type="button" className="btn btn-quiet" onClick={() => setTitle(today())}>
                用今天
              </button>
            )}
          </div>
        </Field>

        <Field label={`內文${chars > 0 ? `・${chars.toLocaleString()} 字` : ''}`} hint="純文字或 HTML 都可以。">
          <textarea
            className="input textarea compose-body"
            rows={16}
            value={source}
            onChange={(event) => setSource(event.target.value)}
            placeholder="把稿子貼進來…"
          />
        </Field>

        <ErrorNote message={create.error} />

        <div className="compose-actions">
          <button type="button" className="btn btn-quiet" onClick={onCancel} disabled={create.busy}>
            取消
          </button>
          <button
            type="button"
            className="btn btn-primary btn-big"
            disabled={create.busy || targetKey === null || source.trim().length === 0}
            onClick={() =>
              void create.run(async () => {
                if (targetKey === null) return;
                const result = await api.createJob({
                  targetKey,
                  sourceText: source,
                  ...(title.trim() === '' ? {} : { title: title.trim() }),
                });
                onCreated(result.uuid);
              })
            }
          >
            建立並打開
            {create.busy ? <Spinner /> : <Icon name="chevron-right" size={16} />}
          </button>
        </div>
        {targetKey === null && targets !== null && targets.length > 1 && (
          <p className="field-hint compose-why">先選類型：它決定這篇會發到網站的哪個地方。</p>
        )}
      </main>
    </div>
  );
}
