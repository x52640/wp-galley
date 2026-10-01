/**
 * AI 查證的純函式（D-034，P6-T004；規格 docs/specs/factcheck.md）：主張挑選、候選來源規劃與分配、
 * 引文核對與降級、`superseded` 判斷。不碰資料庫、不碰網路（抓取由呼叫方注入），好測。
 *
 * **核對以「實際給 Agent 的文字」為準**：第一趟的 excerpt 拿 `articleTextForAgent(原文)` 比，
 * 第二趟的引文拿 `sourceTextForAgent(截短後的文字)` 比（prompt 裡放的就是這兩個的輸出）。
 */

import { parseFragment, type DefaultTreeAdapterMap } from 'parse5';
import { findIgnoringSpaces } from '../contract/text-match.js';
import type {
  FactCheckSource,
  FactCheckSourceCheck,
  FactCheckSourceOrigin,
  FactCheckVerdict,
} from '../contract/api.js';
import { correctionOf, type FactCheckFindClaim, type FactCheckJudgeOutput } from '../agents/output-contract.js';

/** 整次查證最多留幾份來源、每條主張最多幾份（factcheck.md「挑選與上限」）。 */
export const FACTCHECK_MAX_SOURCES = 8;
export const FACTCHECK_MAX_SOURCES_PER_CLAIM = 3;
/** 少於這麼多個非空白字的引文不算核對過：「1994」到處都找得到，證明不了什麼。 */
export const MIN_QUOTE_CHARS = 8;
/** 「看原文」展開的前後文，引文前後各約幾個字。 */
export const QUOTE_CONTEXT_RADIUS = 150;

function compact(text: string): string {
  return text.replace(/\s+/gu, '');
}

/** 兩段 excerpt 是不是同一句（忽略空白相等）：同一句再查，舊的 open 結果標成 `superseded`。 */
export function sameExcerpt(a: string, b: string): boolean {
  const left = compact(a);
  return left.length > 0 && left === compact(b);
}

// --- ① 第一趟的主張 -----------------------------------------------------------

/**
 * 留下 excerpt 在文章裡找得到（忽略空白）的主張，最多 `max` 條。`agentTexts` 是**給 Agent 看的那幾份**
 * （`articleTextForAgent` 的輸出：標題、正文…）。空的 excerpt 當成找不到。
 * 先丟找不到的、再截數量：丟掉的不該佔名額。`dropped` 只算找不到的。
 */
export function selectClaims(
  claims: readonly FactCheckFindClaim[],
  options: { readonly max: number; readonly agentTexts: readonly string[] },
): { kept: FactCheckFindClaim[]; dropped: number } {
  const found = claims.filter(
    (claim) =>
      typeof claim.excerpt === 'string' &&
      compact(claim.excerpt).length > 0 &&
      options.agentTexts.some((text) => findIgnoringSpaces(text, claim.excerpt) !== null),
  );
  return { kept: found.slice(0, options.max), dropped: claims.length - found.length };
}

// --- ② 候選來源 -----------------------------------------------------------------

export interface ArticleLink {
  readonly url: string;
  readonly text: string;
}

