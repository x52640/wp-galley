import { useEffect, useMemo, useState, type JSX } from 'react';
import { api, describeError } from '../../service/client.js';
import type { LoadedJob, Term } from '../../service/types.js';
import { Icon } from '../../icons.js';
import { readString, readStringArray } from '../../lib/format.js';
import { useConfirm } from '../ConfirmDialog.js';
import { ErrorNote, Field, Spinner, guardEdit, useAction } from './shared.js';

/**
 * 分類項目。
 *
 * **預設只能選既有的項目。** 理由寫在 docs/SITE-FINDINGS.md：Agent 很容易生出
 * 「經濟」「經濟學」「經濟學思考」這種近義詞，自動建立幾個月後分類就變垃圾場。
 * 所以要建新項目得使用者自己打字、自己按確認，而且發布目標的
 * `allowCreateTerms` 還要是開的。
 *
 * 長文用多選（tags），日記用單選（category）——這是兩個模板 schema 的差別，
 * 不是這裡自己決定的。
 */

export function TaxonomyPanel({
  job,
  refresh,
}: {
  job: LoadedJob;
  refresh: () => Promise<void>;
}): JSX.Element {
  const taxonomy = job.target.taxonomy;
  const multiple = job.target.contentType !== 'diary';
  const dataKey = multiple ? 'tags' : 'category';

  const current = useMemo(
    () =>
      multiple
        ? readStringArray(job.currentRevision?.templateData, 'tags')
        : [readString(job.currentRevision?.templateData, 'category')].filter((v) => v !== ''),
    [job.currentRevision, multiple],
  );

  const [terms, setTerms] = useState<Term[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>(current);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const save = useAction();
  const create = useAction();
  const confirm = useConfirm();

  useEffect(() => setSelected(current), [current]);

  useEffect(() => {
    if (taxonomy === null) return;
    let cancelled = false;
    setTerms(null);
    setLoadError(null);
    api
      .listTerms(taxonomy)
      .then((list) => {
        if (cancelled) return;
        setTerms(list);
        setLoadError(null);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setLoadError(describeError(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [taxonomy]);

  if (taxonomy === null) {
    return <p className="empty-line">這個內容類型沒有掛分類法，不用選分類。</p>;
  }

  // 後端還沒有 /api/wordpress/terms 時退回手動輸入，不要讓整個步驟卡死。
  const termsUnavailable = loadError !== null;
  const known = new Set((terms ?? []).map((term) => term.name));
  const unknown = selected.filter((name) => terms !== null && !known.has(name));
  const dirty =
    selected.length !== current.length || selected.some((name, index) => name !== current[index]);

  const toggle = (name: string): void => {
    setSelected((now) => {
      if (now.includes(name)) return now.filter((item) => item !== name);
      return multiple ? [...now, name] : [name];
    });
  };

  return (
    <div className="stack">
      <Field
        label={`分類法 ${taxonomy}`}
        hint={
          terms !== null && terms.length === 0
            ? undefined
            : multiple
              ? '可以複選。'
              : '只能選一個。'
        }
      >
        <div className="chips">
          {terms === null && !loadError && (
            <span className="field-hint">
              <Spinner /> 讀取分類項目…
            </span>
          )}
          {/*
            一個項目都沒有是**正常的**，不是錯誤：站上的 diary-category 現在就是空的。
            所以這裡講的是「可以直接發布」，不是紅字警告。
          */}
          {terms?.length === 0 && (
            <span className="field-hint">
              {taxonomy} 目前一個項目都沒有，不選分類也能發布。
              {job.target.allowCreateTerms === true ? '要分類的話，在下面建立第一個項目。' : ''}
            </span>
          )}
          {terms?.map((term) => (
            <button
              key={term.id}
              type="button"
              className="chip"
              data-active={selected.includes(term.name) ? 'yes' : 'no'}
              aria-pressed={selected.includes(term.name)}
              onClick={() => toggle(term.name)}
            >
              {selected.includes(term.name) && <Icon name="check" size={12} />}
              {term.name}
              {term.count !== undefined && (
                <span className="chip-count mono" title={`${term.count} 篇`}>
                  {term.count}
                </span>
              )}
            </button>
          ))}
          {/*
            選到的名稱站上找不到（舊資料或 Agent 生的）也要看得見、按得掉，
            否則使用者只能看著警告卻沒有地方改。
          */}
          {!termsUnavailable &&
            unknown.map((name) => (
              <button
                key={`unknown-${name}`}
                type="button"
                className="chip"
                data-active="yes"
                data-unknown="yes"
                aria-pressed={true}
                onClick={() => toggle(name)}
              >
                <Icon name="alert" size={12} />
                {name}
                <span className="sr-only">（站上沒有這個項目，按一下取消選取）</span>
              </button>
            ))}
        </div>
      </Field>

      {termsUnavailable && (
        <p className="note note-warn">
          <Icon name="alert" size={14} />
          <span>
            讀不到 {taxonomy} 的既有項目（{loadError}）。可以先手動輸入名稱，
            發布時對不上的名稱會原樣回報，不會自動建立。
          </span>
        </p>
      )}

      {termsUnavailable && (
        <Field label="分類項目名稱" hint={multiple ? '多個名稱用頓號「、」分隔。' : '只填一個。'}>
          <input
            className="input"
            value={selected.join('、')}
            onChange={(event) =>
              setSelected(
                event.target.value
                  .split(/[、,，]/)
                  .map((name) => name.trim())
                  .filter((name) => name.length > 0)
                  .slice(0, multiple ? 10 : 1),
              )
            }
            placeholder="隨筆"
          />
        </Field>
      )}

      {unknown.length > 0 && !termsUnavailable && (
        <p className="note note-warn">
          <Icon name="alert" size={14} />
          <span>站上沒有「{unknown.join('」「')}」這個分類項目。改選既有的，或在下面明確建立。</span>
        </p>
      )}

      <div className="disclosure">
        <button type="button" className="disclosure-toggle" onClick={() => setCreating((v) => !v)}>
          <Icon name={creating ? 'chevron-down' : 'chevron-right'} size={13} />
          建立新的分類項目
        </button>
        {creating && (
          <div className="disclosure-body">
            {job.target.allowCreateTerms !== true ? (
              <p className="note note-warn">
                <Icon name="alert" size={14} />
                <span>
                  這個發布目標關閉了「建立分類項目」。要開啟，把 config/publish-targets.json 裡
                  {job.target.key} 的 <code>allowCreateTerms</code> 改成 true，重啟後端。
                </span>
              </p>
            ) : (
              <>
                <p className="field-hint">
                  新項目會直接建在正式站上，之後每一篇文章都選得到。先確認站上沒有意思相近的既有項目。
                </p>
                <div className="row">
                  <input
                    className="input"
                    value={newName}
                    onChange={(event) => setNewName(event.target.value)}
                    placeholder="分類項目名稱"
                  />
                  <button
                    type="button"
                    className="btn btn-quiet"
                    disabled={create.busy || newName.trim().length === 0}
                    onClick={() =>
                      confirm({
                        title: `在站上建立「${newName.trim()}」？`,
                        danger: false,
                        body: (
                          <p>
                            這會在 {taxonomy} 底下建立一個新的分類項目，之後無法在這裡刪除。
                            如果站上已經有意思相近的項目，請改選那一個。
                          </p>
                        ),
                        confirmLabel: '建立',
                        onConfirm: async () => {
                          const term = await api.createTerm(taxonomy, newName.trim());
                          setTerms((list) => [...(list ?? []), term]);
                          setSelected((now) => (multiple ? [...now, term.name] : [term.name]));
                          setNewName('');
                        },
                      })
                    }
                  >
                    <Icon name="plus" size={14} />
                    建立
                  </button>
                </div>
                <ErrorNote message={create.error} />
              </>
            )}
          </div>
        )}
      </div>

      <ErrorNote message={save.error} />

      <div className="row row-end">
        <button
          type="button"
          className="btn btn-primary"
          disabled={save.busy || !dirty}
          onClick={() =>
            void save.run(async () => {
              const value = multiple ? selected : (selected[0] ?? '');
              const baseHash = job.currentRevision?.contentHash ?? null;
              // templateData 是整份取代，現有欄位一定要帶上，否則會把正文清掉。
              // 帶上 expectedContentHash：這份欄位是從哪一版抄來的，就報哪一版；
              // 中間被別人改過的話寧可被擋下來，也不要把對方的修改蓋掉。
              await guardEdit(() =>
                api.createRevision(job.uuid, {
                  origin: 'manual',
                  templateData: { ...(job.currentRevision?.templateData ?? {}), [dataKey]: value },
                  reason: '修改分類',
                  ...(baseHash === null ? {} : { expectedContentHash: baseHash }),
                }),
              );
              await refresh();
            })
          }
        >
          {save.busy ? <Spinner /> : <Icon name="tag" size={14} />}
          儲存分類
        </button>
      </div>
    </div>
  );
}
