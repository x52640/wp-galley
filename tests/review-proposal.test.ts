import { afterEach, describe, expect, it } from 'vitest';

import { approveJob, createCoreFixture, TINY_PNG, type CoreFixture } from './helpers/core-fixture.js';
import { FakeAdapter } from './helpers/fake-adapter.js';
import { ContentChangedError, InvalidInputError } from '../src/core/errors.js';
import type { CoreService } from '../src/core/service.js';

/**
 * 待處理清單（階段 5.5）。
 *
 * 這一批的重點只有一個：**Agent 的建議不會自己落地。** 每一條測試都在確認
 * 「沒按就沒改」——內容、核准、狀態三件事都不該因為 Agent 跑過而變動。
 *
 * 一律用 FakeAdapter，絕不呼叫真實 CLI（那會消耗使用者的訂閱額度）。
 */

const SOURCE = '今天讀完這本書，想到很多事。\n\n不是書裡寫的那些，而是別的。';

const P = (text: string): string => `<p class="wp-block-paragraph">${text}</p>`;

/** Agent 提了三項：兩項安全的、一項自承改了原意，外加一個要人判斷的觀察。 */
const CHANGES = [
  { type: 'typo' as const, before: '很多事', after: '很多事情', reason: '語感', meaningChanged: false },
  { type: 'style' as const, before: '別的', after: '另一回事', reason: '用詞', meaningChanged: false },
  { type: 'clarity' as const, before: '不是書裡寫的', after: '書裡完全沒寫的', reason: '更清楚', meaningChanged: true },
];

const OBSERVATION = {
  kind: 'contradiction' as const,
  blockIndex: 1,
  excerpt: '不是書裡寫的那些',
  detail: '第 1 段說書裡有寫，第 2 段說沒寫',
  suggestion: '確認到底哪一段才對',
};

const PROPOSED_BODY = P('今天讀完這本書，想到很多事情。') + P('書裡完全沒寫的那些，而是另一回事。');

function reviewResult(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    ok: true as const,
    data: {
      title: '20260828',
      summary: '三處建議',
      correctedSource: '（略）',
      changes: CHANGES,
      observations: [OBSERVATION],
      templateData: { title: '20260828', body: PROPOSED_BODY },
      imageBriefs: [],
      ...overrides,
    },
    meta: { runId: 'r', agentId: 'codex' as const, model: null, durationMs: 1, stderrTail: '' },
  };
}

let fixture: CoreFixture | null = null;

afterEach(async () => {
  await fixture?.cleanup();
  fixture = null;
});

async function setup(result = reviewResult()): Promise<CoreFixture> {
  fixture = await createCoreFixture({ adapters: [new FakeAdapter('codex', 'Codex', { result })] });
  return fixture;
}

function newJob(core: CoreService): string {
  return core.createJob({ targetKey: 'diary', sourceText: SOURCE, title: '20260828' }).uuid;
}

async function propose(core: CoreService): Promise<string> {
  const uuid = newJob(core);
  await core.runAgentReview(uuid, { provider: 'codex' });
  return uuid;
}

/** 依 ordinal 取清單上的第幾項。 */
function itemAt(core: CoreService, uuid: string, ordinal: number): number {
  return core.getReview(uuid)!.items.find((item) => item.ordinal === ordinal)!.id;
}

describe('提案的形狀', () => {
  it('改動與觀察掛在同一張清單上，全部是 pending', async () => {
    const f = await setup();
    const uuid = await propose(f.core);

    const review = f.core.getReview(uuid)!;
    expect(review.items.map((item) => item.type)).toEqual([
      'change',
      'change',
      'change',
      'observation',
    ]);
    expect(review.items.every((item) => item.state === 'pending')).toBe(true);
    expect(review.pendingCount).toBe(4);
    expect(review.stale).toBe(false);
  });

  it('meaningChanged 的項目照樣是 pending——「預設不套用」在這裡是字面意思', async () => {
    const f = await setup();
    const uuid = await propose(f.core);

    const risky = f.core.getReview(uuid)!.items.find((item) => item.change?.meaningChanged === true)!;
    expect(risky.state).toBe('pending');
    // 而且文章裡還是原本那句話。
    expect(f.core.getJob(uuid).currentRevision!.publishHtml).toContain('不是書裡寫的');
  });

  it('觀察原樣帶出來，UI 才掛得到那一段', async () => {
    const f = await setup();
    const uuid = await propose(f.core);

    const observation = f.core.getReview(uuid)!.items.find((item) => item.type === 'observation')!;
    expect(observation.observation).toEqual(OBSERVATION);
    expect(observation.change).toBeNull();
  });

  it('沒處理完的項目會列進 blockers，使用者看得到「還沒清完」', async () => {
    const f = await setup();
    const uuid = await propose(f.core);
    expect(f.core.getJob(uuid).blockers.some((line) => line.includes('4 項'))).toBe(true);
  });

  it('再跑一次校稿，舊提案結掉換成新的，清單不會疊起來', async () => {
    const f = await setup();
    const uuid = await propose(f.core);
    const first = f.core.getReview(uuid)!.id;

    await f.core.runAgentReview(uuid, { provider: 'codex' });
    const second = f.core.getReview(uuid)!;
    expect(second.id).not.toBe(first);
    expect(second.items).toHaveLength(4);
  });
});

