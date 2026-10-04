/**
 * AI 查證（D-034，P6-T004；規格 docs/specs/factcheck.md）：找來源（Agent 第一趟）→ 抓網頁（我們的取回器）
 * → 判斷（Agent 第二趟，最嚴格無工具）→ 核對引文（程式），存成查證結果。
 *
 * - 整次佔一個 Agent 名額（`activeRuns`），跟其他 Agent 動作互斥；跑的期間**不鎖內容**（D-036）：
 *   結果不改文章，跑完時內容換過了照收，讀取時用 excerpt 重新定位（找不到原句的算「原句已經改了」）。
 * - 抓網頁、核對兩段沒有 CLI 在跑、`agent_runs` 沒有 running 的那一筆：進度記在 `factcheck_runs`，
 *   `JobDetail.agentRun` 由它組出來（`agentRunView`）。
 * - 停止走既有的 `cancelAgentRun`（`agent.ts`）→ `cancelActive`：停掉正在跑的 CLI、中止正在抓的請求，**不存任何結果**。
 * - 結果**永不自動套用**、不改文章、不動核准、不寫 `review_items`。
 */

import type {
  AgentRun,
  FactCheckFinding,
  FactCheckListResponse,
  FactCheckRun,
  FactCheckRunResult,
  FactCheckSource,
  Observation,
  Revision,
} from '../../contract/api.js';
import { canFactCheckObservation, checkFactCheckSelection, countOpenContradictions, isExcerptGone } from '../../contract/factcheck.js';
import { findIgnoringSpaces } from '../../contract/text-match.js';
import { EMPTY_BODY_AGENT_MESSAGE, isBlankBody } from '../../contract/empty-body.js';
import { AgentError, InvalidInputError } from '../errors.js';
import { findBlockContaining, findBlocksContaining, splitTopLevelBlocks, type TopLevelBlock } from '../html-blocks.js';
import type { AgentRunStatus, FactCheckFindingRow, FactCheckRunRow, JobRow } from '../repository.js';
import {
  articleTextForAgent,
  buildFactCheckFindSystemPrompt,
  buildFactCheckFindUserPrompt,
  buildFactCheckJudgeSystemPrompt,
  buildFactCheckJudgeUserPrompt,
  FACTCHECK_MAX_CLAIMS_BY_SCOPE,
  sourceTextForAgent,
  type FactCheckFindTarget,
  type FactCheckJudgeClaim,
} from '../factcheck-prompts.js';
import {
  collectSources,
  extractLinks,
  hostOf,
  originOf,
  planCandidates,
  sameExcerpt,
  selectClaims,
  verifyFindings,
  type CandidateOutcome,
  type ClaimForVerify,
  type FactCheckCandidate,
  type JudgedSource,
} from '../factcheck.js';
import {
  FACTCHECK_FIND_SCHEMA,
  FACTCHECK_JUDGE_SCHEMA,
  type FactCheckFindOutput,
  type FactCheckJudgeOutput,
} from '../../agents/output-contract.js';
import { AgentUnavailableError } from '../../agents/registry.js';
import type { AgentId, AgentResult } from '../../agents/types.js';
import { anyUrlContainsSecret, truncateSources, type SourceFetcher } from '../../fetch/index.js';
import type { FactCheckInput } from './types.js';
import { FACTCHECK_PURPOSE, MAX_AGENT_OUTPUT_BYTES, type ActiveRun, type CoreContext } from './context.js';

/** 每一趟 Agent 的預設逾時（跟校稿一樣 3 分鐘）。 */
const DEFAULT_FACTCHECK_TIMEOUT_MS = 180_000;

/** 第一趟給的網址含 WordPress 密碼（security.md「取回器」）：整次停止。訊息本身不含密碼。 */
export const SECRET_IN_URLS_MESSAGE = 'AI 給的網址或搜尋字串裡有你的 WordPress 應用程式密碼，這次查證停止';
/** 要抓的候選（含文章原有的連結）含 WordPress 密碼：整次停止，一個都不抓。訊息本身不含密碼。 */
export const SECRET_IN_CANDIDATES_MESSAGE = '要抓的網址裡有你的 WordPress 應用程式密碼（可能在文章原有的連結裡），這次查證停止';
/** 要存的查證結果含 WordPress 密碼：整次停止，什麼都不存。訊息本身不含密碼。 */
export const SECRET_IN_RESULT_MESSAGE = '查證結果裡有你的 WordPress 應用程式密碼，這次查證停止，沒有留下任何結果';
/** 按了停止：等著的請求拿到這句，什麼都不存。 */
export const FACTCHECK_CANCELLED_MESSAGE = '查證已停止，沒有留下任何結果';
const CANCELLED_REASON = '使用者取消';

/** 流程內部用：查證紀錄已經不是 running（被停止了），後面一律不做。 */
class FactCheckStopped extends Error {}

/** 目前這一版的文字：標題、各頂層區塊、正文純文字。 */
interface ArticleText {
  readonly title: string;
  readonly blocks: readonly TopLevelBlock[];
  /** 非空區塊的文字，以空行接起來（給第一趟的「正文」、找跨段的選字）。 */
  readonly bodyText: string;
  /** 外洩檢查的「文章片段」用：標題＋正文。 */
  readonly plainText: string;
}

