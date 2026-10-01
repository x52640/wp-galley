import { describe, expect, it } from 'vitest';

import type { FactCheckFinding, FactCheckProgress, FactCheckRun, FactCheckSource } from '../src/contract/api.js';
import {
  ORIGIN_LABEL,
  VERDICT_LABEL,
  downgradeNote,
  factCheckBlockedReason,
  hostOf,
  hostedSearchNote,
  isOpenFinding,
  latestRunNote,
  mergeByBlock,
  pickClickedMark,
  isNewCancelledRun,
  progressSteps,
  quoteInContext,
  resolvedFindingLabel,
  safeHref,
  selectionProblem,
  sourceCheckText,
} from '../src/ui/lib/factcheck-view.js';

/** AI 查證的畫面（P6-T005，docs/specs/factcheck.md「觸發與畫面」）：卡片文案、降級說明、排序、反灰條件、進度文字。 */

function source(partial: Partial<FactCheckSource> = {}): FactCheckSource {
  return {
    url: 'https://zh.wikipedia.org/wiki/刺激1995',
    title: '刺激1995',
    origin: 'wikipedia',
    quote: null,
    check: 'not-found',
    failReason: null,
    context: null,
    ...partial,
  };
}

function finding(partial: Partial<FactCheckFinding> = {}): FactCheckFinding {
  return {
    id: 1,
    runId: 1,
    excerpt: '這部片 1995 年上映',
    claim: '《刺激1995》在 1995 年上映',
    verdict: 'contradicted',
    agentVerdict: 'contradicted',
    evidence: '維基百科寫 1994 年 9 月首映。',
    correction: '改成 1994 年。',
    sources: [],
    blockIndex: 0,
    status: 'open',
    excerptGone: false,
    agentId: 'claude',
    revisionId: 1,
    createdAt: '2026-10-01T00:00:00Z',
    resolvedAt: null,
    ...partial,
  };
}

function progress(partial: Partial<FactCheckProgress> = {}): FactCheckProgress {
  return {
    runId: 1,
    scope: 'article',
    stage: 'find',
    counts: { candidates: 0, fetched: 0, fetchFailed: 0, droppedClaims: 0 },
    hostedSearch: true,
    judged: false,
    ...partial,
  };
}

function run(partial: Partial<FactCheckRun> = {}): FactCheckRun {
  return {
    id: 1,
    scope: 'article',
    provider: 'claude',
    status: 'succeeded',
    stage: 'verify',
    counts: { candidates: 6, fetched: 4, fetchFailed: 2, droppedClaims: 0 },
    hostedSearch: true,
    judged: true,
    revisionId: 1,
    startedAt: '2026-10-01T00:00:00Z',
    finishedAt: '2026-10-01T00:01:00Z',
    errorMessage: null,
    ...partial,
  };
}