describe('逐項套用', () => {
  it('只套用勾選的那一項，其他原封不動', async () => {
    const f = await setup();
    const uuid = await propose(f.core);

    const result = f.core.resolveReviewItems(uuid, { itemIds: [itemAt(f.core, uuid, 0)], decision: 'apply' });
    expect(result.applied).toHaveLength(1);
    expect(result.revision).not.toBeNull();

    const html = f.core.getJob(uuid).currentRevision!.publishHtml;
    expect(html).toContain('很多事情');
    expect(html).toContain('而是別的'); // 第 1 項沒勾
    expect(html).toContain('不是書裡寫的'); // 第 2 項沒勾
  });

  it('套用之後那一項變成 applied，其他還是 pending', async () => {
    const f = await setup();
    const uuid = await propose(f.core);
    const target = itemAt(f.core, uuid, 0);

    f.core.resolveReviewItems(uuid, { itemIds: [target], decision: 'apply' });

    const review = f.core.getReview(uuid)!;
    expect(review.items.find((item) => item.id === target)!.state).toBe('applied');
    expect(review.pendingCount).toBe(3);
  });

  it('分兩次套用也對得上位置——第二次是站在第一次的結果上做的', async () => {
    const f = await setup();
    const uuid = await propose(f.core);

    f.core.resolveReviewItems(uuid, { itemIds: [itemAt(f.core, uuid, 0)], decision: 'apply' });
    f.core.resolveReviewItems(uuid, { itemIds: [itemAt(f.core, uuid, 2)], decision: 'apply' });

    const html = f.core.getJob(uuid).currentRevision!.publishHtml;
    expect(html).toContain('很多事情');
    expect(html).toContain('書裡完全沒寫的');
    expect(html).toContain('而是別的'); // 中間那一項始終沒勾
    expect(f.core.listRevisions(uuid)).toHaveLength(3);
  });

  it('套用會撤銷核准並退回 RENDERED，跟手動編輯走同一條路', async () => {
    const f = await setup();
    const uuid = await propose(f.core);
    approveJob(f.core, uuid);
    expect(f.core.getJob(uuid).approval?.valid).toBe(true);

    f.core.resolveReviewItems(uuid, { itemIds: [itemAt(f.core, uuid, 0)], decision: 'apply' });

    const detail = f.core.getJob(uuid);
    expect(detail.approval?.valid).toBe(false);
    expect(detail.state).toBe('RENDERED');
  });

  it('定位不到就標成 unappliable，不會產生版本也不會亂改', async () => {
    const f = await setup(
      reviewResult({
        changes: [
          { type: 'typo', before: '這句話根本不在文章裡', after: '換掉', reason: 'x', meaningChanged: false },
        ],
        observations: [],
      }),
    );
    const uuid = await propose(f.core);
    const before = f.core.getJob(uuid).currentRevision!.contentHash;

    const result = f.core.resolveReviewItems(uuid, { itemIds: [itemAt(f.core, uuid, 0)], decision: 'apply' });
    expect(result.revision).toBeNull();
    expect(result.unappliable).toHaveLength(1);
    expect(f.core.getReview(uuid)!.items[0]!.state).toBe('unappliable');
    expect(f.core.getJob(uuid).currentRevision!.contentHash).toBe(before);
  });

  it('略過不會動到內容', async () => {
    const f = await setup();
    const uuid = await propose(f.core);
    const before = f.core.getJob(uuid).currentRevision!.contentHash;

    const result = f.core.resolveReviewItems(uuid, { itemIds: [itemAt(f.core, uuid, 2)], decision: 'skip' });
    expect(result.revision).toBeNull();
    expect(f.core.getJob(uuid).currentRevision!.contentHash).toBe(before);
    expect(f.core.getReview(uuid)!.items[2]!.state).toBe('skipped');
  });

  it('觀察不能被「套用」——它不是可以自動替換的東西', async () => {
    const f = await setup();
    const uuid = await propose(f.core);
    const observation = f.core.getReview(uuid)!.items.find((item) => item.type === 'observation')!;

    expect(() => f.core.resolveReviewItems(uuid, { itemIds: [observation.id], decision: 'apply' })).toThrow(
      InvalidInputError,
    );
    // 但可以標成處理過。
    f.core.resolveReviewItems(uuid, { itemIds: [observation.id], decision: 'skip' });
    expect(f.core.getReview(uuid)!.items[3]!.state).toBe('skipped');
  });

  it('不屬於這份提案的 id 直接報錯，不默默忽略', async () => {
    const f = await setup();
    const uuid = await propose(f.core);
    expect(() => f.core.resolveReviewItems(uuid, { itemIds: [99999], decision: 'skip' })).toThrow(
      InvalidInputError,
    );
  });

  it('全部處理完提案就自己結案，清單消失', async () => {
    const f = await setup();
    const uuid = await propose(f.core);
    const ids = f.core.getReview(uuid)!.items.map((item) => item.id);

    f.core.resolveReviewItems(uuid, { itemIds: ids, decision: 'skip' });
    expect(f.core.getReview(uuid)).toBeNull();
    expect(f.core.getJob(uuid).review).toBeNull();
  });
});

