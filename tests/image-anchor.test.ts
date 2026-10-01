import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  approveJob,
  coreInternals,
  createCoreFixture,
  defaultWordPressHandler,
  TINY_PNG,
  type CoreFixture,
} from './helpers/core-fixture.js';
import type { MockResponse, RecordedRequest } from './helpers/mock-wordpress.js';
import { FakeAdapter } from './helpers/fake-adapter.js';
import { hasWpImageClass } from '../src/contract/media-marker.js';
import { buildReviewSchema, REVIEW_OUTPUT_SCHEMA } from '../src/agents/output-contract.js';
import { stripNulls, toOpenAiStrictSchema } from '../src/agents/adapters/openai-strict.js';
import { validateAgainstSchema } from '../src/templates/schema-validator.js';
import type { CoreService } from '../src/core/service.js';

/**
 * AI 內文配圖自動放位置（D-020，P5-T016）。
 *
 * 配圖需求帶一段「錨點」：它要跟在後面的那一段的原文。上傳成功後在**目前**這一版裡找
 * （忽略空白），剛好一段對得上才放；找不到或不只一段就不放、講清楚。
 *
 * 一律用 FakeAdapter＋本機假 WordPress，絕不呼叫真實 CLI、不連真實網站。
 */

const SOURCE = [
  '今天讀完這本書，想到很多事。',
  '下午的雨下得很急，路口積了一小攤水。',
  '晚上把去年的筆記翻出來對照。',
].join('\n\n');

const INLINE = {
  key: 'rainy_crossing',
  purpose: '雨天路口',
  prompt: '雨天路口積水反射紅色招牌',
  aspectRatio: '4:3',
  altText: '雨天路口的積水',
  placement: '第 2 段之後',
  anchor: '路口積了一小攤水',
};

const COVER = {
  key: 'featured',
  purpose: '精選圖片',
  prompt: '木桌上的舊筆記本',
  aspectRatio: '16:9',
  altText: '舊筆記本',
  placement: '精選圖片',
};

function codex(briefs: unknown[], delayMs?: number): FakeAdapter {
  return new FakeAdapter('codex', 'Codex', {
    ...(delayMs === undefined ? {} : { delayMs }),
    result: {
      ok: true,
      data: {
        title: '20260828',
        summary: '配圖',
        correctedSource: '',
        changes: [],
        observations: [],
        templateData: {},
        imageBriefs: briefs,
      },
      meta: { runId: 'x', agentId: 'codex', model: null, durationMs: 1, stderrTail: '' },
    },
    image: {},
  });
}

let fixture: CoreFixture | null = null;

afterEach(async () => {
  await fixture?.cleanup();
  fixture = null;
});

async function setup(
  briefs: unknown[] = [INLINE, COVER],
  source = SOURCE,
  options: { delayMs?: number; handler?: (request: RecordedRequest, index: number) => MockResponse } = {},
): Promise<{ core: CoreService; uuid: string; adapter: FakeAdapter }> {
  const adapter = codex(briefs, options.delayMs);
  fixture = await createCoreFixture({
    adapters: [adapter],
    ...(options.handler === undefined ? {} : { handler: options.handler }),
  });
  const uuid = fixture.core.createJob({ targetKey: 'diary', sourceText: source, title: '20260828' }).uuid;
  await fixture.core.runAgentReview(uuid, { provider: 'codex', task: 'images' });
  return { core: fixture.core, uuid, adapter };
}

/** 媒體模組裡的私有方法（自動放位置、自動設精選；模組內部走 this 呼叫，spy 攔得到）。 */
function mediaModule(core: CoreService): { autoPlace: () => unknown; autoFeature: () => unknown } {
  return coreInternals(core).media as unknown as { autoPlace: () => unknown; autoFeature: () => unknown };
}

function briefId(core: CoreService, uuid: string, key: string): number {
  return core.getJob(uuid).imageBriefs.find((brief) => brief.key === key)!.id;
}

async function useGenerated(core: CoreService, uuid: string, key: string) {
  const candidate = await core.generateBriefImage(uuid, briefId(core, uuid, key));
  return core.useImageCandidate(uuid, candidate.id);
}

