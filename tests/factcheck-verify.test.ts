import { describe, expect, it } from 'vitest';

import {
  AGENT_SKIPPED_EVIDENCE,
  collectSources,
  extractLinks,
  locateQuote,
  NO_SOURCE_EVIDENCE,
  planCandidates,
  sameExcerpt,
  selectClaims,
  verifyFindings,
  type CandidateOutcome,
  type ClaimForVerify,
  type FactCheckCandidate,
} from '../src/core/factcheck.js';
import { sourceTextForAgent } from '../src/core/factcheck-prompts.js';
import {
  checkFactCheckSelection,
  countOpenContradictions,
  isExcerptGone,
  selectionLength,
} from '../src/contract/factcheck.js';
import type { FactCheckFindClaim, FactCheckJudgeOutput } from '../src/agents/output-contract.js';

/** AI 查證的純規則（P6-T004；docs/specs/factcheck.md「④ 核對與降級」「挑選與上限」）。不碰 DB、不碰網路。 */

function claim(excerpt: string, extra: Partial<FactCheckFindClaim> = {}): FactCheckFindClaim {
  return { excerpt, claim: `關於「${excerpt}」`, queries: [{ q: excerpt, lang: 'zh' }], candidateUrls: [], ...extra };
}

const SOURCE_TEXT = '刺激1995是1994年的美國電影。本片於1994年9月10日在多倫多國際電影節首映，後來成為影史經典。';

function judged(sources: { ref: string; text: string }[], judgeIndex = 0, excerpt = '這部片 1995 年上映'): ClaimForVerify {
  return {
    excerpt,
    claim: '《刺激1995》在 1995 年上映。',
    judgeIndex,
    sources: sources.map((source) => ({
      ref: source.ref,
      url: `https://example.org/${source.ref}`,
      title: source.ref,
      origin: 'agent-search',
      agentText: sourceTextForAgent(source.text),
    })),
    failed: [],
  };
}

function output(findings: FactCheckJudgeOutput['findings']): FactCheckJudgeOutput {
  return { findings };
}

describe('selectClaims：excerpt 要在文章裡找得到', () => {
  it('找不到、空的丟掉並計數；忽略空白比對；先丟再截數量', () => {
    const texts = ['標題', '這部片1995年上映。導演是法蘭克·達拉邦特。'];
    const { kept, dropped } = selectClaims(
      [claim('不存在的句子'), claim('   '), claim('這部片 1995 年上映'), claim('導演是法蘭克·達拉邦特')],
      { max: 1, agentTexts: texts },
    );
    expect(kept.map((c) => c.excerpt)).toEqual(['這部片 1995 年上映']);
    expect(dropped).toBe(2);
  });
});

describe('planCandidates：候選順序與去重', () => {
  it('文章連結 → Agent 的網址 → 維基百科（每個語言只用第一個搜尋字串）；有開搜尋算 agent-search', () => {
    const [plan] = planCandidates(
      [
        {
          links: [{ url: 'https://example.org/review', text: '影評' }],
          agentUrls: [{ url: 'https://www.imdb.com/title/tt0111161/', title: 'IMDb' }],
          queries: [
            { q: '刺激1995', lang: 'zh' },
            { q: '肖申克的救贖', lang: 'zh' },
            { q: 'The Shawshank Redemption', lang: 'en' },
          ],
        },
      ],
      { hostedSearch: true },
    );
    expect(plan).toEqual([
      { kind: 'url', url: 'https://example.org/review', origin: 'article-link', title: '影評' },
      { kind: 'url', url: 'https://www.imdb.com/title/tt0111161/', origin: 'agent-search', title: 'IMDb' },
      { kind: 'wikipedia', lang: 'zh', query: '刺激1995' },
      { kind: 'wikipedia', lang: 'en', query: 'The Shawshank Redemption' },
    ]);
  });

  it('沒開搜尋（agy）算 agent-memory；同一網址、同一查詢整次只出現一次（給前面那條）', () => {
    const plans = planCandidates(
      [
        { links: [], agentUrls: [{ url: 'https://a.example/x', title: 'A' }], queries: [{ q: '同一個', lang: 'zh' }] },
        {
          links: [{ url: 'https://a.example/x', text: '' }],
          agentUrls: [{ url: 'https://b.example/y', title: 'B' }],
          queries: [{ q: '同一個', lang: 'zh' }],
        },
      ],
      { hostedSearch: false },
    );
    expect(plans[0]).toEqual([
      { kind: 'url', url: 'https://a.example/x', origin: 'agent-memory', title: 'A' },
      { kind: 'wikipedia', lang: 'zh', query: '同一個' },
    ]);
    expect(plans[1]).toEqual([{ kind: 'url', url: 'https://b.example/y', origin: 'agent-memory', title: 'B' }]);
  });
});