describe('全部接受', () => {
  it('採用 Agent 的整份稿，所有改動一次落地', async () => {
    const f = await setup();
    const uuid = await propose(f.core);

    const result = f.core.acceptWholeProposal(uuid);
    expect(result.revision!.publishHtml).toContain('很多事情');
    expect(result.revision!.publishHtml).toContain('另一回事');
    expect(result.revision!.publishHtml).toContain('書裡完全沒寫的');
  });

  it('觀察不會被一起清掉——它要的是人去判斷，不是接受一份稿', async () => {
    const f = await setup();
    const uuid = await propose(f.core);

    f.core.acceptWholeProposal(uuid);
    const review = f.core.getReview(uuid)!;
    expect(review.pendingCount).toBe(1);
    expect(review.items.find((item) => item.state === 'pending')!.type).toBe('observation');
  });

  it('提案之後內容被改過就擋下來，不會拿舊稿蓋掉新的修改', async () => {
    const f = await setup();
    const uuid = await propose(f.core);

    // 使用者自己動了一筆。
    f.core.createRevision(uuid, {
      templateData: { title: '20260828', body: P('使用者自己重寫的內容。') },
      reason: '手動編輯',
    });

    expect(f.core.getReview(uuid)!.stale).toBe(true);
    expect(() => f.core.acceptWholeProposal(uuid)).toThrow(ContentChangedError);
    expect(f.core.getJob(uuid).currentRevision!.publishHtml).toContain('使用者自己重寫的內容');
  });

  it('插圖之後也算內容被改過，全部接受會被擋下（否則那張圖會消失）', async () => {
    const f = await setup();
    const uuid = await propose(f.core);
    const asset = await f.core.addMedia(uuid, { bytes: TINY_PNG, mimeType: 'image/png', filename: 'a' });
    f.core.placeMedia(uuid, asset.id, 0);

    expect(() => f.core.acceptWholeProposal(uuid)).toThrow(ContentChangedError);
    expect(f.core.getJob(uuid).currentRevision!.publishHtml).toContain('wp-image-');
  });

  it('逐項套用之後仍然可以全部接受——那是我們自己造成的改動，不算外力', async () => {
    const f = await setup();
    const uuid = await propose(f.core);
    f.core.resolveReviewItems(uuid, { itemIds: [itemAt(f.core, uuid, 0)], decision: 'apply' });

    expect(f.core.getReview(uuid)!.stale).toBe(false);
    const result = f.core.acceptWholeProposal(uuid);
    expect(result.revision!.publishHtml).toContain('書裡完全沒寫的');
  });

  it('手改之後再逐項套用一項，提案仍是過期的，全部接受照樣擋下（審查 #8）', async () => {
    const f = await setup();
    const uuid = await propose(f.core);

    // 使用者自己加了一段，原本的句子都還在，逐項套用仍套得上。
    const current = f.core.getJob(uuid).currentRevision!.templateData;
    f.core.createRevision(uuid, {
      templateData: { ...current, body: `${String(current.body)}${P('使用者手動加的段落。')}` },
      reason: '手動編輯',
    });
    expect(f.core.getReview(uuid)!.stale).toBe(true);

    const applied = f.core.resolveReviewItems(uuid, { itemIds: [itemAt(f.core, uuid, 0)], decision: 'apply' });
    expect(applied.applied).toHaveLength(1);
    expect(applied.revision!.publishHtml).toContain('使用者手動加的段落');

    // 逐項套用不能把過期的提案洗成未過期。
    expect(f.core.getReview(uuid)!.stale).toBe(true);
    expect(() => f.core.acceptWholeProposal(uuid)).toThrow(ContentChangedError);
    expect(f.core.getJob(uuid).currentRevision!.publishHtml).toContain('使用者手動加的段落');

    // 剩下的項目照樣能逐項套用。
    const second = f.core.resolveReviewItems(uuid, { itemIds: [itemAt(f.core, uuid, 1)], decision: 'apply' });
    expect(second.applied).toHaveLength(1);
    expect(second.revision!.publishHtml).toContain('另一回事');
    expect(second.revision!.publishHtml).toContain('使用者手動加的段落');
    expect(f.core.getReview(uuid)!.stale).toBe(true);
  });
});

describe('丟棄提案', () => {
  it('丟掉之後清單就沒了，內容從頭到尾沒動過', async () => {
    const f = await setup();
    const uuid = await propose(f.core);
    const before = f.core.getJob(uuid).currentRevision!.contentHash;

    f.core.discardReview(uuid, '不採用');
    expect(f.core.getReview(uuid)).toBeNull();
    expect(f.core.getJob(uuid).currentRevision!.contentHash).toBe(before);
    expect(f.core.listRevisions(uuid)).toHaveLength(1);
  });

  it('沒有提案時丟棄或套用都會明講，而不是靜靜地什麼都沒發生', async () => {
    const f = await setup();
    const uuid = newJob(f.core);
    expect(() => f.core.discardReview(uuid, 'x')).toThrow(InvalidInputError);
    expect(() => f.core.acceptWholeProposal(uuid)).toThrow(InvalidInputError);
  });
});

describe('左右對照', () => {
  it('有提案就跟提案比，右邊是「全部接受會變成的樣子」', async () => {
    const f = await setup();
    const uuid = await propose(f.core);

    const comparison = f.core.getComparison(uuid);
    expect(comparison.against).toBe('proposal');
    expect(comparison.rows).toHaveLength(2);
    expect(comparison.rows.every((row) => row.kind === 'replaced')).toBe(true);
    // 逐詞比對：只有真的改掉的那個詞被標出來，「今天讀完這本書，想到很多」全部是 same。
    const first = comparison.rows[0]!;
    expect(first.right!.filter((segment) => segment.op === 'added').map((s) => s.text)).toEqual(['事情']);
    expect(first.left!.filter((segment) => segment.op === 'removed').map((s) => s.text)).toEqual(['事']);
    expect(first.left!.map((segment) => segment.text).join('')).toBe('今天讀完這本書，想到很多事。');
  });

  it('沒有提案就跟上一版比', async () => {
    const f = await setup();
    const uuid = await propose(f.core);
    f.core.discardReview(uuid, '不採用');
    f.core.createRevision(uuid, {
      templateData: { title: '20260828', body: P('改過的第一段。') + P('不是書裡寫的那些，而是別的。') },
      reason: '手動',
    });

    const comparison = f.core.getComparison(uuid);
    expect(comparison.against).toBe('previous');
    expect(comparison.rows.filter((row) => row.kind === 'replaced')).toHaveLength(1);
  });

  it('跟上一版比：只換了封面也要講出來，正文一段都沒改（D-019，使用者 r12 → r13）', async () => {
    const f = await setup();
    const uuid = newJob(f.core);
    const asset = await f.core.addMedia(uuid, {
      bytes: TINY_PNG,
      mimeType: 'image/png',
      filename: 'cover',
      altText: '一張封面',
    });
    f.core.setFeaturedMedia(uuid, asset.id);

    const comparison = f.core.getComparison(uuid);
    expect(comparison.against).toBe('previous');
    expect(comparison.rows.every((row) => row.kind === 'same')).toBe(true);
    expect(comparison.fieldChanges).toHaveLength(1);
    const [change] = comparison.fieldChanges;
    expect(change!.field).toBe('featuredMedia');
    expect(change!.label).toBe('精選圖片');
    expect(change!.before).toBeNull();
    // 顯示檔名／替代文字，不是資料庫的 id。
    expect(change!.after).toContain('一張封面');
    expect(change!.after).not.toBe(String(asset.id));
  });

  it('跟上一版比：標題、網址片段這些正文以外的欄位也列出來', async () => {
    const f = await setup();
    const uuid = newJob(f.core);
    const current = f.core.getJob(uuid).currentRevision!.templateData;
    f.core.createRevision(uuid, {
      templateData: { ...current, title: '20260829', slug: '20260829' },
      reason: '手動',
    });
    const comparison = f.core.getComparison(uuid);
    expect(comparison.fieldChanges.map((change) => change.label)).toEqual(['標題', '網址片段']);
    expect(comparison.fieldChanges[0]).toMatchObject({ before: '20260828', after: '20260829' });
  });

  it('跟 AI 提案比：提案改了標題也要列出來；正文與精選圖片沿用時不列', async () => {
    const f = await setup(
      reviewResult({ templateData: { title: '讀完一本書', body: PROPOSED_BODY } }),
    );
    const uuid = await propose(f.core);
    const comparison = f.core.getComparison(uuid);
    expect(comparison.against).toBe('proposal');
    expect(comparison.fieldChanges).toEqual([
      { field: 'title', label: '標題', before: '20260828', after: '讀完一本書' },
    ]);
  });

  it('只有一版又沒有提案時老實說沒得比', async () => {
    const f = await setup();
    const uuid = newJob(f.core);
    expect(f.core.getComparison(uuid).against).toBe('none');
  });

  it('可以指定要跟哪一邊比', async () => {
    const f = await setup();
    const uuid = await propose(f.core);
    expect(f.core.getComparison(uuid, 'previous').against).toBe('none');
    expect(f.core.getComparison(uuid, 'proposal').against).toBe('proposal');
  });
});