function upload(core: CoreService, uuid: string, briefKey?: string) {
  return core.addMediaWithOutcome(uuid, {
    bytes: TINY_PNG,
    mimeType: 'image/png',
    filename: 'x',
    ...(briefKey === undefined ? {} : { briefKey }),
  });
}

describe('錨點存下來', () => {
  it('內文圖帶錨點，封面沒有就是 null', async () => {
    const { core, uuid } = await setup();
    const briefs = core.getJob(uuid).imageBriefs;
    expect(briefs.find((brief) => brief.key === 'rainy_crossing')!.anchor).toBe('路口積了一小攤水');
    expect(briefs.find((brief) => brief.key === 'featured')!.anchor).toBeNull();
  });

  it('一鍵配圖的 prompt 講清楚錨點怎麼填：引用原文、封面留空、不要寫段落編號', async () => {
    const { adapter } = await setup();
    const prompt = adapter.calls[0]!.request.systemPrompt;
    expect(prompt).toContain('anchor');
    expect(prompt).toContain('一字不差');
    expect(prompt).toContain('封面');
  });
});

describe('用這張：自動放到錨點那段後面', () => {
  it('剛好一段對得上：放在那一段之後，建新版本', async () => {
    const { core, uuid } = await setup();
    const before = core.getJob(uuid).revisionCount;

    const { media: asset, autoPlace } = await useGenerated(core, uuid, 'rainy_crossing');

    expect(autoPlace).toMatchObject({ outcome: 'placed', afterBlockIndex: 1 });
    expect(asset.placedAfterBlockIndex).toBe(1);
    const detail = core.getJob(uuid);
    expect(detail.revisionCount).toBe(before + 1);
    expect(detail.media.find((row) => row.id === asset.id)).toMatchObject({ placed: true, placedAfterBlockIndex: 1 });
  });

  it('比對忽略空白：Agent 自己加了空格也找得到', async () => {
    const { core, uuid } = await setup([{ ...INLINE, anchor: '路口 積了 一小攤水' }]);
    const { autoPlace } = await useGenerated(core, uuid, 'rainy_crossing');
    expect(autoPlace).toMatchObject({ outcome: 'placed', afterBlockIndex: 1 });
  });

  it('放進正文是內容改動：核准照既有規則失效', async () => {
    const { core, uuid } = await setup();
    const candidate = await core.generateBriefImage(uuid, briefId(core, uuid, 'rainy_crossing'));
    approveJob(core, uuid);

    const { autoPlace } = await core.useImageCandidate(uuid, candidate.id);

    expect(autoPlace?.outcome).toBe('placed');
    const detail = core.getJob(uuid);
    expect(detail.approval?.valid).toBe(false);
    expect(detail.state).toBe('RENDERED');
  });

  it('對著目前這一版找：前面多了一段，就放到新的位置', async () => {
    const { core, uuid } = await setup();
    const body = core.getJob(uuid).currentRevision!.publishHtml;
    core.createRevision(uuid, { editedBody: `<p>多加的第一段。</p>${body}`, origin: 'manual' });

    const { autoPlace } = await useGenerated(core, uuid, 'rainy_crossing');

    expect(autoPlace).toMatchObject({ outcome: 'placed', afterBlockIndex: 2 });
  });
});

