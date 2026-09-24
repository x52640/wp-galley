import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { writeFileAtomic } from '../config/env-file.js';
import { ContentTypeSchema } from '../templates/types.js';

/**
 * 分類法 slug 與 REST 名稱的格式。兩者都會接進 URL 路徑（`/wp/v2/<它>`；沒寫 taxonomyRestBase 時
 * 用的就是 taxonomy），所以限制得跟 key 一樣緊。允許底線是因為核心的 `post_tag`。
 */
const TAXONOMY_NAME_PATTERN = /^[a-z0-9_]+(?:-[a-z0-9_]+)*$/;

/**
 * 發布目標：把「模板」對應到「WordPress 上的哪個內容類型」。
 *
 * 放在 config/publish-targets.json 而不是寫死在程式碼裡，因為這是**站台設定**——
 * 換一個網站就要換一份，但程式不用改。一次連一個站（D-016），所以這是**本機檔**，
 * 不進 git；repo 只附範例：`config/publish-targets.example.json`（通用：文章＋頁面）與
 * `config/examples/remusplus.json`（作者站台）。裡面沒有秘密，只是每個人的站不一樣。
 *
 * 每個 target 上的三個開關是安全邊界，預設全部保守：
 * - allowCreate      能不能建立新內容
 * - allowUpdate      能不能覆寫既有內容
 * - allowCreateTerms 能不能建立新的分類項目（預設 false，見 terms.ts 的說明）
 */

export const PublishTargetSchema = z
  .object({
    key: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'key 只能用小寫英數與連字號'),
    displayName: z.string().min(1),
    /** 對應 templates/<id>/manifest.json 的 contentType。 */
    contentType: ContentTypeSchema,
    /** WordPress 的 post type slug。 */
    postType: z.string().min(1),
    /** REST 端點名稱，不一定等於 postType。啟動探查時會驗證。 */
    restBase: z.string().min(1),
    templateId: z.string().min(1),
    /**
     * 這個內容類型掛的分類法 slug；null 代表不使用分類（例如 page）。
     * 通用範例的 post 用 `category`（D-004：一樣不自動建立分類項目）。
     */
    taxonomy: z
      .string()
      .regex(TAXONOMY_NAME_PATTERN, 'taxonomy 只能用小寫英數、底線與連字號')
      .nullable()
      .default(null),
    /**
     * 分類法的 REST 名稱（端點 `/wp/v2/<它>`，也是文章 JSON 裡放 term id 的欄位名）。
     * null＝跟 taxonomy 一樣。核心的 `category` 就不一樣，要寫 `categories`（`post_tag` 是 `tags`）；
     * 作者站台的兩個分類法 slug 剛好等於 rest_base，不用寫。
     * 會接進 URL 路徑，格式限制得跟 key 一樣緊。
     */
    taxonomyRestBase: z
      .string()
      .regex(TAXONOMY_NAME_PATTERN, 'taxonomyRestBase 只能用小寫英數、底線與連字號')
      .nullable()
      .default(null),
    /** 固定物件 ID（首頁用）。null 代表每次建立新的。 */
    fixedObjectId: z.number().int().positive().nullable().default(null),
    allowCreate: z.boolean().default(false),
    allowUpdate: z.boolean().default(false),
    allowCreateTerms: z.boolean().default(false),
    /** 長文 15/15 篇都有精選圖片；日記 0/100 篇有。 */
    requireFeaturedImage: z.boolean().default(false),
    /** 發布前是否需要第二次確認（首頁用）。 */
    requireSecondConfirmation: z.boolean().default(false),
  })
  .strict()
  .superRefine((target, ctx) => {
    // 首頁一定要綁固定 Page ID，否則可能建出一堆新首頁（計畫 §8.4）。
    if (target.contentType === 'homepage' && target.fixedObjectId === null) {
      ctx.addIssue({ code: 'custom', message: `${target.key}：首頁類型必須指定 fixedObjectId` });
    }
    // 綁了固定 ID 就不該再建新的。
    if (target.fixedObjectId !== null && target.allowCreate) {
      ctx.addIssue({
        code: 'custom',
        message: `${target.key}：已綁定 fixedObjectId，不應該同時允許 allowCreate`,
      });
    }
    if (target.taxonomyRestBase !== null && target.taxonomy === null) {
      ctx.addIssue({
        code: 'custom',
        message: `${target.key}：沒有設定 taxonomy，taxonomyRestBase 沒有意義`,
      });
    }
    if (target.allowCreateTerms && target.taxonomy === null) {
      ctx.addIssue({
        code: 'custom',
        message: `${target.key}：沒有設定 taxonomy，allowCreateTerms 沒有意義`,
      });
    }
  });