/**
 * Codex review（未留檔）抓到的幾條。每一條都對應清單上的一項，
 * 修好之後這些測試就是「不要再退回去」的看門狗。
 */
describe('review 之後補上的防線', () => {
  it('校稿不會把已經渲染好的稿子推回「還沒渲染」', async () => {
    const f = await setup();
    const uuid = newJob(f.core);
    f.core.render(uuid);
    expect(f.core.getJob(uuid).state).toBe('RENDERED');

    await f.core.runAgentReview(uuid, { provider: 'codex' });

    // 內容一個字都沒改，校樣也沒失效——狀態不該倒退。
    const detail = f.core.getJob(uuid);
    expect(detail.state).toBe('RENDERED');
    expect(detail.blockers.some((line) => line.includes('還沒渲染'))).toBe(false);
  });

  it('已經套用的項目不能被標成「已略過」', async () => {
    const f = await setup();
    const uuid = await propose(f.core);
    const target = itemAt(f.core, uuid, 0);
    f.core.resolveReviewItems(uuid, { itemIds: [target], decision: 'apply' });

    const result = f.core.resolveReviewItems(uuid, { itemIds: [target], decision: 'skip' });
    expect(result.skipped).toEqual([]);
    expect(f.core.getReview(uuid)!.items.find((item) => item.id === target)!.state).toBe('applied');
  });

  it('定位不到的項目算「還沒處理」，提案不會提早結案', async () => {
    const f = await setup(
      reviewResult({
        changes: [
          { type: 'typo', before: '這句話根本不在文章裡', after: '換掉', reason: 'x', meaningChanged: false },
        ],
        observations: [],
      }),
    );
    const uuid = await propose(f.core);
    f.core.resolveReviewItems(uuid, { itemIds: [itemAt(f.core, uuid, 0)], decision: 'apply' });

    const review = f.core.getReview(uuid);
    expect(review).not.toBeNull();
    expect(review!.items[0]!.state).toBe('unappliable');
    expect(review!.pendingCount).toBe(1);

    // 略過它之後才結案。
    f.core.resolveReviewItems(uuid, { itemIds: [review!.items[0]!.id], decision: 'skip' });
    expect(f.core.getReview(uuid)).toBeNull();
  });

  it('整份操作指名的提案對不上就拒絕，不會作用在沒看過的那一份上', async () => {
    const f = await setup();
    const uuid = await propose(f.core);
    const first = f.core.getReview(uuid)!.id;

    // 確認對話框還開著的時候，又跑了一次校稿。
    await f.core.runAgentReview(uuid, { provider: 'codex' });

    expect(() => f.core.acceptWholeProposal(uuid, { proposalId: first })).toThrow(ContentChangedError);
    expect(() => f.core.discardReview(uuid, 'x', { proposalId: first })).toThrow(ContentChangedError);
    // 指名目前那一份就可以。
    expect(() => f.core.discardReview(uuid, 'x', { proposalId: f.core.getReview(uuid)!.id })).not.toThrow();
  });

  it('observation 的 excerpt 找不到時 blockIndex 是 null，不拿 Agent 給的索引充數', async () => {
    const f = await setup(
      reviewResult({
        changes: [],
        observations: [{ ...OBSERVATION, excerpt: '這段文字不在文章裡', blockIndex: 0 }],
      }),
    );
    const uuid = await propose(f.core);
    expect(f.core.getReview(uuid)!.items[0]!.blockIndex).toBeNull();
  });

  it('excerpt 找得到時就用實際算出來的段落，不是 Agent 講的那個', async () => {
    const f = await setup(
      reviewResult({
        changes: [],
        // Agent 說在第 0 段，實際上「而是別的」在第 1 段。
        observations: [{ ...OBSERVATION, excerpt: '而是別的', blockIndex: 0 }],
      }),
    );
    const uuid = await propose(f.core);
    expect(f.core.getReview(uuid)!.items[0]!.blockIndex).toBe(1);
  });
});