describe('找不到或有歧義：不放，講清楚', () => {
  it('找不到：不放進正文、不建新版本，訊息照講', async () => {
    const { core, uuid } = await setup([{ ...INLINE, anchor: '這句話文章裡沒有' }]);
    const before = core.getJob(uuid).revisionCount;

    const { media: asset, autoPlace } = await useGenerated(core, uuid, 'rainy_crossing');

    expect(autoPlace?.outcome).toBe('not-found');
    expect(autoPlace?.message).toContain('找不到建議的位置，請自己放');
    expect(autoPlace?.afterBlockIndex).toBeNull();
    expect(asset.placed).toBe(false);
    expect(core.getJob(uuid).revisionCount).toBe(before);
    // 圖本身照樣上傳了，配圖需求算完成。
    expect(core.getJob(uuid).imageBriefs.find((brief) => brief.key === 'rainy_crossing')!.fulfilled).toBe(true);
  });

  it('不只一段對得上：不猜，照樣不放', async () => {
    const source = ['雨下得很急。', '中間一段。', '雨下得很急，路口積水。'].join('\n\n');
    const { core, uuid } = await setup([{ ...INLINE, anchor: '雨下得很急' }], source);
    const before = core.getJob(uuid).revisionCount;

    const { media: asset, autoPlace } = await useGenerated(core, uuid, 'rainy_crossing');

    expect(autoPlace?.outcome).toBe('ambiguous');
    expect(autoPlace?.message).toContain('找不到建議的位置，請自己放');
    expect(asset.placed).toBe(false);
    expect(core.getJob(uuid).revisionCount).toBe(before);
  });

  it('同一段裡出現兩次不算歧義：還是那一段', async () => {
    const source = ['第一段。', '水，水。', '第三段。'].join('\n\n');
    const { core, uuid } = await setup([{ ...INLINE, anchor: '水' }], source);
    const { autoPlace } = await useGenerated(core, uuid, 'rainy_crossing');
    expect(autoPlace).toMatchObject({ outcome: 'placed', afterBlockIndex: 1 });
  });

  it('舊的配圖需求沒有錨點：不放，照樣請使用者自己放', async () => {
    const { anchor: _drop, ...legacy } = INLINE;
    const { core, uuid } = await setup([legacy]);
    const { media: asset, autoPlace } = await useGenerated(core, uuid, 'rainy_crossing');
    expect(autoPlace?.outcome).toBe('not-found');
    expect(autoPlace?.message).toContain('找不到建議的位置，請自己放');
    expect(asset.placed).toBe(false);
  });

});

describe('手動上傳與封面', () => {
  it('手動「上傳這張」到內文圖卡片：一樣自動放', async () => {
    const { core, uuid } = await setup();
    const { autoPlace } = await upload(core, uuid, 'rainy_crossing');
    expect(autoPlace).toMatchObject({ outcome: 'placed', afterBlockIndex: 1 });
  });

  it('封面照舊設精選，不放進正文', async () => {
    const { core, uuid } = await setup();
    const { media: asset, autoFeature, autoPlace } = await useGenerated(core, uuid, 'featured');
    expect(autoFeature?.outcome).toBe('set');
    expect(autoPlace).toBeNull();
    expect(core.getJob(uuid).media.find((row) => row.id === asset.id)!.placed).toBe(false);
  });

  it('沒帶 briefKey 的上傳不自動放', async () => {
    const { core, uuid } = await setup();
    const before = core.getJob(uuid).revisionCount;
    const { autoPlace } = await upload(core, uuid);
    expect(autoPlace).toBeNull();
    expect(core.getJob(uuid).revisionCount).toBe(before);
  });
});

describe('輸出契約：anchor 欄位', () => {
  const brief = { key: 'rainy', purpose: 'p', prompt: 'q', aspectRatio: '4:3', altText: 'a' };
  const base = {
    title: 't',
    summary: 's',
    correctedSource: 'c',
    changes: [],
    observations: [],
    templateData: { title: 't', body: '<p>x</p>' },
  };

  function briefSchema(schema: Record<string, unknown>): Record<string, unknown> {
    const props = schema['properties'] as Record<string, Record<string, unknown>>;
    return (props['imageBriefs']!['items'] as Record<string, unknown>);
  }

  it('原始 schema：選填、有長度上限', () => {
    const items = briefSchema(REVIEW_OUTPUT_SCHEMA);
    expect(items['required']).not.toContain('anchor');
    const anchor = (items['properties'] as Record<string, Record<string, unknown>>)['anchor']!;
    expect(anchor['type']).toBe('string');
    expect(anchor['maxLength']).toBeGreaterThan(0);
  });

  it('Codex strict：列進 required、可以是 null、不帶長度約束', () => {
    const strict = toOpenAiStrictSchema(REVIEW_OUTPUT_SCHEMA);
    const items = briefSchema(strict);
    expect(items['required']).toContain('anchor');
    const anchor = (items['properties'] as Record<string, Record<string, unknown>>)['anchor']!;
    expect(anchor['type']).toEqual(['string', 'null']);
    expect(anchor['maxLength']).toBeUndefined();
  });

  it('後端仍用原始 schema 驗：null 先拿掉就過，太長照樣擋', () => {
    const schema = buildReviewSchema({
      type: 'object',
      additionalProperties: false,
      required: ['title', 'body'],
      properties: { title: { type: 'string' }, body: { type: 'string' } },
    });
    const withNull = stripNulls({ ...base, imageBriefs: [{ ...brief, anchor: null }] });
    expect(validateAgainstSchema(schema, 'anchor-1', withNull).valid).toBe(true);
    expect(validateAgainstSchema(schema, 'anchor-2', { ...base, imageBriefs: [{ ...brief, anchor: '路口' }] }).valid).toBe(true);
    const tooLong = { ...base, imageBriefs: [{ ...brief, anchor: '字'.repeat(1000) }] };
    expect(validateAgainstSchema(schema, 'anchor-3', tooLong).valid).toBe(false);
  });
});