export class FactCheckModule {
  constructor(private readonly ctx: CoreContext) {}

  /**
   * 發起一次查證，等它跑完才回（通常 1～3 分鐘）。
   *
   * 派工前擋（400，一個請求都不發）：稿件不能改、正文空的、範圍的輸入不對（選字長度、找不到、觀察卡片種類）、
   * 選字或第一趟組好的 prompt 含 WordPress 密碼。另一個 Agent 動作在跑 → AgentError；沒有取回器 → 503。
   */
  async runFactCheck(uuid: string, input: FactCheckInput): Promise<FactCheckRunResult> {
    const job = this.ctx.requireJob(uuid);
    this.ctx.assertMutable(job);
    this.ctx.requireTemplate(job);
    const revisionRow = this.ctx.requireRevision(job);
    if (isBlankBody(revisionRow.rendered_html)) throw new InvalidInputError(EMPTY_BODY_AGENT_MESSAGE);

    // 選字先查密碼：找不到的錯誤訊息不該蓋過「有密碼」。
    this.ctx.assertNoAppPassword(input.selection);
    const article = this.articleOf(this.ctx.payloadOf(revisionRow).templateData, revisionRow.rendered_html ?? '');
    const target = this.findTarget(job, input, article);

    const hostedSearch = this.ctx.agents.supportsHostedSearch(input.provider);
    const systemPrompt = buildFactCheckFindSystemPrompt({ scope: input.scope, hostedSearch });
    const userPrompt = buildFactCheckFindUserPrompt(target);
    this.ctx.assertNoAppPassword(systemPrompt, userPrompt);

    const fetcherFactory = this.ctx.factCheckFetcher;
    if (fetcherFactory === null) throw new AgentUnavailableError('查證的取回器沒有設定，不能查證');
    if (this.ctx.activeRuns.has(job.uuid)) {
      throw new AgentError('這個工作項目已經有一個 Agent 在跑了，先取消或等它跑完');
    }

    const workspace = this.ctx.jobWorkspace(job);
    const runRow = this.ctx.repo.insertFactCheckRun({
      jobId: job.id,
      revisionId: revisionRow.id,
      scope: input.scope,
      provider: input.provider,
      hostedSearch,
    });
    const findRow = this.ctx.repo.insertAgentRun({
      jobId: job.id,
      revisionId: revisionRow.id,
      provider: input.provider,
      model: input.model ?? null,
      purpose: FACTCHECK_PURPOSE,
      status: 'running',
      inputHash: revisionRow.content_hash,
    });
    this.ctx.repo.updateFactCheckRun(runRow.id, { findAgentRunId: findRow.id });
    const active: ActiveRun = {
      runId: `${job.uuid}-${findRow.id}`,
      provider: input.provider,
      rowId: findRow.id,
      factCheck: { runRowId: runRow.id, abort: new AbortController(), cliRunning: true },
    };
    this.ctx.activeRuns.set(job.uuid, active);

    try {
      return await this.execute(job, input, {
        runId: runRow.id,
        revisionId: revisionRow.id,
        contentHash: revisionRow.content_hash,
        article,
        hostedSearch,
        systemPrompt,
        userPrompt,
        workspace,
        active,
        fetcher: fetcherFactory,
      });
    } catch (error) {
      const message = this.ctx.scrub(error instanceof Error ? error.message : String(error));
      const current = this.ctx.repo.agentRunById(active.rowId);
      if (current?.status === 'running') {
        this.ctx.repo.finishAgentRun(active.rowId, { status: 'failed', outputHash: null, errorMessage: message });
      }
      const run = this.ctx.repo.factCheckRunById(runRow.id);
      if (run?.status === 'cancelled' || error instanceof FactCheckStopped) {
        throw new AgentError(FACTCHECK_CANCELLED_MESSAGE);
      }
      if (run?.status === 'running') {
        this.ctx.repo.finishFactCheckRun(runRow.id, { status: 'failed', errorMessage: message });
        this.ctx.repo.insertEvent({
          jobId: job.id,
          revisionId: revisionRow.id,
          approvalId: null,
          actor: 'ui',
          eventType: 'factcheck_failed',
          status: 'failed',
          detail: { factCheckRunId: runRow.id, provider: input.provider, scope: input.scope, stage: run.stage, message },
        });
      }
      throw error;
    } finally {
      active.factCheck!.abort.abort();
      if (this.ctx.activeRuns.get(job.uuid) === active) this.ctx.activeRuns.delete(job.uuid);
    }
  }

