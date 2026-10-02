import { afterEach, describe, expect, it } from 'vitest';

import { createCoreFixture, type CoreFixture } from './helpers/core-fixture.js';
import { FakeAdapter } from './helpers/fake-adapter.js';
import { excerptAfterChanges } from '../src/contract/review-locate.js';
import type { CoreService } from '../src/core/service.js';
import { missingTargetNotice } from '../src/ui/lib/edit-target.js';
import { WRITE_RULES } from '../src/ui/lib/proof-edit-dom.js';
import { highlightText } from '../src/ui/lib/review-kinds.js';
import type { ReviewItem } from '../src/ui/service/types.js';

/**
 * P5-T037：「去原文改」被同一份校稿改過的原句要找得到並標黃、找不到要明講、段首游標不被框線蓋住。
 * 一律用 FakeAdapter，不呼叫真實 CLI、不連 WordPress。
 */

describe('excerptAfterChanges', () => {
  const BOWL = { before: '大腕', after: '大碗' };

  it('excerpt 完整包含 before：換成 after', () => {
    expect(excerptAfterChanges('那是被湯匙跟高麗菜撐出來的大腕', [BOWL])).toBe('那是被湯匙跟高麗菜撐出來的大碗');
  });

  it('一條都用不上（不含、或只交疊一段）：null', () => {
    expect(excerptAfterChanges('撐出來的', [BOWL])).toBeNull();
    expect(excerptAfterChanges('撐出來的大', [BOWL])).toBeNull();
    expect(excerptAfterChanges('撐出來的大腕', [{ before: '大腕。', after: '大碗。' }])).toBeNull();
    expect(excerptAfterChanges('撐出來的大腕', [])).toBeNull();
  });

  it('多條依序套：後一條吃得到前一條換出來的字', () => {
    expect(excerptAfterChanges('撐出來的大腕', [BOWL, { before: '大碗', after: '大海碗' }])).toBe('撐出來的大海碗');
    // 順序反過來，第二條就沒有東西可換。
    expect(excerptAfterChanges('撐出來的大腕', [{ before: '大碗', after: '大海碗' }, BOWL])).toBe('撐出來的大碗');
  });

  it('忽略空白比對；before 出現兩次以上有歧義回 null；after 裡含 before 不會無限換', () => {
    expect(excerptAfterChanges('佔 40% 的大腕', [{ before: '佔40%', after: '佔四成' }])).toBe('佔四成 的大腕');
    // 套用一條只換一處：「大腕→大碗」「大腕→大海碗」接受後文章是「大碗配大海碗」，猜不出來（Codex 審查）。
    expect(excerptAfterChanges('大腕配大腕', [BOWL])).toBeNull();
    expect(excerptAfterChanges('大腕配大腕', [BOWL, { before: '大腕', after: '大海碗' }])).toBeNull();
    expect(excerptAfterChanges('很多事', [{ before: '很多事', after: '很多事情' }])).toBe('很多事情');
  });
});

const SOURCE = '那是被湯匙跟高麗菜撐出來的大腕。\n\n吃完再說。';
const P = (text: string): string => `<p class="wp-block-paragraph">${text}</p>`;

function reviewResult(changes: { before: string; after: string }[], excerpt: string) {
  return {
    ok: true as const,
    data: {
      title: '晚餐',
      summary: '一處錯字、一個觀察',
      correctedSource: '（略）',
      changes: changes.map((change) => ({ type: 'typo' as const, reason: '錯字', meaningChanged: false, ...change })),
      observations: [
        { kind: 'gap' as const, blockIndex: 0, excerpt, detail: '交代不足', suggestion: '補一句' },
      ],
      templateData: { title: '晚餐', body: P('那是被湯匙跟高麗菜撐出來的大碗。') + P('吃完再說。') },
      imageBriefs: [],
    },
    meta: { runId: 'r', agentId: 'codex' as const, model: null, durationMs: 1, stderrTail: '' },
  };
}

