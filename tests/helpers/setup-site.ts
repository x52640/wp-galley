import type { MockResponse, RecordedRequest } from './mock-wordpress.js';
import { wpError } from './mock-wordpress.js';

/**
 * 設定精靈測試用的假站台行為（P8-T002）。預設是一個健康的通用 WordPress：
 * 有 post／page、category 的 rest_base 是 categories、帳號是 editor、有開應用程式密碼。
 * 每一種失敗都靠覆寫其中一段來模擬。測試絕不連真的網站。
 */

export const GOOD_PASSWORD = 'abcd EFGH 1234 ijkl MNOP 5678';
export const GOOD_PASSWORD_BARE = 'abcdEFGH1234ijklMNOP5678';

export interface SiteBehaviour {
  /** `/wp-json/` 的回應。 */
  index?: MockResponse;
  /** `/wp/v2/users/me` 的回應。 */
  me?: MockResponse;
  types?: MockResponse;
  taxonomies?: MockResponse;
}

export const EDITOR_CAPS = {
  edit_posts: true,
  publish_posts: true,
  edit_pages: true,
  publish_pages: true,
  upload_files: true,
};

export function indexBody(options: { appPasswords?: boolean; namespaces?: string[] } = {}): Record<string, unknown> {
  return {
    name: '測試站',
    namespaces: options.namespaces ?? ['oembed/1.0', 'wp/v2'],
    authentication:
      options.appPasswords === false
        ? []
        : { 'application-passwords': { endpoints: { authorization: 'https://example.test/wp-admin/authorize-application.php' } } },
  };
}

export function meBody(roles: string[] = ['editor'], capabilities: Record<string, boolean> | undefined = EDITOR_CAPS) {
  return {
    id: 3,
    name: '編輯小明',
    slug: 'ming',
    roles,
    ...(capabilities === undefined ? {} : { capabilities }),
  };
}

export const TYPES_BODY = {
  post: { slug: 'post', name: '文章', rest_base: 'posts', taxonomies: ['category', 'post_tag'], supports: { thumbnail: true } },
  page: { slug: 'page', name: '頁面', rest_base: 'pages', taxonomies: [], supports: { thumbnail: true } },
  attachment: { slug: 'attachment', name: '媒體', rest_base: 'media', taxonomies: [] },
};

export const TAXONOMIES_BODY = {
  category: { slug: 'category', name: '分類', rest_base: 'categories', types: ['post'], hierarchical: true },
  post_tag: { slug: 'post_tag', name: '標籤', rest_base: 'tags', types: ['post'], hierarchical: false },
};

/** 路徑對上就回那一段；認證要對（帳號 ming、密碼 GOOD_PASSWORD）才給 users/me。 */
export function siteHandler(behaviour: SiteBehaviour = {}): (request: RecordedRequest) => MockResponse {
  const expectedAuth = `Basic ${Buffer.from(`ming:${GOOD_PASSWORD_BARE}`).toString('base64')}`;
  return (request) => {
    const path = request.path.split('?')[0] ?? '';
    if (path === '/wp-json/' || path === '/wp-json') return behaviour.index ?? { body: indexBody() };
    if (path === '/wp-json/wp/v2/users/me') {
      if (behaviour.me) return behaviour.me;
      if (request.authorization !== expectedAuth) return wpError('incorrect_password', 'bad', 401);
      return { body: meBody() };
    }
    if (path === '/wp-json/wp/v2/types') return behaviour.types ?? { body: TYPES_BODY };
    if (path === '/wp-json/wp/v2/taxonomies') return behaviour.taxonomies ?? { body: TAXONOMIES_BODY };
    return wpError('rest_no_route', 'no route', 404);
  };
}
