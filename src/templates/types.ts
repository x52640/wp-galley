import { z } from 'zod';

/**
 * 模板契約。
 *
 * 模板資料夾是**受信任的本機設定**；使用者貼上的原稿與外部網頁內容一律是
 * 不受信任資料，不能覆蓋這裡的任何規則。
 */

export const ContentTypeSchema = z.enum(['homepage', 'longform', 'diary']);
export type ContentType = z.infer<typeof ContentTypeSchema>;

/**
 * 嚴格度決定 Agent 有多少自由：
 * - strict：Agent 只給結構化欄位，正文 HTML 由 renderer 產生（首頁用，MVP 未啟用）。
 * - hybrid：Agent 給正文 HTML，但要通過 allowlist 與 structureRules。
 * - flexible：Agent 給正文 HTML，通過 allowlist 即可，不套結構規則。
 */
export const StrictnessSchema = z.enum(['strict', 'hybrid', 'flexible']);
export type Strictness = z.infer<typeof StrictnessSchema>;

export const StructureRulesSchema = z
  .object({
    /** 允許的標題階層。例如 [3] 代表只能用 h3。 */
    allowedHeadingLevels: z.array(z.number().int().min(1).max(6)).optional(),
    /** 正文最外層必須是區塊元素，不能是裸文字。 */
    requireTopLevelBlocks: z.boolean().optional(),
    /** 元素巢狀深度上限，擋掉異常結構。 */
    maxNestingDepth: z.number().int().min(1).max(10).optional(),
  })
  .strict();

export type StructureRules = z.infer<typeof StructureRulesSchema>;

export const TemplateManifestSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'id 只能用小寫英數與連字號'),
    version: z.number().int().min(1),
    contentType: ContentTypeSchema,
    strictness: StrictnessSchema,
    /** 對應 config/publish-targets.json 的 target key；階段 4 才會用到。 */
    wordpressTargetKey: z.string().nullable().default(null),
    /** 哪一個欄位的 HTML 才是要送去 WordPress 的內容。其餘一律只用於預覽。 */
    publishSlot: z.string().min(1),
    requiredSlots: z.array(z.string().min(1)),
    optionalSlots: z.array(z.string().min(1)).default([]),
    allowedTags: z.array(z.string().min(1)),
    allowedAttributes: z.record(z.string(), z.array(z.string())).default({}),
    /** 每個標籤允許的 class；支援 `wp-image-*` 這種尾綴萬用字元。 */
    allowedClasses: z.record(z.string(), z.array(z.string())).default({}),
    allowedSchemes: z.array(z.string().min(1)).default(['https', 'http', 'mailto']),
    structureRules: StructureRulesSchema.default({}),
    previewStrategy: z.enum(['local', 'wordpress_draft', 'staging']).default('local'),
  })
  .strict()
  .superRefine((manifest, ctx) => {
    if (!manifest.requiredSlots.includes(manifest.publishSlot)) {
      ctx.addIssue({
        code: 'custom',
        message: `publishSlot「${manifest.publishSlot}」必須列在 requiredSlots 裡，否則可能發布出空內容`,
      });
    }
    // 危險標籤即使寫進 manifest 也不接受。模板是受信任設定，但打錯字不該變成漏洞。
    const forbidden = ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'link', 'meta', 'base'];
    const bad = manifest.allowedTags.filter((tag) => forbidden.includes(tag.toLowerCase()));
    if (bad.length > 0) {
      ctx.addIssue({ code: 'custom', message: `allowedTags 不得包含危險標籤：${bad.join('、')}` });
    }
    const badSchemes = manifest.allowedSchemes.filter((s) => !['https', 'http', 'mailto', 'tel'].includes(s));
    if (badSchemes.length > 0) {
      ctx.addIssue({ code: 'custom', message: `allowedSchemes 不得包含：${badSchemes.join('、')}` });
    }
  });

export type TemplateManifest = z.infer<typeof TemplateManifestSchema>;

/** 已載入並驗證過的模板。hash 綁定所有五個檔案的內容。 */
export interface LoadedTemplate {
  readonly manifest: TemplateManifest;
  /** schema.json 的原始 JSON Schema 物件。 */
  readonly schema: Record<string, unknown> & { required?: string[] };
  readonly templateHtml: string;
  readonly rulesMarkdown: string;
  readonly previewCss: string;
  /** 五個檔案內容的 SHA-256；模板一改就變，舊 revision 因此可辨識。 */
  readonly hash: string;
  readonly directory: string;
}
