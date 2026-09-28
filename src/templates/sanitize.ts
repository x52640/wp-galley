import sanitizeHtml from 'sanitize-html';
import type { TemplateManifest } from './types.js';
import { safeHref } from '../contract/rich-text.js';

/**
 * 正文 HTML 清理。
 *
 * 這是 Agent 輸出與 WordPress 之間唯一的關卡。原則：
 * - allowlist，不是 blocklist。沒列出來的一律移除。
 * - 移除標籤但保留文字，使用者不會因為 Agent 用錯標籤就整段內容消失。
 * - 回報移除了什麼，讓後端能判斷要不要整份退回重試（計畫 §6.3）。
 */

export interface SanitizeReport {
  readonly html: string;
  readonly changed: boolean;
  /** 被移除的標籤名稱，去重後排序。 */
  readonly removedTags: string[];
  /** 被移除的屬性，格式為 `tag.attr`。 */
  readonly removedAttributes: string[];
}

/** 把 manifest 裡的 `wp-image-*` 轉成 RegExp；沒有星號就當成字面值。 */
function toClassMatcher(pattern: string): string | RegExp {
  if (!pattern.includes('*')) return pattern;
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '[A-Za-z0-9_-]*');
  return new RegExp(`^${escaped}$`);
}

function buildOptions(manifest: TemplateManifest, onRejectedLink: () => void = () => undefined): sanitizeHtml.IOptions {
  const allowedClasses: Record<string, (string | RegExp)[]> = {};
  for (const [tag, patterns] of Object.entries(manifest.allowedClasses)) {
    allowedClasses[tag] = patterns.map(toClassMatcher);
  }

  return {
    allowedTags: [...manifest.allowedTags],
    allowedAttributes: { ...manifest.allowedAttributes },
    allowedClasses,
    allowedSchemes: [...manifest.allowedSchemes],
    // 相對網址一律不接受：WordPress 的媒體網址一定是絕對路徑，
    // 相對路徑代表 Agent 在瞎猜。
    allowProtocolRelative: false,
    // script / style 的**內容**也要丟掉，不能只拿掉標籤留下程式碼。
    nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript'],
    disallowedTagsMode: 'discard',
    transformTags: {
      // 瀏覽器編輯器與外來內容常用 b／i；模板認得的是 strong／em。拆掉的話粗體會靜靜消失（P5-T028）。
      ...renameTags(manifest),
      // 連結網址跟編輯整理用同一個規則（contract/rich-text.ts 的 safeHref，審查 F5）：不收的整個連結拆掉、字留著，
      // 不留一個沒有 href 的空殼 <a>。站內路徑 `/about` 與錨點 `#x` 收，`../post` 之類的相對路徑不收。
      a: (tagName: string, attribs: sanitizeHtml.Attributes) => {
        const href = attribs['href'];
        if (href !== undefined && safeHref(href, manifest.allowedSchemes) === null) {
          onRejectedLink();
          return { tagName: REJECTED_LINK, attribs: {} };
        }
        return { tagName, attribs };
      },
    },
  };
}

/** b→strong、i→em：只在模板允許目標、不允許來源時轉換。轉換後的標籤照目標的屬性規則處理。 */
function renameTags(manifest: TemplateManifest): Record<string, string> {
  const allowed = new Set(manifest.allowedTags.map((tag) => tag.toLowerCase()));
  const renames: Record<string, string> = {};
  for (const [from, to] of Object.entries(SEMANTIC_RENAMES)) {
    if (allowed.has(to) && !allowed.has(from)) renames[from] = to;
  }
  return renames;
}

/** 不在任何 allowlist 裡的標籤名：transformTags 換成它，sanitize 就會拆掉它、留下字。 */
const REJECTED_LINK = 'publisher-rejected-link';

const SEMANTIC_RENAMES: Readonly<Record<string, string>> = { b: 'strong', i: 'em' };

export function sanitizeBody(html: string, manifest: TemplateManifest): SanitizeReport {
  const removedTags = new Set<string>();
  const removedAttributes = new Set<string>();

  const options: sanitizeHtml.IOptions = {
    ...buildOptions(manifest, () => removedAttributes.add('a.href')),
    exclusiveFilter: undefined,
  };

  // 先掃一遍原始 HTML，記下哪些標籤與屬性不在 allowlist。
  const allowedTagSet = new Set(manifest.allowedTags.map((t) => t.toLowerCase()));
  const renames = renameTags(manifest);
  for (const match of html.matchAll(/<\s*([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>/g)) {
    const raw = match[1]!.toLowerCase();
    // 會被轉換的（b→strong）不算移除，屬性照轉換後的標籤檢查。
    const tag = renames[raw] ?? raw;
    if (!allowedTagSet.has(tag)) {
      removedTags.add(tag);
      continue;
    }
    const allowedAttrs = new Set((manifest.allowedAttributes[tag] ?? []).map((a) => a.toLowerCase()));
    for (const attrMatch of match[2]!.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=/g)) {
      const attr = attrMatch[1]!.toLowerCase();
      if (!allowedAttrs.has(attr)) removedAttributes.add(`${tag}.${attr}`);
    }
  }

  const clean = sanitizeHtml(html, options);

  return {
    html: clean,
    changed: clean !== html,
    removedTags: [...removedTags].sort(),
    removedAttributes: [...removedAttributes].sort(),
  };
}
