import sanitizeHtml from 'sanitize-html';
import type { TemplateManifest } from './types.js';

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

function buildOptions(manifest: TemplateManifest): sanitizeHtml.IOptions {
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
  };
}

export function sanitizeBody(html: string, manifest: TemplateManifest): SanitizeReport {
  const removedTags = new Set<string>();
  const removedAttributes = new Set<string>();

  const options: sanitizeHtml.IOptions = {
    ...buildOptions(manifest),
    exclusiveFilter: undefined,
  };

  // 先掃一遍原始 HTML，記下哪些標籤與屬性不在 allowlist。
  const allowedTagSet = new Set(manifest.allowedTags.map((t) => t.toLowerCase()));
  for (const match of html.matchAll(/<\s*([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>/g)) {
    const tag = match[1]!.toLowerCase();
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