describe('collectSources：輪流分配', () => {
  const url = (claimIndex: number, n: number): FactCheckCandidate => ({
    kind: 'url',
    url: `https://c${claimIndex}.example/${n}`,
    origin: 'agent-search',
    title: '',
  });
  const okFetch = async (candidate: FactCheckCandidate): Promise<CandidateOutcome> => ({
    ok: true,
    url: candidate.kind === 'url' ? candidate.url : '',
    title: 't',
    text: 'x',
  });

  it('整次最多 8 份、每條最多 3 份、每條至少輪到一次', async () => {
    const plans = [0, 1, 2, 3, 4].map((c) => [0, 1, 2, 3, 4].map((n) => url(c, n)));
    const result = await collectSources(plans, okFetch);
    const counts = result.map((entries) => entries.filter((entry) => entry.outcome.ok).length);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(8);
    expect(Math.min(...counts)).toBeGreaterThanOrEqual(1);
    expect(Math.max(...counts)).toBeLessThanOrEqual(3);
    expect(counts).toEqual([2, 2, 2, 1, 1]);
  });

  it('一條主張內照候選順序一個一個來，抓到一份才讓出；失敗的照樣記下', async () => {
    const plans = [[url(0, 0), url(0, 1), url(0, 2)]];
    const fetchOne = async (candidate: FactCheckCandidate): Promise<CandidateOutcome> =>
      candidate.kind === 'url' && candidate.url.endsWith('/0')
        ? { ok: false, url: candidate.url, title: '', reason: '網頁太大，沒抓完' }
        : okFetch(candidate);
    const [entries] = await collectSources(plans, fetchOne, { maxPerClaim: 1 });
    expect(entries!.map((entry) => entry.outcome.ok)).toEqual([false, true]);
  });

  it('停止之後不再開新的抓取', async () => {
    let stopped = false;
    let calls = 0;
    const plans = [[url(0, 0), url(0, 1)], [url(1, 0)]];
    await collectSources(
      plans,
      async (candidate) => {
        calls += 1;
        stopped = true;
        return { ok: false, url: candidate.kind === 'url' ? candidate.url : '', title: '', reason: 'x' };
      },
      { isStopped: () => stopped },
    );
    expect(calls).toBeLessThanOrEqual(2);
  });
});