  private async execute(
    job: JobRow,
    input: FactCheckInput,
    run: {
      runId: number;
      revisionId: number;
      contentHash: string;
      article: ArticleText;
      hostedSearch: boolean;
      systemPrompt: string;
      userPrompt: string;
      workspace: string;
      active: ActiveRun;
      fetcher: NonNullable<CoreContext['factCheckFetcher']>;
    },
  ): Promise<FactCheckRunResult> {
    const { active, article } = run;
    const control = active.factCheck!;
    const timeoutMs = input.timeoutMs ?? DEFAULT_FACTCHECK_TIMEOUT_MS;

    // ① 找來源：只有廠商端搜尋（做得到的那幾家）。
    const find = await this.ctx.agents.runStructured<FactCheckFindOutput>(
      input.provider,
      {
        systemPrompt: run.systemPrompt,
        userPrompt: run.userPrompt,
        workspaceDir: run.workspace,
        model: input.model,
        timeoutMs,
        maxOutputBytes: MAX_AGENT_OUTPUT_BYTES,
        ...(run.hostedSearch ? { hostedSearch: true } : {}),
      },
      FACTCHECK_FIND_SCHEMA,
      active.runId,
    );
    control.cliRunning = false;
    const findOutput = this.finishPass(active.rowId, find);
    this.assertStillRunning(run.runId);

    const allClaims = Array.isArray(findOutput.claims) ? findOutput.claims : [];
    // 第一趟產出的候選網址與搜尋字串（搜尋字串會變成維基百科的網址），在任何抓取之前整批檢查 WordPress 密碼
    // （含被丟掉的主張的）。
    const agentUrls = allClaims.flatMap((claim) =>
      (Array.isArray(claim.candidateUrls) ? claim.candidateUrls : []).map((candidate) => String(candidate.url ?? '')),
    );
    const agentQueries = allClaims.flatMap((claim) =>
      (Array.isArray(claim.queries) ? claim.queries : []).map((query) => String(query?.q ?? '')),
    );
    if (this.containsSecret([...agentUrls, ...agentQueries])) {
      this.failForSecret(job, input, run, SECRET_IN_URLS_MESSAGE, 'factcheck_secret_in_urls', {
        urlCount: agentUrls.length,
        queryCount: agentQueries.length,
      });
    }

    // excerpt 要在文章裡找得到：拿「給 Agent 看的那一份」比。
    const { kept, dropped } = selectClaims(allClaims, {
      max: FACTCHECK_MAX_CLAIMS_BY_SCOPE[input.scope],
      agentTexts: [articleTextForAgent(article.title), articleTextForAgent(article.bodyText)],
    });
    this.ctx.repo.updateFactCheckRun(run.runId, { stage: 'fetch', droppedClaims: dropped });
    if (kept.length === 0) return this.persist(job, input, run, [], { judged: false });

    // ② 抓：候選＝那段裡本來就有的連結＋Agent 給的網址＋維基百科。
    const plans = planCandidates(
      kept.map((claim) => ({
        links: this.linksNear(article, claim.excerpt),
        agentUrls: (Array.isArray(claim.candidateUrls) ? claim.candidateUrls : []).map((candidate) => ({
          url: String(candidate.url ?? ''),
          title: String(candidate.title ?? ''),
        })),
        queries: Array.isArray(claim.queries) ? claim.queries : [],
      })),
      { hostedSearch: run.hostedSearch },
    );
    this.ctx.repo.updateFactCheckRun(run.runId, { candidates: plans.reduce((n, plan) => n + plan.length, 0) });

    // 抓取前再整批檢查一次**所有**候選（含文章原有的連結與它的文字）：取回器雖然會拒抓含密碼的網址，
    // 但候選的網址與標題會被記進結果的來源清單，所以任一含密碼就整次停止、一個都不抓。
    const candidateTexts = plans.flat().flatMap((candidate) =>
      candidate.kind === 'url' ? [candidate.url, candidate.title] : [candidate.query],
    );
    if (this.containsSecret(candidateTexts)) {
      this.failForSecret(job, input, run, SECRET_IN_CANDIDATES_MESSAGE, 'factcheck_secret_in_urls', {
        candidateCount: candidateTexts.length,
      });
    }

    const fetcher = run.fetcher({
      articleText: article.plainText,
      containsSecret: (text) => this.ctx.hasAppPassword(text),
      signal: control.abort.signal,
    });
    let fetched = 0;
    let fetchFailed = 0;
    const collected = await collectSources(plans, (candidate) => this.fetchCandidate(fetcher, candidate), {
      isStopped: () => control.abort.signal.aborted || !this.isRunning(run.runId),
      onOutcome: (outcome) => {
        if (outcome.ok) fetched += 1;
        else fetchFailed += 1;
        this.ctx.repo.updateFactCheckRun(run.runId, { fetched, fetchFailed });
      },
    });
    this.assertStillRunning(run.runId);

    // 截斷：整次所有抓到的一起截；核對與「看原文」都以截短後、實際給 Agent 的那份為準。
    const fetchedEntries = collected.flatMap((entries) => entries.filter((entry) => entry.outcome.ok));
    const truncated = truncateSources(fetchedEntries.map((entry) => (entry.outcome as { text: string }).text));
    const truncatedOf = new Map(fetchedEntries.map((entry, index) => [entry, truncated[index]!]));

    let nextRef = 1;
    let judgeIndex = 0;
    const judgeClaims: FactCheckJudgeClaim[] = [];
    const forVerify: ClaimForVerify[] = kept.map((claim, index) => {
      const entries = collected[index] ?? [];
      const sources: (JudgedSource & { text: string })[] = [];
      const failed: ClaimForVerify['failed'][number][] = [];
      for (const entry of entries) {
        const outcome = entry.outcome;
        if (outcome.ok) {
          const text = truncatedOf.get(entry) ?? '';
          sources.push({
            ref: `S${nextRef++}`,
            url: outcome.url,
            title: outcome.title,
            origin: originOf(entry.candidate),
            agentText: sourceTextForAgent(text),
            text,
          });
        } else {
          failed.push({ url: outcome.url, title: outcome.title, origin: originOf(entry.candidate), reason: outcome.reason });
        }
      }
      let myIndex: number | null = null;
      if (sources.length > 0) {
        myIndex = judgeIndex++;
        judgeClaims.push({
          claim: String(claim.claim ?? ''),
          excerpt: claim.excerpt,
          sources: sources.map((source) => ({ ref: source.ref, title: source.title, url: source.url, text: source.text })),
        });
      }
      return {
        excerpt: claim.excerpt,
        claim: String(claim.claim ?? ''),
        judgeIndex: myIndex,
        sources: sources.map(({ text: _text, ...source }) => source),
        failed,
      };
    });

    // 全部都沒抓到：不跑第二趟（省一次額度），每條都記查不到。
    if (judgeClaims.length === 0) {
      this.ctx.repo.updateFactCheckRun(run.runId, { stage: 'verify' });
      return this.persist(job, input, run, verifyFindings(forVerify, null), { judged: false });
    }

    // ③ 判斷：最嚴格無工具，只讀我們遞過去的文字。
    const judgeSystem = buildFactCheckJudgeSystemPrompt();
    const judgeUser = buildFactCheckJudgeUserPrompt(judgeClaims);
    this.ctx.assertNoAppPassword(judgeSystem, judgeUser);
    this.assertStillRunning(run.runId);

    const judgeRow = this.ctx.repo.insertAgentRun({
      jobId: job.id,
      revisionId: run.revisionId,
      provider: input.provider,
      model: input.model ?? null,
      purpose: FACTCHECK_PURPOSE,
      status: 'running',
      inputHash: run.contentHash,
    });
    this.ctx.repo.updateFactCheckRun(run.runId, { stage: 'judge', judged: true, judgeAgentRunId: judgeRow.id });
    active.runId = `${job.uuid}-${judgeRow.id}`;
    active.rowId = judgeRow.id;
    control.cliRunning = true;
    const judge = await this.ctx.agents.runStructured<FactCheckJudgeOutput>(
      input.provider,
      {
        systemPrompt: judgeSystem,
        userPrompt: judgeUser,
        workspaceDir: run.workspace,
        model: input.model,
        timeoutMs,
        maxOutputBytes: MAX_AGENT_OUTPUT_BYTES,
        strictNoTools: true,
      },
      FACTCHECK_JUDGE_SCHEMA,
      active.runId,
    );
    control.cliRunning = false;
    const judgeOutput = this.finishPass(judgeRow.id, judge);
    this.assertStillRunning(run.runId);

    // ④ 核對：引文逐字（忽略空白）對「實際給 Agent 的文字」，對不上降為查不到。
    this.ctx.repo.updateFactCheckRun(run.runId, { stage: 'verify' });
    return this.persist(job, input, run, verifyFindings(forVerify, judgeOutput), { judged: true });
  }

