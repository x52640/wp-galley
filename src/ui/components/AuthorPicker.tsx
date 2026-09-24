import { useEffect, useState, type JSX } from 'react';
import { api, describeError } from '../service/client.js';
import type { AuthorsResponse } from '../service/types.js';
import { Icon } from '../icons.js';
import { ErrorNote, Spinner, useAction } from './panels/shared.js';

/**
 * 發布面板裡的「作者：某某」（P5-T024，D-024）。
 *
 * 作者是**發布選項**，跟「存成草稿／馬上公開」一樣，不是核准的內容：改它不用重新核准。
 * 常做的事要一鍵：設好預設作者之後，這一行只是顯示，什麼都不用點。
 * - 還沒設預設：清單直接攤開，點一個名字、按「設為預設」，之後每篇自動用。
 * - 這一篇想用別人：按「改」，點名字就好，只影響這一篇。
 * - 帳號只能用自己（Author 角色）：不給選，講清楚要去 WordPress 把帳號升成 Editor——
 *   不要等按了發布才失敗。
 */

export interface AuthorsState {
  readonly data: AuthorsResponse | null;
  readonly error: string | null;
  setData(data: AuthorsResponse): void;
}

export function useAuthors(): AuthorsState {
  const [data, setData] = useState<AuthorsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    api.listAuthors().then(
      (result) => alive && setData(result),
      (cause: unknown) => alive && setError(describeError(cause)),
    );
    return () => {
      alive = false;
    };
  }, []);
  return { data, error, setData };
}

/**
 * 讀不到作者清單而且有預設作者：後端會擋下發布（不讓作者靜默變成發布台的帳號），面板先擋、講原因。
 * 畫面自己的請求失敗（`error`）時不知道有沒有預設，不擋，交給後端判斷。
 */
export function authorBlocker(state: AuthorsState, chosen: number | null): string | null {
  const data = state.data;
  if (data === null) return null;
  if (data.listUnavailable && (chosen !== null || data.defaultAuthorId !== null)) {
    return '讀不到站上的作者清單，現在發布作者會被記錯，稍後再試。';
  }
  if (chosen === null && staleDefault(data)) return '預設作者不在這個站上：先在上面選作者。';
  return null;
}

/** 預設作者設了、卻不在這個站可選的名單裡（換過站）。這時沒選人就不能發，不默默改用 AI 帳號。 */
export function staleDefault(data: AuthorsResponse | null): boolean {
  return data !== null && data.canChooseOthers && data.defaultAuthorId !== null && data.defaultAuthor === null;
}

export function AuthorPicker({
  state,
  chosen,
  onChoose,
}: {
  state: AuthorsState;
  /** 這一篇另外選的人；null＝用預設。 */
  chosen: number | null;
  onChoose: (authorId: number | null) => void;
}): JSX.Element {
  const { data, error } = state;
  const [open, setOpen] = useState<boolean | null>(null);
  const save = useAction();

  if (error !== null && data === null) {
    return (
      <p className="field-hint">
        讀不到作者清單（{error}）。有設預設作者的話，發布會被擋下（免得作者被記成發布台的帳號），稍後再試；
        沒設的話，作者會是發布台的帳號。
      </p>
    );
  }
  if (data === null) {
    return (
      <div className="p-author">
        <Icon name="user" size={16} />
        <span className="p-author-main dim">
          <Spinner /> 讀取作者…
        </span>
      </div>
    );
  }

  const effectiveId = chosen ?? data.defaultAuthor?.id ?? null;
  const effective = data.authors.find((author) => author.id === effectiveId) ?? null;
  const noDefault = data.defaultAuthorId === null || staleDefault(data);
  // 沒設預設時直接攤開：點一下名字＋「設為預設」就好，不用先找「改」在哪。
  const expanded = data.canChooseOthers && (open ?? noDefault);
  const oneOff = chosen !== null && chosen !== data.defaultAuthorId && !noDefault;
  const canSetDefault = data.canChooseOthers && effectiveId !== null && effectiveId !== data.defaultAuthorId;

  const setDefault = (): void =>
    void save.run(async () => {
      if (effectiveId === null) return;
      state.setData(await api.setDefaultAuthor(effectiveId));
      onChoose(null);
      setOpen(false);
    });

  return (
    <>
      <div className="p-author">
        <Icon name="user" size={16} />
        <span className="p-author-main">
          <span>作者：</span>
          {effective === null && staleDefault(data) ? (
            <b>還沒選</b>
          ) : (
            <>
              <b>{effective?.name ?? data.currentUser.name}</b>
              {effective === null && <span className="dim">（發布台的帳號）</span>}
            </>
          )}
          {effective !== null && effective.id === data.defaultAuthorId && !oneOff && (
            <span className="p-author-tag">預設</span>
          )}
          {oneOff && (
            <span className="p-author-tag" data-tone="accent">
              只有這一篇
            </span>
          )}
        </span>
        {data.canChooseOthers && (
          <button
            type="button"
            className="btn btn-quiet btn-tiny"
            aria-expanded={expanded}
            onClick={() => setOpen(!expanded)}
          >
            {expanded ? '收起' : '改'}
          </button>
        )}
      </div>

      {expanded && (
        <div className="p-author-list" role="radiogroup" aria-label="作者">
          {data.authors.map((author) => (
            <button
              key={author.id}
              type="button"
              role="radio"
              aria-checked={author.id === effectiveId}
              className="p-author-opt"
              data-active={author.id === effectiveId ? 'yes' : 'no'}
              onClick={() => onChoose(author.id === data.defaultAuthorId && !staleDefault(data) ? null : author.id)}
            >
              {author.name}
              {author.id === data.currentUser.id && <span>發布台的帳號</span>}
            </button>
          ))}
        </div>
      )}

      {data.notice !== null && (
        <p className="note note-warn">
          <Icon name="alert" size={14} />
          <span>{data.notice}</span>
        </p>
      )}

      {data.canChooseOthers && data.defaultAuthorId === null && (
        <p className="field-hint">
          還沒設預設作者：沒選的話，WordPress 會把作者記成發布台的帳號（{data.currentUser.name}）。
          選一次、按「設為預設」，之後每篇自動用。
        </p>
      )}

      {canSetDefault && (
        <div className="p-author-actions">
          <button type="button" className="btn btn-quiet btn-tiny" disabled={save.busy} onClick={setDefault}>
            {save.busy ? <Spinner /> : <Icon name="star" size={13} />}
            設為預設
          </button>
          <span className="field-hint">
            {oneOff ? '不按也行：只有這一篇用他，下一篇回到預設。' : '以後每篇都用他。'}
          </span>
        </div>
      )}
      <ErrorNote message={save.error} />
    </>
  );
}