describe('verifyFindings：引文核對與降級', () => {
  const quote = '本片於1994年9月10日在多倫多國際電影節首映';

  it('對得上：found＋前後文，判定照收', () => {
    const [finding] = verifyFindings(
      [judged([{ ref: 'S1', text: SOURCE_TEXT }])],
      output([
        { claimIndex: 0, verdict: 'contradicted', evidence: '來源寫 1994', correction: '應該是 1994 年', citations: [{ ref: 'S1', quote }] },
      ]),
    );
    expect(finding!.verdict).toBe('contradicted');
    expect(finding!.agentVerdict).toBe('contradicted');
    expect(finding!.correction).toBe('應該是 1994 年');
    expect(finding!.sources[0]).toMatchObject({ check: 'found', quote });
    expect(finding!.sources[0]!.context).toContain(quote);
  });

  it('引文忽略空白比對（Agent 自己加空格也對得上）', () => {
    const [finding] = verifyFindings(
      [judged([{ ref: 'S1', text: SOURCE_TEXT }])],
      output([{ claimIndex: 0, verdict: 'supported', evidence: '', citations: [{ ref: 'S1', quote: '本片於 1994 年 9 月 10 日在多倫多' }] }]),
    );
    expect(finding!.verdict).toBe('supported');
  });

  it('supported／contradicted 沒有 found 引文 → unverifiable，agentVerdict 保留，不留 correction', () => {
    const [finding] = verifyFindings(
      [judged([{ ref: 'S1', text: SOURCE_TEXT }])],
      output([
        {
          claimIndex: 0,
          verdict: 'contradicted',
          evidence: '來源寫 1993',
          correction: '應該是 1993 年',
          citations: [{ ref: 'S1', quote: '本片於1993年在某地首映了好多次' }],
        },
      ]),
    );
    expect(finding!.verdict).toBe('unverifiable');
    expect(finding!.agentVerdict).toBe('contradicted');
    expect(finding!.correction).toBeNull();
    expect(finding!.sources[0]).toMatchObject({ check: 'not-found', quote: '本片於1993年在某地首映了好多次', context: null });
  });

  it('少於 8 個非空白字的引文不算核對過', () => {
    const [finding] = verifyFindings(
      [judged([{ ref: 'S1', text: SOURCE_TEXT }])],
      output([{ claimIndex: 0, verdict: 'supported', evidence: '', citations: [{ ref: 'S1', quote: '1994 年' }] }]),
    );
    expect(finding!.verdict).toBe('unverifiable');
    expect(finding!.agentVerdict).toBe('supported');
    expect(locateQuote(SOURCE_TEXT, '1994年9月')).toBeNull();
    expect(locateQuote(SOURCE_TEXT, '1994年9月1')).not.toBeNull();
  });

  it('needs-context、unverifiable 不需要引文', () => {
    const [finding] = verifyFindings(
      [judged([{ ref: 'S1', text: SOURCE_TEXT }])],
      output([{ claimIndex: 0, verdict: 'needs-context', evidence: '要看前後文', citations: [] }]),
    );
    expect(finding!.verdict).toBe('needs-context');
  });

  it('不存在的 ref、不是給這條主張的 ref：那條引文丟掉', () => {
    const claims = [
      judged([{ ref: 'S1', text: '第一份來源，沒有提到年份的任何文字內容在這裡。' }], 0),
      judged([{ ref: 'S2', text: SOURCE_TEXT }], 1, '另一句'),
    ];
    const findings = verifyFindings(
      claims,
      output([
        // S2 是第二條的來源，S9 不存在：都不能撐第一條的 supported。
        { claimIndex: 0, verdict: 'supported', evidence: '', citations: [{ ref: 'S2', quote }, { ref: 'S9', quote }] },
        { claimIndex: 1, verdict: 'supported', evidence: '', citations: [{ ref: 'S2', quote }] },
      ]),
    );
    expect(findings[0]!.verdict).toBe('unverifiable');
    expect(findings[0]!.sources).toHaveLength(1);
    expect(findings[0]!.sources[0]).toMatchObject({ check: 'not-found', quote: null });
    expect(findings[1]!.verdict).toBe('supported');
  });

  it('漏回的主張記 unverifiable；不存在的 claimIndex 丟掉；同一個出現兩次留第一個', () => {
    const claims = [judged([{ ref: 'S1', text: SOURCE_TEXT }], 0), judged([{ ref: 'S2', text: SOURCE_TEXT }], 1, '另一句')];
    const findings = verifyFindings(
      claims,
      output([
        { claimIndex: 7, verdict: 'supported', evidence: '不存在的編號', citations: [{ ref: 'S1', quote }] },
        { claimIndex: 0, verdict: 'supported', evidence: '第一個', citations: [{ ref: 'S1', quote }] },
        { claimIndex: 0, verdict: 'contradicted', evidence: '第二個', citations: [{ ref: 'S1', quote }] },
      ]),
    );
    expect(findings[0]).toMatchObject({ verdict: 'supported', evidence: '第一個' });
    expect(findings[1]).toMatchObject({ verdict: 'unverifiable', agentVerdict: 'unverifiable', evidence: AGENT_SKIPPED_EVIDENCE });
  });

  it('沒抓到來源的主張：unverifiable，抓不到的來源照樣列出原因', () => {
    const [finding] = verifyFindings(
      [
        {
          excerpt: 'x',
          claim: 'y',
          judgeIndex: null,
          sources: [],
          failed: [{ url: 'https://e.example/', title: 'E', origin: 'agent-search', reason: '網址含文章原句，沒抓' }],
        },
      ],
      null,
    );
    expect(finding).toMatchObject({ verdict: 'unverifiable', evidence: NO_SOURCE_EVIDENCE });
    expect(finding!.sources).toEqual([
      {
        url: 'https://e.example/',
        title: 'E',
        origin: 'agent-search',
        quote: null,
        check: 'fetch-failed',
        failReason: '網址含文章原句，沒抓',
        context: null,
      },
    ]);
  });

  it('核對拿「實際給 Agent 的文字」比：原文的 ===== 在 prompt 裡變成 …，照抄 Agent 看到的才對得上', () => {
    const raw = '開頭說明文字 ===== 結尾說明文字，後面還有更多內容';
    const claims = [judged([{ ref: 'S1', text: raw }])];
    const seen = verifyFindings(
      claims,
      output([{ claimIndex: 0, verdict: 'supported', evidence: '', citations: [{ ref: 'S1', quote: '開頭說明文字 … 結尾說明文字' }] }]),
    );
    expect(seen[0]!.verdict).toBe('supported');
    const original = verifyFindings(
      claims,
      output([{ claimIndex: 0, verdict: 'supported', evidence: '', citations: [{ ref: 'S1', quote: '開頭說明文字 ===== 結尾說明文字' }] }]),
    );
    expect(original[0]!.verdict).toBe('unverifiable');
  });

  it('前後文各約 150 字，截掉的地方加…', () => {
    const text = `${'前'.repeat(300)}本片於1994年9月10日首映${'後'.repeat(300)}`;
    const context = locateQuote(text, '本片於1994年9月10日首映')!;
    expect(context.startsWith('…')).toBe(true);
    expect(context.endsWith('…')).toBe(true);
    expect(Array.from(context).length).toBeLessThanOrEqual(150 * 2 + 20 + 2);
  });
});

