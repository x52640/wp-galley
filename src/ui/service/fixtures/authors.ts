/** 作者（對應後端 `service/authors.ts`）。 */

import type { AuthorOption, AuthorsResponse, PublisherApi } from '../types.js';
import { clone, delay } from './context.js';

// --- 作者（P5-T024）------------------------------------------------------------
//
// `?fixtures=1&authors=…` 切換情境：
// - 不給：站上有使用者本人與 AI 帳號，還沒設預設作者（第一次用的樣子）
// - `default`：已經設好預設作者＝本人（之後每一篇的樣子）
// - `only-self`：帳號是 Author，只能用自己
// - `stale`：預設作者不在這個站（換過站）
// - `unavailable`：讀不到站上的作者清單（安全外掛擋了），預設作者是本人 → 發布被擋

const FIXTURE_AUTHORS: AuthorOption[] = [
  { id: 2, name: 'Remus' },
  { id: 7, name: 'AI Romulus' },
  { id: 9, name: '小編阿青' },
];
const FIXTURE_ME: AuthorOption = { id: 7, name: 'AI Romulus' };

function authorScenario(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('authors');
}

let fixtureDefaultAuthorId: number | null = (() => {
  const scenario = authorScenario();
  if (scenario === 'default') return 2;
  if (scenario === 'stale') return 42;
  if (scenario === 'unavailable') return 2;
  return null;
})();

export function fixtureAuthors(): AuthorsResponse {
  if (authorScenario() === 'unavailable') {
    return clone({
      authors: [FIXTURE_ME],
      currentUser: FIXTURE_ME,
      canChooseOthers: false,
      defaultAuthorId: fixtureDefaultAuthorId,
      defaultAuthor: null,
      notice:
        '讀不到站上的作者清單：站上不讓這個帳號列出使用者（HTTP 403），常見原因是安全外掛擋了 /wp/v2/users。' +
        '有設預設作者，所以現在發布會被擋下（免得作者被記成發布台的帳號），稍後再試。',
      listUnavailable: true,
    });
  }
  const onlySelf = authorScenario() === 'only-self';
  const authors = onlySelf ? [FIXTURE_ME] : FIXTURE_AUTHORS;
  const defaultAuthor = authors.find((author) => author.id === fixtureDefaultAuthorId) ?? null;
  const notice = onlySelf
    ? '這個帳號只能用自己當作者，要改作者請在 WordPress 把它升成 Editor'
    : fixtureDefaultAuthorId !== null && defaultAuthor === null
      ? `預設作者（第 ${fixtureDefaultAuthorId} 號使用者）不在這個站可以當作者的名單裡，可能是換過站。請重新選一個並設為預設。`
      : null;
  return clone({
    authors,
    currentUser: FIXTURE_ME,
    canChooseOthers: !onlySelf,
    defaultAuthorId: fixtureDefaultAuthorId,
    defaultAuthor,
    notice,
    listUnavailable: false,
  });
}

export const authorsApi: Pick<PublisherApi, 'listAuthors' | 'setDefaultAuthor'> = {
  async listAuthors() {
    await delay(120);
    return fixtureAuthors();
  },

  async setDefaultAuthor(authorId: number | null) {
    await delay(200);
    if (authorId !== null && !fixtureAuthors().authors.some((author) => author.id === authorId)) {
      throw new Error(`第 ${authorId} 號使用者不在這個站可以當作者的名單裡`);
    }
    fixtureDefaultAuthorId = authorId;
    return fixtureAuthors();
  },
};
