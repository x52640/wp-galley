/**
 * AI 查證（對應後端 `service/factcheck.ts`，P6-T005）：發起、列出、知道了，以及給其他領域用的兩個小工具
 * （存檔時「去原文改」結案、發布面板提醒的條數）。
 *
 * 只放假資料與「假裝是資料庫」的部分。判定、核對、降級是後端的事，這裡直接寫結果；
 * `blockIndex`、`excerptGone` 在種子資料裡**寫死**（後端用 `articleTextForAgent` 處理過的文字算，那份前處理不搬過來）。
 * 前後端都要的規則（選字長度、觀察卡片種類、說法不同的條數）用 `src/contract/factcheck.ts`。
 *
 * 跑一次查證會照真的流程走四個階段（找來源 → 抓網頁 → 判斷 → 核對），每段等幾秒，`agentRun.factCheck` 跟著變，
 * 練得到進度畫面。`?factcheck=nofetch` 模擬一個來源都沒抓到（第二趟不跑）。
 */

import { EMPTY_BODY_AGENT_MESSAGE, isBlankBody } from '../../../contract/empty-body.js';
import {
  canFactCheckObservation,
  checkFactCheckSelection,
  countOpenContradictions,
  isExcerptGone,
} from '../../../contract/factcheck.js';
import { findIgnoringSpaces } from '../../../contract/text-match.js';
import { mergeByBlock, providerHasHostedSearch } from '../../lib/factcheck-view.js';
import { isFinished } from '../../lib/steps.js';
import type {
  FactCheckFinding,
  FactCheckListResponse,
  FactCheckRequest,
  FactCheckRun,
  FactCheckRunResult,
  FactCheckSource,
  PublisherApi,
} from '../types.js';
import type { Writable } from './store.js';
import { blockText, bodyBlocks, clone, delay, mustGet, readBody } from './context.js';

type Finding = Writable<FactCheckFinding>;

interface FactCheckState {
  findings: Finding[];
  latestRun: FactCheckRun | null;
}

const WIKI_ZH = 'https://zh.wikipedia.org/wiki/%E5%88%BA%E6%BF%801995';
const WIKI_EN = 'https://en.wikipedia.org/wiki/The_Shawshank_Redemption';

function src(partial: Partial<FactCheckSource> & Pick<FactCheckSource, 'url' | 'title' | 'origin' | 'check'>): FactCheckSource {
  return { quote: null, failReason: null, context: null, ...partial };
}

function base(id: number, partial: Partial<Finding> & Pick<Finding, 'excerpt' | 'verdict' | 'evidence' | 'sources'>): Finding {
  return {
    id,
    runId: 1,
    claim: partial.excerpt,
    agentVerdict: partial.verdict,
    correction: null,
    blockIndex: null,
    status: 'open',
    excerptGone: false,
    agentId: 'claude',
    revisionId: 1002,
    createdAt: '2026-09-30T08:05:00Z',
    resolvedAt: null,
    ...partial,
  };
}

