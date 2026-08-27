import type { StructureRules } from './types.js';

/**
 * 結構驗證（hybrid 模式才套用）。
 *
 * sanitize 保證「安全」，這裡保證「符合這個網站的版型慣例」。
 * 例如長文只准用 h3——這不是安全問題，是不想讓新文章跟既有 15 篇長得不一樣。
 */

export interface StructureIssue {
  readonly rule: string;
  readonly message: string;
}

const BLOCK_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'blockquote', 'figure', 'div', 'hr']);
const VOID_TAGS = new Set(['br', 'img', 'hr', 'input', 'meta', 'link', 'source', 'wbr']);

interface Token {
  readonly kind: 'open' | 'close' | 'text';
  readonly tag: string;
  readonly text: string;
}

function tokenize(html: string): Token[] {
  const tokens: Token[] = [];
  const pattern = /<\/?\s*([a-zA-Z][a-zA-Z0-9-]*)[^>]*?(\/?)>|([^<]+)/g;
  for (const match of html.matchAll(pattern)) {
    if (match[3] !== undefined) {
      tokens.push({ kind: 'text', tag: '', text: match[3] });
      continue;
    }
    const tag = match[1]!.toLowerCase();
    const selfClosing = match[2] === '/' || VOID_TAGS.has(tag);
    if (match[0].startsWith('</')) {
      tokens.push({ kind: 'close', tag, text: '' });
    } else {
      tokens.push({ kind: 'open', tag, text: '' });
      if (selfClosing) tokens.push({ kind: 'close', tag, text: '' });
    }
  }
  return tokens;
}

export function validateStructure(html: string, rules: StructureRules): StructureIssue[] {
  const issues: StructureIssue[] = [];
  const tokens = tokenize(html);

  if (rules.allowedHeadingLevels) {
    const allowed = new Set(rules.allowedHeadingLevels);
    const used = new Set<number>();
    for (const token of tokens) {
      const m = token.kind === 'open' ? /^h([1-6])$/.exec(token.tag) : null;
      if (m) used.add(Number(m[1]));
    }
    for (const level of [...used].sort()) {
      if (!allowed.has(level)) {
        issues.push({
          rule: 'allowedHeadingLevels',
          message: `正文用了 h${level}，這個版型只允許 ${[...allowed].map((l) => `h${l}`).join('、')}`,
        });
      }
    }
  }

  if (rules.requireTopLevelBlocks) {
    let depth = 0;
    for (const token of tokens) {
      if (token.kind === 'open') {
        if (depth === 0 && !BLOCK_TAGS.has(token.tag)) {
          issues.push({
            rule: 'requireTopLevelBlocks',
            message: `正文最外層出現 <${token.tag}>；最外層只能是段落、標題、清單、引用或圖片區塊`,
          });
        }
        depth += 1;
      } else if (token.kind === 'close') {
        depth = Math.max(0, depth - 1);
      } else if (depth === 0 && token.text.trim().length > 0) {
        issues.push({
          rule: 'requireTopLevelBlocks',
          message: '正文最外層出現沒有被段落包住的文字',
        });
      }
    }
  }

  if (rules.maxNestingDepth !== undefined) {
    let depth = 0;
    let maxDepth = 0;
    for (const token of tokens) {
      if (token.kind === 'open') {
        depth += 1;
        maxDepth = Math.max(maxDepth, depth);
      } else if (token.kind === 'close') {
        depth = Math.max(0, depth - 1);
      }
    }
    if (maxDepth > rules.maxNestingDepth) {
      issues.push({
        rule: 'maxNestingDepth',
        message: `巢狀深度 ${maxDepth} 超過上限 ${rules.maxNestingDepth}`,
      });
    }
  }

  // 同一條規則只回報一次，錯誤訊息才不會洗版。
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.rule}:${issue.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
