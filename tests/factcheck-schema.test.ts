import { describe, expect, it } from 'vitest';

import {
  correctionOf,
  FACTCHECK_FIND_SCHEMA,
  FACTCHECK_JUDGE_SCHEMA,
} from '../src/agents/output-contract.js';
import { stripNulls, toOpenAiStrictSchema } from '../src/agents/adapters/openai-strict.js';
import { validateAgainstSchema } from '../src/templates/schema-validator.js';

/**
 * P6-T003：查證兩趟的輸出 schema（factcheck.md「① 找來源」「③ 判斷」）。
 * adapter 解析流程（假執行檔 → stripNulls → 原 schema）的測試在 agent-hosted-search.test.ts。
 */

const find = (data: unknown) => validateAgainstSchema(FACTCHECK_FIND_SCHEMA, 'test:factcheck-find', data);
const judge = (data: unknown) => validateAgainstSchema(FACTCHECK_JUDGE_SCHEMA, 'test:factcheck-judge', data);

const CLAIM = {
  excerpt: '這部片 1995 年上映',
  claim: '《刺激1995》在 1995 年上映。',
  queries: [{ q: '刺激1995', lang: 'zh' }],
  candidateUrls: [{ url: 'https://zh.wikipedia.org/wiki/刺激1995', title: '刺激1995 – 維基百科' }],
};

const FINDING = {
  claimIndex: 0,
  verdict: 'contradicted',
  evidence: '維基百科寫 1994 年 9 月首映。',
  correction: '應該是 1994 年',
  citations: [{ ref: 'S1', quote: '本片於1994年9月10日在多倫多國際電影節首映' }],
};

/** 每一層物件都封閉、required 列齊、沒有 strict 不支援的關鍵字。 */
function assertStrictShape(node: unknown): void {
  if (Array.isArray(node)) {
    node.forEach(assertStrictShape);
    return;
  }
  if (typeof node !== 'object' || node === null) return;
  const obj = node as Record<string, unknown>;
  if (obj['type'] === 'object' || (Array.isArray(obj['type']) && obj['type'].includes('object'))) {
    expect(obj['additionalProperties']).toBe(false);
    expect(obj['required']).toEqual(Object.keys(obj['properties'] as object));
  }
  for (const key of ['maxLength', 'minLength', 'maxItems', 'minItems', 'minimum', 'pattern', '$schema']) {
    expect(obj).not.toHaveProperty(key);
  }
  for (const [key, value] of Object.entries(obj)) {
    if (key === 'properties') Object.values(value as object).forEach(assertStrictShape);
    else assertStrictShape(value);
  }
}

describe('FACTCHECK_FIND_SCHEMA', () => {
  it('合格的輸出通過；沒有 templateData', () => {
    expect(find({ claims: [CLAIM] })).toEqual({ valid: true, issues: [] });
    expect(find({ claims: [] }).valid).toBe(true);
    expect(JSON.stringify(FACTCHECK_FIND_SCHEMA)).not.toContain('templateData');
  });

  it('candidateUrls 可以是空的', () => {
    expect(find({ claims: [{ ...CLAIM, candidateUrls: [] }] }).valid).toBe(true);
  });

  it('超過上限被拒：主張 6 條、搜尋字串 0 或 4 個、網址 6 個', () => {
    expect(find({ claims: Array.from({ length: 6 }, () => CLAIM) }).valid).toBe(false);
    expect(find({ claims: [{ ...CLAIM, queries: [] }] }).valid).toBe(false);
    expect(find({ claims: [{ ...CLAIM, queries: Array.from({ length: 4 }, () => CLAIM.queries[0]) }] }).valid).toBe(false);
    expect(
      find({ claims: [{ ...CLAIM, candidateUrls: Array.from({ length: 6 }, () => CLAIM.candidateUrls[0]) }] }).valid,
    ).toBe(false);
  });

  it('超過字數被拒：excerpt／claim 201 字、q 81 字、url 301 字、title 201 字', () => {
    expect(find({ claims: [{ ...CLAIM, excerpt: 'a'.repeat(201) }] }).valid).toBe(false);
    expect(find({ claims: [{ ...CLAIM, claim: 'a'.repeat(201) }] }).valid).toBe(false);
    expect(find({ claims: [{ ...CLAIM, queries: [{ q: 'a'.repeat(81), lang: 'en' }] }] }).valid).toBe(false);
    expect(find({ claims: [{ ...CLAIM, candidateUrls: [{ url: 'h'.repeat(301), title: 't' }] }] }).valid).toBe(false);
    expect(find({ claims: [{ ...CLAIM, candidateUrls: [{ url: 'https://a.b', title: 't'.repeat(201) }] }] }).valid).toBe(false);
    // 邊界剛好可以。
    expect(find({ claims: [{ ...CLAIM, excerpt: 'a'.repeat(200) }] }).valid).toBe(true);
  });

  it('語言只能是 zh／en；多餘欄位與 templateData 被拒', () => {
    expect(find({ claims: [{ ...CLAIM, queries: [{ q: 'x', lang: 'ja' }] }] }).valid).toBe(false);
    expect(find({ claims: [{ ...CLAIM, verdict: 'supported' }] }).valid).toBe(false);
    expect(find({ claims: [CLAIM], templateData: {} }).valid).toBe(false);
    const { excerpt: _excerpt, ...noExcerpt } = CLAIM;
    expect(find({ claims: [noExcerpt] }).valid).toBe(false);
  });

  it('轉成 Codex strict 之後每一層都封閉、required 列齊、沒有上限關鍵字', () => {
    const strict = toOpenAiStrictSchema(FACTCHECK_FIND_SCHEMA);
    assertStrictShape(strict);
    // 全部欄位本來就是必填，不該被轉成 nullable。
    expect(JSON.stringify(strict)).not.toContain('"null"');
  });
});