export type PublishTarget = z.infer<typeof PublishTargetSchema>;

/** 這個 target 的分類法在 REST 上叫什麼；沒有分類法回 null。讀寫 term 一律用它，不要直接用 taxonomy。 */
export function taxonomyRestBaseOf(target: PublishTarget): string | null {
  if (target.taxonomy === null) return null;
  return target.taxonomyRestBase ?? target.taxonomy;
}

/**
 * 站台設定檔。除了 targets，還有**整個站共用**的設定：
 * - `defaultAuthorId`（選填，P5-T024，D-024）：發布時預設送的 WordPress 使用者 id。不寫＝不送 author，
 *   WordPress 用發布台登入的帳號當作者（原本的行為）。在發布面板按「設為預設」會寫進來。
 */
export const PublishTargetsFileSchema = z
  .object({
    defaultAuthorId: z.number().int().positive().optional(),
    targets: z.array(PublishTargetSchema).min(1),
  })
  .strict()
  .superRefine((file, ctx) => {
    const seen = new Set<string>();
    for (const target of file.targets) {
      if (seen.has(target.key)) {
        ctx.addIssue({ code: 'custom', message: `發布目標 key 重複：${target.key}` });
      }
      seen.add(target.key);
    }
  });

export class PublishTargetError extends Error {
  override readonly name = 'PublishTargetError';
}

/** 找不到本機站台設定檔時，啟動訊息、建稿拒絕都講這一句。 */
export const SITE_CONFIG_MISSING_MESSAGE =
  '還沒有站台設定：先跑設定精靈，或複製 config/publish-targets.example.json';

export interface PublishTargetRegistry {
  list(): PublishTarget[];
  get(key: string): PublishTarget;
  has(key: string): boolean;
  /**
   * 不是 undefined 就代表「根本還沒設定站台」（本機設定檔不存在），值是給人看的說明。
   * 這時 list() 是空的；伺服器照樣啟動（健康檢查、診斷都要能用），只是建不了稿。
   */
  readonly setupRequired?: string;
  /** 站台設定檔的 `defaultAuthorId`；沒設是 null（不送 author）。 */
  readonly defaultAuthorId: number | null;
}

export function createTargetRegistry(
  targets: readonly PublishTarget[],
  options: { setupRequired?: string; defaultAuthorId?: number | null } = {},
): PublishTargetRegistry {
  const byKey = new Map(targets.map((target) => [target.key, target]));
  return {
    defaultAuthorId: options.defaultAuthorId ?? null,
    list: () => [...targets],
    has: (key) => byKey.has(key),
    get: (key) => {
      const target = byKey.get(key);
      if (!target) throw new PublishTargetError(options.setupRequired ?? `找不到發布目標：${key}`);
      return target;
    },
    ...(options.setupRequired === undefined ? {} : { setupRequired: options.setupRequired }),
  };
}

/** 啟動時要印給使用者看的話；站台已設定就是 null。 */
export function startupNotice(registry: PublishTargetRegistry): string | null {
  if (registry.setupRequired === undefined) return null;
  return `${registry.setupRequired}。\n發布台照樣啟動（健康檢查與環境診斷可以用），但建不了稿。`;
}