describe('同一句與原句已經改了', () => {
  it('sameExcerpt 忽略空白；空的不算', () => {
    expect(sameExcerpt('這部片 1995 年上映', '這部片1995年上映')).toBe(true);
    expect(sameExcerpt('這部片 1995 年上映', '這部片 1994 年上映')).toBe(false);
    expect(sameExcerpt(' ', ' ')).toBe(false);
  });

  it('isExcerptGone：任何一段文字裡找得到（忽略空白）就還在', () => {
    expect(isExcerptGone('這部片 1995 年上映', ['標題', '這部片1995年上映。'])).toBe(false);
    expect(isExcerptGone('這部片 1995 年上映', ['標題', '這部片1994年上映。'])).toBe(true);
    expect(isExcerptGone('  ', ['x'])).toBe(true);
  });

  it('countOpenContradictions：只算說法不同、open、原句還在', () => {
    expect(
      countOpenContradictions([
        { verdict: 'contradicted', status: 'open', excerptGone: false },
        { verdict: 'contradicted', status: 'open', excerptGone: true },
        { verdict: 'contradicted', status: 'dismissed', excerptGone: false },
        { verdict: 'supported', status: 'open', excerptGone: false },
      ]),
    ).toBe(1);
  });
});

describe('選字長度', () => {
  it('4～300 字（空白摺疊後、code point）', () => {
    expect(selectionLength('  a  b  ')).toBe(3);
    expect(checkFactCheckSelection('一二三').ok).toBe(false);
    expect(checkFactCheckSelection('一二三四').ok).toBe(true);
    expect(checkFactCheckSelection('😀'.repeat(300)).ok).toBe(true);
    expect(checkFactCheckSelection('字'.repeat(301)).ok).toBe(false);
  });
});

describe('extractLinks：段落裡本來就有的連結', () => {
  it('只收 http(s) 絕對網址，帶連結文字', () => {
    const html =
      '<p>見<a href="https://example.org/review">這篇 <strong>影評</strong></a>、<a href="/local">站內</a>、<a href="#x">錨點</a>、<a href="mailto:a@b.c">信</a></p>';
    expect(extractLinks(html)).toEqual([{ url: 'https://example.org/review', text: '這篇 影評' }]);
  });
});
