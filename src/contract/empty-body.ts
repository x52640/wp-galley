/**
 * 空的正文（D-030，P5-T029）。
 *
 * 新稿件可以先建再寫：建立時沒有內文，正文存成一個空段落。模板的 schema 要求 body 至少一個字元、
 * 渲染也拒絕清理後變成空字串的正文——這兩道都不放寬，改成存一個「看得到、點得進去」的空段落，
 * 讓校樣顯示得出來、打字模式有地方放游標。真正擋「不能發布空文章」的是核准與發布前置檢查，
 * 用的就是這裡的 `isBlankBody`。前後端共用同一條規則。
 */

/** 空正文存成這一段。class 跟 sourceTextToHtml 產生的段落一樣，三個模板都收。 */
export const EMPTY_BODY_HTML = '<p class="wp-block-paragraph"></p>';

/** 核准、發布、AI 動作遇到空正文時講的話。發布面板把它原樣列成「還不能發布」的原因。 */
export const EMPTY_BODY_MESSAGE = '正文是空的，先寫點內容再發布';
export const EMPTY_BODY_AGENT_MESSAGE = '正文是空的，先寫點內容再請 AI 看';

/** 算「有內容」的元素：圖片、影音、嵌入。只有這些、沒有字的文章（例如一張照片）不算空的。 */
const MEDIA_TAG = /<(img|video|audio|iframe|embed|object|picture|svg)\b/i;

/**
 * 正文是不是空的：沒有任何看得到的字，也沒有圖片或影音。
 *
 * 只有空段落、`<br>`、`&nbsp;`、分隔線的都算空的。用字串判斷而不是 DOM，前端與後端（沒有 DOM）
 * 才能共用；這不是安全關卡，判斷錯的最壞結果是「擋了一篇只有分隔線的文章」。
 */
export function isBlankBody(html: string | null | undefined): boolean {
  if (typeof html !== 'string') return true;
  if (MEDIA_TAG.test(html)) return false;
  const text = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;|&#160;|&#xa0;/gi, ' ')
    .replace(/&[a-z0-9#]+;/gi, 'x');
  return text.replace(/[\s ​　]/g, '').length === 0;
}