describe('判定與來源的文案', () => {
  it('四種判定照規格寫', () => {
    expect(VERDICT_LABEL).toEqual({
      supported: '有來源支持',
      contradicted: '來源說法不同',
      unverifiable: '查不到',
      'needs-context': '要看前後文',
    });
  });

  it('來源從哪來寫在來源旁', () => {
    expect(ORIGIN_LABEL['article-link']).toBe('文章裡的連結');
    expect(ORIGIN_LABEL['agent-search']).toBe('AI 給的網址');
    expect(ORIGIN_LABEL['agent-memory']).toBe('AI 記得的網址');
    expect(ORIGIN_LABEL.wikipedia).toBe('維基百科');
  });

  it('核對結果：對上、對不上、沒引、沒抓（原因要看得到）', () => {
    expect(sourceCheckText(source({ check: 'found', quote: '1994年' }))).toEqual({ tone: 'good', text: '引文已核對' });
    expect(sourceCheckText(source({ check: 'not-found', quote: '1995年首映' })).text).toBe('引文在網頁上找不到');
    expect(sourceCheckText(source({ check: 'not-found', quote: null })).text).toBe('沒有引用這份');
    const failed = sourceCheckText(source({ check: 'fetch-failed', failReason: '網址含文章原句，沒抓' }));
    expect(failed.tone).toBe('warn');
    expect(failed.text).toBe('網址含文章原句，沒抓。請自己點開確認');
    expect(sourceCheckText(source({ check: 'fetch-failed', failReason: '網頁太大' })).text).toBe('沒抓：網頁太大。請自己點開確認');
    expect(sourceCheckText(source({ check: 'fetch-failed', failReason: null })).text).toContain('原因不明');
  });

  it('被降級的卡片講清楚 AI 原本說什麼、為什麼標成查不到', () => {
    expect(downgradeNote(finding({ verdict: 'unverifiable', agentVerdict: 'contradicted' }))).toBe(
      'AI 說「來源說法不同」，但它引的話在網頁上找不到，所以標成查不到',
    );
    expect(downgradeNote(finding({ verdict: 'unverifiable', agentVerdict: 'supported' }))).toContain('有來源支持');
    expect(downgradeNote(finding())).toBeNull();
  });
});

describe('來源連結', () => {
  it('只給 http／https 當連結，其他不給點', () => {
    expect(safeHref('https://zh.wikipedia.org/wiki/x')).toBe('https://zh.wikipedia.org/wiki/x');
    expect(safeHref('http://example.com/a')).toBe('http://example.com/a');
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('data:text/html,hi')).toBeNull();
    expect(safeHref('not a url')).toBeNull();
  });

  it('網域拿掉 www.，壞網址原樣顯示', () => {
    expect(hostOf('https://www.imdb.com/title/tt0111161/')).toBe('imdb.com');
    expect(hostOf('https://zh.wikipedia.org/wiki/x')).toBe('zh.wikipedia.org');
    expect(hostOf('壞掉的')).toBe('壞掉的');
  });

  it('看原文：把引文在前後文裡找出來（忽略空白），找不到就整段照放', () => {
    expect(quoteInContext('前面的字 1994 年 9 月首映，後面的字', '1994年9月首映')).toEqual({
      before: '前面的字 ',
      quote: '1994 年 9 月首映',
      after: '，後面的字',
    });
    expect(quoteInContext('前後文', '不在裡面')).toBeNull();
    expect(quoteInContext('前後文', null)).toBeNull();
  });
});

describe('還開著的、已處理的', () => {
  it('open 而且原句還在才算開著', () => {
    expect(isOpenFinding(finding())).toBe(true);
    expect(isOpenFinding(finding({ excerptGone: true }))).toBe(false);
    expect(isOpenFinding(finding({ status: 'dismissed' }))).toBe(false);
    expect(isOpenFinding(finding({ status: 'resolved-by-edit' }))).toBe(false);
    expect(isOpenFinding(finding({ status: 'superseded' }))).toBe(false);
  });

  it('已處理的下場分得開', () => {
    expect(resolvedFindingLabel(finding({ status: 'dismissed' }))).toBe('知道了');
    expect(resolvedFindingLabel(finding({ status: 'resolved-by-edit' }))).toBe('自己改了');
    expect(resolvedFindingLabel(finding({ excerptGone: true }))).toBe('原句已經改了');
  });
});

describe('跟校稿卡片混排：依段落順序', () => {
  it('段落小的在前，定位不到的放最後，同一段保持原本順序', () => {
    const items = [
      { key: 'r1', blockIndex: 2 },
      { key: 'r2', blockIndex: null },
      { key: 'r3', blockIndex: 0 },
      { key: 'f1', blockIndex: 2 },
      { key: 'f2', blockIndex: 1 },
      { key: 'f3', blockIndex: null },
    ];
    expect(mergeByBlock(items).map((item) => item.key)).toEqual(['r3', 'f2', 'r1', 'f1', 'r2', 'f3']);
  });
});

