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