let fixture: CoreFixture | null = null;
afterEach(async () => {
  await fixture?.cleanup();
  fixture = null;
});

async function propose(
  changes: { before: string; after: string }[],
  excerpt: string,
  sourceText: string = SOURCE,
): Promise<{ core: CoreService; uuid: string }> {
  fixture = await createCoreFixture({
    adapters: [new FakeAdapter('codex', 'Codex', { result: reviewResult(changes, excerpt) })],
  });
  const core = fixture.core;
  const uuid = core.createJob({ targetKey: 'diary', sourceText, title: '晚餐' }).uuid;
  await core.runAgentReview(uuid, { provider: 'codex' });
  return { core, uuid };
}

function items(core: CoreService, uuid: string) {
  const all = core.getReview(uuid)!.items;
  return {
    changes: all.filter((item) => item.type === 'change').sort((a, b) => a.ordinal - b.ordinal),
    observation: all.find((item) => item.type === 'observation')!,
  };
}

function apply(core: CoreService, uuid: string, id: number): void {
  expect(core.resolveReviewItems(uuid, { itemIds: [id], decision: 'apply' }).applied).toEqual([id]);
}

function editArticle(core: CoreService, uuid: string, from: string, to: string): void {
  const body = core.getJob(uuid).currentRevision!.publishHtml;
  expect(body).toContain(from);
  core.createRevision(uuid, { editedBody: body.replace(from, to) });
}

describe('ReviewItem.locatedText 與觀察原句的對應', () => {
  const EXCERPT = '那是被湯匙跟高麗菜撐出來的大腕';

  it('原句還在：locatedText 就是原句；change 套用前是 before、套用後是 after', async () => {
    const { core, uuid } = await propose([{ before: '大腕', after: '大碗' }], EXCERPT);
    let view = items(core, uuid);
    expect(view.observation).toMatchObject({ blockIndex: 0, locatedText: EXCERPT });
    expect(view.changes[0]).toMatchObject({ blockIndex: 0, locatedText: '大腕' });

    apply(core, uuid, view.changes[0]!.id);
    view = items(core, uuid);
    expect(view.changes[0]).toMatchObject({ state: 'applied', blockIndex: 0, locatedText: '大碗' });
  });

  it('同一份校稿已接受的修改改到原句（job 17）：對應過再找，段落與字都找得到', async () => {
    const { core, uuid } = await propose([{ before: '大腕', after: '大碗' }], EXCERPT);
    apply(core, uuid, items(core, uuid).changes[0]!.id);
    expect(items(core, uuid).observation).toMatchObject({
      blockIndex: 0,
      locatedText: '那是被湯匙跟高麗菜撐出來的大碗',
    });
  });

  it('使用者自己改好的（已經改好了）也算', async () => {
    // after 太短的不判「已經改好了」（isAlreadyDone），這裡用長一點的。
    const { core, uuid } = await propose([{ before: '撐出來的大腕', after: '撐出來的大碗' }], EXCERPT);
    editArticle(core, uuid, '大腕', '大碗');
    const view = items(core, uuid);
    expect(view.changes[0]).toMatchObject({ alreadyDone: true, locatedText: '撐出來的大碗' });
    expect(view.observation).toMatchObject({ blockIndex: 0, locatedText: '那是被湯匙跟高麗菜撐出來的大碗' });
  });

  it('還沒處理的修改不拿來對應：文章被改成別的字，找不到就是 null', async () => {
    const { core, uuid } = await propose([{ before: '大腕', after: '大碗' }], EXCERPT);
    editArticle(core, uuid, '大腕', '大盆');
    const view = items(core, uuid);
    expect(view.changes[0]).toMatchObject({ state: 'pending', alreadyDone: false, blockIndex: null, locatedText: null });
    expect(view.observation).toMatchObject({ blockIndex: null, locatedText: null });
  });

  it('只交疊一段的不處理，維持找不到', async () => {
    const { core, uuid } = await propose([{ before: '大腕。', after: '大碗。' }], EXCERPT);
    apply(core, uuid, items(core, uuid).changes[0]!.id);
    expect(items(core, uuid).observation).toMatchObject({ blockIndex: null, locatedText: null });
  });

  it('對應出來的字在兩段以上都有：有歧義，不猜（維持找不到）', async () => {
    const { core, uuid } = await propose(
      [{ before: '演藝圈的大腕', after: '演藝圈的大碗' }],
      '大腕',
      '早餐吃了一大碗粥。\n\n他是演藝圈的大腕。',
    );
    apply(core, uuid, items(core, uuid).changes[0]!.id);
    expect(items(core, uuid).observation).toMatchObject({ blockIndex: null, locatedText: null });
  });

  it('對應出來的字在同一段出現兩次：有歧義，不猜', async () => {
    const { core, uuid } = await propose(
      [{ before: '演藝圈的大腕', after: '演藝圈的大碗' }],
      '大腕',
      '早餐吃了一大碗粥。他是演藝圈的大腕。',
    );
    apply(core, uuid, items(core, uuid).changes[0]!.id);
    expect(items(core, uuid).observation).toMatchObject({ blockIndex: null, locatedText: null });
  });

  it('多條已接受：依 ordinal 順序套', async () => {
    const { core, uuid } = await propose(
      [
        { before: '大腕', after: '大碗' },
        { before: '大碗', after: '大海碗' },
      ],
      EXCERPT,
    );
    apply(core, uuid, items(core, uuid).changes[0]!.id);
    apply(core, uuid, items(core, uuid).changes[1]!.id);
    expect(core.getJob(uuid).currentRevision!.publishHtml).toContain('大海碗');
    expect(items(core, uuid).observation).toMatchObject({
      blockIndex: 0,
      locatedText: '那是被湯匙跟高麗菜撐出來的大海碗',
    });
  });
});