  /**
   * 存結果（同步，中間不會被插隊）：同一句已有 open 的舊結果標成 superseded，寫新結果，查證紀錄結成 succeeded。
   * 跑的期間內容可能被改過（D-036 不鎖內容）：結果照收，讀取時用 excerpt 對著最新版重新定位。
   */
  private persist(
    job: JobRow,
    input: FactCheckInput,
    run: { runId: number; revisionId: number },
    drafts: ReturnType<typeof verifyFindings>,
    options: { judged: boolean },
  ): FactCheckRunResult {
    this.assertStillRunning(run.runId);
    // 存之前把每一筆要存的文字欄位（含來源清單裡的網址、標題、引文、前後文）再查一次密碼：任一命中整次停止、什麼都不存。
    const storedTexts = drafts.flatMap((draft) => [
      draft.excerpt,
      draft.claim,
      draft.evidence,
      draft.correction ?? '',
      ...draft.sources.flatMap((source) => Object.values(source).filter((value): value is string => typeof value === 'string')),
    ]);
    if (this.containsSecret(storedTexts)) {
      this.failForSecret(job, input, run, SECRET_IN_RESULT_MESSAGE, 'factcheck_secret_in_result', { findings: drafts.length });
    }

    // 舊結果標 superseded、寫新結果、查證紀錄結成 succeeded、事件：同一個交易，中途失敗全部回滾
    // （外層把查證紀錄結成 failed）。
    const row = this.ctx.repo.transaction(() => this.persistRows(job, input, run, drafts, options));

    const ctx = this.readContext(job);
    return {
      run: this.runView(row),
      findings: this.ctx.repo.factCheckFindingsOfRun(run.runId).map((finding) => this.findingView(finding, row, ctx)),
    };
  }