describe('FACTCHECK_JUDGE_SCHEMA', () => {
  it('合格的輸出通過；correction 選填；沒有 templateData', () => {
    expect(judge({ findings: [FINDING] })).toEqual({ valid: true, issues: [] });
    const { correction: _c, ...noCorrection } = FINDING;
    expect(judge({ findings: [{ ...noCorrection, verdict: 'unverifiable', citations: [] }] }).valid).toBe(true);
    expect(JSON.stringify(FACTCHECK_JUDGE_SCHEMA)).not.toContain('templateData');
  });

  it('correction 不接受 null（null 要先經 stripNulls 拿掉）', () => {
    const withNull = { findings: [{ ...FINDING, correction: null }] };
    expect(judge(withNull).valid).toBe(false);
    expect(judge(stripNulls(withNull)).valid).toBe(true);
  });

  it('判定只能是四種；claimIndex 不能是負數或小數', () => {
    expect(judge({ findings: [{ ...FINDING, verdict: 'true' }] }).valid).toBe(false);
    expect(judge({ findings: [{ ...FINDING, claimIndex: -1 }] }).valid).toBe(false);
    expect(judge({ findings: [{ ...FINDING, claimIndex: 1.5 }] }).valid).toBe(false);
    for (const verdict of ['supported', 'contradicted', 'unverifiable', 'needs-context']) {
      expect(judge({ findings: [{ ...FINDING, verdict }] }).valid).toBe(true);
    }
  });

  it('超過上限被拒：evidence 401、correction 201、quote 201 字、引文 4 條、findings 11 筆', () => {
    expect(judge({ findings: [{ ...FINDING, evidence: 'a'.repeat(401) }] }).valid).toBe(false);
    expect(judge({ findings: [{ ...FINDING, correction: 'a'.repeat(201) }] }).valid).toBe(false);
    expect(judge({ findings: [{ ...FINDING, citations: [{ ref: 'S1', quote: 'a'.repeat(201) }] }] }).valid).toBe(false);
    expect(judge({ findings: [{ ...FINDING, citations: Array.from({ length: 4 }, () => FINDING.citations[0]) }] }).valid).toBe(
      false,
    );
    expect(judge({ findings: Array.from({ length: 11 }, () => FINDING) }).valid).toBe(false);
    expect(judge({ findings: Array.from({ length: 10 }, () => FINDING) }).valid).toBe(true);
  });

  it('引文多了欄位（例如自己寫的 url）被拒：只能用編號引用', () => {
    expect(
      judge({ findings: [{ ...FINDING, citations: [{ ref: 'S1', quote: 'x', url: 'https://evil.example' }] }] }).valid,
    ).toBe(false);
  });

  it('轉成 Codex strict：每一層封閉、只有 correction 變成可 null', () => {
    const strict = toOpenAiStrictSchema(FACTCHECK_JUDGE_SCHEMA);
    assertStrictShape(strict);
    const item = ((strict['properties'] as Record<string, Record<string, unknown>>)['findings']!['items'] as Record<
      string,
      unknown
    >)['properties'] as Record<string, Record<string, unknown>>;
    expect(item['correction']!['type']).toEqual(['string', 'null']);
    expect(item['evidence']!['type']).toBe('string');
    expect(item['claimIndex']!['type']).toBe('integer');
  });
});

describe('correctionOf', () => {
  it('沒給、空白 → null；有字照回', () => {
    expect(correctionOf({})).toBeNull();
    expect(correctionOf({ correction: '  ' })).toBeNull();
    expect(correctionOf({ correction: '應該是 1994 年' })).toBe('應該是 1994 年');
  });
});
