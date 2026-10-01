/** 作者（P5-T024，D-024）：站上可以當作者的人、發布時要送哪一位。 */

import type { AuthorOption, AuthorsResponse } from '../../contract/api.js';
import { InvalidInputError } from '../errors.js';
import type { EventActor, JobRow } from '../repository.js';
import type { WordPressClient } from '../../wordpress/client.js';
import { fetchIdentity } from '../../wordpress/site.js';
import {
  AUTHOR_LIST_UNAVAILABLE_MESSAGE,
  AuthorListUnavailableError,
  fetchAuthorChoices,
  ONLY_SELF_NOTICE,
  type AuthorChoices,
} from '../../wordpress/authors.js';
import type { CoreContext } from './context.js';

export class AuthorsModule {
  constructor(private readonly ctx: CoreContext) {}

  /**
   * 站上可以當作者的人、發布台自己的帳號、預設作者。發布面板靠它顯示「作者：某某」。
   * 只有 id 與顯示名稱。規則見 wordpress/authors.ts。
   */
  async listAuthors(): Promise<AuthorsResponse> {
    const client = this.ctx.requireWordPress();
    try {
      const choices = await this.ctx.trackWordPress(() => fetchAuthorChoices(client));
      return this.describeAuthors(choices);
    } catch (error) {
      if (!(error instanceof AuthorListUnavailableError)) throw error;
      // 面板照樣要畫得出來；但講清楚：有預設作者的發布會被擋，不會靜默改用發布台的帳號。
      const me = await this.ctx.trackWordPress(() => fetchIdentity(client)).catch(() => null);
      const currentUser = me === null ? { id: 0, name: '發布台的帳號' } : { id: me.user.id, name: me.user.name };
      return {
        authors: me === null ? [] : [currentUser],
        currentUser,
        canChooseOthers: false,
        defaultAuthorId: this.ctx.targets.defaultAuthorId,
        defaultAuthor: null,
        notice:
          `${error.message}。` +
          (this.ctx.targets.defaultAuthorId === null
            ? '現在不能選作者；沒選的話作者會是發布台的帳號。'
            : '有設預設作者，所以現在發布會被擋下（免得作者被記成發布台的帳號），稍後再試。'),
        listUnavailable: true,
      };
    }
  }

  /** 設預設作者之前的檢查：這個人在不在可選名單裡。不在就丟 InvalidInputError（400）。 */
  async assertAuthorChoosable(authorId: number): Promise<void> {
    const client = this.ctx.requireWordPress();
    const choices = await this.ctx.trackWordPress(() => fetchAuthorChoices(client)).catch((error: unknown) => {
      if (error instanceof AuthorListUnavailableError) throw new InvalidInputError(`${error.message}。稍後再試。`);
      throw error;
    });
    if (choices.authors.some((author) => author.id === authorId)) return;
    throw new InvalidInputError(
      choices.canChooseOthers
        ? `第 ${authorId} 號使用者不在這個站可以當作者的名單裡`
        : (choices.notice ?? ONLY_SELF_NOTICE),
    );
  }

  private describeAuthors(choices: AuthorChoices): AuthorsResponse {
    const defaultAuthorId = this.ctx.targets.defaultAuthorId;
    const defaultAuthor =
      defaultAuthorId === null ? null : (choices.authors.find((author) => author.id === defaultAuthorId) ?? null);
    const stale =
      defaultAuthorId !== null && defaultAuthor === null && choices.canChooseOthers
        ? `預設作者（第 ${defaultAuthorId} 號使用者）不在這個站可以當作者的名單裡，可能是換過站。請重新選一個並設為預設。`
        : null;
    return {
      authors: choices.authors.map((author) => ({ id: author.id, name: author.name })),
      currentUser: { id: choices.currentUser.id, name: choices.currentUser.name },
      canChooseOthers: choices.canChooseOthers,
      defaultAuthorId,
      defaultAuthor,
      notice: choices.notice ?? stale,
      listUnavailable: false,
    };
  }

  /**
   * 這次發布要送哪個作者；null＝不送。沒指定也沒預設時**不問站台**，行為跟以前一模一樣。
   *
   * - 指定的（或預設的）人不在可選名單：拒絕，零寫入。預設作者不在名單不默默改用 AI 帳號——
   *   那正是 D-024 要修的問題。
   * - 帳號只能用自己（Author 角色）：指定別人就拒絕；預設是別人則不送（反正只能是自己，
   *   面板也已經講了），不讓使用者卡住。
   */
  async resolvePublishAuthor(
    job: JobRow,
    actor: EventActor,
    client: WordPressClient,
    requested: number | undefined,
  ): Promise<AuthorOption | null> {
    const wanted = requested ?? this.ctx.targets.defaultAuthorId;
    if (wanted === null) return null;

    let choices: AuthorChoices;
    try {
      choices = await fetchAuthorChoices(client);
    } catch (error) {
      // 讀不到清單（被擋、限流、連不上）就不發：不送 author 會讓作者悄悄變成發布台的帳號。
      const why = error instanceof Error ? error.message : String(error);
      throw this.ctx.publish.rejectPublish(job, actor, `${AUTHOR_LIST_UNAVAILABLE_MESSAGE}（${why}）`);
    }
    const found = choices.authors.find((author) => author.id === wanted) ?? null;
    if (found !== null) return { id: found.id, name: found.name };

    if (!choices.canChooseOthers) {
      if (requested === undefined) return null;
      throw this.ctx.publish.rejectPublish(job, actor, choices.notice ?? ONLY_SELF_NOTICE);
    }
    throw this.ctx.publish.rejectPublish(
      job,
      actor,
      requested === undefined
        ? `預設作者（第 ${wanted} 號使用者）不在這個站可以當作者的名單裡，可能是換過站。請在發布面板重新選作者並設為預設。這次沒有送出任何內容。`
        : `指定的作者（第 ${wanted} 號使用者）不在這個站可以當作者的名單裡。這次沒有送出任何內容。`,
    );
  }
}