  private persistRows(
    job: JobRow,
    input: FactCheckInput,
    run: { runId: number; revisionId: number },
    drafts: ReturnType<typeof verifyFindings>,
    options: { judged: boolean },
  ): FactCheckRunRow {
    const previous = this.ctx.repo.listFactCheckFindings(job.id).filter((row) => row.status === 'open');
    for (const row of previous) {
      if (drafts.some((draft) => sameExcerpt(draft.excerpt, row.excerpt))) {
        this.ctx.repo.updateFactCheckFindingStatus(row.id, 'superseded', null);
      }
    }
    drafts.forEach((draft, ordinal) => {
      this.ctx.repo.insertFactCheckFinding({
        runId: run.runId,
        jobId: job.id,
        ordinal,
        excerpt: draft.excerpt,
        claim: draft.claim,
        verdict: draft.verdict,
        agentVerdict: draft.agentVerdict,
        evidence: draft.evidence,
        correction: draft.correction,
        sourcesJson: JSON.stringify(draft.sources),
      });
    });
    this.ctx.repo.updateFactCheckRun(run.runId, { judged: options.judged });
    this.ctx.repo.finishFactCheckRun(run.runId, { status: 'succeeded', errorMessage: null });
    const row = this.ctx.repo.factCheckRunById(run.runId)!;
    this.ctx.repo.insertEvent({
      jobId: job.id,
      revisionId: run.revisionId,
      approvalId: null,
      actor: 'ui',
      eventType: 'factcheck_completed',
      status: 'succeeded',
      detail: {
        factCheckRunId: run.runId,
        provider: input.provider,
        scope: input.scope,
        findings: drafts.length,
        judged: options.judged,
        candidates: row.candidate_count,
        fetched: row.fetched_count,
        fetchFailed: row.fetch_failed_count,
        droppedClaims: row.dropped_claim_count,
      },
    });
    return row;
  }

  /** 任一段文字含已知的 WordPress 密碼（原字串，以及網址的各種解碼形式）。 */
  private containsSecret(texts: readonly string[]): boolean {
    return anyUrlContainsSecret(texts, (text) => this.ctx.hasAppPassword(text));
  }

  /** 密碼命中：查證紀錄結成 failed、記稽核事件（只記筆數，不記內容）、丟 AgentError。 */
  private failForSecret(
    job: JobRow,
    input: FactCheckInput,
    run: { runId: number; revisionId: number },
    message: string,
    eventType: string,
    counts: Record<string, number>,
  ): never {
    this.ctx.repo.finishFactCheckRun(run.runId, { status: 'failed', errorMessage: message });
    this.ctx.repo.insertEvent({
      jobId: job.id,
      revisionId: run.revisionId,
      approvalId: null,
      actor: 'system',
      eventType,
      status: 'rejected',
      detail: { factCheckRunId: run.runId, provider: input.provider, ...counts },
    });
    throw new AgentError(message);
  }

  /** 一趟 Agent 的結果：失敗就把那筆 agent_runs 結掉、丟 AgentError；成功也結掉（已經被取消的不改寫）。 */
  private finishPass<T>(rowId: number, result: AgentResult<T>): T {
    const running = this.ctx.repo.agentRunById(rowId)?.status === 'running';
    if (!result.ok) {
      const status: AgentRunStatus =
        result.reason === 'timeout' ? 'timeout' : result.reason === 'cancelled' ? 'cancelled' : 'failed';
      const message = this.ctx.scrub(result.message);
      if (running) this.ctx.repo.finishAgentRun(rowId, { status, outputHash: null, errorMessage: message });
      throw new AgentError(message, this.ctx.scrub(result.issues));
    }
    if (running) this.ctx.repo.finishAgentRun(rowId, { status: 'succeeded', outputHash: null, errorMessage: null });
    return result.data;
  }

  private isRunning(runId: number): boolean {
    return this.ctx.repo.factCheckRunById(runId)?.status === 'running';
  }

  private assertStillRunning(runId: number): void {
    if (!this.isRunning(runId)) throw new FactCheckStopped('查證已經不是進行中');
  }

  /** 抓一個候選。取回器不丟例外（失敗都是結構化原因）；萬一丟了也當成抓不到。 */
  private async fetchCandidate(fetcher: SourceFetcher, candidate: FactCheckCandidate): Promise<CandidateOutcome> {
    try {
      if (candidate.kind === 'url') {
        const result = await fetcher.fetchUrl(candidate.url, candidate.origin === 'article-link' ? 'article-link' : 'agent');
        if (result.ok) {
          return { ok: true, url: result.url, title: result.title ?? (candidate.title || hostOf(result.url)), text: result.text };
        }
        return { ok: false, url: candidate.url, title: candidate.title || hostOf(candidate.url), reason: result.reason };
      }
      const searchPage = `https://${candidate.lang}.wikipedia.org/w/index.php?search=${encodeURIComponent(candidate.query)}`;
      const found = await fetcher.searchWikipedia(candidate.lang, candidate.query);
      if (!found.ok) return { ok: false, url: searchPage, title: `維基百科：${candidate.query}`, reason: found.reason };
      const page = await fetcher.wikipediaExtract(candidate.lang, found.title);
      if (!page.ok) return { ok: false, url: searchPage, title: `維基百科：${found.title}`, reason: page.reason };
      return { ok: true, url: page.url, title: page.title ?? found.title, text: page.text };
    } catch {
      const url = candidate.kind === 'url' ? candidate.url : `https://${candidate.lang}.wikipedia.org/`;
      return { ok: false, url, title: hostOf(url), reason: '抓取時出錯，沒抓' };
    }
  }

