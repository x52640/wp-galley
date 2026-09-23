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

// ReviewChange、Observation 與配圖需求會原樣送到前端，形狀定義在 src/contract/api.ts。
// 這裡只負責 JSON Schema（給 CLI 與後端驗證用）；兩邊對不上時以 schema 為準並回頭改契約。
export type { Observation, ReviewChange } from '../contract/api.js';
export type { ImageBriefDraft as ImageBrief } from '../contract/api.js';

import type { ImageBriefDraft, Observation, ReviewChange } from '../contract/api.js';

export interface ReviewOutput {
  readonly title: string;
  readonly summary: string;
  readonly correctedSource: string;
  readonly changes: ReviewChange[];
  readonly observations: Observation[];
  readonly templateData: Record<string, unknown>;
  readonly imageBriefs: ImageBriefDraft[];
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
          // 選填（不列 required）：Codex 的 strict schema 會把它轉成 nullable，回來的 null 在驗證前被拿掉。
          anchor: {
            type: 'string',
            maxLength: 200,
            description:
              '內文圖要跟在哪一段後面：從那一段裡一字不差地引用一小段原文（10 到 30 字，挑整篇只出現一次的句子）。' +
              '不要寫段落編號。封面（精選圖片）不放進正文，這一欄留空。',
          },
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
