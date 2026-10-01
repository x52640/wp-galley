import type {
  AgentProvider,
  FactCheckFinding,
  FactCheckProgress,
  FactCheckRun,
  FactCheckSource,
  FactCheckSourceOrigin,
  FactCheckStage,
  FactCheckVerdict,
} from '../../contract/api.js';
import { checkFactCheckSelection } from '../../contract/factcheck.js';
import { findIgnoringSpaces } from '../../contract/text-match.js';

/**
 * AI 查證的畫面用的純函式（P6-T005，D-034；規格 docs/specs/factcheck.md「觸發與畫面」）。
 *
 * 只有文案、排序、反灰條件與進度文字；判定、核對、降級都是後端做好的（`verdict`、`check`），這裡不重算。
 * 前後端都要的規則（選字長度、說法不同的條數）在 `src/contract/factcheck.ts`。
 */

export const VERDICT_LABEL: Record<FactCheckVerdict, string> = {
  supported: '有來源支持',
  contradicted: '來源說法不同',
  unverifiable: '查不到',
  'needs-context': '要看前後文',
};

export const ORIGIN_LABEL: Record<FactCheckSourceOrigin, string> = {
  'article-link': '文章裡的連結',
  'agent-search': 'AI 給的網址',
  'agent-memory': 'AI 記得的網址',
  wikipedia: '維基百科',
};

export type NoteTone = 'good' | 'warn' | 'bad' | 'dim' | 'info';

/** 一份來源的核對結果。抓不到的原因一定寫出來（例如「網址含文章原句，沒抓」），使用者才能自己點開。 */
export function sourceCheckText(source: FactCheckSource): { tone: NoteTone; text: string } {
  if (source.check === 'found') return { tone: 'good', text: '引文已核對' };
  if (source.check === 'fetch-failed') {
    const reason = source.failReason ?? '原因不明';
    // 後端有些原因自己就寫了「沒抓」（「網址含文章原句，沒抓」），不要講兩次。
    return { tone: 'warn', text: `${reason.includes('沒抓') ? reason : `沒抓：${reason}`}。請自己點開確認` };
  }
  return source.quote === null ? { tone: 'dim', text: '沒有引用這份' } : { tone: 'warn', text: '引文在網頁上找不到' };
}

/** 被降級（AI 引的話對不上）的卡片要講清楚；沒被降級是 null。 */
export function downgradeNote(finding: FactCheckFinding): string | null {
  if (finding.verdict === finding.agentVerdict) return null;
  return `AI 說「${VERDICT_LABEL[finding.agentVerdict]}」，但它引的話在網頁上找不到，所以標成${VERDICT_LABEL[finding.verdict]}`;
}

/** 只有 http／https 給點；其他（含 `javascript:`）不做成連結。 */
export function safeHref(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null;
  } catch {
    return null;
  }
}

/** 來源旁的網域（拿掉 www.）。解析不了就原樣。 */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * 「看原文」：把引文在前後文裡標出來。忽略空白找（`text-match`，跟後端核對同一套）。
 * 回的是三段純文字，畫面當文字節點放，不當 HTML。找不到是 null，畫面整段照放。
 */
export function quoteInContext(
  context: string,
  quote: string | null,
): { before: string; quote: string; after: string } | null {
  if (quote === null) return null;
  const hit = findIgnoringSpaces(context, quote);
  if (hit === null) return null;
  return { before: context.slice(0, hit.start), quote: context.slice(hit.start, hit.end), after: context.slice(hit.end) };
}

/** 還開著（要看的）：`open` 而且原句還在。原句已經改了的收進「已處理」。 */
export function isOpenFinding(finding: FactCheckFinding): boolean {
  return finding.status === 'open' && !finding.excerptGone;
}

/** 「已處理」裡的下場。 */
export function resolvedFindingLabel(finding: FactCheckFinding): string {
  if (finding.status === 'dismissed') return '知道了';
  if (finding.status === 'resolved-by-edit') return '自己改了';
  if (finding.excerptGone) return '原句已經改了';
  return '已處理';
}

/** 校稿與查證卡片混排：依段落順序，定位不到的放最後，同一段保持原本的順序。 */
export function mergeByBlock<T extends { blockIndex: number | null }>(items: readonly T[]): T[] {
  const rank = (item: T): number => item.blockIndex ?? Number.POSITIVE_INFINITY;
  return items
    .map((item, order) => ({ item, order }))
    .sort((a, b) => rank(a.item) - rank(b.item) || a.order - b.order)
    .map(({ item }) => item);
}

/**
 * 這家能不能在第一趟只開廠商端的搜尋。後端的權威是 `AgentRegistry.supportsHostedSearch`，
 * 但按之前沒有 API 問得到；跑起來之後以 `FactCheckProgress.hostedSearch` 為準。
 */
export function providerHasHostedSearch(provider: AgentProvider): boolean {
  return provider !== 'google';
}

/** 選 Antigravity（畫面上的「Gemini」）時按鈕旁要講明；其他家是 null。 */
export function hostedSearchNote(provider: AgentProvider): string | null {
  return providerHasHostedSearch(provider)
    ? null
    : 'Gemini（Antigravity）不能只開搜尋，這次只查維基百科和 AI 記得的網址';
}

/** 能不能按查證（三個入口共用；跟其他 Agent 動作同一套）。可以按是 null。 */
export function factCheckBlockedReason(state: {
  running: boolean;
  editing: boolean;
  comparing: boolean;
  bodyEmpty: boolean;
  finished: boolean;
}): string | null {
  if (state.finished) return '這篇稿件已經結束，不能再查證';
  if (state.running) return '另一個 AI 動作還在跑，等它跑完再查證';
  if (state.editing) return '正在改文章，先儲存或取消再查證';
  if (state.comparing) return '對照中不能查證，先回到文章';
  if (state.bodyEmpty) return '正文是空的，先寫點內容再查證';
  return null;
}

