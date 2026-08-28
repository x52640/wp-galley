import { useEffect, useState, type JSX } from 'react';
import { api, describeError } from '../service/client.js';
import type { JobTarget } from '../service/types.js';
import { Icon } from '../icons.js';
import { ErrorNote, Field, Spinner, useAction } from './panels/shared.js';

/** 新增稿件：選發布目標、貼原稿。其他都等進了工作區再說。 */

function today(): string {
  const now = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
}

export function NewJob({
  onCreated,
  onCancel,
}: {
  onCreated: (uuid: string) => void;
  onCancel: () => void;
}): JSX.Element {
  const [targets, setTargets] = useState<JobTarget[] | null>(null);
  const [targetKey, setTargetKey] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [source, setSource] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const create = useAction();

  useEffect(() => {
    let cancelled = false;
    api
      .listTargets()
      .then((list) => {
        if (cancelled) return;
        setTargets(list);
        setTargetKey((current) => current ?? list[0]?.key ?? null);
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

  return (
    <div className="new-screen">
      <header className="list-head">
        <div>
          <button type="button" className="btn btn-quiet btn-tiny" onClick={onCancel}>
            <Icon name="arrow-left" size={14} />
            全部稿件
          </button>
          <h1 className="list-title">新增稿件</h1>
        </div>
      </header>

      <ErrorNote message={loadError} />

      <div className="new-form">
        <Field label="發布到哪裡">
          <div className="target-grid">
            {targets === null && !loadError && <span className="field-hint">讀取發布目標…</span>}
            {targets?.map((item) => (
              <button
                key={item.key}
                type="button"
                className="target-card"
                data-active={targetKey === item.key ? 'yes' : 'no'}
                aria-pressed={targetKey === item.key}
                onClick={() => setTargetKey(item.key)}
              >
                <span className="target-name">{item.displayName}</span>
                <span className="target-meta mono">{item.key}</span>
                <span className="target-note">
                  {item.requireFeaturedImage ? '需要精選圖片' : '不需要精選圖片'}
                  {item.taxonomy ? `・${item.taxonomy}` : ''}
                </span>
              </button>
            ))}
          </div>
        </Field>

        <Field
          label="標題"
          hint={isDiary ? '日記的慣例是 YYYYMMDD。' : '留空的話進工作區再補。'}
        >
          <div className="row">
            <input
              className="input"
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

        <Field label="原稿" hint="純文字或 HTML 都可以。之後可以交給 Agent 校稿，也可以直接渲染發布。">
          <textarea
            className="input textarea"
            rows={14}
            value={source}
            onChange={(event) => setSource(event.target.value)}
            placeholder="把稿子貼進來…"
          />
        </Field>

        <ErrorNote message={create.error} />

        <div className="row row-end">
          <button type="button" className="btn btn-quiet" onClick={onCancel} disabled={create.busy}>
            取消
          </button>
          <button
            type="button"
            className="btn btn-primary"
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
            {create.busy ? <Spinner /> : <Icon name="plus" size={14} />}
            建立稿件
          </button>
        </div>
      </div>
    </div>
  );
}