/** 一段 HTML 裡的 http(s) 連結（使用者自己引的出處）。站內相對路徑、`#` 錨點、`mailto:` 不算。 */
export function extractLinks(html: string): ArticleLink[] {
  const out: ArticleLink[] = [];
  const stack: unknown[] = [parseFragment(html)];
  while (stack.length > 0) {
    const node = stack.pop() as DefaultTreeAdapterMap['element'] | DefaultTreeAdapterMap['documentFragment'];
    const children = 'childNodes' in node ? node.childNodes : [];
    if ('tagName' in node && node.tagName === 'a') {
      const href = node.attrs.find((attr) => attr.name === 'href')?.value.trim() ?? '';
      if (/^https?:\/\//iu.test(href)) out.push({ url: href, text: textOf(node).replace(/\s+/gu, ' ').trim() });
    }
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
  }
  return out;
}

function textOf(node: DefaultTreeAdapterMap['element']): string {
  let text = '';
  const stack: unknown[] = [...node.childNodes].reverse();
  while (stack.length > 0) {
    const child = stack.pop() as { nodeName: string; value?: string; childNodes?: unknown[] };
    if (child.nodeName === '#text') text += child.value ?? '';
    else if (child.childNodes) stack.push(...[...child.childNodes].reverse());
  }
  return text;
}

export type FactCheckCandidate =
  | {
      readonly kind: 'url';
      readonly url: string;
      readonly origin: Exclude<FactCheckSourceOrigin, 'wikipedia'>;
      /** Agent 給的標題、或文章連結的文字；抓到之後沒有更好的標題就用它。 */
      readonly title: string;
    }
  | { readonly kind: 'wikipedia'; readonly lang: 'zh' | 'en'; readonly query: string };

export interface ClaimCandidateInput {
  readonly links: readonly ArticleLink[];
  readonly agentUrls: readonly { readonly url: string; readonly title: string }[];
  readonly queries: readonly { readonly q: string; readonly lang: 'zh' | 'en' }[];
}

/**
 * 每條主張的候選，依序：`article-link` → `agent-search`／`agent-memory` → `wikipedia`。
 * 維基百科每條主張、每個語言只用第一個搜尋字串。**同一網址整次只出現一次**（給排在前面的那條主張），
 * 同一個「語言＋搜尋字串」也只查一次。
 */
export function planCandidates(
  claims: readonly ClaimCandidateInput[],
  options: { readonly hostedSearch: boolean },
): FactCheckCandidate[][] {
  const seenUrls = new Set<string>();
  const seenQueries = new Set<string>();
  const agentOrigin = options.hostedSearch ? 'agent-search' : 'agent-memory';
  return claims.map((claim) => {
    const list: FactCheckCandidate[] = [];
    const addUrl = (url: string, origin: Exclude<FactCheckSourceOrigin, 'wikipedia'>, title: string): void => {
      const key = url.trim();
      if (key === '' || seenUrls.has(key)) return;
      seenUrls.add(key);
      list.push({ kind: 'url', url: key, origin, title: title.trim() });
    };
    for (const link of claim.links) addUrl(link.url, 'article-link', link.text);
    for (const candidate of claim.agentUrls) addUrl(candidate.url, agentOrigin, candidate.title);
    for (const lang of ['zh', 'en'] as const) {
      const first = claim.queries.find((query) => query.lang === lang && query.q.trim() !== '');
      if (!first) continue;
      const key = `${lang}:${first.q.trim().toLowerCase()}`;
      if (seenQueries.has(key)) continue;
      seenQueries.add(key);
      list.push({ kind: 'wikipedia', lang, query: first.q.trim() });
    }
    return list;
  });
}

export type CandidateOutcome =
  | { readonly ok: true; readonly url: string; readonly title: string; readonly text: string }
  | { readonly ok: false; readonly url: string; readonly title: string; readonly reason: string };

export interface CollectedSource {
  readonly candidate: FactCheckCandidate;
  readonly outcome: CandidateOutcome;
}

/**
 * 輪流分配（factcheck.md「挑選與上限」）：第 k 輪，還沒滿 k 份、還有候選的主張各自依序抓到一份成功為止；
 * 每輪最多開「剩下幾個名額」條主張（照主張順序），所以整次不會超過 `maxTotal`，每條至少輪到一次。
 * 同一輪的主張同時抓（同時數由取回器的額度管）；同一條主張內照候選順序一個一個來。
 * `isStopped()` 為真就不再開新的抓取（使用者按了停止）。
 */
export async function collectSources(
  plans: readonly (readonly FactCheckCandidate[])[],
  fetchOne: (candidate: FactCheckCandidate) => Promise<CandidateOutcome>,
  options: {
    readonly maxTotal?: number;
    readonly maxPerClaim?: number;
    readonly isStopped?: () => boolean;
    readonly onOutcome?: (outcome: CandidateOutcome) => void;
  } = {},
): Promise<CollectedSource[][]> {
  const maxTotal = options.maxTotal ?? FACTCHECK_MAX_SOURCES;
  const maxPerClaim = options.maxPerClaim ?? FACTCHECK_MAX_SOURCES_PER_CLAIM;
  const stopped = options.isStopped ?? (() => false);
  const results: CollectedSource[][] = plans.map(() => []);
  const fetched = plans.map(() => 0);
  const cursor = plans.map(() => 0);

  for (let round = 1; round <= maxPerClaim; round++) {
    if (stopped()) break;
    const total = fetched.reduce((n, count) => n + count, 0);
    const eligible = plans
      .map((plan, index) => index)
      .filter((index) => fetched[index]! === round - 1 && cursor[index]! < plans[index]!.length);
    const lanes = eligible.slice(0, Math.max(0, maxTotal - total));
    if (lanes.length === 0) break;
    await Promise.all(
      lanes.map(async (index) => {
        const plan = plans[index]!;
        while (cursor[index]! < plan.length && !stopped()) {
          const candidate = plan[cursor[index]!]!;
          cursor[index] = cursor[index]! + 1;
          const outcome = await fetchOne(candidate);
          if (stopped()) return;
          results[index]!.push({ candidate, outcome });
          options.onOutcome?.(outcome);
          if (outcome.ok) {
            fetched[index] = fetched[index]! + 1;
            return;
          }
        }
      }),
    );
  }
  return results;
}

/** 候選在畫面上的來源種類。 */
export function originOf(candidate: FactCheckCandidate): FactCheckSourceOrigin {
  return candidate.kind === 'wikipedia' ? 'wikipedia' : candidate.origin;
}

/** 沒有更好的標題時用網域。 */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

// --- ③④ 判斷與核對 --------------------------------------------------------------

/** 給第二趟的一份來源（已編號、已截短）。`agentText` = `sourceTextForAgent(截短後的文字)`，核對以它為準。 */
export interface JudgedSource {
  readonly ref: string;
  readonly url: string;
  readonly title: string;
  readonly origin: FactCheckSourceOrigin;
  readonly agentText: string;
}

/** 一條要存的主張：有來源的才給第二趟（`judgeIndex` 是它在第二趟 prompt 裡的編號），沒有的直接記查不到。 */
export interface ClaimForVerify {
  readonly excerpt: string;
  readonly claim: string;
  /** 在第二趟裡的編號；null＝沒抓到來源、沒給第二趟。 */
  readonly judgeIndex: number | null;
  readonly sources: readonly JudgedSource[];
  /** 抓不到的來源（照樣列在卡片上）。 */
  readonly failed: readonly { readonly url: string; readonly title: string; readonly origin: FactCheckSourceOrigin; readonly reason: string }[];
}

export interface FindingDraft {
  readonly excerpt: string;
  readonly claim: string;
  readonly verdict: FactCheckVerdict;
  readonly agentVerdict: FactCheckVerdict;
  readonly evidence: string;
  readonly correction: string | null;
  readonly sources: FactCheckSource[];
}

export const NO_SOURCE_EVIDENCE = '一份來源都沒抓到，沒有請 AI 判斷這一條。';
export const AGENT_SKIPPED_EVIDENCE = 'AI 沒有回這一條。';

/**
 * 核對與降級（factcheck.md「④ 核對與降級」）：
 * - 不存在的 `claimIndex` 丟掉；同一個出現兩次留第一個；漏掉的主張記 `unverifiable`（「AI 沒有回這一條」）。
 * - 不存在的 `ref`、或不是給這條主張的 `ref`，那條引文丟掉。
 * - 引文到它 `ref` 那一份**實際給 Agent 的文字**裡找（忽略空白）；少於 8 個非空白字的不算。
 * - `supported`／`contradicted` 至少要一條對得上，否則改成 `unverifiable`，`agentVerdict` 留原本的；
 *   被降級的不留 `correction`（沒有對得上的出處撐著它）。
 */
export function verifyFindings(claims: readonly ClaimForVerify[], output: FactCheckJudgeOutput | null): FindingDraft[] {
  const judgedCount = claims.filter((claim) => claim.judgeIndex !== null).length;
  const byIndex = new Map<number, FactCheckJudgeOutput['findings'][number]>();
  for (const finding of output?.findings ?? []) {
    const index = finding.claimIndex;
    if (!Number.isInteger(index) || index < 0 || index >= judgedCount || byIndex.has(index)) continue;
    byIndex.set(index, finding);
  }

  return claims.map((claim): FindingDraft => {
    const failedSources = claim.failed.map(
      (failure): FactCheckSource => ({
        url: failure.url,
        title: failure.title,
        origin: failure.origin,
        quote: null,
        check: 'fetch-failed',
        failReason: failure.reason,
        context: null,
      }),
    );
    const base = { excerpt: claim.excerpt, claim: claim.claim };
    if (claim.judgeIndex === null) {
      return {
        ...base,
        verdict: 'unverifiable',
        agentVerdict: 'unverifiable',
        evidence: NO_SOURCE_EVIDENCE,
        correction: null,
        sources: failedSources,
      };
    }

    const finding = byIndex.get(claim.judgeIndex);
    const refs = new Map(claim.sources.map((source) => [source.ref, source]));
    const citations = (finding?.citations ?? []).filter(
      (citation) => typeof citation.ref === 'string' && typeof citation.quote === 'string' && refs.has(citation.ref),
    );

    let anyFound = false;
    const checked = claim.sources.map((source): FactCheckSource => {
      const mine = citations.filter((citation) => citation.ref === source.ref);
      let chosen: { quote: string; check: FactCheckSourceCheck; context: string | null } | null = null;
      for (const citation of mine) {
        const context = locateQuote(source.agentText, citation.quote);
        if (context !== null) {
          chosen = { quote: citation.quote, check: 'found', context };
          break;
        }
        chosen ??= { quote: citation.quote, check: 'not-found', context: null };
      }
      if (chosen?.check === 'found') anyFound = true;
      return {
        url: source.url,
        title: source.title,
        origin: source.origin,
        quote: chosen?.quote ?? null,
        check: chosen?.check ?? 'not-found',
        failReason: null,
        context: chosen?.context ?? null,
      };
    });

    if (!finding) {
      return {
        ...base,
        verdict: 'unverifiable',
        agentVerdict: 'unverifiable',
        evidence: AGENT_SKIPPED_EVIDENCE,
        correction: null,
        sources: [...checked, ...failedSources],
      };
    }

    const agentVerdict = finding.verdict;
    const needsQuote = agentVerdict === 'supported' || agentVerdict === 'contradicted';
    const downgraded = needsQuote && !anyFound;
    return {
      ...base,
      verdict: downgraded ? 'unverifiable' : agentVerdict,
      agentVerdict,
      evidence: finding.evidence,
      correction: downgraded ? null : correctionOf(finding),
      sources: [...checked, ...failedSources],
    };
  });
}

/**
 * 引文對得上就回前後文（引文前後各約 150 字），對不上回 null。少於 8 個非空白字的一律對不上。
 * 前後被截掉的地方加「…」；不切壞 surrogate pair。
 */
export function locateQuote(text: string, quote: string, radius = QUOTE_CONTEXT_RADIUS): string | null {
  if (compact(quote).length < MIN_QUOTE_CHARS) return null;
  const hit = findIgnoringSpaces(text, quote);
  if (hit === null) return null;
  let start = Math.max(0, hit.start - radius);
  if (start > 0 && isLowSurrogate(text.charCodeAt(start))) start -= 1;
  let end = Math.min(text.length, hit.end + radius);
  if (end < text.length && isLowSurrogate(text.charCodeAt(end))) end += 1;
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}
