import { escapeHtml } from './html-blocks.js';
import { EMPTY_BODY_HTML } from '../contract/empty-body.js';
import type { LoadedTemplate } from '../templates/types.js';

/**
 * 貼上的純文字 → templateData。
 *
 * 存在的理由是狀態機刻意留的那條捷徑：`SOURCE → RENDERED`，使用者可以完全不用
 * Agent，貼完稿直接渲染發布。既然不經過 Agent，就需要一段**固定程式**把純文字
 * 變成結構化資料——這正好也是架構要點第一條的樣子：HTML 永遠由程式產生。
 *
 * 規則刻意很笨，因為要決定性（同樣的輸入永遠得到位元組相同的輸出）：
 * - 空行分段，每段一個 `<p class="wp-block-paragraph">`
 * - 段內換行變 `<br />`
 * - 全部逃脫，貼進來的角括號一律當文字
 * - 不碰時鐘、不猜日期、不自動加標題
 */

const MAX_TITLE_LENGTH = 120;

export function paragraphsOf(sourceText: string): string[] {
  return sourceText
    .replace(/\r\n?/g, '\n')
    .split(/\n[ \t]*\n+/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);
}

export function sourceTextToHtml(sourceText: string): string {
  return paragraphsOf(sourceText)
    .map((paragraph) => {
      const inner = escapeHtml(paragraph).replace(/\n/g, '<br />');
      return `<p class="wp-block-paragraph">${inner}</p>`;
    })
    .join('\n');
}

/** 沒給標題就用第一行。不自動產生 YYYYMMDD——那是使用者的慣例，不是程式該猜的。 */
export function titleFromSource(sourceText: string): string {
  const firstLine = sourceText
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return (firstLine ?? '未命名').slice(0, MAX_TITLE_LENGTH);
}

/**
 * 產生初版 templateData。
 *
 * 只填 `title` 與模板的 `publishSlot`；其他必填欄位由使用者或 Agent 補。
 * 原稿是空的（新稿件先建再寫，P5-T029）時正文是一個空段落，不是空字串：schema 要求非空。
 * 補不齊時 renderRevision 會擋下來並說明缺什麼欄位，這比我們亂填好。
 */
export function buildTemplateDataFromSource(
  template: LoadedTemplate,
  sourceText: string,
  title?: string | undefined,
): Record<string, unknown> {
  const data: Record<string, unknown> = {
    title: (title ?? titleFromSource(sourceText)).slice(0, MAX_TITLE_LENGTH),
  };
  const html = sourceTextToHtml(sourceText);
  data[template.manifest.publishSlot] = html.length === 0 ? EMPTY_BODY_HTML : html;
  return data;
}