describe('能不能按（跟其他 Agent 動作同一套）', () => {
  const idle = { running: false, editing: false, comparing: false, bodyEmpty: false, finished: false };

  it('閒著可以按', () => {
    expect(factCheckBlockedReason(idle)).toBeNull();
  });

  it('每一種反灰都講原因', () => {
    expect(factCheckBlockedReason({ ...idle, running: true })).toBe('另一個 AI 動作還在跑，等它跑完再查證');
    expect(factCheckBlockedReason({ ...idle, editing: true })).toBe('正在改文章，先儲存或取消再查證');
    expect(factCheckBlockedReason({ ...idle, comparing: true })).toBe('對照中不能查證，先回到文章');
    expect(factCheckBlockedReason({ ...idle, bodyEmpty: true })).toBe('正文是空的，先寫點內容再查證');
    expect(factCheckBlockedReason({ ...idle, finished: true })).toBe('這篇稿件已經結束，不能再查證');
  });

  it('稿件結束優先講', () => {
    expect(factCheckBlockedReason({ ...idle, finished: true, running: true })).toBe('這篇稿件已經結束，不能再查證');
  });

  it('選字的長度用共用規則', () => {
    expect(selectionProblem('1995 年上映')).toBeNull();
    expect(selectionProblem('上映')).toContain('太短');
    expect(selectionProblem('字'.repeat(301))).toContain('太長');
  });

  it('Antigravity（畫面上叫 Gemini）不能只開搜尋，要講明', () => {
    expect(hostedSearchNote('google')).toBe('Gemini（Antigravity）不能只開搜尋，這次只查維基百科和 AI 記得的網址');
    expect(hostedSearchNote('claude')).toBeNull();
    expect(hostedSearchNote('codex')).toBeNull();
  });
});

describe('分段進度', () => {
  it('找來源中：第一行在跑，其他還沒開始', () => {
    const steps = progressSteps(progress({ stage: 'find' }));
    expect(steps.map((step) => step.state)).toEqual(['active', 'todo', 'todo', 'todo']);
    expect(steps[0]?.text).toBe('找來源中…');
  });

  it('抓網頁中：講找到幾個候選、已經抓到幾個', () => {
    const steps = progressSteps(
      progress({ stage: 'fetch', counts: { candidates: 6, fetched: 2, fetchFailed: 1, droppedClaims: 0 } }),
    );
    expect(steps.map((step) => step.state)).toEqual(['done', 'active', 'todo', 'todo']);
    expect(steps[0]?.text).toBe('找來源：找到 6 個候選網頁');
    expect(steps[1]?.text).toBe('抓網頁中…已抓到 2 個（1 個抓不到）');
  });

  it('判斷中：抓到幾個（幾個抓不到）', () => {
    const steps = progressSteps(
      progress({ stage: 'judge', counts: { candidates: 6, fetched: 4, fetchFailed: 2, droppedClaims: 1 } }),
    );
    expect(steps.map((step) => step.state)).toEqual(['done', 'done', 'active', 'todo']);
    expect(steps[0]?.text).toBe('找來源：找到 6 個候選網頁；AI 引的句子文章裡找不到，丟掉 1 條');
    expect(steps[1]?.text).toBe('抓網頁：抓到 4 個（2 個抓不到）');
    expect(steps[2]?.text).toBe('讀來源、判斷中…');
  });

  it('核對中', () => {
    const steps = progressSteps(
      progress({ stage: 'verify', judged: true, counts: { candidates: 3, fetched: 3, fetchFailed: 0, droppedClaims: 0 } }),
    );
    expect(steps.map((step) => step.state)).toEqual(['done', 'done', 'done', 'active']);
    expect(steps[1]?.text).toBe('抓網頁：抓到 3 個');
    expect(steps[3]?.text).toBe('核對引文中…');
  });

  it('全部抓不到：第二趟沒跑，講只用掉一次額度', () => {
    const steps = progressSteps(
      progress({ stage: 'verify', judged: false, counts: { candidates: 3, fetched: 0, fetchFailed: 3, droppedClaims: 0 } }),
    );
    expect(steps[1]?.text).toBe('抓網頁：一個都沒抓到（3 個抓不到）');
    expect(steps[2]?.state).toBe('skipped');
    expect(steps[2]?.text).toBe('一個來源都沒抓到，沒有再請 AI 判斷（只用掉一次額度）');
  });

  it('沒找到任何候選', () => {
    const steps = progressSteps(progress({ stage: 'fetch' }));
    expect(steps[0]?.text).toBe('找來源：沒有找到可以抓的網頁');
  });
});

