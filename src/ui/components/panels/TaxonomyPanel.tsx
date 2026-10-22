import { useEffect, useState, type JSX } from 'react';
import { api, describeError } from '../../service/client.js';
import type { LoadedJob, Term } from '../../service/types.js';
import { Icon } from '../../icons.js';
import { matchTerms, termAddedNote } from '../../lib/term-match.js';
import { holdTaxonomy, type AddTermOutcome } from '../../lib/slug-save-store.js';
import { ErrorNote, Field, Spinner } from './shared.js';

/**
 * 分類項目。
 *
 * **發布時不自動建立項目**（plan.md D-004）：Agent 很容易生出「經濟」「經濟學」「經濟學思考」
 * 這種近義詞，自動建立幾個月後分類就變垃圾場。要新項目由使用者在這裡自己打字、看過站上名稱相近的
 * 既有項目、再按一次確認才建（D-050：一律可用，沒有設定檔開關）。同名的直接選既有的，不建第二個。
 * 從這裡建好（或選了既有的）就直接存到這篇（D-050 2026-10-22），不用再按「儲存分類」。
 *
 * **選取不放在這個元件裡**（P5-T051 跟進）：跟網址一樣記在 `lib/slug-save-store.ts`、以稿件為 key，
 * 由發布面板（PublishSheet）讀寫——選了沒存要擋發布，面板關掉再開、別處存了別的欄位都照樣擋。
 *
 * 長文用多選（tags）；日記與通用文章用單選（category）——這是模板 schema 的差別，
 * 不是這裡自己決定的。
 */