/** 「一鍵查證」會查出來的那幾條（`f-factcheck` 的正文，見 data.ts 的 `FACTCHECK_BODY`）。 */
function articleFindings(nextId: () => number, runId: number, provider: FactCheckFinding['agentId']): Finding[] {
  const memory = !providerHasHostedSearch(provider);
  const web = memory ? 'agent-memory' : 'agent-search';
  const common = { runId, agentId: provider, createdAt: new Date().toISOString() };
  return [
    base(nextId(), {
      ...common,
      excerpt: '這部片 1995 年上映',
      claim: '《刺激1995》在 1995 年上映',
      verdict: 'contradicted',
      evidence: '維基百科寫 1994 年 9 月在多倫多影展首映，同月在美國上映。',
      correction: '改成 1994 年。',
      blockIndex: 0,
      sources: [
        src({
          url: WIKI_ZH,
          title: '刺激1995',
          origin: 'wikipedia',
          check: 'found',
          quote: '1994年9月10日在多倫多國際電影節首映',
          context:
            '《刺激1995》（英語：The Shawshank Redemption）是一部美國劇情片，由法蘭克·戴拉邦特編劇與執導，改編自史蒂芬·金的中篇小說。' +
            '本片於1994年9月10日在多倫多國際電影節首映，同年9月23日在美國上映。上映初期票房不理想，之後透過錄影帶與電視播映累積了大量觀眾。',
        }),
        src({
          url: 'https://www.imdb.com/title/tt0111161/',
          title: 'The Shawshank Redemption (1994) - IMDb',
          origin: web,
          check: 'fetch-failed',
          failReason: '網頁太大',
        }),
      ],
    }),
    base(nextId(), {
      ...common,
      excerpt: '北美首輪只收了大約一千六百萬美元',
      claim: '《刺激1995》在北美首輪上映的票房約一千六百萬美元',
      verdict: 'supported',
      evidence: '英文維基百科寫首輪上映的票房約 1,600 萬美元，跟文章一致。',
      blockIndex: 1,
      sources: [
        src({
          url: WIKI_EN,
          title: 'The Shawshank Redemption',
          origin: 'wikipedia',
          check: 'found',
          quote: 'grossing $16 million during its initial theatrical release',
          context:
            'The film was a box-office disappointment, grossing $16 million during its initial theatrical release against a $25 million budget. ' +
            'It received positive reviews and later found an audience on home video and cable television.',
        }),
        src({
          url: 'https://www.boxofficemojo.com/title/tt0111161/',
          title: 'The Shawshank Redemption - Box Office Mojo',
          origin: web,
          check: 'not-found',
        }),
      ],
    }),
    // 被降級：AI 說有來源支持，但它引的話在網頁上找不到。
    base(nextId(), {
      ...common,
      excerpt: '肖申克監獄其實是俄亥俄州一座已經關閉的感化院',
      claim: '片中的肖申克監獄在俄亥俄州一座已經關閉的感化院拍攝',
      verdict: 'unverifiable',
      agentVerdict: 'supported',
      evidence: '拍攝地是俄亥俄州曼斯菲爾德的俄亥俄州感化院，1990 年關閉，現在開放參觀。',
      blockIndex: 3,
      sources: [
        src({
          url: 'https://www.mrps.org/',
          title: 'Ohio State Reformatory',
          origin: web,
          check: 'not-found',
          quote: 'The reformatory closed in 1990 and now offers public tours',
        }),
        src({
          url: 'https://news.example.tw/2024/肖申克監獄其實是俄亥俄州一座已經關閉的感化院',
          title: '肖申克監獄其實是俄亥俄州一座已經關閉的感化院',
          origin: web,
          check: 'fetch-failed',
          failReason: '網址含文章原句，沒抓',
        }),
      ],
    }),
    base(nextId(), {
      ...common,
      excerpt: '只花了五千美元就買下改編權',
      claim: '戴拉邦特用五千美元買下改編權',
      verdict: 'needs-context',
      evidence:
        '維基百科寫戴拉邦特以 5,000 美元買下改編權，但史蒂芬・金一直沒有兌現那張支票，後來裱框寄回給他；說「只花了」要看你想強調什麼。',
      blockIndex: 4,
      sources: [
        src({
          url: WIKI_ZH,
          title: '刺激1995',
          origin: 'wikipedia',
          check: 'found',
          quote: '以5,000美元向史蒂芬·金購得改編權',
          context: '戴拉邦特在1987年以5,000美元向史蒂芬·金購得改編權。金始終沒有兌現這張支票，多年後將它裱框寄回給戴拉邦特。',
        }),
      ],
    }),
    base(nextId(), {
      ...common,
      excerpt: '研究顯示，重看喜歡的電影能降低焦慮',
      claim: '有研究指出重看喜歡的電影能降低焦慮',
      verdict: 'unverifiable',
      evidence: '抓回來的來源都沒有講到這個研究。',
      blockIndex: 5,
      sources: [
        src({
          url: 'https://www.psychologytoday.com/us/blog/rewatching-comfort-films',
          title: 'Why We Rewatch Comfort Films',
          origin: web,
          check: 'fetch-failed',
          failReason: '逾時',
        }),
        src({
          url: 'https://zh.wikipedia.org/w/index.php?search=%E9%87%8D%E7%9C%8B%E9%9B%BB%E5%BD%B1+%E7%84%A6%E6%85%AE',
          title: '維基百科：重看電影 焦慮',
          origin: 'wikipedia',
          check: 'fetch-failed',
          failReason: '維基百科沒有找到條目',
        }),
      ],
    }),
  ];
}