describe('最近一次查證的說明', () => {
  it('跑中、正常完成不另外講', () => {
    expect(latestRunNote(null)).toBeNull();
    expect(latestRunNote(run({ status: 'running' }))).toBeNull();
    expect(latestRunNote(run())).toBeNull();
  });

  it('停止是中性的、不留結果', () => {
    expect(latestRunNote(run({ status: 'cancelled', errorMessage: '使用者取消' }))).toEqual({
      tone: 'info',
      text: '已停止，這次查證沒有留下結果。',
    });
  });

  it('失敗講原因', () => {
    const note = latestRunNote(run({ status: 'failed', errorMessage: 'AI 給的網址或搜尋字串裡有你的 WordPress 應用程式密碼，這次查證停止' }));
    expect(note?.tone).toBe('bad');
    expect(note?.text).toContain('應用程式密碼');
  });

  it('全部抓不到、丟掉幾條都要講', () => {
    expect(latestRunNote(run({ judged: false, counts: { candidates: 2, fetched: 0, fetchFailed: 2, droppedClaims: 0 } }))?.text).toContain(
      '只用掉一次額度',
    );
    expect(latestRunNote(run({ counts: { candidates: 2, fetched: 2, fetchFailed: 0, droppedClaims: 2 } }))?.text).toBe(
      'AI 引的句子文章裡找不到，丟掉 2 條。',
    );
  });
});

describe('同一句兩張卡片：從文章點得到兩張（審查 A）', () => {
  const inner = { key: 'f3', text: '研究顯示，重看喜歡的電影能降低焦慮' };
  const outer = { key: 'r9201', text: '研究顯示，重看喜歡的電影能降低焦慮' };

  it('沒外層、或外層範圍不同：一律是點到的那個', () => {
    expect(pickClickedMark(inner, null, null)).toBe('f3');
    expect(pickClickedMark(inner, { key: 'r1', text: '更長的句子：研究顯示，重看喜歡的電影能降低焦慮' }, 'f3')).toBe('f3');
  });

  it('同範圍：第一次點亮內層，已經亮的再點一次換外層，再點換回內層', () => {
    expect(pickClickedMark(inner, outer, null)).toBe('f3');
    expect(pickClickedMark(inner, outer, 'f3')).toBe('r9201');
    expect(pickClickedMark(inner, outer, 'r9201')).toBe('f3');
  });

  it('範圍比較忽略空白', () => {
    expect(pickClickedMark({ key: 'f1', text: '1995 年' }, { key: 'r1', text: '1995年' }, 'f1')).toBe('r1');
  });
});

describe('停止才不當錯誤講（審查 1）', () => {
  it('這次新開、而且被停止的才算', () => {
    expect(isNewCancelledRun(run({ id: 5, status: 'cancelled' }), 4)).toBe(true);
    expect(isNewCancelledRun(run({ id: 4, status: 'cancelled' }), 4)).toBe(false);
    expect(isNewCancelledRun(run({ id: 5, status: 'failed' }), 4)).toBe(false);
    expect(isNewCancelledRun(run({ id: 1, status: 'cancelled' }), null)).toBe(true);
    expect(isNewCancelledRun(null, null)).toBe(false);
  });
});