/** 正文裡目前的圖片，依順序列出 WordPress 媒體編號（看 figure 裡的 wp-image-N）。 */
function bodyImageIds(core: CoreService, uuid: string): number[] {
  const html = core.getJob(uuid).currentRevision!.publishHtml;
  return [...html.matchAll(/wp-image-(\d+)/g)].map((match) => Number(match[1]));
}

describe('換一張：新圖放到舊圖的位置', () => {
  it('舊圖在正文裡：新圖接替它的位置，舊圖拿出正文但留在媒體庫', async () => {
    const { core, uuid } = await setup();
    const first = await upload(core, uuid, 'rainy_crossing');
    // 使用者自己把它搬到最前面：新圖要去的是「舊圖現在的位置」，不是錨點。
    core.placeMedia(uuid, first.media.id, -1);
    approveJob(core, uuid);
    const before = core.getJob(uuid).revisionCount;

    const second = await upload(core, uuid, 'rainy_crossing');

    expect(second.autoPlace).toMatchObject({ outcome: 'replaced', afterBlockIndex: -1 });
    expect(second.autoPlace?.message).toContain('舊圖');
    const detail = core.getJob(uuid);
    expect(detail.revisionCount).toBe(before + 1);
    expect(detail.approval?.valid).toBe(false);
    expect(bodyImageIds(core, uuid)).toEqual([second.media.wordpressMediaId]);
    expect(detail.media.find((row) => row.id === second.media.id)).toMatchObject({ placed: true, placedAfterBlockIndex: -1 });
    // 舊圖還在這篇稿件（媒體庫）裡，只是不在正文。
    expect(detail.media.find((row) => row.id === first.media.id)).toMatchObject({ placed: false });
  });

  it('舊圖跟文字在同一段：只換掉圖，前文與後文留著（審查 #9）', async () => {
    const { core, uuid } = await setup();
    const first = await upload(core, uuid, 'rainy_crossing');
    const html = core.getJob(uuid).currentRevision!.publishHtml;
    const img = /<img[^>]*>/.exec(html)![0];
    core.createRevision(uuid, {
      templateData: { title: '20260828', body: `<p class="wp-block-paragraph">前文${img}後文</p>` },
      reason: '手動編輯',
    });

    const second = await upload(core, uuid, 'rainy_crossing');

    expect(second.autoPlace).toMatchObject({ outcome: 'replaced', afterBlockIndex: 0 });
    const body = core.getJob(uuid).currentRevision!.publishHtml;
    expect(body).toMatch(/<p class="wp-block-paragraph">前文後文<\/p>/);
    expect(bodyImageIds(core, uuid)).toEqual([second.media.wordpressMediaId]);
    expect(first.media.wordpressMediaId).not.toBe(second.media.wordpressMediaId);
  });

  it('正文文字裡寫著舊圖的 wp-image-N、但圖不在：不算換一張，退回照錨點放', async () => {
    const { core, uuid } = await setup();
    const first = await upload(core, uuid, 'rainy_crossing');
    const P = (text: string): string => `<p class="wp-block-paragraph">${text}</p>`;
    core.createRevision(uuid, {
      templateData: {
        title: '20260828',
        body:
          P('今天讀完這本書，想到很多事。') +
          P('下午的雨下得很急，路口積了一小攤水。') +
          P(`舊圖檔名 wp-image-${first.media.wordpressMediaId}`),
      },
      reason: '手動編輯',
    });

    const second = await upload(core, uuid, 'rainy_crossing');

    expect(second.autoPlace).toMatchObject({ outcome: 'placed', afterBlockIndex: 1 });
    const body = core.getJob(uuid).currentRevision!.publishHtml;
    expect(body).toContain(`舊圖檔名 wp-image-${first.media.wordpressMediaId}`);
    expect(body).toContain(`class="wp-image-${second.media.wordpressMediaId}"`);
  });

  it('換一張時正文裡其實沒換到任何一張：丟錯，不建版本、不回報換好了', async () => {
    const { core, uuid } = await setup();
    const first = await upload(core, uuid, 'rainy_crossing');
    const original = core.getJob(uuid).currentRevision!.publishHtml.replace(/<figure[\s\S]*?<\/figure>\n?/, '');
    core.createRevision(uuid, { editedBody: original, origin: 'manual' });
    const second = await core.addMedia(uuid, { bytes: TINY_PNG, mimeType: 'image/png', filename: 'y' });
    const before = core.getJob(uuid).revisionCount;

    const internals = coreInternals(core);
    const media = internals.media as unknown as {
      replaceInBody(job: unknown, assetId: number, previous: unknown): unknown;
    };
    const job = internals.repo.jobByUuid(uuid);
    const previous = internals.repo.mediaById(first.media.id);

    expect(() => media.replaceInBody(job, second.id, previous)).toThrow(/找不到原本那張圖/);
    expect(core.getJob(uuid).revisionCount).toBe(before);
  });

  it('舊圖已經不在正文裡：退回照錨點放', async () => {
    const { core, uuid } = await setup();
    const original = core.getJob(uuid).currentRevision!.publishHtml;
    await upload(core, uuid, 'rainy_crossing');
    core.createRevision(uuid, { editedBody: original, origin: 'manual' });

    const second = await upload(core, uuid, 'rainy_crossing');

    expect(second.autoPlace).toMatchObject({ outcome: 'placed', afterBlockIndex: 1 });
    expect(bodyImageIds(core, uuid)).toEqual([second.media.wordpressMediaId]);
  });
});

