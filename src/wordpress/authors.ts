import { z } from 'zod';
import type { WordPressClient } from './client.js';
import { WordPressError } from './errors.js';
import { fetchIdentity, type SiteIdentity } from './site.js';

/**
 * 站上誰可以當作者（P5-T024，D-024）。
 *
 * 規則照 WordPress 核心 `WP_REST_Users_Controller::get_items_permissions_check`
 * （docs/specs/wordpress-site.md「作者」）：
 * - `context=edit`、`roles=`、`capabilities[]=` **都要 `list_users`**，只有 Administrator 有；
 *   發布台建議用的 Editor 帳號用了會 403。所以這裡**不用**它們。
 * - `who=authors` 只要能編輯某個支援作者的內容類型就可以（Editor、Author 都行），回的是
 *   `user_level != 0` 的人（投稿者以上）。區塊編輯器的作者下拉選單用的就是這一招。
 *   WordPress 5.9 把 `WP_User_Query` 的 `who` 標成棄用、建議改 `capability`，但 REST 的
 *   `who` 參數還在、行為沒變；改用 `capabilities[]` 反而 Editor 用不了。
 * - 指定**別人**當作者要 `edit_others_posts`（建稿／更新的權限檢查），Author 角色沒有。
 *   能不能從 `users/me?context=edit` 的 `capabilities` 看出來（本人可以用 context=edit 看自己）。
 *
 * 只留 id 與顯示名稱：清單在 view context 下也有 slug、頭像、個人網址，前端用不到就不帶。
 */

export interface AuthorOption {
  readonly id: number;
  readonly name: string;
}

export interface AuthorChoices {
  /** 可以選的人。不能指定別人時只有自己。 */
  readonly authors: readonly AuthorOption[];
  /** 發布台登入的帳號。 */
  readonly currentUser: AuthorOption;
  /** 這個帳號能不能指定別人當作者。 */
  readonly canChooseOthers: boolean;
  /** 不能選別人時給人看的原因；可以選就是 null。 */
  readonly notice: string | null;
}

const AuthorSchema = z.object({ id: z.number().int().positive(), name: z.string() });
const AuthorListSchema = z.array(AuthorSchema);

/** WordPress 的 per_page 上限是 100。 */
const PAGE_SIZE = 100;
/** 使用者多到這樣就不是個人站了；到這裡停，不要一直翻。 */
const MAX_PAGES = 10;

export const ONLY_SELF_NOTICE = '這個帳號只能用自己當作者，要改作者請在 WordPress 把它升成 Editor';

/** 讀不到站上的作者清單時，發布前拒絕用的話（審查：不能靜默變成 AI 帳號）。 */
export const AUTHOR_LIST_UNAVAILABLE_MESSAGE =
  '讀不到站上的作者清單，這次沒有發布，免得作者被記成發布台的帳號；稍後再試。';

/**
 * 讀不到作者清單（使用者端點被擋、限流、連線問題）。**不能**當成「只能用自己」：那會不送 author，
 * 作者悄悄變成發布台的帳號——正是 D-024 要修的問題。
 */
export class AuthorListUnavailableError extends Error {
  override readonly name = 'AuthorListUnavailableError';
}

/**
 * **確定**不能指定別人才回 false：`users/me?context=edit` 的 capabilities 在、而且沒有 edit_others_posts。
 * capabilities 被外掛拿掉時不用角色猜（猜錯會靜默改作者），當成可以、去列清單；真的不行 WordPress 寫入時會 403。
 */
export function canAssignOthers(identity: SiteIdentity): boolean {
  const caps = identity.user.capabilities;
  if (caps !== undefined) return caps['edit_others_posts'] === true;
  return true;
}

export async function listAuthorUsers(client: WordPressClient): Promise<AuthorOption[]> {
  const all: AuthorOption[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const { data, totalPages } = await client.request('/wp/v2/users', {
      query: { who: 'authors', per_page: PAGE_SIZE, page, orderby: 'name', order: 'asc', _fields: 'id,name' },
      schema: AuthorListSchema,
    });
    all.push(...data.map((user) => ({ id: user.id, name: user.name })));
    if (data.length < PAGE_SIZE || totalPages === null || page >= totalPages) break;
  }
  return all;
}

/** 讀不到清單（或讀不到自己是誰）一律丟 AuthorListUnavailableError，訊息帶原因。 */
export async function fetchAuthorChoices(client: WordPressClient): Promise<AuthorChoices> {
  let identity: SiteIdentity;
  let authors: AuthorOption[] | null = null;
  try {
    identity = await fetchIdentity(client);
    if (canAssignOthers(identity)) authors = await listAuthorUsers(client);
  } catch (error) {
    const status = error instanceof WordPressError ? error.status : null;
    const why =
      status === 401 || status === 403
        ? `站上不讓這個帳號列出使用者（HTTP ${status}），常見原因是安全外掛擋了 /wp/v2/users`
        : error instanceof Error
          ? error.message
          : String(error);
    throw new AuthorListUnavailableError(`讀不到站上的作者清單：${why}`);
  }
  const currentUser: AuthorOption = { id: identity.user.id, name: identity.user.name };
  if (authors === null) {
    return { authors: [currentUser], currentUser, canChooseOthers: false, notice: ONLY_SELF_NOTICE };
  }
  // 自己一定在清單裡（who=authors 會列到自己；保險起見補上）。
  if (!authors.some((author) => author.id === currentUser.id)) authors.push(currentUser);
  return { authors, currentUser, canChooseOthers: true, notice: null };
}