export function TaxonomyPanel({
  job,
  selected,
  onChange,
  dirty,
  saving,
  error,
  onSave,
  onAddTerm,
  editingLock,
}: {
  job: LoadedJob;
  /** 畫面上的選取（沒存的草稿或已存的）。 */
  selected: readonly string[];
  onChange: (next: readonly string[]) => void;
  dirty: boolean;
  saving: boolean;
  error: string | null;
  /** 存這份選取到這篇（建一版新內容）；回傳失敗原因，成功是 null。 */
  onSave: (selection: readonly string[]) => Promise<string | null>;
  /** 把項目加進最新的選取（發布面板讀 store 的最新值，不用這裡的快照）；不在打字模式才直接存。 */
  onAddTerm: (name: string) => Promise<AddTermOutcome>;
  /**
   * 這篇在打字模式時講的原因（PR #39 跟進，PublishSheet 用 markEditing 的登記判斷）；不是 null 就鎖住所有會建新版本的
   * 按鈕：儲存分類、建立（確定建立）、選這個、相近項目。點選 chip 只改沒存的選取，照常可以。
   */
  editingLock: string | null;
}): JSX.Element {
  const taxonomy = job.target.taxonomy;
  const multiple = job.target.contentType === 'longform';

  const [terms, setTerms] = useState<Term[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  /** 按了「建立」、等使用者在行內確認（D-050：建在正式站上，先講清楚再建）。 */
  const [confirming, setConfirming] = useState(false);
  /** 建立／選上之後的結果：講「已建立」或「站上已有」，存失敗講還沒套到這篇。 */
  const [added, setAdded] = useState<{ tone: 'good' | 'warn' | 'bad'; text: string } | null>(null);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

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
  // 建立、套用、存的期間鎖住所有選取控制（PR #39 Codex 第一輪）：期間點的會被存的那一份蓋掉。
  // `saving` 來自發布面板，含 holdTaxonomy 的整段，面板關掉再開也一樣鎖。
  const busy = createBusy || saving;
  const locked = editingLock !== null;
  const known = new Set((terms ?? []).map((term) => term.name));
  const unknown = selected.filter((name) => terms !== null && !known.has(name));

  const toggle = (name: string): void => {
    if (busy) return;
    setAdded(null);
    if (selected.includes(name)) onChange(selected.filter((item) => item !== name));
    else onChange(multiple ? [...selected, name] : [name]);
  };

  const trimmedName = newName.trim();
  // 用已載入的清單在前端比對（不另打 WordPress）；清單還沒載入時先不給建，免得漏看相近的。
  const matches = matchTerms(trimmedName, terms ?? []);
  const termsLoading = terms === null && !termsUnavailable;

  const editName = (value: string): void => {
    setNewName(value);
    setConfirming(false);
    setAdded(null);
    setCreateError(null);
  };

  /**
   * 選上並直接存到這篇（D-050 2026-10-22）。整段（含建立請求）包在 holdTaxonomy 裡：請求送出前就擋發布，
   * 跑完才放開（PR #39 Codex 第一輪）。存失敗：選取留著（草稿），講清楚、可以按「儲存分類」重試。
   */
  const runAdd = (obtain: () => Promise<{ term: Term; created: boolean }>): void => {
    if (busy || locked) return;
    setCreateBusy(true);
    setCreateError(null);
    setAdded(null);
    void holdTaxonomy(job.uuid, async () => {
      let got: { term: Term; created: boolean };
      try {
        got = await obtain();
      } catch (cause) {
        setCreateError(describeError(cause));
        return;
      }
      const { term, created } = got;
      setTerms((list) => {
        const now = list ?? [];
        return now.some((entry) => entry.id === term.id) ? now : [...now, term];
      });
      setNewName('');
      setConfirming(false);
      const outcome = await onAddTerm(term.name);
      setAdded(
        termAddedNote({
          name: term.name,
          created,
          saveError: outcome.kind === 'failed' ? outcome.error : null,
          deferred: outcome.kind === 'deferred',
        }),
      );
    }).finally(() => setCreateBusy(false));
  };

  const chooseExisting = (term: Term): void => runAdd(async () => ({ term, created: false }));

  // 後端 resolveTerms 遇到同名的既有項目會直接回它（200，created: false），不會建第二個。
  const createNow = (): void => runAdd(() => api.createTerm(taxonomy, trimmedName));

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
              要分類的話，在下面建立第一個項目。
            </span>
          )}
          {terms?.map((term) => (
            <button
              key={term.id}
              type="button"
              className="chip"
              data-active={selected.includes(term.name) ? 'yes' : 'no'}
              aria-pressed={selected.includes(term.name)}
              disabled={busy}
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
                disabled={busy}
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
            disabled={busy}
            onChange={(event) =>
              onChange(
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
            <div className="row">
              <input
                className="input"
                value={newName}
                onChange={(event) => editName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && trimmedName.length > 0 && !termsLoading && !busy && !locked) {
                    event.preventDefault();
                    if (matches.exact) chooseExisting(matches.exact);
                    else setConfirming(true);
                  }
                }}
                placeholder="新分類項目名稱"
                aria-label="新分類項目名稱"
                maxLength={120}
                disabled={busy}
              />
              <button
                type="button"
                className="btn btn-quiet"
                disabled={busy || locked || trimmedName.length === 0 || termsLoading || confirming}
                onClick={() => (matches.exact ? chooseExisting(matches.exact) : setConfirming(true))}
              >
                <Icon name={matches.exact ? 'check' : 'plus'} size={14} />
                {matches.exact ? '選這個' : '建立'}
              </button>
            </div>

            {matches.exact && (
              <p className="note note-info">
                <Icon name="check" size={14} />
                <span>站上已經有「{matches.exact.name}」，按「選這個」直接用它，不會再建一個。</span>
              </p>
            )}

            {!matches.exact && matches.similar.length > 0 && (
              <div className="term-create-group">
                <span className="field-hint">站上有名稱相近的項目，是這個嗎？點一下直接選：</span>
                <div className="chips">
                  {matches.similar.map((term) => (
                    <button key={term.id} type="button" className="chip" disabled={busy || locked} onClick={() => chooseExisting(term)}>
                      {term.name}
                      {term.count !== undefined && (
                        <span className="chip-count mono" title={`${term.count} 篇`}>
                          {term.count}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {termsUnavailable && trimmedName.length > 0 && (
              <p className="field-hint">讀不到站上的既有項目，沒辦法比對相近的名稱；同名的話會直接用既有的。</p>
            )}

            {confirming && !matches.exact && (
              <div className="note note-warn" role="group" aria-label="確認建立分類項目">
                <Icon name="alert" size={14} />
                <div className="term-create-group">
                  <span>
                    會直接在正式站的 {taxonomy} 建立「{trimmedName}」，之後每一篇文章都選得到；
                    發布台裡不能刪除或改名。
                    {matches.similar.length > 0 ? '上面有名稱相近的既有項目，確定都不是你要的？' : ''}
                  </span>
                  <div className="row">
                    <button type="button" className="btn btn-primary" disabled={busy || locked} onClick={createNow}>
                      {busy ? <Spinner /> : <Icon name="plus" size={14} />}
                      確定建立
                    </button>
                    <button
                      type="button"
                      className="btn btn-quiet"
                      disabled={busy}
                      onClick={() => setConfirming(false)}
                    >
                      先不要
                    </button>
                  </div>
                </div>
              </div>
            )}

            {added && (
              <p className={`note note-${added.tone}`} role={added.tone === 'good' ? 'status' : 'alert'}>
                <Icon name={added.tone === 'good' ? 'check' : 'alert'} size={14} />
                <span>{added.text}</span>
              </p>
            )}

            <ErrorNote message={createError === null ? null : `沒有建立：${createError}`} />
          </div>
        )}
      </div>

      {/* 建立後自動存失敗時，上面那行已經講了；這裡只講「儲存分類」按鈕自己的失敗，不重複。 */}
      <ErrorNote message={added?.tone === 'bad' ? null : error} />

      {editingLock !== null && (
        <p className="note note-warn">
          <Icon name="alert" size={14} />
          <span>{editingLock}</span>
        </p>
      )}

      <div className="row row-end">
        <button
          type="button"
          className="btn btn-primary"
          disabled={saving || createBusy || !dirty || locked}
          title={editingLock ?? undefined}
          onClick={() => {
            setAdded(null);
            void onSave(selected);
          }}
        >
          {saving ? <Spinner /> : <Icon name="tag" size={14} />}
          儲存分類
        </button>
      </div>
    </div>
  );
}
