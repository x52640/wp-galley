/**
 * 校稿輸出契約（計畫 §6.3）。
 *
 * 這份 JSON Schema 有兩個用途：
 * 1. 送給 CLI 的 `--output-schema` / `--json-schema`，讓模型端就先受約束。
 * 2. 回來之後由後端再驗一次——Agent 說自己合格不算數。
 *
 * `templateData` 的形狀由各模板的 schema.json 決定，所以這裡只宣告它是物件，
 * 實際內容交給 templates/ 的渲染流程驗證。這樣新增模板不必改這個檔案。
 */

export interface ReviewChange {
  readonly type: 'typo' | 'grammar' | 'clarity' | 'style';
  readonly before: string;
  readonly after: string;
  readonly reason: string;
  /** Agent 自評有沒有改變原意。true 者 UI 必須標紅並預設不套用。 */
  readonly meaningChanged: boolean;
}

export interface ImageBrief {
  /** 供 templateData 的 featuredImageBriefKey 指向。 */
  readonly key: string;
  readonly purpose: string;
  readonly prompt: string;
  readonly aspectRatio: string;
  readonly altText: string;
  readonly caption?: string;
  /** 建議插入的位置描述，例如「第三段之後」。 */
  readonly placement?: string;
}

export interface ReviewOutput {
  readonly title: string;
  readonly summary: string;
  readonly correctedSource: string;
  readonly changes: ReviewChange[];
  readonly templateData: Record<string, unknown>;
  readonly imageBriefs: ImageBrief[];
}

export const REVIEW_OUTPUT_SCHEMA: Record<string, unknown> = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: '校稿結果',
  type: 'object',
  additionalProperties: false,
  required: ['title', 'summary', 'correctedSource', 'changes', 'templateData', 'imageBriefs'],
  properties: {
    title: {
      type: 'string',
      maxLength: 200,
      description: '文章標題。日記類型必須原樣帶回使用者給的標題，不得竄改。',
    },
    summary: {
      type: 'string',
      maxLength: 500,
      description: '這次校稿做了什麼的一句話說明，給使用者看的，不是文章摘要。',
    },
    correctedSource: {
      type: 'string',
      maxLength: 200000,
      description: '校正後的完整原稿純文字，供使用者比對差異用。',
    },
    changes: {
      type: 'array',
      maxItems: 300,
      description: '逐項列出改了什麼。使用者會逐項接受或拒絕，所以不要合併成一大項。',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'before', 'after', 'reason', 'meaningChanged'],
        properties: {
          type: { type: 'string', enum: ['typo', 'grammar', 'clarity', 'style'] },
          before: { type: 'string', maxLength: 2000 },
          after: { type: 'string', maxLength: 2000 },
          reason: { type: 'string', maxLength: 300 },
          meaningChanged: {
            type: 'boolean',
            description: '這項修改有沒有可能改變原意。不確定就填 true。',
          },
        },
      },
    },
    templateData: {
      type: 'object',
      description: '符合目標模板 schema.json 的資料。後端會用該模板再驗一次。',
    },
    imageBriefs: {
      type: 'array',
      maxItems: 20,
      description: '配圖需求。不要自己編造圖片網址，圖檔由使用者提供。',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'purpose', 'prompt', 'aspectRatio', 'altText'],
        properties: {
          key: { type: 'string', minLength: 1, maxLength: 60, pattern: '^[a-z0-9]+(?:[_-][a-z0-9]+)*$' },
          purpose: { type: 'string', maxLength: 200 },
          prompt: { type: 'string', maxLength: 2000 },
          aspectRatio: { type: 'string', maxLength: 20 },
          altText: { type: 'string', maxLength: 300 },
          caption: { type: 'string', maxLength: 500 },
          placement: { type: 'string', maxLength: 200 },
        },
      },
    },
  },
};