function seedFactcheck(): FactCheckState {
  let id = 0;
  const findings = articleFindings(() => ++id, 1, 'claude');
  findings.push(
    base(++id, {
      excerpt: '改編自史蒂芬・金的中篇小說',
      claim: '《刺激1995》改編自史蒂芬・金的中篇小說',
      verdict: 'supported',
      evidence: '維基百科寫改編自史蒂芬・金的中篇小說《麗塔海華絲與蕭山克的救贖》。',
      blockIndex: 0,
      status: 'dismissed',
      resolvedAt: '2026-09-30T08:20:00Z',
      sources: [src({ url: WIKI_ZH, title: '刺激1995', origin: 'wikipedia', check: 'found', quote: '改編自史蒂芬·金的中篇小說' })],
    }),
    // 原句已經改了：還是 open，但 excerpt 在目前的文章裡找不到（後端讀取時算，這裡寫死）。
    base(++id, {
      excerpt: '拍完之後成了全美最熱門的觀光景點',
      verdict: 'contradicted',
      evidence: '來源只說開放參觀，沒有「全美最熱門」的說法。',
      correction: '改成「現在開放參觀」。',
      excerptGone: true,
      sources: [src({ url: 'https://www.mrps.org/', title: 'Ohio State Reformatory', origin: 'agent-search', check: 'found', quote: 'open for tours' })],
    }),
    base(++id, {
      excerpt: '法蘭克・戴拉邦特在 1990 年執導',
      verdict: 'contradicted',
      evidence: '電影是 1993 年開拍的。',
      status: 'resolved-by-edit',
      resolvedAt: '2026-09-30T08:25:00Z',
      sources: [src({ url: WIKI_ZH, title: '刺激1995', origin: 'wikipedia', check: 'found', quote: '1993年開拍' })],
    }),
  );
  return {
    findings,
    latestRun: {
      id: 1,
      scope: 'article',
      provider: 'claude',
      status: 'succeeded',
      stage: 'verify',
      counts: { candidates: 9, fetched: 5, fetchFailed: 4, droppedClaims: 1 },
      hostedSearch: true,
      judged: true,
      revisionId: 1002,
      startedAt: '2026-09-30T08:03:00Z',
      finishedAt: '2026-09-30T08:05:00Z',
      errorMessage: null,
    },
  };
}

const states = new Map<string, FactCheckState>([['f-factcheck', seedFactcheck()]]);
let nextFindingId = 100;
let nextRunId = 10;

function stateOf(uuid: string): FactCheckState {
  let state = states.get(uuid);
  if (!state) {
    state = { findings: [], latestRun: null };
    states.set(uuid, state);
  }
  return state;
}

/** 發布面板提醒的條數（後端放在 `JobDetail.openFactCheckContradictions`）。 */
export function openContradictionsFor(uuid: string): number {
  return countOpenContradictions(stateOf(uuid).findings);
}

/** 從查證卡片「去原文改」、存成新版本：那條結成 resolved-by-edit（後端 createRevision 的 `resolveFactCheckId`）。 */
export function resolveFactCheckByEdit(uuid: string, findingId: number): void {
  const finding = stateOf(uuid).findings.find((item) => item.id === findingId);
  if (finding?.status === 'open') {
    finding.status = 'resolved-by-edit';
    finding.excerptGone = false;
    finding.resolvedAt = new Date().toISOString();
  }
}

function slow(): number {
  if (typeof window === 'undefined') return 3200;
  return new URLSearchParams(window.location.search).get('fcslow') === '1' ? 9000 : 3200;
}

function noFetch(): boolean {
  return typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('factcheck') === 'nofetch';
}

/**
 * 選字查證的段落：示範資料的正文一行一個區塊、沒有後端那些會被刪掉的特殊字，直接用共用的忽略空白比對找第一段
 * （後端是拿前處理過的文字算的；示範資料不搬那份前處理）。
 */
function blockOf(body: string, text: string): number | null {
  const index = bodyBlocks(body).findIndex((html) => findIgnoringSpaces(blockText(html), text) !== null);
  return index >= 0 ? index : null;
}

