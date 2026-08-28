import { readFile } from 'node:fs/promises';
import { z } from 'zod';

/**
 * 發布目標：把「模板」對應到「WordPress 上的哪個內容類型」。
 *
 * 放在 config/publish-targets.json 而不是寫死在程式碼裡，因為這是**站台設定**——
 * 換一個網站就要換一份，但程式不用改。裡面沒有任何秘密（只有內容類型名稱與
 * 開關），所以這個檔案會進 git，跟 .env 不同。
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
    contentType: z.enum(['homepage', 'longform', 'diary']),
    /** WordPress 的 post type slug。 */
    postType: z.string().min(1),
    /** REST 端點名稱，不一定等於 postType。啟動探查時會驗證。 */
    restBase: z.string().min(1),
    templateId: z.string().min(1),
    /** 這個內容類型掛的分類法 slug；null 代表不使用分類。 */
    taxonomy: z.string().nullable().default(null),
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
    if (target.allowCreateTerms && target.taxonomy === null) {
      ctx.addIssue({
        code: 'custom',
        message: `${target.key}：沒有設定 taxonomy，allowCreateTerms 沒有意義`,
      });
    }
  });

export type PublishTarget = z.infer<typeof PublishTargetSchema>;

const PublishTargetsFileSchema = z
  .object({ targets: z.array(PublishTargetSchema).min(1) })
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

export interface PublishTargetRegistry {
  list(): PublishTarget[];
  get(key: string): PublishTarget;
  has(key: string): boolean;
}

export function createTargetRegistry(targets: readonly PublishTarget[]): PublishTargetRegistry {
  const byKey = new Map(targets.map((target) => [target.key, target]));
  return {
    list: () => [...targets],
    has: (key) => byKey.has(key),
    get: (key) => {
      const target = byKey.get(key);
      if (!target) throw new PublishTargetError(`找不到發布目標：${key}`);
      return target;
    },
  };
}

export async function loadPublishTargets(file: string): Promise<PublishTargetRegistry> {
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    // 這個檔案有進 git（裡面沒有秘密），不見了可以從版本控制還原。
    throw new PublishTargetError(`找不到發布目標設定 ${file}`);
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

  return createTargetRegistry(result.data.targets);
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
    }
  }

  return issues;
}