/** 選的字能不能查（太短、太長）。找不找得到由後端判斷。 */
export function selectionProblem(text: string): string | null {
  const checked = checkFactCheckSelection(text);
  return checked.ok ? null : checked.message;
}

// --- 進度 ---------------------------------------------------------------------

const STAGE_ORDER: readonly FactCheckStage[] = ['find', 'fetch', 'judge', 'verify'];

export interface ProgressStep {
  readonly stage: FactCheckStage;
  /** `skipped`：一份來源都沒抓到，第二趟沒跑。 */
  readonly state: 'done' | 'active' | 'todo' | 'skipped';
  readonly text: string;
}

/** 查證跑的時候那四行：找來源 → 抓網頁 → 判斷 → 核對。不畫百分比，只講做到哪、數到幾個。 */
export function progressSteps(progress: FactCheckProgress): ProgressStep[] {
  const at = STAGE_ORDER.indexOf(progress.stage);
  const { candidates, fetched, fetchFailed, droppedClaims } = progress.counts;
  const stateOf = (stage: FactCheckStage): ProgressStep['state'] => {
    const index = STAGE_ORDER.indexOf(stage);
    return index < at ? 'done' : index === at ? 'active' : 'todo';
  };
  const failedNote = fetchFailed > 0 ? `（${fetchFailed} 個抓不到）` : '';

  const find = stateOf('find');
  const findText =
    find === 'active'
      ? '找來源中…'
      : (candidates === 0 ? '找來源：沒有找到可以抓的網頁' : `找來源：找到 ${candidates} 個候選網頁`) +
        (droppedClaims > 0 ? `；AI 引的句子文章裡找不到，丟掉 ${droppedClaims} 條` : '');

  const fetch = stateOf('fetch');
  const fetchText =
    fetch === 'todo'
      ? '抓網頁'
      : fetch === 'active'
        ? fetched + fetchFailed > 0
          ? `抓網頁中…已抓到 ${fetched} 個${failedNote}`
          : '抓網頁中…'
        : fetched === 0
          ? `抓網頁：一個都沒抓到${failedNote}`
          : `抓網頁：抓到 ${fetched} 個${failedNote}`;

  let judge: ProgressStep = { stage: 'judge', state: stateOf('judge'), text: '讀來源、判斷' };
  if (judge.state === 'active') judge = { ...judge, text: '讀來源、判斷中…' };
  if (judge.state === 'done') {
    judge = progress.judged
      ? { ...judge, text: '讀來源、判斷：完成' }
      : { stage: 'judge', state: 'skipped', text: '一個來源都沒抓到，沒有再請 AI 判斷（只用掉一次額度）' };
  }

  const verify = stateOf('verify');
  return [
    { stage: 'find', state: find, text: findText },
    { stage: 'fetch', state: fetch, text: fetchText },
    judge,
    { stage: 'verify', state: verify, text: verify === 'active' ? '核對引文中…' : '核對引文' },
  ];
}

/**
 * 最近一次查證跑完之後要講的話（右欄上方）。跑中、正常完成是 null。
 * 停止是中性的（不是紅色錯誤）；失敗講原因；全部抓不到、丟掉幾條都要講。
 */
export function latestRunNote(run: FactCheckRun | null): { tone: NoteTone; text: string } | null {
  if (run === null || run.status === 'running') return null;
  if (run.status === 'cancelled') return { tone: 'info', text: '已停止，這次查證沒有留下結果。' };
  if (run.status === 'failed') return { tone: 'bad', text: `查證沒有完成：${run.errorMessage ?? '原因不明'}` };
  const lines: string[] = [];
  if (!run.judged) lines.push('一個來源都沒抓到，沒有再請 AI 判斷（只用掉一次額度）。抓不到的網頁列在卡片上，可以自己點開看。');
  if (run.counts.droppedClaims > 0) lines.push(`AI 引的句子文章裡找不到，丟掉 ${run.counts.droppedClaims} 條。`);
  if (lines.length === 0) return null;
  return { tone: run.judged ? 'info' : 'warn', text: lines.join('') };
}

/**
 * 點文章上的標記，要亮哪一張卡片。同一段字同時有兩種標記（一個 `<mark>` 包著另一個、範圍一樣）時，
 * 點擊只會落在內層；所以內層已經亮著、再點一次就換外層，再點換回來——兩張卡片都從文章點得到。
 * 範圍不同（外層比較長）時外層其他的字點得到它，這裡一律回點到的那個。
 */
export function pickClickedMark(
  inner: { key: string; text: string },
  outer: { key: string; text: string } | null,
  active: string | null,
): string {
  if (outer === null) return inner.key;
  const same = inner.text.replace(/\s+/gu, '') === outer.text.replace(/\s+/gu, '');
  if (!same) return inner.key;
  return active === inner.key ? outer.key : inner.key;
}

/**
 * 查證請求失敗之後，是不是「使用者按了停止」：最近一次是**這次新開的**（id 跟送出前不同）而且被停止。
 * 很多錯誤（選字找不到、含密碼、另一個動作在跑…）在開紀錄之前就丟，那時 latestRun 還是上一次的，不能拿來吞錯。
 */
export function isNewCancelledRun(latest: FactCheckRun | null, previousId: number | null): boolean {
  return latest !== null && latest.status === 'cancelled' && latest.id !== previousId;
}
