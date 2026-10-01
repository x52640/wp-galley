/**
 * 前後端共用的 HTTP 契約：AI 查證（D-034，P6-T004；規格 docs/specs/factcheck.md）。
 * 規則見 api.ts 開頭；前端與後端一律從 `api.ts` import。
 */

import type { AgentProvider } from './api-enums.js';

/** 查什麼：選的那段字、校稿觀察卡片、整篇（AI 挑最多 5 條）。 */
export type FactCheckScope = 'selection' | 'observation' | 'article';

/** 判定。`verdict` 是程式核對後的，`agentVerdict` 是 AI 原本說的。 */
export type FactCheckVerdict = 'supported' | 'contradicted' | 'unverifiable' | 'needs-context';

/** 目前在哪一段：找來源（第一趟）→ 抓網頁 → 判斷（第二趟）→ 核對引文。 */
export type FactCheckStage = 'find' | 'fetch' | 'judge' | 'verify';

export type FactCheckRunStatus = 'running' | 'succeeded' | 'failed' | 'cancelled';

/** 來源從哪來（畫面寫在來源旁：「文章裡的連結」「AI 給的網址」「維基百科」）。 */
export type FactCheckSourceOrigin = 'article-link' | 'agent-search' | 'agent-memory' | 'wikipedia';

/** 引文核對結果；抓不到的來源是 `fetch-failed`。 */
export type FactCheckSourceCheck = 'found' | 'not-found' | 'fetch-failed';

/**
 * 查證結果的下場。`superseded`＝同一句又查了一次（不出現在已處理）。
 * 「原句已經改了」不是存的狀態，是讀取時算的 `excerptGone`。
 */
export type FactCheckFindingStatus = 'open' | 'dismissed' | 'resolved-by-edit' | 'superseded';

/** 進度計數（畫面：「找到 6 個候選網頁」「抓到 4 個（2 個抓不到）」「丟掉 N 條」）。 */
export interface FactCheckCounts {
  /** 候選來源數（網址＋要查的維基百科），去掉重複之後。 */
  readonly candidates: number;
  /** 抓到的份數。 */
  readonly fetched: number;
  /** 試過但沒抓到的份數。 */
  readonly fetchFailed: number;
  /** AI 引的句子在文章裡找不到而丟掉的主張數。 */
  readonly droppedClaims: number;
}

/** `JobDetail.agentRun.factCheck`：查證跑的時候（含抓網頁、核對這兩段沒有 CLI 在跑的時候）的階段與計數。 */
export interface FactCheckProgress {
  /** 查證紀錄的 id（不是 agent_runs 的）。 */
  readonly runId: number;
  readonly scope: FactCheckScope;
  readonly stage: FactCheckStage;
  readonly counts: FactCheckCounts;
  /** 第一趟有沒有開廠商端搜尋（Antigravity 沒有，畫面要講「這次只查維基百科和 AI 記得的網址」）。 */
  readonly hostedSearch: boolean;
  /** 第二趟有沒有跑。一份來源都沒抓到就不跑（「只用掉一次額度」）。 */
  readonly judged: boolean;
}

/** 一次查證（每按一次一筆）。 */
export interface FactCheckRun {
  readonly id: number;
  readonly scope: FactCheckScope;
  readonly provider: AgentProvider;
  readonly status: FactCheckRunStatus;
  readonly stage: FactCheckStage;
  readonly counts: FactCheckCounts;
  readonly hostedSearch: boolean;
  readonly judged: boolean;
  /** 發起時的那一版。 */
  readonly revisionId: number | null;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  /** 失敗原因（白話，不含密碼）；取消是「使用者取消」。 */
  readonly errorMessage: string | null;
}

export interface FactCheckSource {
  /** 實際抓的那個（跳轉後的最終網址）；抓不到的是原本要抓的網址。 */
  readonly url: string;
  /** 抓回的頁面標題；沒有才用 Agent 給的（或連結文字、網域）。 */
  readonly title: string;
  readonly origin: FactCheckSourceOrigin;
  /** AI 引的那句（核對過或沒對上的）；沒引這份就是 null。 */
  readonly quote: string | null;
  readonly check: FactCheckSourceCheck;
  /** `fetch-failed` 時的白話原因，例如「網址含文章原句，沒抓」「網頁太大」。 */
  readonly failReason: string | null;
  /** 引文前後各約 150 字（「看原文」就地展開用；純文字，不當 HTML）。沒對上就是 null。 */
  readonly context: string | null;
}

/** 一條查證結果（給畫面的形狀，程式組出來的，不是 Agent 直接給的）。 */
export interface FactCheckFinding {
  readonly id: number;
  readonly runId: number;
  /** 文章原文片段（用來在字上標記）。 */
  readonly excerpt: string;
  /** 改寫成可查證的一句話。 */
  readonly claim: string;
  readonly verdict: FactCheckVerdict;
  /** AI 原本說的；跟 `verdict` 不同＝被降級（引文對不上），畫面要講。 */
  readonly agentVerdict: FactCheckVerdict;
  readonly evidence: string;
  /** 建議改法（文字建議，**永不自動套用**）；沒有是 null。 */
  readonly correction: string | null;
  readonly sources: FactCheckSource[];
  /** 每次讀取時用 excerpt 在目前內容裡重算；定位不到是 null（不存）。 */
  readonly blockIndex: number | null;
  readonly status: FactCheckFindingStatus;
  /**
   * `open` 但 excerpt 在目前的標題與正文裡找不到了（原句已經改了）：讀取時算，畫面收進「已處理」。
   * 不是 `open` 的一律 false。
   */
  readonly excerptGone: boolean;
  readonly agentId: AgentProvider;
  /** 發起查證時的那一版。 */
  readonly revisionId: number | null;
  readonly createdAt: string;
  readonly resolvedAt: string | null;
}

// --- 請求與回應 -----------------------------------------------------------------

/**
 * `POST /api/jobs/:uuid/factchecks`：發起查證。等它跑完才回（通常 1～3 分鐘），跑的期間看 `JobDetail.agentRun`
 * （`task: 'factcheck'`、`factCheck` 帶階段與計數），停止走 `DELETE /api/jobs/:uuid/agent`。
 */
export interface FactCheckRequest {
  readonly provider: AgentProvider;
  readonly scope: FactCheckScope;
  /** `scope: 'selection'` 才給、而且一定要給：選的那段字（4～300 字，空白摺疊後）。 */
  readonly selection?: string;
  /** `scope: 'observation'` 才給、而且一定要給：校稿觀察卡片的 id（`ReviewItem.id`）。excerpt 由後端讀。 */
  readonly observationItemId?: number;
  readonly model?: string;
  /** 每一趟 Agent 的逾時（毫秒）；不給用預設。 */
  readonly timeoutMs?: number;
}

/** 發起查證的回應：這一次的紀錄與它產生的結果（已經存好）。 */
export interface FactCheckRunResult {
  readonly run: FactCheckRun;
  readonly findings: FactCheckFinding[];
}

/** `GET /api/jobs/:uuid/factchecks`：這篇的查證結果（不含 `superseded`），依段落順序。 */
export interface FactCheckListResponse {
  readonly findings: FactCheckFinding[];
  /** 最近一次查證（失敗、取消也算）；沒查過是 null。 */
  readonly latestRun: FactCheckRun | null;
  /** 「說法不同」且未結案、原句還在的條數（發布面板提醒用，不擋發布）。 */
  readonly openContradictions: number;
}
