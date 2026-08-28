import { z } from 'zod';

/**
 * Gutenberg 區塊的中介表示法（IR）。
 *
 * 為什麼要有 IR，不直接把 HTML 重新序列化一次？
 *
 * Gutenberg 存檔時會把「區塊標記」與「HTML」一起寫進 post_content，開啟編輯器時
 * 再拿實際 HTML 跟該區塊 save() 應該產生的 HTML 逐字比對。差一個字元——例如
 * `<hr/>` 寫成 `<hr>`——編輯器就會跳「此區塊包含非預期或無效的內容」，使用者得
 * 手動按「復原」才能編輯。
 *
 * 所以流程是：sanitize 過的 HTML → 解析成 IR → **由我們自己逐字產生** 核心區塊的
 * 標記，而不是把解析結果丟給通用序列化器。輸出格式全部對照 www.remusplus.com
 * 既有 115 篇文章的真實內容決定（見 docs/SITE-FINDINGS.md）。
 */

/** 行內 HTML（strong/em/a/br 等），已經過 sanitize，直接沿用。 */
export type InlineHtml = string;

/**
 * WordPress 的 class slug 格式（`medium`、`x-large`、`is-style-wide`）。
 *
 * 一定要驗證，因為這些值最後會被塞進**區塊註解的 JSON** 與 class 屬性裡。
 * 帶 `-->` 的值會把註解提早關掉，整個區塊標記就壞了。manifest 是受信任設定沒錯，
 * 但打錯字不該變成壞掉的發布內容；而且 fontSize 也可能從內容的 class 反推出來，
 * 那條路徑的來源是不受信任的。
 */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SlugSchema = z.string().regex(SLUG_PATTERN, 'slug 只能用小寫英數與連字號');

export function isSafeSlug(value: string): boolean {
  return SLUG_PATTERN.test(value);
}

/** CSS 長度，例如 `800px`。同樣會進區塊註解與 style 屬性，要限制格式。 */
const CSS_LENGTH_PATTERN = /^\d+(?:\.\d+)?(?:px|em|rem|%|vw|vh)$/;

export function isSafeCssLength(value: string): boolean {
  return CSS_LENGTH_PATTERN.test(value);
}

export interface ParagraphBlock {
  readonly type: 'paragraph';
  readonly html: InlineHtml;
  /** null 代表用主題預設字級，不輸出 fontSize 屬性。 */
  readonly fontSize: string | null;
}

export interface HeadingBlock {
  readonly type: 'heading';
  readonly level: 2 | 3 | 4 | 5 | 6;
  readonly html: InlineHtml;
  readonly fontSize: string | null;
}

export interface ListItem {
  readonly html: InlineHtml;
  /** 字級是每一項各自的屬性，不是整份清單共用。 */
  readonly fontSize: string | null;
  /**
   * 巢狀子清單。核心把子清單存成 list-item **裡面**的獨立 wp:list 區塊，
   * 不是 li 的純 HTML 內容——寫成純 HTML 的話編輯器就認不出那是可編輯的清單。
   */
  readonly nested: readonly ListBlock[];
}

export interface ListBlock {
  readonly type: 'list';
  readonly ordered: boolean;
  readonly items: readonly ListItem[];
}

export interface QuoteBlock {
  readonly type: 'quote';
  /** 引用內部同樣是區塊；核心會巢狀存放。 */
  readonly children: readonly Block[];
}

export interface ImageBlock {
  readonly type: 'image';
  readonly src: string;
  readonly alt: string;
  /** WordPress 媒體庫 ID。尚未上傳時為 null，序列化時就不輸出 id 與 wp-image-* class。 */
  readonly mediaId: number | null;
  readonly sizeSlug: string;
  readonly align: string | null;
  /** 空圖說一律存成 null：核心的 save() 會略過空圖說，多輸出就會判定內容無效。 */
  readonly caption: InlineHtml | null;
  /** 指定顯示寬度（CSS 長度）。有值時核心會加上 is-resized 並寫進 img 的 style。 */
  readonly width: string | null;
  readonly height: string | null;
}

export interface SeparatorBlock {
  readonly type: 'separator';
  /** 例如 `is-style-wide`。核心存進 className 屬性並附加到 class。 */
  readonly className: string | null;
}

/**
 * 逃生門：辨識不出對應核心區塊的內容，原樣包進 wp:html。
 *
 * 存在的理由是「絕不靜默丟掉內容」。日記是 flexible 模式，使用者本來就可能寫出
 * 我們沒預期的標記；那時應該照樣發得出去，由使用者在預覽時看到並決定，而不是
 * 悄悄消失。內容已經過 sanitize，所以原樣輸出是安全的。
 *
 * 也用在「核心表達不了這個形狀」的情況——例如巢狀清單後面還有文字，核心的
 * list-item 一定先存文字再存子區塊，硬轉就會把內容前後對調。寧可退回逃生門
 * 保持原樣，也不要悄悄改變使用者寫的順序。
 */
export interface HtmlBlock {
  readonly type: 'html';
  readonly html: string;
}

export type Block =
  | ParagraphBlock
  | HeadingBlock
  | ListBlock
  | QuoteBlock
  | ImageBlock
  | SeparatorBlock
  | HtmlBlock;

/**
 * 站台的區塊慣例。放在 manifest 而不是寫死在程式碼裡：
 * 這是「這個網站長什麼樣」的設定，不是 WordPress 的規則。
 *
 * 預設值取自 remusplus.com 2026 年的現行慣例——2023/2025 的長文不用 fontSize，
 * 2026 年起改用 medium，新文章要跟新慣例。
 */
export const BlockDefaultsSchema = z
  .object({
    /** 段落字級。null = 用主題預設。 */
    paragraphFontSize: SlugSchema.nullable().default('medium'),
    headingFontSize: SlugSchema.nullable().default('medium'),
    /** 清單項目字級。 */
    listItemFontSize: SlugSchema.nullable().default(null),
    imageSizeSlug: SlugSchema.default('large'),
    imageAlign: SlugSchema.nullable().default('center'),
  })
  .strict();

export type BlockDefaults = z.infer<typeof BlockDefaultsSchema>;

export const DEFAULT_BLOCK_DEFAULTS: BlockDefaults = BlockDefaultsSchema.parse({});

/**
 * 巢狀深度的兩道防線。長文的 structureRules 有限制，但日記是 flexible 模式沒有。
 *
 * - `MAX_NESTING_DEPTH`：超過就退到 wp:html 逃生門，內容保住，轉換照樣成功。
 *   對付的是「寫得有點誇張但仍然是真實內容」的情況。
 * - `HARD_NESTING_LIMIT`：超過就整份拒絕。因為連逃生門都救不了——逃生門要呼叫
 *   parse5 的 serializeOuter 把子樹序列化回字串，那是遞迴的，幾千層一樣爆堆疊。
 *   這種輸入不是內容，是壞掉的資料，寧可給一個看得懂的錯誤也不要當掉。
 */
export const MAX_NESTING_DEPTH = 32;
export const HARD_NESTING_LIMIT = 200;

/** 區塊轉換失敗。呼叫端要當成「內容有問題」回報給使用者，不是內部錯誤。 */
export class BlockConversionError extends Error {
  override readonly name = 'BlockConversionError';
}