  // --- 範圍與文章 --------------------------------------------------------------

  private articleOf(templateData: Record<string, unknown>, html: string): ArticleText {
    const title = this.ctx.titleOf(templateData) ?? '';
    const blocks = html.length === 0 ? [] : splitTopLevelBlocks(html);
    const bodyText = blocks
      .map((block) => block.text.trim())
      .filter((text) => text.length > 0)
      .join('\n\n');
    return { title, blocks, bodyText, plainText: [title, bodyText].join('\n') };
  }

  /** 第一趟要查的東西；輸入不對就 400（factcheck.md「① 找來源」輸入表）。 */
  private findTarget(job: JobRow, input: FactCheckInput, article: ArticleText): FactCheckFindTarget {
    if (input.scope !== 'selection' && input.selection !== undefined) {
      throw new InvalidInputError('只有選字查證能給 selection');
    }
    if (input.scope !== 'observation' && input.observationItemId !== undefined) {
      throw new InvalidInputError('只有觀察卡片的查證能給 observationItemId');
    }
    switch (input.scope) {
      case 'selection': {
        const selection = input.selection;
        if (selection === undefined) throw new InvalidInputError('選字查證要給選的那段字');
        const checked = checkFactCheckSelection(selection);
        if (!checked.ok) throw new InvalidInputError(checked.message);
        const paragraph = this.paragraphOf(article, selection);
        if (paragraph === null) throw new InvalidInputError('選的字在目前的文章裡找不到，重新選一次再查');
        return { scope: 'selection', selection, paragraph };
      }
      case 'observation': {
        const itemId = input.observationItemId;
        if (itemId === undefined) throw new InvalidInputError('觀察卡片的查證要給卡片編號');
        const row = this.ctx.repo.reviewItemById(itemId);
        const proposal = row ? this.ctx.repo.reviewProposalById(row.proposal_id) : null;
        if (!row || !proposal || proposal.job_id !== job.id) {
          throw new InvalidInputError(`找不到這篇的校稿卡片 ${itemId}`);
        }
        if (row.item_type !== 'observation') throw new InvalidInputError('只有校稿的觀察卡片能查證');
        const observation = JSON.parse(row.payload_json) as Observation;
        if (!canFactCheckObservation(observation.kind)) {
          throw new InvalidInputError('這種觀察卡片不能查證；只有「沒有依據」「沒標出處」「前後矛盾」這三種可以');
        }
        const paragraph = this.paragraphOf(article, observation.excerpt);
        if (paragraph === null) {
          throw new InvalidInputError('這張卡片引的句子在目前的文章裡找不到了，改用選字查證');
        }
        return { scope: 'observation', excerpt: observation.excerpt, detail: observation.detail, paragraph };
      }
      case 'article':
        return { scope: 'article', title: article.title, body: article.bodyText };
      default:
        throw new InvalidInputError('scope 只能是 selection、observation 或 article');
    }
  }

  /**
   * 這段字所在的段落：在標題裡就是標題，在某一段裡就是那一段，跨段就是那幾段接起來（忽略空白比對）。
   * 找不到回 null。
   */
  private paragraphOf(article: ArticleText, text: string): string | null {
    if (text.replace(/\s+/gu, '').length === 0) return null;
    if (findIgnoringSpaces(article.title, text) !== null) return article.title;
    const index = findBlockContaining(article.blocks, text);
    if (index !== null) return article.blocks[index]!.text.trim();
    const hit = findIgnoringSpaces(article.bodyText, text);
    if (hit === null) return null;
    const parts: string[] = [];
    let offset = 0;
    for (const block of article.blocks) {
      const part = block.text.trim();
      if (part.length === 0) continue;
      const end = offset + part.length;
      if (end > hit.start && offset < hit.end) parts.push(part);
      offset = end + 2; // 「\n\n」
    }
    return parts.join('\n\n');
  }

  /** 主張所在段落裡本來就有的連結（使用者自己引的出處）。excerpt 在標題或跨段時沒有。 */
  private linksNear(article: ArticleText, excerpt: string): { url: string; text: string }[] {
    return findBlocksContaining(blocksForMatch(article.blocks), articleTextForAgent(excerpt)).flatMap((index) =>
      extractLinks(article.blocks[index]!.html),
    );
  }

  // --- 停止 ------------------------------------------------------------------------