describe('一鍵配圖', () => {
  const BRIEFS = [
    {
      key: 'rainy_crossing',
      purpose: '第二段的雨天路口',
      prompt: '雨天路口積水反射紅色招牌，寫實攝影風格',
      aspectRatio: '16:9',
      altText: '雨天路口的積水',
      placement: '第 2 段之後',
    },
  ];

  it('配圖那一趟不建提案，也不動內容', async () => {
    const f = await setup(reviewResult({ imageBriefs: BRIEFS }));
    const uuid = newJob(f.core);
    const before = f.core.getJob(uuid).currentRevision!.contentHash;

    const result = await f.core.runAgentReview(uuid, { provider: 'codex', task: 'images' });
    expect(result.task).toBe('images');
    expect(result.review).toBeNull();
    expect(f.core.getReview(uuid)).toBeNull();
    expect(f.core.listRevisions(uuid)).toHaveLength(1);
    expect(f.core.getJob(uuid).currentRevision!.contentHash).toBe(before);

    const briefs = f.core.getJob(uuid).imageBriefs;
    expect(briefs).toHaveLength(1);
    expect(briefs[0]).toMatchObject({ key: 'rainy_crossing', aspectRatio: '16:9', fulfilled: false });
  });

  it('按一鍵配圖不會洗掉還沒清完的校稿清單', async () => {
    const f = await setup(reviewResult({ imageBriefs: BRIEFS }));
    const uuid = await propose(f.core);
    const proposalId = f.core.getReview(uuid)!.id;

    await f.core.runAgentReview(uuid, { provider: 'codex', task: 'images' });

    const review = f.core.getReview(uuid);
    expect(review).not.toBeNull();
    expect(review!.id).toBe(proposalId);
    expect(review!.pendingCount).toBe(4);
  });

  it('上傳的圖對上 briefKey 之後那條需求就算完成了', async () => {
    const f = await setup(reviewResult({ imageBriefs: BRIEFS }));
    const uuid = newJob(f.core);
    await f.core.runAgentReview(uuid, { provider: 'codex', task: 'images' });

    await f.core.addMedia(uuid, {
      bytes: TINY_PNG,
      mimeType: 'image/png',
      filename: 'a',
      briefKey: 'rainy_crossing',
    });
    expect(f.core.getJob(uuid).imageBriefs[0]!.fulfilled).toBe(true);
  });

  it('同一個 key 重跑就是覆蓋，不會累積成兩條', async () => {
    const f = await setup(reviewResult({ imageBriefs: BRIEFS }));
    const uuid = newJob(f.core);
    await f.core.runAgentReview(uuid, { provider: 'codex', task: 'images' });
    await f.core.runAgentReview(uuid, { provider: 'codex', task: 'images' });
    expect(f.core.getJob(uuid).imageBriefs).toHaveLength(1);
  });

  it('丟掉之後就不再列出來，但列還在（事後查得到曾經建議過）', async () => {
    const f = await setup(reviewResult({ imageBriefs: BRIEFS }));
    const uuid = newJob(f.core);
    await f.core.runAgentReview(uuid, { provider: 'codex', task: 'images' });
    const brief = f.core.getJob(uuid).imageBriefs[0]!;

    f.core.dismissImageBrief(uuid, brief.id);
    expect(f.core.getJob(uuid).imageBriefs).toHaveLength(0);
    expect(f.core.listEvents(uuid).some((event) => event.eventType === 'image_brief_dismissed')).toBe(true);
  });

  it('別的稿件的配圖需求動不了', async () => {
    const f = await setup(reviewResult({ imageBriefs: BRIEFS }));
    const mine = newJob(f.core);
    const other = newJob(f.core);
    await f.core.runAgentReview(mine, { provider: 'codex', task: 'images' });
    const brief = f.core.getJob(mine).imageBriefs[0]!;

    expect(() => f.core.dismissImageBrief(other, brief.id)).toThrow(InvalidInputError);
  });

  it('校稿那一趟順便給的配圖需求也會收下', async () => {
    const f = await setup(reviewResult({ imageBriefs: BRIEFS }));
    const uuid = await propose(f.core);
    expect(f.core.getJob(uuid).imageBriefs).toHaveLength(1);
  });
});

describe('已發布之後', () => {
  it('不能再套用校稿建議', async () => {
    const f = await setup();
    const uuid = await propose(f.core);
    const target = itemAt(f.core, uuid, 0);
    approveJob(f.core, uuid);
    await f.core.publish(uuid, { status: 'draft' });

    expect(() => f.core.resolveReviewItems(uuid, { itemIds: [target], decision: 'apply' })).toThrow(
      /不能再改內容/,
    );
    expect(() => f.core.acceptWholeProposal(uuid)).toThrow(/不能再改內容/);
  });
});