describe('畫面：字上標記用 locatedText', () => {
  const base: ReviewItem = {
    id: 1,
    ordinal: 1,
    type: 'observation',
    state: 'pending',
    change: null,
    observation: { kind: 'gap', blockIndex: 0, excerpt: '撐出來的大腕', detail: 'x', suggestion: 'y' },
    blockIndex: 0,
    locatedText: '撐出來的大碗',
    resolvedAt: null,
    resolvedByEdit: false,
    alreadyDone: false,
  };

  it('有 locatedText 就標它，沒有退回原本引用的字', () => {
    expect(highlightText(base)).toBe('撐出來的大碗');
    expect(highlightText({ ...base, locatedText: null })).toBe('撐出來的大腕');
  });
});

describe('missingTargetNotice：找不到要明講', () => {
  it('有要找的字、什麼都標不出來：講找不到、游標在文章開頭', () => {
    expect(missingTargetNotice('撐出來的大腕', false)).toBe('文章裡找不到「撐出來的大腕」，游標放在文章開頭。');
  });

  it('標得出來（字或整段）、或沒有要找的字：不講', () => {
    expect(missingTargetNotice('撐出來的大腕', true)).toBeNull();
    expect(missingTargetNotice(null, false)).toBeNull();
    expect(missingTargetNotice('  ', false)).toBeNull();
  });
});

describe('打字模式的正文焦點框', () => {
  it('跟標題一樣往外推，段首游標不疊在框線上', () => {
    const rule = WRITE_RULES.find((candidate) => candidate.startsWith('.preview-body[contenteditable]:focus'));
    expect(rule).toBeDefined();
    const offset = /outline-offset:\s*(\d+)px/.exec(rule!);
    expect(Number(offset?.[1])).toBeGreaterThanOrEqual(4);
    // 推出去的框（offset＋框寬）要落在模板左右 1.25rem（20px）的留白裡，不被 iframe 邊緣切掉。
    const width = /outline:\s*(\d+)px/.exec(rule!);
    expect(Number(offset?.[1]) + Number(width?.[1])).toBeLessThan(20);
  });
});
