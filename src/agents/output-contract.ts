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
  /**
   * 已停用（P5-T017）：以前要 Agent 交一份「校正後的完整原稿」，發布台從來沒用過，而且原稿
   * 已經不送了。保留成選填，舊的輸出帶著它照樣合格；不給就省下一整篇的輸出。
   */
  readonly correctedSource?: string;
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
    // 選填（不列 required）：發布台不用它。Codex 的 strict schema 會把它轉成 nullable，回來的 null 在驗證前被拿掉。
    correctedSource: {
      type: 'string',
      maxLength: 200000,
      description: '不用填。發布台不使用這一欄，留空或省略。',
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
          before: {
            type: 'string',
            maxLength: 2000,
            description:
              '從 templateData 目前的內容裡一字不差地引用要改的那一段，多帶幾個字讓它在整篇裡只出現一次。' +
              '引用對不上，發布台就套不上去。',
          },
          after: { type: 'string', maxLength: 2000, description: '同一段改好之後的樣子（純文字，不要帶 HTML 標籤）。' },
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

/**
 * AI 建議英文網址那一趟（D-026，P5-T026）的輸出。**另一份小 schema，不共用校稿那份**：
 *
 * - 校稿那份的 `templateData` 是必填、而且嵌了整份模板 schema。這一趟只送標題＋內文開頭，
 *   Agent 手上沒有整份 templateData，硬要它帶回來只能編、或把整篇再吐一次（慢、花額度）。
 * - 三家 CLI 都吃得下這份：每層 `additionalProperties: false`、只有一個欄位且必填（Codex strict 不用轉 nullable）；
 *   `maxItems`／`maxLength` 送給 Codex 前會被濾掉，後端照原樣再驗一次。
 *
 * 單個候選**不在 schema 裡驗格式**（沒有 pattern）：一個不合格就整趟重來太浪費，
 * 後端用 `contract/slug.ts` 的 `pickSlugSuggestions` 逐個丟掉不合格的。
 */
export interface SlugOutput {
  readonly slugs: unknown[];
}

export const SLUG_OUTPUT_SCHEMA: Record<string, unknown> = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: '英文網址建議',
  type: 'object',
  additionalProperties: false,
  required: ['slugs'],
  properties: {
    slugs: {
      type: 'array',
      maxItems: 10,
      description: '三個英文網址候選，最好的放第一個。只用小寫英文字母、數字與連字號。',
      items: { type: 'string', maxLength: 200 },
    },
  },
};

/**
 * AI 查證（D-034，docs/specs/factcheck.md）的兩趟輸出。**兩份都沒有 `templateData`**：結構上改不了文章。
 *
 * 跟其他 schema 同一套規則：送給 CLI 的可以被放寬（Codex strict 濾掉上限、選填變 nullable），
 * 回來之後後端用這裡的原始 schema 再驗一次。
 *
 * 個別項目的「內容對不對」（excerpt 在文章裡找不找得到、claimIndex／ref 存不存在）**不在 schema 裡驗**：
 * 一項不合格就整趟重來太浪費，由查證流程（P6-T004）逐項丟掉，規則見 factcheck.md。
 */

/** 第一趟最多回幾條主張。selection／observation 只留前 2 條，由流程截。 */
export const FACTCHECK_MAX_CLAIMS = 5;

export interface FactCheckFindClaim {
  readonly excerpt: string;
  readonly claim: string;
  readonly queries: { readonly q: string; readonly lang: 'zh' | 'en' }[];
  readonly candidateUrls: { readonly url: string; readonly title: string }[];
}

export interface FactCheckFindOutput {
  readonly claims: FactCheckFindClaim[];
}

