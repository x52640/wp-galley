/**
 * 抽文字與截斷（factcheck.md「抽文字」）。
 * HTML 用 parse5 解析（惰性，不跑 script、不載任何東西），拿掉非正文的元素，取純文字、摺疊空白。
 */
import { parse } from 'parse5';
import type { DefaultTreeAdapterMap } from 'parse5';

type Node = DefaultTreeAdapterMap['node'];

/** factcheck.md 列的元素，加上本來就不是正文的（head、noscript、template、svg、iframe…）。 */
const SKIPPED = new Set([
  'script',
  'style',
  'nav',
  'header',
  'footer',
  'aside',
  'form',
  'head',
  'noscript',
  'template',
  'svg',
  'math',
  'iframe',
  'object',
  'canvas',
  'button',
  'select',
]);

/** 這些元素前後換行，讓段落不會黏在一起。 */
const BLOCK = new Set([
  'p', 'div', 'section', 'article', 'main', 'li', 'ul', 'ol', 'dl', 'dt', 'dd', 'table', 'tr',
  'td', 'th', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'figure', 'figcaption',
  'br', 'hr', 'body', 'address', 'details', 'summary',
]);

/**
 * 同步、會吃 CPU（parse5 處理深層巢狀是平方級）：取回器一律經 `extract-runner.ts` 在 worker 裡跑，
 * 不要在主執行緒直接對抓回來的 HTML 呼叫。走訪不用遞迴（深層巢狀不會爆 stack）。
 */
export function extractTextFromHtml(html: string): string {
  const doc = parse(html);
  const parts: string[] = [];
  type Item = { node: Node; inPre: boolean } | '\n';
  const stack: Item[] = [{ node: doc as unknown as Node, inPre: false }];
  while (stack.length > 0) {
    const item = stack.pop()!;
    if (item === '\n') {
      parts.push('\n');
      continue;
    }
    const { node, inPre } = item;
    if (node.nodeName === '#text') {
      const value = (node as DefaultTreeAdapterMap['textNode']).value;
      // HTML 裡原始碼的換行只是空白；只有 <pre> 保留換行。
      parts.push(inPre ? value : value.replace(/\s+/g, ' '));
      continue;
    }
    if (node.nodeName === '#comment' || node.nodeName === '#documentType') continue;
    const name = node.nodeName.toLowerCase();
    if (SKIPPED.has(name)) continue;
    const isBlock = BLOCK.has(name);
    if (isBlock) {
      parts.push('\n');
      stack.push('\n'); // 子節點都處理完才輪到它
    }
    const children =
      'content' in node && node.content
        ? node.content.childNodes
        : 'childNodes' in node
          ? (node.childNodes as Node[])
          : [];
    const childInPre = inPre || name === 'pre';
    for (let i = children.length - 1; i >= 0; i -= 1) stack.push({ node: children[i]!, inPre: childInPre });
  }
  return collapseWhitespace(parts.join(''));
}

/** 行內空白摺成一個空格；空行摺成一個換行；頭尾去掉。 */
export function collapseWhitespace(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[\s ]+/g, ' ').trim())
    .filter((line) => line !== '')
    .join('\n');
}

/** 依 Content-Type 取純文字：HTML 走 parse5，`text/plain` 原樣（只統一換行）。 */
export function extractText(body: string, contentType: string): string {
  if (contentType === 'text/html' || contentType === 'application/xhtml+xml') {
    return extractTextFromHtml(body);
  }
  return body.replace(/\r\n?/g, '\n').trim();
}

export interface TruncateLimits {
  /** 每份最多幾字（以 Unicode code point 算）。 */
  readonly perSource: number;
  /** 全部加起來最多幾字。 */
  readonly total: number;
}

export const DEFAULT_TRUNCATE_LIMITS: TruncateLimits = Object.freeze({ perSource: 12_000, total: 40_000 });

/**
 * 截斷：每份先截到 perSource；加總超過 total 時各份等比例截短（無條件捨去，保證加總不超過）。
 * 核對與「看原文」都以這裡回傳、實際給 Agent 的那份為準。
 */
export function truncateSources(
  texts: readonly string[],
  limits: TruncateLimits = DEFAULT_TRUNCATE_LIMITS,
): string[] {
  const chars = texts.map((t) => Array.from(t).slice(0, limits.perSource));
  const sum = chars.reduce((n, c) => n + c.length, 0);
  if (sum <= limits.total) return chars.map((c) => c.join(''));
  const ratio = limits.total / sum;
  return chars.map((c) => c.slice(0, Math.floor(c.length * ratio)).join(''));
}
