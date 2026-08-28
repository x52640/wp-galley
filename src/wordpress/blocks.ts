import { parseBlocks } from './block-parse.js';
import { serializeBlocks } from './block-serialize.js';
import { DEFAULT_BLOCK_DEFAULTS, type Block, type BlockDefaults } from './block-types.js';

/**
 * 區塊序列化器的對外入口。
 *
 * 在管線裡的位置：
 *
 *   Agent（結構化 JSON）
 *     → renderRevision()      驗 schema、sanitize、套版型規則 → 乾淨的純 HTML
 *     → toBlockMarkup()       ← 這裡：純 HTML → Gutenberg 區塊標記
 *     → WordPress REST        寫進 post_content
 *
 * 為什麼放在渲染器之後而不是裡面：渲染器的輸出要保持「乾淨、好 diff、好比對」，
 * 那是預覽與 revision hash 的基礎。區塊標記是**發布格式**，只有真的要送出去時
 * 才需要，而且是決定性的轉換——同樣的 HTML 永遠得到同樣的區塊標記。
 *
 * 這也代表 revision hash 算的仍然是純 HTML：換一套區塊慣例不會讓既有核准失效，
 * 因為使用者核准的是「內容」，不是「WordPress 的存檔格式」。
 */

export interface BlockConversionResult {
  /** 要寫進 WordPress post_content 的字串。 */
  readonly markup: string;
  /** 中介表示法，供測試與診斷頁檢視。 */
  readonly blocks: readonly Block[];
  /** 落到 wp:html 逃生門的區塊數。大於 0 代表有內容沒對應到核心區塊，值得提醒使用者。 */
  readonly fallbackCount: number;
}

export function toBlockMarkup(
  html: string,
  defaults: BlockDefaults = DEFAULT_BLOCK_DEFAULTS,
): BlockConversionResult {
  const blocks = parseBlocks(html, defaults);
  return {
    markup: serializeBlocks(blocks),
    blocks,
    fallbackCount: countFallbacks(blocks),
  };
}

function countFallbacks(blocks: readonly Block[]): number {
  let count = 0;
  for (const block of blocks) {
    if (block.type === 'html') count += 1;
    else if (block.type === 'quote') count += countFallbacks(block.children);
  }
  return count;
}

export { parseBlocks, serializeBlocks };
export type { Block, BlockDefaults };