export const FACTCHECK_FIND_SCHEMA: Record<string, unknown> = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: '查證：找來源',
  type: 'object',
  additionalProperties: false,
  required: ['claims'],
  properties: {
    claims: {
      type: 'array',
      maxItems: FACTCHECK_MAX_CLAIMS,
      description: '值得查證的主張，最值得查的放前面。沒有可查的就給空陣列。',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['excerpt', 'claim', 'queries', 'candidateUrls'],
        properties: {
          excerpt: {
            type: 'string',
            maxLength: 200,
            description: '從文章裡一字不差地引用這條主張所在的那一小段原文。引用對不上，這條會被丟掉。',
          },
          claim: { type: 'string', maxLength: 200, description: '把主張改寫成一句可以查證的話。' },
          queries: {
            type: 'array',
            minItems: 1,
            maxItems: 3,
            description: '拿去查百科的搜尋字串，1 到 3 個，短一點（關鍵詞，不是整句）。',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['q', 'lang'],
              properties: {
                q: { type: 'string', maxLength: 80 },
                lang: { type: 'string', enum: ['zh', 'en'] },
              },
            },
          },
          candidateUrls: {
            type: 'array',
            maxItems: 5,
            description: '可能有答案的網頁，0 到 5 個。只給你真的在搜尋結果裡看到、或確定存在的網址；不確定就不要給。',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['url', 'title'],
              properties: {
                url: { type: 'string', maxLength: 300 },
                title: { type: 'string', maxLength: 200 },
              },
            },
          },
        },
      },
    },
  },
};

export type FactCheckVerdict = 'supported' | 'contradicted' | 'unverifiable' | 'needs-context';

export interface FactCheckJudgeFinding {
  readonly claimIndex: number;
  readonly verdict: FactCheckVerdict;
  readonly evidence: string;
  /** 選填、不接受 null（Codex 回的 null 由 `stripNulls` 拿掉）。讀的時候用 `correctionOf`。 */
  readonly correction?: string;
  readonly citations: { readonly ref: string; readonly quote: string }[];
}

export interface FactCheckJudgeOutput {
  readonly findings: FactCheckJudgeFinding[];
}

/**
 * 判斷趟最多回幾條。主張最多 5 條；留一點空間給「同一條回兩次」（流程留第一個），
 * 不要因為多回一條就整份被拒。factcheck.md 沒定這個數，這裡定 10。
 */
export const FACTCHECK_MAX_FINDINGS = 10;

export const FACTCHECK_JUDGE_SCHEMA: Record<string, unknown> = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: '查證：判斷',
  type: 'object',
  additionalProperties: false,
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      maxItems: FACTCHECK_MAX_FINDINGS,
      description: '每條主張一筆判斷。',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['claimIndex', 'verdict', 'evidence', 'citations'],
        properties: {
          claimIndex: { type: 'integer', minimum: 0, description: '主張的編號（從 0 起）。' },
          verdict: {
            type: 'string',
            enum: ['supported', 'contradicted', 'unverifiable', 'needs-context'],
            description:
              'supported：來源支持。contradicted：來源說法不同。unverifiable：給你的來源裡查不到。' +
              'needs-context：要看前後文才能判斷。',
          },
          evidence: { type: 'string', maxLength: 400, description: '白話說明在來源裡查到什麼。' },
          // 選填（不列 required）：Codex 的 strict schema 會把它轉成 nullable，回來的 null 在驗證前被拿掉。
          correction: {
            type: 'string',
            maxLength: 200,
            description: '來源說法不同時，建議怎麼改（一句話，例如「應該是 1994 年」）。沒有建議就不要給。',
          },
          citations: {
            type: 'array',
            maxItems: 3,
            description: '支持你判斷的原句，0 到 3 條。',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['ref', 'quote'],
              properties: {
                ref: { type: 'string', maxLength: 20, description: '來源編號，只能是給你的 S1、S2…。' },
                quote: { type: 'string', maxLength: 200, description: '從那份來源一字不差地抄出來的原句。' },
              },
            },
          },
        },
      },
    },
  },
};

/** `correction` 沒給（或只有空白）就是 null（factcheck.md：程式把「沒有」存成 null）。 */
export function correctionOf(finding: Pick<FactCheckJudgeFinding, 'correction'>): string | null {
  const value = finding.correction;
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}
