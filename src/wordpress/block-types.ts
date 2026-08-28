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
  readonly itemFontSize: string | null;
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
  readonly caption: InlineHtml | null;
}

export interface SeparatorBlock {
  readonly type: 'separator';
}

/**
 * 逃生門：辨識不出對應核心區塊的內容，原樣包進 wp:html。
 *
 * 存在的理由是「絕不靜默丟掉內容」。日記是 flexible 模式，使用者本來就可能寫出
 * 我們沒預期的標記；那時應該照樣發得出去，由使用者在預覽時看到並決定，而不是
 * 悄悄消失。內容已經過 sanitize，所以原樣輸出是安全的。
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
    paragraphFontSize: z.string().nullable().default('medium'),
    headingFontSize: z.string().nullable().default('medium'),
    /** 清單項目字級。 */
    listItemFontSize: z.string().nullable().default(null),
    imageSizeSlug: z.string().default('large'),
    imageAlign: z.string().nullable().default('center'),
  })
  .strict();

export type BlockDefaults = z.infer<typeof BlockDefaultsSchema>;

export const DEFAULT_BLOCK_DEFAULTS: BlockDefaults = BlockDefaultsSchema.parse({});