describe('從卡片進去直接改，存檔時一起標成已處理（P5-T012）', () => {
  function observationId(core: CoreService, uuid: string): number {
    return core.getReview(uuid)!.items.find((item) => item.type === 'observation')!.id;
  }

  it('存成新版本，那張卡片變成已處理，而且看得出是「自己改了」', async () => {
    const f = await setup();
    const uuid = await propose(f.core);
    const id = observationId(f.core, uuid);
    const body = f.core.getJob(uuid).currentRevision!.publishHtml.replace('不是書裡寫的那些', '書裡其實有寫的那些');

    const revision = f.core.createRevision(uuid, { editedBody: body, resolveItemId: id });

    const item = f.core.getReview(uuid)!.items.find((candidate) => candidate.id === id)!;
    expect(item.state).toBe('skipped');
    expect(item.resolvedByEdit).toBe(true);
    expect(f.core.getJob(uuid).currentRevision!.id).toBe(revision.id);
  });

  it('按「不用改」略過的，resolvedByEdit 是 false', async () => {
    const f = await setup();
    const uuid = await propose(f.core);
    const id = observationId(f.core, uuid);
    f.core.resolveReviewItems(uuid, { itemIds: [id], decision: 'skip' });
    expect(f.core.getReview(uuid)!.items.find((candidate) => candidate.id === id)!.resolvedByEdit).toBe(false);
  });

  it('沒有實質改動就不建版本，卡片也不動', async () => {
    const f = await setup();
    const uuid = await propose(f.core);
    const id = observationId(f.core, uuid);
    const body = f.core.getJob(uuid).currentRevision!.publishHtml;
    f.core.createRevision(uuid, { editedBody: body, resolveItemId: id });
    expect(f.core.getReview(uuid)!.items.find((candidate) => candidate.id === id)!.state).toBe('pending');
  });

  it('不屬於目前提案的項目：整個存檔被拒絕，不留下半套', async () => {
    const f = await setup();
    const uuid = await propose(f.core);
    const before = f.core.listRevisions(uuid).length;
    expect(() => f.core.createRevision(uuid, { editedBody: P('全新'), resolveItemId: 99999 })).toThrow(InvalidInputError);
    expect(f.core.listRevisions(uuid)).toHaveLength(before);
  });

  it('resolveItemId 只能跟 editedBody／editedTitle 一起用', async () => {
    const f = await setup();
    const uuid = await propose(f.core);
    const id = observationId(f.core, uuid);
    expect(() => f.core.createRevision(uuid, { templateData: { title: 'x', body: P('x') }, resolveItemId: id })).toThrow(
      InvalidInputError,
    );
    expect(() => f.core.createRevision(uuid, { resolveItemId: id })).toThrow(InvalidInputError);
  });

  // P5-T031：講標題的建議，從卡片進去只改標題就儲存，那張卡片也要結案。
  it('只改標題：存成新版本，卡片結案（自己改了）', async () => {
    const f = await setup();
    const uuid = await propose(f.core);
    const id = observationId(f.core, uuid);
    const body = f.core.getJob(uuid).currentRevision!.publishHtml;

    const revision = f.core.createRevision(uuid, { editedTitle: '20260829', resolveItemId: id });

    const item = f.core.getReview(uuid)!.items.find((candidate) => candidate.id === id)!;
    expect(item.state).toBe('skipped');
    expect(item.resolvedByEdit).toBe(true);
    expect(f.core.getJob(uuid).title).toBe('20260829');
    expect(f.core.getJob(uuid).currentRevision!.id).toBe(revision.id);
    expect(f.core.getJob(uuid).currentRevision!.publishHtml).toBe(body);
  });

  it.each([
    ['一模一樣', '讀完 這本書'],
    ['只差在空白', ' 讀完\u00a0\u3000這本書 '],
  ])('標題沒有實質改動（%s）：不建版本，卡片也不動', async (_label, title) => {
    const f = await setup();
    const uuid = await propose(f.core);
    const id = observationId(f.core, uuid);
    f.core.createRevision(uuid, { editedTitle: '讀完 這本書' });
    const before = f.core.listRevisions(uuid).length;
    f.core.createRevision(uuid, { editedTitle: title, resolveItemId: id });
    expect(f.core.listRevisions(uuid)).toHaveLength(before);
    expect(f.core.getJob(uuid).title).toBe('讀完 這本書');
    expect(f.core.getReview(uuid)!.items.find((candidate) => candidate.id === id)!.state).toBe('pending');
  });
});