  /**
   * `cancelAgentRun`（agent.ts）轉過來：停掉正在跑的 CLI、中止正在抓的請求、結掉查證紀錄。**不存任何結果**
   * （等著的 `runFactCheck` 看到紀錄不是 running 就丟「已停止」）。已用掉的額度照算。
   */
  cancelActive(job: JobRow, active: ActiveRun): void {
    const control = active.factCheck;
    if (!control) return;
    control.abort.abort();
    if (control.cliRunning) void this.ctx.agents.cancel(active.provider, active.runId);
    if (this.ctx.repo.agentRunById(active.rowId)?.status === 'running') {
      this.ctx.repo.finishAgentRun(active.rowId, { status: 'cancelled', outputHash: null, errorMessage: CANCELLED_REASON });
    }
    if (this.isRunning(control.runRowId)) {
      this.ctx.repo.finishFactCheckRun(control.runRowId, { status: 'cancelled', errorMessage: CANCELLED_REASON });
    }
    this.ctx.activeRuns.delete(job.uuid);
    this.ctx.repo.insertEvent({
      jobId: job.id,
      revisionId: null,
      approvalId: null,
      actor: 'ui',
      eventType: 'agent_cancelled',
      status: 'succeeded',
      detail: { factCheckRunId: control.runRowId },
    });
  }

  /** 記憶體裡沒有、DB 卻還是 running 的查證（理論上啟動清理已經結掉）：結成取消。有結到回 true。 */
  cancelOrphan(job: JobRow): boolean {
    const row = this.ctx.repo.runningFactCheckRun(job.id);
    if (!row) return false;
    this.ctx.repo.finishFactCheckRun(row.id, { status: 'cancelled', errorMessage: CANCELLED_REASON });
    return true;
  }

  // --- 讀取與結案 ------------------------------------------------------------------

  listFactChecks(uuid: string): FactCheckListResponse {
    const job = this.ctx.requireJob(uuid);
    const ctx = this.readContext(job);
    const runs = new Map<number, FactCheckRunRow | null>();
    const runOf = (id: number): FactCheckRunRow | null => {
      if (!runs.has(id)) runs.set(id, this.ctx.repo.factCheckRunById(id));
      return runs.get(id) ?? null;
    };
    const findings = this.ctx.repo
      .listFactCheckFindings(job.id)
      .map((row) => this.findingView(row, runOf(row.run_id), ctx))
      .sort((a, b) => (a.blockIndex ?? Number.MAX_SAFE_INTEGER) - (b.blockIndex ?? Number.MAX_SAFE_INTEGER) || a.id - b.id);
    const latest = this.ctx.repo.latestFactCheckRun(job.id);
    return {
      findings,
      latestRun: latest ? this.runView(latest) : null,
      openContradictions: countOpenContradictions(findings),
    };
  }

  /** 「知道了」：只收 open 的；不是內容改動，不建版本、不動核准。 */
  dismissFactCheck(uuid: string, findingId: number): void {
    const job = this.ctx.requireJob(uuid);
    const row = this.requireOpenFinding(job, findingId);
    this.ctx.repo.updateFactCheckFindingStatus(row.id, 'dismissed', null);
    this.ctx.repo.insertEvent({
      jobId: job.id,
      revisionId: null,
      approvalId: null,
      actor: 'ui',
      eventType: 'factcheck_dismissed',
      status: 'succeeded',
      detail: { findingId: row.id },
    });
  }

  /**
   * `createRevision` 的 `resolveFactCheckId`：寫入任何東西之前先驗。不屬於這篇 → 整個拒絕；
   * 屬於這篇但已經不是 open（打字中被 superseded、知道了、已結案）→ 回 null：照存、不結案、不報錯
   * （D-036：查證跑的期間可以去原文改，跑完時那條可能已經被新結果取代，不能讓使用者的字存不進去）。
   */
  findingToResolveByEdit(job: JobRow, findingId: number): FactCheckFindingRow | null {
    const row = this.ctx.repo.factCheckFindingById(findingId);
    if (!row || row.job_id !== job.id) throw new InvalidInputError(`找不到這篇的查證結果 ${findingId}`);
    return row.status === 'open' ? row : null;
  }

  /** 「知道了」用：不屬於這篇、不是 open 就拒絕。 */
  requireOpenFinding(job: JobRow, findingId: number): FactCheckFindingRow {
    const row = this.ctx.repo.factCheckFindingById(findingId);
    if (!row || row.job_id !== job.id) throw new InvalidInputError(`找不到這篇的查證結果 ${findingId}`);
    if (row.status !== 'open') throw new InvalidInputError('這條查證結果已經處理過了');
    return row;
  }

  /** 從查證卡片「去原文改」、存成新版本之後結案（規則同校稿的 resolvedByEdit）。 */
  resolveByEdit(job: JobRow, row: FactCheckFindingRow, revisionId: number): void {
    this.ctx.repo.updateFactCheckFindingStatus(row.id, 'resolved-by-edit', revisionId);
    this.ctx.repo.insertEvent({
      jobId: job.id,
      revisionId,
      approvalId: null,
      actor: 'ui',
      eventType: 'factcheck_resolved_by_edit',
      status: 'succeeded',
      detail: { findingId: row.id },
    });
  }