describe('AI 還在跑：先不放，跑完的結果不能因此作廢', () => {
  it('內文圖：上傳成功但不放，校稿那一趟照樣收得到', async () => {
    const { core, uuid } = await setup([INLINE, COVER], SOURCE, { delayMs: 300 });
    const before = core.getJob(uuid).revisionCount;

    const running = core.runAgentReview(uuid, { provider: 'codex', task: 'images' });
    const { media: asset, autoPlace } = await upload(core, uuid, 'rainy_crossing');

    expect(autoPlace?.outcome).toBe('agent-running');
    expect(autoPlace?.message).toContain('AI 還在跑，等它跑完再放（圖已經上傳了）');
    expect(asset.placed).toBe(false);
    expect(core.getJob(uuid).revisionCount).toBe(before);
    await expect(running).resolves.toMatchObject({ status: 'succeeded' });
  });

  it('封面：先不設精選（設精選也會建新版本）', async () => {
    const { core, uuid } = await setup([INLINE, COVER], SOURCE, { delayMs: 300 });

    const running = core.runAgentReview(uuid, { provider: 'codex', task: 'images' });
    const { autoFeature } = await upload(core, uuid, 'featured');

    expect(autoFeature?.outcome).toBe('agent-running');
    expect(autoFeature?.message).toContain('AI 還在跑');
    expect(core.getJob(uuid).featuredMediaId).toBeNull();
    await expect(running).resolves.toMatchObject({ status: 'succeeded' });
  });
});