describe('AI 校稿只看目前的文章（P5-T017，D-021）', () => {
  /** 直接在文章上改一個地方（不從卡片進去），sourceText 不會跟著改。 */
  function editArticle(core: CoreService, uuid: string, from: string, to: string): void {
    const body = core.getJob(uuid).currentRevision!.publishHtml;
    expect(body).toContain(from);
    core.createRevision(uuid, { editedBody: body.replace(from, to) });
  }

  it('校稿的 prompt 只帶目前這一版，過期的原稿不送', async () => {
    const adapter = new FakeAdapter('codex', 'Codex', { result: reviewResult() });
    fixture = await createCoreFixture({ adapters: [adapter] });
    const uuid = newJob(fixture.core);
    editArticle(fixture.core, uuid, '不是書裡寫的那些', '書裡其實有寫的那些');

    await fixture.core.runAgentReview(uuid, { provider: 'codex' });

    const prompt = adapter.calls[0]!.request.userPrompt;
    expect(prompt).toContain('書裡其實有寫的那些');
    // 原稿（sourceText）還是 8/28 貼上的那份；它不能再出現在 prompt 裡。
    expect(prompt).not.toContain('不是書裡寫的那些');
    expect(prompt).not.toContain('原稿');
    // 系統指令講清楚「before 要從目前的內容一字不差地引用」。模板的 rules.md 不在這裡檢查（那是站台設定）。
    expect(adapter.calls[0]!.request.systemPrompt).toContain('before 必須一字不差地引用 templateData 裡目前的文字');
  });

  it('一鍵配圖的 prompt 也一樣', async () => {
    const adapter = new FakeAdapter('codex', 'Codex', { result: reviewResult() });
    fixture = await createCoreFixture({ adapters: [adapter] });
    const uuid = newJob(fixture.core);
    editArticle(fixture.core, uuid, '不是書裡寫的那些', '書裡其實有寫的那些');

    await fixture.core.runAgentReview(uuid, { provider: 'codex', task: 'images' });

    const prompt = adapter.calls[0]!.request.userPrompt;
    expect(prompt).toContain('書裡其實有寫的那些');
    expect(prompt).not.toContain('不是書裡寫的那些');
  });

  const FIX = { type: 'typo' as const, before: '想到很多事。', after: '想到很多事情。', reason: '語感', meaningChanged: false };

  it('原句找不到、要改成的字已經在文章裡：按接受就算「已經改好了」，不是 unappliable', async () => {
    const f = await setup(reviewResult({ changes: [FIX] }));
    const uuid = await propose(f.core);
    const id = itemAt(f.core, uuid, 0);
    editArticle(f.core, uuid, '想到很多事。', '想到很多事情。');
    const hash = f.core.getJob(uuid).currentRevision!.contentHash;

    const result = f.core.resolveReviewItems(uuid, { itemIds: [id], decision: 'apply' });
    expect(result.revision).toBeNull();
    expect(result.unappliable).toEqual([]);
    expect(result.alreadyDone).toEqual([id]);
    expect(f.core.getJob(uuid).currentRevision!.contentHash).toBe(hash);

    const item = f.core.getReview(uuid)!.items.find((candidate) => candidate.id === id)!;
    expect(item.state).toBe('skipped');
    expect(item.alreadyDone).toBe(true);
    expect(item.resolvedByEdit).toBe(false);
    // 跳轉用的段落照 after 找（文章裡現在是它）。
    expect(item.blockIndex).toBe(0);
  });

  it('讀清單時就套同一條規則：舊的 unappliable 不用按任何東西就顯示「已經改好了」', async () => {
    const f = await setup(reviewResult({ changes: [FIX] }));
    const uuid = await propose(f.core);
    const id = itemAt(f.core, uuid, 0);

    // 先變成真的找不到（存成 unappliable），再改成 AI 要的樣子——使用者 job 2 提案 6 的情況。
    editArticle(f.core, uuid, '想到很多事。', '想到很多東西。');
    f.core.resolveReviewItems(uuid, { itemIds: [id], decision: 'apply' });
    expect(f.core.getReview(uuid)!.items.find((candidate) => candidate.id === id)!.state).toBe('unappliable');
    expect(f.core.getReview(uuid)!.pendingCount).toBe(2);

    editArticle(f.core, uuid, '想到很多東西。', '想到很多事情。');
    const review = f.core.getReview(uuid)!;
    const item = review.items.find((candidate) => candidate.id === id)!;
    expect(item.state).toBe('skipped');
    expect(item.alreadyDone).toBe(true);
    // 只剩觀察那一項還沒處理：清單、blockers、總覽的數字都要一致。
    expect(review.pendingCount).toBe(1);
    expect(f.core.getJob(uuid).blockers.some((line) => line.includes('1 項校稿建議'))).toBe(true);
    expect(f.core.listJobs().find((job) => job.uuid === uuid)!.pendingReviewCount).toBe(1);
  });

  it('還沒按過的 pending 也一樣，打開就是「已經改好了」', async () => {
    const f = await setup(reviewResult({ changes: [FIX] }));
    const uuid = await propose(f.core);
    const id = itemAt(f.core, uuid, 0);
    editArticle(f.core, uuid, '想到很多事。', '想到很多事情。');

    const item = f.core.getReview(uuid)!.items.find((candidate) => candidate.id === id)!;
    expect(item.state).toBe('skipped');
    expect(item.alreadyDone).toBe(true);
  });

  it('剩下的都「已經改好了」也不自動結案（那是推算的）；文章改回去，卡片就回來', async () => {
    const f = await setup(reviewResult({ changes: [FIX], observations: [] }));
    const uuid = await propose(f.core);
    const id = itemAt(f.core, uuid, 0);
    editArticle(f.core, uuid, '想到很多事。', '想到很多事情。');

    const review = f.core.getReview(uuid);
    expect(review).not.toBeNull();
    expect(review!.pendingCount).toBe(0);
    expect(review!.items[0]!.alreadyDone).toBe(true);

    editArticle(f.core, uuid, '想到很多事情。', '想到很多事。');
    const back = f.core.getReview(uuid)!.items.find((candidate) => candidate.id === id)!;
    expect(back.state).toBe('pending');
    expect(back.alreadyDone).toBe(false);
    expect(f.core.getReview(uuid)!.pendingCount).toBe(1);
  });

  it('按接受碰到「已經改好了」也不會結案：資料庫裡的狀態沒有變', async () => {
    const f = await setup(reviewResult({ changes: [FIX], observations: [] }));
    const uuid = await propose(f.core);
    const id = itemAt(f.core, uuid, 0);
    editArticle(f.core, uuid, '想到很多事。', '想到很多事情。');
    f.core.resolveReviewItems(uuid, { itemIds: [id], decision: 'apply' });
    expect(f.core.getReview(uuid)).not.toBeNull();
  });

  it('接在後面補字（很多事→很多事情）：文章已經是 after 時按接受不會變成「很多事情情」', async () => {
    const f = await setup(
      reviewResult({
        changes: [{ type: 'typo', before: '想到很多事', after: '想到很多事情', reason: 'x', meaningChanged: false }],
      }),
    );
    const uuid = await propose(f.core);
    const id = itemAt(f.core, uuid, 0);
    editArticle(f.core, uuid, '想到很多事。', '想到很多事情。');
    const hash = f.core.getJob(uuid).currentRevision!.contentHash;

    expect(f.core.getReview(uuid)!.items.find((candidate) => candidate.id === id)!.alreadyDone).toBe(true);
    const result = f.core.resolveReviewItems(uuid, { itemIds: [id], decision: 'apply' });
    expect(result.alreadyDone).toEqual([id]);
    expect(result.revision).toBeNull();
    expect(f.core.getJob(uuid).currentRevision!.contentHash).toBe(hash);
    expect(f.core.getJob(uuid).currentRevision!.publishHtml).not.toContain('事情情');
  });

  it('在前面補字（很多事情→想到很多事情）：一樣算已經改好了', async () => {
    const f = await setup(
      reviewResult({
        changes: [{ type: 'typo', before: '很多事情。', after: '想到很多事情。', reason: 'x', meaningChanged: false }],
      }),
    );
    const uuid = await propose(f.core);
    const id = itemAt(f.core, uuid, 0);
    editArticle(f.core, uuid, '想到很多事。', '想到很多事情。');

    const result = f.core.resolveReviewItems(uuid, { itemIds: [id], decision: 'apply' });
    expect(result.alreadyDone).toEqual([id]);
    expect(f.core.getJob(uuid).currentRevision!.publishHtml).not.toContain('想到想到');
  });

  it('別的地方還有一個真的沒改的 before：套到那一個，不套進已經改好的那句', async () => {
    const f = await setup(
      reviewResult({
        changes: [{ type: 'typo', before: '想到很多事', after: '想到很多事情', reason: 'x', meaningChanged: false }],
      }),
    );
    const uuid = await propose(f.core);
    const id = itemAt(f.core, uuid, 0);
    editArticle(f.core, uuid, '想到很多事。', '想到很多事情。');
    editArticle(f.core, uuid, '而是別的。', '而是又想到很多事，');

    // 卡片、段落跳轉指的就是那一個（第 2 段），不是已經改好的第 1 段。
    const item = f.core.getReview(uuid)!.items.find((candidate) => candidate.id === id)!;
    expect(item.alreadyDone).toBe(false);
    expect(item.blockIndex).toBe(1);

    const result = f.core.resolveReviewItems(uuid, { itemIds: [id], decision: 'apply' });
    expect(result.applied).toEqual([id]);
    const html = f.core.getJob(uuid).currentRevision!.publishHtml;
    expect(html).toContain('想到很多事情。');
    expect(html).toContain('又想到很多事情，');
    expect(html).not.toContain('事情情');
  });

  it('同一批裡有套上的、已經改好的、真的找不到的，各歸各的', async () => {
    const f = await setup(
      reviewResult({
        changes: [
          { type: 'style', before: '而是別的', after: '而是另一回事', reason: 'x', meaningChanged: false },
          { type: 'grammar', before: '讀完這本書想到很多事', after: '讀完這本書，想到很多事', reason: 'x', meaningChanged: false },
          { type: 'typo', before: '這句話根本不在文章裡', after: '這句話真的不在文章裡', reason: 'x', meaningChanged: false },
        ],
      }),
    );
    const uuid = await propose(f.core);
    const ids = [0, 1, 2].map((ordinal) => itemAt(f.core, uuid, ordinal));

    const result = f.core.resolveReviewItems(uuid, { itemIds: ids, decision: 'apply' });
    expect(result.revision).not.toBeNull();
    expect(result.applied).toEqual([ids[0]]);
    expect(result.alreadyDone).toEqual([ids[1]]);
    expect(result.unappliable).toEqual([ids[2]]);

    const items = f.core.getReview(uuid)!.items;
    expect(items.find((item) => item.id === ids[1])!).toMatchObject({ state: 'skipped', alreadyDone: true });
    expect(items.find((item) => item.id === ids[2])!).toMatchObject({ state: 'unappliable', alreadyDone: false });
  });

  it('同一批裡前一項改出來的字就是後一項的 after：後一項算已經改好了', async () => {
    const f = await setup(
      reviewResult({
        changes: [
          { type: 'typo', before: '想到很多事。', after: '想到很多事情。', reason: 'x', meaningChanged: false },
          { type: 'typo', before: '書，想到很多事。', after: '書，想到很多事情。', reason: 'x', meaningChanged: false },
        ],
      }),
    );
    const uuid = await propose(f.core);
    const ids = [0, 1].map((ordinal) => itemAt(f.core, uuid, ordinal));

    const result = f.core.resolveReviewItems(uuid, { itemIds: ids, decision: 'apply' });
    expect(result.applied).toEqual([ids[0]]);
    expect(result.alreadyDone).toEqual([ids[1]]);
    expect(f.core.getJob(uuid).currentRevision!.publishHtml).not.toContain('事情情');
  });

  it('太短的 after 不算數：整篇到處都可能有，看不出是不是改過了', async () => {
    const f = await setup(
      reviewResult({
        changes: [{ type: 'typo', before: '這句話根本不在文章裡', after: '今天', reason: 'x', meaningChanged: false }],
      }),
    );
    const uuid = await propose(f.core);
    const id = itemAt(f.core, uuid, 0);

    const result = f.core.resolveReviewItems(uuid, { itemIds: [id], decision: 'apply' });
    expect(result.unappliable).toEqual([id]);
    expect(result.alreadyDone).toEqual([]);
    const item = f.core.getReview(uuid)!.items.find((candidate) => candidate.id === id)!;
    expect(item.state).toBe('unappliable');
    expect(item.alreadyDone).toBe(false);
  });

  it('刪字的建議（after 是 before 的一部分）不算數：after 本來就可能在', async () => {
    const f = await setup(
      reviewResult({
        changes: [{ type: 'typo', before: '讀完這本書這本書', after: '讀完這本書', reason: '重複', meaningChanged: false }],
      }),
    );
    const uuid = await propose(f.core);
    const id = itemAt(f.core, uuid, 0);

    const result = f.core.resolveReviewItems(uuid, { itemIds: [id], decision: 'apply' });
    expect(result.unappliable).toEqual([id]);
    expect(f.core.getReview(uuid)!.items.find((candidate) => candidate.id === id)!.alreadyDone).toBe(false);
  });

  it('按過「保留原文」、但文章裡其實已經改好了：顯示「已經改好了」，不再說「保留原文」', async () => {
    const f = await setup(reviewResult({ changes: [FIX] }));
    const uuid = await propose(f.core);
    const id = itemAt(f.core, uuid, 0);
    f.core.resolveReviewItems(uuid, { itemIds: [id], decision: 'skip' });
    editArticle(f.core, uuid, '想到很多事。', '想到很多事情。');

    const item = f.core.getReview(uuid)!.items.find((candidate) => candidate.id === id)!;
    expect(item.state).toBe('skipped');
    expect(item.alreadyDone).toBe(true);
  });

  it('「自己改了」的不重判——那個說法本來就對', async () => {
    const f = await setup(reviewResult({ changes: [FIX] }));
    const uuid = await propose(f.core);
    const id = itemAt(f.core, uuid, 0);
    const body = f.core.getJob(uuid).currentRevision!.publishHtml.replace('想到很多事。', '想到很多事情。');
    f.core.createRevision(uuid, { editedBody: body, resolveItemId: id });

    const item = f.core.getReview(uuid)!.items.find((candidate) => candidate.id === id)!;
    expect(item.resolvedByEdit).toBe(true);
    expect(item.alreadyDone).toBe(false);
  });
});