  /** `JobDetail.openFactCheckContradictions`：說法不同、open、原句還在的條數。 */
  openContradictionCount(job: JobRow, revision: Revision | null): number {
    const open = this.ctx.repo
      .listFactCheckFindings(job.id)
      .filter((row) => row.status === 'open' && row.verdict === 'contradicted');
    if (open.length === 0) return 0;
    const ctx = this.readContextOf(revision);
    return countOpenContradictions(
      open.map((row) => ({ verdict: row.verdict, status: row.status, excerptGone: isExcerptGone(articleTextForAgent(row.excerpt), ctx.texts) })),
    );
  }

  /**
   * `JobDetail.agentRun`：查證正在跑、或最近一趟 Agent 是查證時，由查證紀錄組出來（抓網頁、核對兩段
   * 沒有 running 的 agent_runs，鎖與「另一個 Agent 動作在跑」照樣成立）。其他情況回 undefined（用 agent_runs 那一筆）。
   */
  agentRunView(job: JobRow, latestAgentPurpose: string | null): AgentRun | undefined {
    const row = this.ctx.repo.latestFactCheckRun(job.id);
    if (!row) return undefined;
    if (row.status !== 'running' && latestAgentPurpose !== null && latestAgentPurpose !== FACTCHECK_PURPOSE) return undefined;
    const view = this.runView(row);
    return {
      status: row.status,
      provider: row.provider,
      task: 'factcheck',
      briefId: null,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      errorMessage: row.error_message,
      factCheck: {
        runId: row.id,
        scope: row.scope,
        stage: row.stage,
        counts: view.counts,
        hostedSearch: view.hostedSearch,
        judged: view.judged,
      },
    };
  }

  private runView(row: FactCheckRunRow): FactCheckRun {
    return {
      id: row.id,
      scope: row.scope,
      provider: row.provider as AgentId,
      status: row.status,
      stage: row.stage,
      counts: {
        candidates: row.candidate_count,
        fetched: row.fetched_count,
        fetchFailed: row.fetch_failed_count,
        droppedClaims: row.dropped_claim_count,
      },
      hostedSearch: row.hosted_search === 1,
      judged: row.judged === 1,
      revisionId: row.revision_id,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      errorMessage: row.error_message,
    };
  }

  /**
   * 讀取時要的東西：目前這一版的頂層區塊與「找得到嗎」要比的文字（標題、正文、各段）。
   * **都是處理後的**（`articleTextForAgent`）：excerpt 是 AI 照處理後的文字抄的，拿原文比會因為 VS16、零寬字之類
   * 被刪掉的字而對不上（factcheck.md「核對與定位都拿處理後那一份比」）。區塊的 `text` 換掉、順序不變，index 照用。
   */
  private readContext(job: JobRow): { blocks: readonly TopLevelBlock[]; texts: string[] } {
    const row = this.ctx.repo.latestRevision(job.id);
    return this.readContextOf(row ? this.ctx.toRevision(row) : null);
  }

  private readContextOf(revision: Revision | null): { blocks: readonly TopLevelBlock[]; texts: string[] } {
    if (!revision) return { blocks: [], texts: [] };
    const article = this.articleOf(revision.templateData, revision.publishHtml);
    return {
      blocks: blocksForMatch(article.blocks),
      texts: [article.title, article.bodyText, ...article.blocks.map((block) => block.text)].map(articleTextForAgent),
    };
  }

  private findingView(
    row: FactCheckFindingRow,
    run: FactCheckRunRow | null,
    ctx: { blocks: readonly TopLevelBlock[]; texts: string[] },
  ): FactCheckFinding {
    let sources: FactCheckSource[] = [];
    try {
      const parsed = JSON.parse(row.sources_json) as unknown;
      if (Array.isArray(parsed)) sources = parsed as FactCheckSource[];
    } catch {
      // 壞掉的就當沒有來源。
    }
    return {
      id: row.id,
      runId: row.run_id,
      excerpt: row.excerpt,
      claim: row.claim,
      verdict: row.verdict,
      agentVerdict: row.agent_verdict,
      evidence: row.evidence,
      correction: row.correction,
      sources,
      // review-proposals.md「blockIndex 每次讀取時重算」：一律以目前內容去找，找不到就是 null。
      blockIndex: ctx.blocks.length === 0 ? null : findBlockContaining(ctx.blocks, articleTextForAgent(row.excerpt)),
      status: row.status,
      excerptGone: row.status === 'open' && isExcerptGone(articleTextForAgent(row.excerpt), ctx.texts),
      agentId: (run?.provider ?? 'claude') as AgentId,
      revisionId: run?.revision_id ?? null,
      createdAt: row.created_at,
      resolvedAt: row.resolved_at,
    };
  }
}

/**
 * 定位用的區塊：`text` 換成處理後的（`articleTextForAgent`），其他不變、順序不變。
 * AI 的 excerpt 是照處理後的文字抄的，定位與「找得到嗎」都拿這一份比。
 */
function blocksForMatch(blocks: readonly TopLevelBlock[]): TopLevelBlock[] {
  return blocks.map((block) => ({ ...block, text: articleTextForAgent(block.text) }));
}
