import type { WordPressClient } from './client.js';
import { WordPressError } from './errors.js';
import {
  PostTypesSchema,
  TaxonomiesSchema,
  supportsFeature,
  WordPressUserSchema,
  type PostType,
  type Taxonomy,
  type WordPressUser,
} from './schemas.js';

/**
 * 站台探查：連得上嗎、認證過了嗎、要用的內容類型在不在。
 *
 * 跟 `src/agents/registry.ts` 同一個模式——回報「裝了沒／登入了沒／能不能用」，
 * 讓 UI 在使用者按下發布**之前**就把問題講清楚，而不是等到發布失敗。
 *
 * 這裡不丟例外（除非呼叫端明確要求單項查詢）。探查失敗本身就是要回報的結果，
 * 不是程式錯誤。
 */

export interface SiteIdentity {
  readonly user: WordPressUser;
  /** editor / author / administrator… 用來提醒權限過大或不足。 */
  readonly roles: readonly string[];
}

export interface TargetCheck {
  readonly postType: string;
  readonly present: boolean;
  readonly restBase: string | null;
  readonly taxonomies: readonly string[];
  /** 有沒有精選圖片支援，決定 UI 要不要顯示精選圖片欄位。 */
  readonly supportsThumbnail: boolean;
}

export interface SiteProbe {
  /** .env 有沒有填齊。沒填的話其他欄位一律是 null。 */
  readonly configured: boolean;
  readonly reachable: boolean;
  readonly authenticated: boolean;
  readonly identity: SiteIdentity | null;
  readonly targets: readonly TargetCheck[];
  /** 使用者看得懂的問題描述；空陣列代表一切正常。 */
  readonly problems: readonly string[];
}

export async function fetchIdentity(client: WordPressClient): Promise<SiteIdentity> {
  const { data } = await client.request('/wp/v2/users/me', {
    query: { context: 'edit' },
    schema: WordPressUserSchema,
  });
  return { user: data, roles: data.roles ?? [] };
}

export async function fetchPostTypes(client: WordPressClient): Promise<Record<string, PostType>> {
  const { data } = await client.request('/wp/v2/types', {
    query: { context: 'edit' },
    schema: PostTypesSchema,
  });
  return data;
}

export async function fetchTaxonomies(client: WordPressClient): Promise<Record<string, Taxonomy>> {
  const { data } = await client.request('/wp/v2/taxonomies', {
    query: { context: 'edit' },
    schema: TaxonomiesSchema,
  });
  return data;
}

/**
 * Administrator 權限過大：發布台只需要建立與編輯內容。
 * 計畫 §16 要求用專用的 Author/Editor 帳號，這裡把它變成執行時的檢查。
 */
const OVERPRIVILEGED_ROLES = new Set(['administrator', 'super_admin']);
/** 這些角色才建得了草稿。 */
const SUFFICIENT_ROLES = new Set(['author', 'editor', 'administrator', 'super_admin']);

export async function probeSite(
  client: WordPressClient,
  expectedPostTypes: readonly string[],
): Promise<SiteProbe> {
  const problems: string[] = [];

  let identity: SiteIdentity;
  try {
    identity = await fetchIdentity(client);
  } catch (error) {
    const wpError = error instanceof WordPressError ? error : null;
    // 連不上跟認證失敗要分開講，處置方式完全不同。
    const reachable = wpError?.status !== null && wpError?.status !== undefined;
    return {
      configured: true,
      reachable,
      authenticated: false,
      identity: null,
      targets: [],
      problems: [wpError?.message ?? '無法連線到 WordPress'],
    };
  }

  for (const role of identity.roles) {
    if (OVERPRIVILEGED_ROLES.has(role)) {
      problems.push(
        `這個帳號是 ${role}，權限比發布台需要的大。建議改用專用的 Author 或 Editor 帳號`,
      );
    }
  }
  if (!identity.roles.some((role) => SUFFICIENT_ROLES.has(role))) {
    problems.push(`這個帳號的角色是 ${identity.roles.join('、') || '（無）'}，可能沒有建立內容的權限`);
  }

  const [types, taxonomies] = await Promise.all([fetchPostTypes(client), fetchTaxonomies(client)]);

  const targets: TargetCheck[] = expectedPostTypes.map((slug) => {
    const type = types[slug];
    if (!type) {
      problems.push(
        `找不到內容類型 ${slug}。若它存在於後台，通常代表註冊時沒有開啟 show_in_rest`,
      );
      return { postType: slug, present: false, restBase: null, taxonomies: [], supportsThumbnail: false };
    }

    for (const taxonomy of type.taxonomies) {
      if (!taxonomies[taxonomy]) {
        problems.push(`內容類型 ${slug} 掛著分類法 ${taxonomy}，但它沒有開啟 show_in_rest`);
      }
    }

    return {
      postType: slug,
      present: true,
      restBase: type.rest_base,
      taxonomies: type.taxonomies,
      supportsThumbnail: supportsFeature(type, 'thumbnail'),
    };
  });

  return {
    configured: true,
    reachable: true,
    authenticated: true,
    identity,
    targets,
    problems,
  };
}

/** .env 沒填 WordPress 設定時的回應。 */
export function unconfiguredProbe(): SiteProbe {
  return {
    configured: false,
    reachable: false,
    authenticated: false,
    identity: null,
    targets: [],
    problems: ['尚未設定 WordPress 連線。請在 .env 填入 WORDPRESS_URL、WORDPRESS_USERNAME 與 WORDPRESS_APP_PASSWORD'],
  };
}