export async function loadPublishTargets(file: string): Promise<PublishTargetRegistry> {
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch (error) {
    // 檔案不在是「還沒設定站台」，不是壞掉：新 clone 下來本來就沒有這個檔（不進 git）。
    // 回一個空的 registry，讓伺服器照樣起得來、把話講清楚，而不是啟動就崩潰。
    if ((error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
      return createTargetRegistry([], { setupRequired: SITE_CONFIG_MISSING_MESSAGE });
    }
    throw new PublishTargetError(
      `讀不到發布目標設定 ${file}：${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new PublishTargetError(
      `${file} 不是合法 JSON：${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const result = PublishTargetsFileSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new PublishTargetError(`${file} 設定不合法：\n- ${issues.join('\n- ')}`);
  }

  return createTargetRegistry(result.data.targets, { defaultAuthorId: result.data.defaultAuthorId ?? null });
}

/**
 * 只改站台設定檔的 `defaultAuthorId`（發布面板的「設為預設」）。null＝拿掉這個欄位。
 *
 * 其他內容原樣保留（照檔案裡寫的，不補預設值）；寫之前用正式 schema 驗一次，壞掉的檔不碰。
 * 「這個 id 在不在站上可當作者的名單」由呼叫端先驗，這裡只管檔案。
 */
export async function writeDefaultAuthor(file: string, authorId: number | null): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
      throw new PublishTargetError(SITE_CONFIG_MISSING_MESSAGE);
    }
    throw new PublishTargetError(`${file} 讀不到或不是合法 JSON，沒有改動：${error instanceof Error ? error.message : String(error)}`);
  }
  if (!PublishTargetsFileSchema.safeParse(parsed).success) {
    throw new PublishTargetError(`${file} 格式不對，沒有改動。先修好站台設定檔再設預設作者。`);
  }
  // 欄位放在 targets 前面，打開檔案第一眼就看得到。
  const { defaultAuthorId: _old, ...rest } = parsed as Record<string, unknown>;
  const next = authorId === null ? rest : { defaultAuthorId: authorId, ...rest };
  const check = PublishTargetsFileSchema.safeParse(next);
  if (!check.success) throw new PublishTargetError('預設作者的編號不合法');
  await writeFileAtomic(file, `${JSON.stringify(next, null, 2)}\n`, 0o644);
}

/**
 * 拿站台探查的結果驗證設定。
 *
 * 設定檔說「發到 read-think」，但那個內容類型在遠端到底存不存在、rest_base 對不對，
 * 只有連上去才知道。不對就要在啟動時講清楚，不要等到發布才失敗。
 */
export interface TargetValidationIssue {
  readonly targetKey: string;
  readonly message: string;
}

export function validateTargetsAgainstSite(
  targets: readonly PublishTarget[],
  postTypes: Readonly<Record<string, { rest_base: string; taxonomies: readonly string[] }>>,
  /** `/wp/v2/taxonomies` 的結果（slug → rest_base）。用來確認讀寫分類項目打的端點是對的。 */
  taxonomies: Readonly<Record<string, { rest_base: string }>>,
): TargetValidationIssue[] {
  const issues: TargetValidationIssue[] = [];

  for (const target of targets) {
    const type = postTypes[target.postType];
    if (!type) {
      issues.push({
        targetKey: target.key,
        message: `WordPress 上找不到內容類型 ${target.postType}。若後台有，通常是沒開 show_in_rest`,
      });
      continue;
    }

    if (type.rest_base !== target.restBase) {
      issues.push({
        targetKey: target.key,
        message: `restBase 設定成 ${target.restBase}，但 WordPress 回報的是 ${type.rest_base}`,
      });
    }

    if (target.taxonomy !== null && !type.taxonomies.includes(target.taxonomy)) {
      issues.push({
        targetKey: target.key,
        message: `內容類型 ${target.postType} 上沒有分類法 ${target.taxonomy}`,
      });
      continue;
    }

    // REST 名稱對不上的話，讀分類項目會 404，文章 JSON 也讀不到分類欄位——
    // 後者會讓「遠端分類被改過」的偵測無聲失效，所以一定要在診斷時講出來。
    if (target.taxonomy !== null) {
      const taxonomy = taxonomies[target.taxonomy];
      if (!taxonomy) {
        issues.push({
          targetKey: target.key,
          message: `WordPress 上找不到分類法 ${target.taxonomy} 的 REST 資訊。若後台有，通常是沒開 show_in_rest`,
        });
      } else if (taxonomy.rest_base !== taxonomyRestBaseOf(target)) {
        issues.push({
          targetKey: target.key,
          message:
            `分類法 ${target.taxonomy} 的 REST 名稱是 ${taxonomy.rest_base}，` +
            `請在設定檔加上 taxonomyRestBase: "${taxonomy.rest_base}"`,
        });
      }
    }
  }

  return issues;
}