describe('上傳成功之後出什麼錯都不能讓人以為沒上傳', () => {
  it('自動放位置整個丟例外：回 failed，候選圖算用掉了（不會再上傳一次）', async () => {
    const { core, uuid } = await setup();
    const candidate = await core.generateBriefImage(uuid, briefId(core, uuid, 'rainy_crossing'));
    vi.spyOn(mediaModule(core), 'autoPlace').mockImplementation(() => {
      throw new Error('注入的失敗');
    });

    const { autoPlace } = await core.useImageCandidate(uuid, candidate.id);

    expect(autoPlace?.outcome).toBe('failed');
    expect(autoPlace?.message).toContain('圖已經上傳');
    await expect(core.useImageCandidate(uuid, candidate.id)).rejects.toThrow(/已經用過/);
  });

  it('自動設精選整個丟例外：回 failed，候選圖算用掉了', async () => {
    const { core, uuid } = await setup();
    const candidate = await core.generateBriefImage(uuid, briefId(core, uuid, 'featured'));
    vi.spyOn(mediaModule(core), 'autoFeature').mockImplementation(() => {
      throw new Error('注入的失敗');
    });

    const { autoFeature, autoPlace } = await core.useImageCandidate(uuid, candidate.id);

    expect(autoFeature?.outcome).toBe('failed');
    expect(autoPlace).toBeNull();
    await expect(core.useImageCandidate(uuid, candidate.id)).rejects.toThrow(/已經用過/);
  });
});

describe('wp-image-51 不能認成 wp-image-512', () => {
  it('class 要整個對上', () => {
    expect(hasWpImageClass('<img class="wp-image-512" />', 51)).toBe(false);
    expect(hasWpImageClass('<img class="wp-image-512" />', 512)).toBe(true);
    expect(hasWpImageClass('<img class="size-large wp-image-51 x" />', 51)).toBe(true);
    expect(hasWpImageClass("<img class='wp-image-51'>", 51)).toBe(true);
    expect(hasWpImageClass('<img class="wp-image-151" />', 51)).toBe(false);
  });

  /** 假 WordPress 依序發 512、51 這兩個媒體編號。 */
  function collidingIds(): (request: RecordedRequest, index: number) => MockResponse {
    const base = defaultWordPressHandler();
    const ids = [512, 51];
    return (request, index) => {
      if (request.method === 'POST' && request.path.split('?')[0] === '/wp-json/wp/v2/media') {
        const id = ids.shift() ?? 999;
        return {
          status: 201,
          body: {
            id,
            source_url: `https://example.test/wp-content/uploads/${id}.png`,
            mime_type: 'image/png',
            media_type: 'image',
            alt_text: '',
            title: { raw: 'upload', rendered: 'upload' },
          },
        };
      }
      return base(request);
    };
  }

  it('放與搬：512 在正文裡時，51 不算已放；搬 51 不會把 512 拿掉', async () => {
    const { core, uuid } = await setup([INLINE], SOURCE, { handler: collidingIds() });
    const big = await upload(core, uuid);
    const small = await upload(core, uuid);
    expect(big.media.wordpressMediaId).toBe(512);
    expect(small.media.wordpressMediaId).toBe(51);

    core.placeMedia(uuid, big.media.id, 0);
    expect(core.getJob(uuid).media.find((row) => row.id === small.media.id)!.placed).toBe(false);

    core.placeMedia(uuid, small.media.id, 2);
    expect(bodyImageIds(core, uuid)).toEqual([512, 51]);

    // 搬家：只拿掉 51 自己那一塊。
    core.placeMedia(uuid, small.media.id, -1);
    expect(bodyImageIds(core, uuid)).toEqual([51, 512]);
    const media = core.getJob(uuid).media;
    expect(media.find((row) => row.id === big.media.id)).toMatchObject({ placed: true, placedAfterBlockIndex: 1 });
    expect(media.find((row) => row.id === small.media.id)).toMatchObject({ placed: true, placedAfterBlockIndex: -1 });
  });

  it('移除 51 不會把正文裡的 512 一起清掉', async () => {
    const { core, uuid } = await setup([INLINE], SOURCE, { handler: collidingIds() });
    const big = await upload(core, uuid);
    const small = await upload(core, uuid);
    core.placeMedia(uuid, big.media.id, 0);

    core.removeMedia(uuid, small.media.id);

    expect(bodyImageIds(core, uuid)).toEqual([512]);
  });
});
