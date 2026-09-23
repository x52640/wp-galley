/**
 * 校稿輸出契約（計畫 §6.3）。
 *
 * 這份 JSON Schema 有兩個用途：
 * 1. 送給 CLI 的 `--output-schema` / `--json-schema`，讓模型端就先受約束。
 * 2. 回來之後由後端再驗一次——Agent 說自己合格不算數。
 *
 * `templateData` 的形狀由各模板的 schema.json 決定，所以這裡放的是「骨架」，
 * 實際使用時用 `buildReviewSchema(模板 schema)` 把該模板的 schema 嵌進去。
 *
 * 為什麼一定要嵌進去而不是描述成「一個物件」：OpenAI 的結構化輸出要求
 * **每一層物件都必須明寫 `additionalProperties: false`**，開放形狀會被拒絕：
 *   `'additionalProperties' is required to be supplied and to be false`
 * 嵌進去同時也讓 Agent 拿到精確形狀，比用文字描述可靠。
 */

export interface ReviewChange {
  readonly type: 'typo' | 'grammar' | 'clarity' | 'style';
  readonly before: string;
  readonly after: string;
  readonly reason: string;
  /** Agent 自評有沒有改變原意。true 者 UI 必須標紅並預設不套用。 */
  readonly meaningChanged: boolean;
}

/**
 * 需要人判斷的觀察（階段 5.5-A）。
 *
 * `changes` 的形狀是「把 A 改成 B」，但校稿真正有價值的另一半不是字詞替換：
 * 「第 3 段寫 1985、第 7 段寫 1987，講的是同一件事」不是一個可以自動套用的改動，
 * 是一個要人去確認的疑點。以前沒有地方放，Agent 只能硬塞進 `changes` 裡假裝
 * 自己知道正確答案，或者乾脆不講。
 *
 * **不需要連外就做得到**，所以它屬於現在這個階段：把要查的東西列出來，
 * 而不是假裝自己查過了。真的去查是階段 6 的事（見 docs/specs/factcheck.md）。
 */
export interface Observation {
  readonly kind: 'contradiction' | 'unsupported-claim' | 'missing-source' | 'gap';
  /** 對應正文第幾個頂層區塊，讓 UI 把它掛到那一段的頁邊。 */
  readonly blockIndex: number;
  /** 原文中被指涉的片段，用來標亮。 */
  readonly excerpt: string;
  readonly detail: string;
  /** 建議怎麼處理；**不是**自動套用的改動。 */
  readonly suggestion: string;
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
  readonly observations: Observation[];
  readonly templateData: Record<string, unknown>;
  readonly imageBriefs: ImageBrief[];
}

export const REVIEW_OUTPUT_SCHEMA: Record<string, unknown> = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: '校稿結果',
  type: 'object',
  additionalProperties: false,
  required: [
    'title',
    'summary',
    'correctedSource',
    'changes',
    'observations',
    'templateData',
    'imageBriefs',
  ],
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
    observations: {
      type: 'array',
      maxItems: 50,
      description:
        '需要人判斷的觀察，不是字詞替換：段落之間互相矛盾、沒有出處的宣稱、前後日期兜不攏。' +
        '不確定的事就寫在這裡，不要寫進 changes 假裝自己知道答案；沒有就給空陣列。',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'blockIndex', 'excerpt', 'detail', 'suggestion'],
        properties: {
          kind: {
            type: 'string',
            enum: ['contradiction', 'unsupported-claim', 'missing-source', 'gap'],
            description:
              'contradiction：前後說法兜不攏。unsupported-claim：宣稱沒有依據。' +
              'missing-source：引用或數據沒標出處。gap：少了讀者需要的交代。',
          },
          blockIndex: {
            type: 'integer',
            minimum: 0,
            description: '正文第幾個頂層區塊（段落、標題、清單各算一個），0 起算。',
          },
          excerpt: { type: 'string', maxLength: 300, description: '原文中被指涉的片段，要一字不差。' },
          detail: { type: 'string', maxLength: 500, description: '觀察到什麼。講事實，不要下結論。' },
          suggestion: { type: 'string', maxLength: 300, description: '建議怎麼處理。' },
        },
      },
    },
    templateData: {
      type: 'object',
      additionalProperties: false,
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


/**
 * 產生特定模板專用的校稿 schema。
 *
 * 把模板的 schema.json 整份放進 `templateData`，Agent 因此知道確切要填什麼欄位，
 * 且整份 schema 每一層都是封閉的，符合 OpenAI 結構化輸出的要求。
 *
 * 後端收到結果後**仍然會**用模板的 schema 再驗一次（計畫 §4.1）——
 * 這裡只是讓模型端先受約束，不是把驗證外包出去。
 */
export function buildReviewSchema(templateSchema: Record<string, unknown>): Record<string, unknown> {
  const properties = REVIEW_OUTPUT_SCHEMA['properties'] as Record<string, unknown>;
  const { $schema: _ignored, $id: _ignoredId, ...inlined } = templateSchema;

  return {
    ...REVIEW_OUTPUT_SCHEMA,
    properties: {
      ...properties,
      templateData: {
        ...inlined,
        // 保險：模板 schema 若漏寫，這裡補上，否則 OpenAI 會整份拒絕。
        additionalProperties: false,
      },
    },
  };
}