export const factcheckApi: Pick<PublisherApi, 'runFactCheck' | 'listFactChecks' | 'dismissFactCheck'> = {
  async runFactCheck(uuid: string, input: FactCheckRequest): Promise<FactCheckRunResult> {
    const job = mustGet(uuid);
    const body = readBody(job);
    // 跟後端 assertMutable 同一句（不能改內容的狀態：已結束、發布中、已發布）。示範資料不能 import core 的狀態機。
    if (isFinished(job.state) || job.state === 'PUBLISHING') throw new Error(`工作項目目前是 ${job.state}，不能再改內容`);
    if (isBlankBody(job.currentRevision?.publishHtml)) throw new Error(EMPTY_BODY_AGENT_MESSAGE);
    if (job.agentRun?.status === 'running') throw new Error('這個工作項目已經有一個 Agent 在跑了，先取消或等它跑完');

    // 先驗完再開始：跟後端一樣，錯的請求不留紀錄、不花額度。
    let excerpt: string | null = null;
    let blockIndex: number | null = null;
    if (input.scope === 'selection') {
      const selection = input.selection ?? '';
      const checked = checkFactCheckSelection(selection);
      if (!checked.ok) throw new Error(checked.message);
      const title = typeof job.currentRevision?.templateData['title'] === 'string' ? (job.currentRevision.templateData['title'] as string) : '';
      if (isExcerptGone(selection, [title, ...bodyBlocks(body).map(blockText)])) {
        throw new Error('選的字在目前的文章裡找不到，重新選一次再查');
      }
      excerpt = selection.replace(/\s+/gu, ' ').trim();
      blockIndex = blockOf(body, selection);
    } else if (input.scope === 'observation') {
      const item = job.review?.items.find((candidate) => candidate.id === input.observationItemId);
      if (!item?.observation) throw new Error('找不到這張觀察卡片');
      if (!canFactCheckObservation(item.observation.kind)) throw new Error('這種觀察卡片不能查證');
      excerpt = item.observation.excerpt;
      blockIndex = item.blockIndex;
    }

    const state = stateOf(uuid);
    const hostedSearch = providerHasHostedSearch(input.provider);
    const runId = ++nextRunId;
    const startedAt = new Date().toISOString();
    const zero = { candidates: 0, fetched: 0, fetchFailed: 0, droppedClaims: 0 };
    const nothing = noFetch();
    let run: FactCheckRun = {
      id: runId,
      scope: input.scope,
      provider: input.provider,
      status: 'running',
      stage: 'find',
      counts: zero,
      hostedSearch,
      judged: false,
      revisionId: job.currentRevision?.id ?? null,
      startedAt,
      finishedAt: null,
      errorMessage: null,
    };
    const show = (): void => {
      state.latestRun = run;
      job.agentRun = {
        status: 'running',
        provider: input.provider,
        task: 'factcheck',
        briefId: null,
        startedAt,
        finishedAt: null,
        errorMessage: null,
        factCheck: { runId, scope: input.scope, stage: run.stage, counts: run.counts, hostedSearch, judged: run.judged },
      };
    };
    /** 停止：不存任何結果（已用掉的額度照算）。 */
    const stopped = (): boolean => {
      if (job.agentRun?.status !== 'cancelled') return false;
      run = { ...run, status: 'cancelled', finishedAt: new Date().toISOString(), errorMessage: '使用者取消' };
      state.latestRun = run;
      job.agentRun = { ...job.agentRun, finishedAt: run.finishedAt, factCheck: null };
      return true;
    };
    const step = async (ms: number): Promise<void> => {
      await delay(ms);
      if (stopped()) throw new Error('查證已停止');
    };

    show();
    const ms = slow();
    await step(ms);

    // ② 抓網頁：數字一路長上去。
    const candidates = input.scope === 'article' ? (uuid === 'f-factcheck' ? 9 : 0) : 3;
    run = { ...run, stage: 'fetch', counts: { ...zero, candidates, droppedClaims: input.scope === 'article' && candidates > 0 ? 1 : 0 } };
    show();
    await step(ms / 2);
    const fetchedTotal = nothing ? 0 : input.scope === 'article' ? (candidates > 0 ? 5 : 0) : 1;
    const failedTotal = candidates - fetchedTotal;
    run = { ...run, counts: { ...run.counts, fetched: Math.min(fetchedTotal, 2), fetchFailed: Math.min(failedTotal, 1) } };
    show();
    await step(ms / 2);
    run = { ...run, counts: { ...run.counts, fetched: fetchedTotal, fetchFailed: failedTotal } };

    // ③ 判斷：一份都沒抓到就不跑（只用掉一次額度）。
    if (fetchedTotal > 0) {
      run = { ...run, stage: 'judge', judged: true };
      show();
      await step(ms);
    }
    // ④ 核對。
    run = { ...run, stage: 'verify' };
    show();
    await step(ms / 2);

    const created: Finding[] = [];
    const common = { runId, agentId: input.provider, revisionId: job.currentRevision?.id ?? null, createdAt: new Date().toISOString() };
    const web = hostedSearch ? 'agent-search' : 'agent-memory';
    if (input.scope === 'article') {
      if (uuid === 'f-factcheck' && !nothing) created.push(...articleFindings(() => ++nextFindingId, runId, input.provider));
    } else if (excerpt !== null) {
      created.push(
        nothing
          ? base(++nextFindingId, {
              ...common,
              excerpt,
              blockIndex,
              verdict: 'unverifiable',
              evidence: '一個來源都沒抓到，沒有再請 AI 判斷。',
              sources: [
                src({ url: 'https://www.example.org/some-study', title: '某篇研究的新聞稿', origin: web, check: 'fetch-failed', failReason: '逾時' }),
                src({ url: 'https://www.example.com/news/2025/rewatch', title: '重看電影的好處', origin: web, check: 'fetch-failed', failReason: '找不到這個網頁（404）' }),
                src({
                  url: 'https://zh.wikipedia.org/w/index.php?search=%E9%87%8D%E7%9C%8B',
                  title: '維基百科：重看',
                  origin: 'wikipedia',
                  check: 'fetch-failed',
                  failReason: '維基百科沒有找到條目',
                }),
              ],
            })
          : base(++nextFindingId, {
              ...common,
              excerpt,
              blockIndex,
              verdict: 'needs-context',
              evidence: '（示範資料）維基百科提到相關的事，但說法比文章保守，要看你在前後文想強調什麼。',
              sources: [
                src({
                  url: WIKI_ZH,
                  title: '刺激1995',
                  origin: 'wikipedia',
                  check: 'found',
                  quote: '上映初期票房不理想',
                  context: '本片於1994年9月23日在美國上映。上映初期票房不理想，之後透過錄影帶與電視播映累積了大量觀眾。',
                }),
                src({ url: 'https://www.imdb.com/title/tt0111161/trivia/', title: 'Trivia - IMDb', origin: web, check: 'fetch-failed', failReason: '網頁太大' }),
              ],
            }),
      );
    }

    // 同一句（忽略空白相等）已經有 open 的：舊的標成 superseded（不出現在已處理）。
    const same = (a: string, b: string): boolean => a.replace(/\s+/gu, '') === b.replace(/\s+/gu, '');
    for (const old of state.findings) {
      if (old.status === 'open' && created.some((fresh) => same(fresh.excerpt, old.excerpt))) old.status = 'superseded';
    }
    state.findings.push(...created);
    run = { ...run, status: 'succeeded', finishedAt: new Date().toISOString() };
    state.latestRun = run;
    job.agentRun = { ...job.agentRun!, status: 'succeeded', finishedAt: run.finishedAt, factCheck: null };
    return { run: clone(run), findings: clone(created) };
  },

  async listFactChecks(uuid: string): Promise<FactCheckListResponse> {
    await delay(80);
    mustGet(uuid);
    const state = stateOf(uuid);
    return {
      findings: clone(mergeByBlock(state.findings.filter((finding) => finding.status !== 'superseded'))),
      latestRun: clone(state.latestRun),
      openContradictions: openContradictionsFor(uuid),
    };
  },

  async dismissFactCheck(uuid: string, findingId: number) {
    await delay(120);
    mustGet(uuid);
    const finding = stateOf(uuid).findings.find((item) => item.id === findingId);
    if (!finding) throw new Error('找不到這條查證結果');
    if (finding.status === 'open') {
      finding.status = 'dismissed';
      finding.resolvedAt = new Date().toISOString();
    }
  },
};
