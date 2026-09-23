import { existsSync, readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  approveJob,
  createCoreFixture,
  defaultWordPressHandler,
  TINY_PNG,
  type CoreFixture,
} from './helpers/core-fixture.js';
import type { MockResponse, RecordedRequest } from './helpers/mock-wordpress.js';
import { FakeAdapter, type FakeImageBehaviour } from './helpers/fake-adapter.js';
import { AgentError, InvalidInputError, MediaError } from '../src/core/errors.js';
import { AgentUnavailableError } from '../src/agents/registry.js';
import type { CoreService } from '../src/core/service.js';
import type { AgentStatus } from '../src/agents/types.js';

/**
 * 用 Codex 訂閱生圖（D-017，P5-T013）。
 *
 * 一律用 FakeAdapter，**絕不呼叫真實 CLI**；WordPress 一律是本機假站台。
 * Codex adapter 本身怎麼從 generated_images 拿圖，見 codex-image.test.ts。
 */

const SOURCE = '今天讀完這本書，想到很多事。\n\n不是書裡寫的那些，而是別的。';
const P = (text: string): string => `<p class="wp-block-paragraph">${text}</p>`;

const INLINE_BRIEF = {
  key: 'rainy_crossing',
  purpose: '第二段的雨天路口',
  prompt: '雨天路口積水反射紅色招牌，寫實攝影風格',
  aspectRatio: '4:3',
  altText: '雨天路口的積水',
  caption: '下午的雨',
  placement: '第 2 段之後',
};

const COVER_BRIEF = {
  key: 'featured',
  purpose: '精選圖片，呼應全篇的回望感',
  prompt: '攤開的舊筆記本放在木桌上，桌燈側光',
  aspectRatio: '16:9',
  altText: '木桌上攤開的舊筆記本',
  placement: '精選圖片',
};

function briefsResult(briefs: unknown[]) {
  return {
    ok: true as const,
    data: {
      title: '20260828',
      summary: '配圖建議',
      correctedSource: '（略）',
      changes: [],
      observations: [],
      templateData: { title: '20260828', body: P('x') },
      imageBriefs: briefs,
    },
    meta: { runId: 'fake', agentId: 'codex' as const, model: null, durationMs: 1, stderrTail: '' },
  };
}

let fixture: CoreFixture | null = null;

afterEach(async () => {
  await fixture?.cleanup();
  fixture = null;
});

interface SetupOptions {
  readonly image?: FakeImageBehaviour | null;
  readonly status?: Partial<AgentStatus>;
  readonly briefs?: unknown[];
  readonly runDelayMs?: number;
  readonly handler?: (request: RecordedRequest, index: number) => MockResponse;
}

async function setup(options: SetupOptions = {}): Promise<{ f: CoreFixture; codex: FakeAdapter }> {
  const codex = new FakeAdapter('codex', 'Codex', {
    result: briefsResult(options.briefs ?? [INLINE_BRIEF, COVER_BRIEF]),
    ...(options.status === undefined ? {} : { status: options.status }),
    ...(options.runDelayMs === undefined ? {} : { delayMs: options.runDelayMs }),
    ...(options.image === null ? {} : { image: options.image ?? {} }),
  });
  fixture = await createCoreFixture({
    adapters: [codex],
    ...(options.handler === undefined ? {} : { handler: options.handler }),
  });
  return { f: fixture, codex };
}

function newJob(core: CoreService, targetKey = 'diary', templateData?: Record<string, unknown>): string {
  return core.createJob({
    targetKey,
    sourceText: SOURCE,
    title: targetKey === 'diary' ? '20260828' : '看得見的錯誤',
    ...(templateData === undefined ? {} : { templateData }),
  }).uuid;
}

async function withBriefs(core: CoreService, uuid: string): Promise<{ inline: number; cover: number }> {
  await core.runAgentReview(uuid, { provider: 'codex', task: 'images' });
  const briefs = core.getJob(uuid).imageBriefs;
  return {
    inline: briefs.find((brief) => brief.key === INLINE_BRIEF.key)!.id,
    cover: briefs.find((brief) => brief.key === COVER_BRIEF.key)!.id,
  };
}

function mediaUploads(f: CoreFixture): number {
  return f.requests.filter((request) => request.method === 'POST' && request.path === '/wp-json/wp/v2/media').length;
}

describe('生圖：候選圖', () => {
  it('生出來的圖先放在卡片上：不上傳、不動內容、核准不失效', async () => {
    const { f } = await setup();
    const uuid = newJob(f.core);
    const { inline } = await withBriefs(f.core, uuid);
    const hash = approveJob(f.core, uuid);
    const revisions = f.core.listRevisions(uuid).length;

    const candidate = await f.core.generateBriefImage(uuid, inline);

    expect(candidate).toMatchObject({
      briefId: inline,
      url: `/api/jobs/${uuid}/candidates/${candidate.id}`,
      mimeType: 'image/png',
      width: 1,
      height: 1,
    });
    const detail = f.core.getJob(uuid);
    expect(detail.imageBriefs.find((brief) => brief.id === inline)!.candidate).toEqual(candidate);
    expect(detail.imageBriefs.find((brief) => brief.id === inline)!.fulfilled).toBe(false);
    expect(detail.state).toBe('APPROVED');
    expect(detail.approval).toMatchObject({ valid: true, contentHash: hash });
    expect(f.core.listRevisions(uuid)).toHaveLength(revisions);
    expect(mediaUploads(f)).toBe(0);
  });

  it('檔案存在本機媒體目錄底下，內容就是 Agent 給的那張', async () => {
    const { f } = await setup();
    const uuid = newJob(f.core);
    const { inline } = await withBriefs(f.core, uuid);
    const candidate = await f.core.generateBriefImage(uuid, inline);

    const file = f.core.imageCandidateFile(uuid, candidate.id);
    expect(file.mimeType).toBe('image/png');
    expect(existsSync(file.path)).toBe(true);
    expect(file.path).toContain(uuid);
    expect(Buffer.from(readFileSync(file.path)).equals(Buffer.from(TINY_PNG))).toBe(true);
  });

  it('prompt 由固定程式組：brief 的 prompt、比例、不要文字；工作區是這篇稿件的', async () => {
    const { f, codex } = await setup();
    const uuid = newJob(f.core);
    const { cover } = await withBriefs(f.core, uuid);
    await f.core.generateBriefImage(uuid, cover);

    const request = codex.imageCalls[0]!.request;
    expect(request.prompt).toContain(COVER_BRIEF.prompt);
    expect(request.prompt).toContain('16:9');
    expect(request.prompt).toContain('不要出現任何文字');
    expect(request.workspaceDir).toContain(uuid);
    expect(request.timeoutMs).toBeGreaterThan(60_000);
  });

  it('再生一張：卡片上換成最新的那張', async () => {
    const { f } = await setup();
    const uuid = newJob(f.core);
    const { inline } = await withBriefs(f.core, uuid);
    const first = await f.core.generateBriefImage(uuid, inline);
    const second = await f.core.generateBriefImage(uuid, inline);

    expect(second.id).toBeGreaterThan(first.id);
    expect(f.core.getJob(uuid).imageBriefs.find((brief) => brief.id === inline)!.candidate!.id).toBe(second.id);
  });

  it('生出來的不是圖就不收，這一趟記成失敗', async () => {
    const { f } = await setup({
      image: {
        result: {
          ok: true,
          data: { bytes: new TextEncoder().encode('<svg onload=alert(1)>'), sourceName: 'exec-x.png' },
          meta: { runId: 'x', agentId: 'codex', model: null, durationMs: 1, stderrTail: '' },
        },
      },
    });
    const uuid = newJob(f.core);
    const { inline } = await withBriefs(f.core, uuid);

    await expect(f.core.generateBriefImage(uuid, inline)).rejects.toBeInstanceOf(MediaError);
    const detail = f.core.getJob(uuid);
    expect(detail.imageBriefs.find((brief) => brief.id === inline)!.candidate).toBeNull();
    expect(detail.agentRun).toMatchObject({ status: 'failed', task: 'generate-image' });
  });

  it('Agent 逾時：這一趟記成 timeout，錯誤照實講', async () => {
    const { f } = await setup({
      image: {
        result: {
          ok: false,
          reason: 'timeout',
          message: '執行逾時，已中止',
          issues: [],
          meta: { runId: 'x', agentId: 'codex', model: null, durationMs: 1, stderrTail: '' },
        },
      },
    });
    const uuid = newJob(f.core);
    const { inline } = await withBriefs(f.core, uuid);

    await expect(f.core.generateBriefImage(uuid, inline)).rejects.toThrow('逾時');
    expect(f.core.getJob(uuid).agentRun).toMatchObject({ status: 'timeout', task: 'generate-image' });
  });

  it('丟掉的配圖需求、別篇稿件的配圖需求都不能拿來生圖', async () => {
    const { f } = await setup();
    const uuid = newJob(f.core);
    const other = newJob(f.core);
    const { inline, cover } = await withBriefs(f.core, uuid);
    f.core.dismissImageBrief(uuid, inline);

    await expect(f.core.generateBriefImage(uuid, inline)).rejects.toBeInstanceOf(InvalidInputError);
    await expect(f.core.generateBriefImage(other, cover)).rejects.toBeInstanceOf(InvalidInputError);
    await expect(f.core.generateBriefImage(uuid, 99_999)).rejects.toBeInstanceOf(InvalidInputError);
  });
});

describe('生圖：一次一個、可取消', () => {
  it('跑的時候 agentRun 講得出在畫哪一張', async () => {
    let seen: unknown = null;
    const { f } = await setup({
      image: {
        onRun: () => {
          seen = fixture!.core.getJob(uuidRef.value).agentRun;
        },
      },
    });
    const uuidRef = { value: newJob(f.core) };
    const { cover } = await withBriefs(f.core, uuidRef.value);
    await f.core.generateBriefImage(uuidRef.value, cover);

    expect(seen).toMatchObject({ status: 'running', provider: 'codex', task: 'generate-image', briefId: cover });
    expect(f.core.getJob(uuidRef.value).agentRun).toMatchObject({ status: 'succeeded', briefId: cover });
  });

  it('生圖的時候不能再派校稿，也不能再生另一張', async () => {
    const errors: unknown[] = [];
    const { f } = await setup({
      image: {
        onRun: async () => {
          const core = fixture!.core;
          errors.push(await core.runAgentReview(ref.uuid, { provider: 'codex' }).catch((error: unknown) => error));
          errors.push(await core.generateBriefImage(ref.uuid, ref.other).catch((error: unknown) => error));
        },
      },
    });
    const ref = { uuid: newJob(f.core), other: 0 };
    const { inline, cover } = await withBriefs(f.core, ref.uuid);
    ref.other = inline;
    await f.core.generateBriefImage(ref.uuid, cover);

    expect(errors).toHaveLength(2);
    for (const error of errors) expect(error).toBeInstanceOf(AgentError);
  });

  it('校稿跑的時候也不能生圖', async () => {
    const { f } = await setup({ runDelayMs: 150 });
    const uuid = newJob(f.core);
    const { inline } = await withBriefs(f.core, uuid);

    const review = f.core.runAgentReview(uuid, { provider: 'codex', task: 'images' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await expect(f.core.generateBriefImage(uuid, inline)).rejects.toBeInstanceOf(AgentError);
    await review;
  });

  it('還在佇列裡就被取消：根本不叫 Codex 畫（每一張都花額度）', async () => {
    const { f, codex } = await setup({ image: { delayMs: 150 } });
    const a = newJob(f.core);
    const b = newJob(f.core);
    const briefsA = await withBriefs(f.core, a);
    const briefsB = await withBriefs(f.core, b);

    const first = f.core.generateBriefImage(a, briefsA.inline);
    const second = f.core.generateBriefImage(b, briefsB.inline).catch((error: unknown) => error);
    await new Promise((resolve) => setTimeout(resolve, 30));
    f.core.cancelAgentRun(b);

    await first;
    expect(await second).toBeInstanceOf(AgentError);
    expect(codex.imageCalls).toHaveLength(1);
    expect(f.core.getJob(b).agentRun).toMatchObject({ status: 'cancelled' });
  });

  it('生圖期間配圖需求被標成不要了：圖不收', async () => {
    const { f } = await setup({
      image: {
        onRun: () => {
          fixture!.core.dismissImageBrief(ref.uuid, ref.brief);
        },
      },
    });
    const ref = { uuid: newJob(f.core), brief: 0 };
    ref.brief = (await withBriefs(f.core, ref.uuid)).inline;

    await expect(f.core.generateBriefImage(ref.uuid, ref.brief)).rejects.toBeInstanceOf(AgentError);
    expect(f.core.getJob(ref.uuid).agentRun).toMatchObject({ status: 'failed' });
    expect(fixture!.db.handle.prepare('SELECT COUNT(*) AS n FROM image_candidates').get()).toEqual({ n: 0 });
  });

  it('按停止：這一趟記成 cancelled，就算圖回來了也不收', async () => {
    const { f, codex } = await setup({
      image: {
        onRun: () => {
          fixture!.core.cancelAgentRun(ref.uuid);
        },
      },
    });
    const ref = { uuid: newJob(f.core) };
    const { inline } = await withBriefs(f.core, ref.uuid);

    await expect(f.core.generateBriefImage(ref.uuid, inline)).rejects.toBeInstanceOf(AgentError);
    const detail = f.core.getJob(ref.uuid);
    expect(detail.agentRun).toMatchObject({ status: 'cancelled', task: 'generate-image' });
    expect(detail.imageBriefs.find((brief) => brief.id === inline)!.candidate).toBeNull();
    expect(codex.cancelled).toHaveLength(1);
  });
});

describe('生圖：只有 Codex 能生圖', () => {
  it('Codex 可用時回報可以生圖', async () => {
    const { f } = await setup();
    await expect(f.core.imageGenerationStatus()).resolves.toEqual({ available: true, provider: 'codex', reason: null });
  });

  it('沒有能生圖的 Agent：不給按，並說只有 Codex 能生圖', async () => {
    const { f } = await setup({ image: null });
    const status = await f.core.imageGenerationStatus();
    expect(status.available).toBe(false);
    expect(status.provider).toBeNull();
    expect(status.reason).toContain('Codex');

    const uuid = newJob(f.core);
    const { inline } = await withBriefs(f.core, uuid);
    await expect(f.core.generateBriefImage(uuid, inline)).rejects.toBeInstanceOf(AgentUnavailableError);
  });

  it('Codex 沒登入：不給按，原因講清楚', async () => {
    const { f } = await setup({
      status: { available: false, loginState: 'logged-out', unavailableReason: '尚未登入，請執行 `codex login`' },
    });
    const status = await f.core.imageGenerationStatus();
    expect(status).toMatchObject({ available: false, provider: 'codex' });
    expect(status.reason).toContain('尚未登入');
  });
});

describe('用這張', () => {
  it('上傳到 WordPress 媒體庫，帶 alt 與圖說，配圖需求算完成', async () => {
    const { f } = await setup();
    const uuid = newJob(f.core);
    const { inline } = await withBriefs(f.core, uuid);
    const candidate = await f.core.generateBriefImage(uuid, inline);

    const { media: asset, autoFeature } = await f.core.useImageCandidate(uuid, candidate.id);

    expect(asset).toMatchObject({ briefKey: INLINE_BRIEF.key, altText: INLINE_BRIEF.altText, caption: INLINE_BRIEF.caption });
    expect(autoFeature).toBeNull();
    expect(mediaUploads(f)).toBe(1);
    const metadata = f.requests.find((request) => /\/wp-json\/wp\/v2\/media\/\d+$/.test(request.path))!;
    expect(JSON.parse(metadata.body)).toMatchObject({ alt_text: INLINE_BRIEF.altText, caption: INLINE_BRIEF.caption });

    const brief = f.core.getJob(uuid).imageBriefs.find((row) => row.id === inline)!;
    expect(brief.fulfilled).toBe(true);
    expect(brief.candidate).toBeNull();
    // 不是封面的那張不會被設成精選。
    expect(f.core.getJob(uuid).featuredMediaId).toBeNull();
  });

  it('同一張不能用兩次', async () => {
    const { f } = await setup();
    const uuid = newJob(f.core);
    const { inline } = await withBriefs(f.core, uuid);
    const candidate = await f.core.generateBriefImage(uuid, inline);
    await f.core.useImageCandidate(uuid, candidate.id);

    await expect(f.core.useImageCandidate(uuid, candidate.id)).rejects.toBeInstanceOf(InvalidInputError);
    expect(mediaUploads(f)).toBe(1);
  });

  it('兩個「用這張」同時送來：只上傳一次', async () => {
    const { f } = await setup();
    const uuid = newJob(f.core);
    const { inline } = await withBriefs(f.core, uuid);
    const candidate = await f.core.generateBriefImage(uuid, inline);

    const results = await Promise.allSettled([
      f.core.useImageCandidate(uuid, candidate.id),
      f.core.useImageCandidate(uuid, candidate.id),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(mediaUploads(f)).toBe(1);
  });

  it('上傳失敗：這張候選圖還留著，可以再按一次', async () => {
    const ok = defaultWordPressHandler();
    let failMedia = true;
    const { f } = await setup({
      handler: (request) => {
        if (failMedia && request.path.startsWith('/wp-json/wp/v2/media')) {
          return { status: 500, body: { code: 'boom', message: '炸了', data: { status: 500 } } };
        }
        return ok(request);
      },
    });
    const uuid = newJob(f.core);
    const { inline } = await withBriefs(f.core, uuid);
    const candidate = await f.core.generateBriefImage(uuid, inline);

    await expect(f.core.useImageCandidate(uuid, candidate.id)).rejects.toThrow();
    expect(f.core.getJob(uuid).imageBriefs.find((brief) => brief.id === inline)!.candidate?.id).toBe(candidate.id);

    failMedia = false;
    const { media } = await f.core.useImageCandidate(uuid, candidate.id);
    expect(media.briefKey).toBe(INLINE_BRIEF.key);
  });

  it('配圖需求被標成不要了：它的候選圖不能用', async () => {
    const { f } = await setup();
    const uuid = newJob(f.core);
    const { inline } = await withBriefs(f.core, uuid);
    const candidate = await f.core.generateBriefImage(uuid, inline);
    f.core.dismissImageBrief(uuid, inline);

    await expect(f.core.useImageCandidate(uuid, candidate.id)).rejects.toBeInstanceOf(InvalidInputError);
    expect(mediaUploads(f)).toBe(0);
  });

  it('同一個 key 重新提過（描述可能變了）：舊的候選圖不再顯示，也不能用', async () => {
    const { f } = await setup();
    const uuid = newJob(f.core);
    const { inline } = await withBriefs(f.core, uuid);
    const candidate = await f.core.generateBriefImage(uuid, inline);

    await f.core.runAgentReview(uuid, { provider: 'codex', task: 'images' });
    const brief = f.core.getJob(uuid).imageBriefs.find((row) => row.key === INLINE_BRIEF.key)!;
    expect(brief.id).toBe(inline);
    expect(brief.candidate).toBeNull();
    await expect(f.core.useImageCandidate(uuid, candidate.id)).rejects.toBeInstanceOf(InvalidInputError);
  });

  it('別篇稿件的候選圖拿不到', async () => {
    const { f } = await setup();
    const uuid = newJob(f.core);
    const other = newJob(f.core);
    const { inline } = await withBriefs(f.core, uuid);
    const candidate = await f.core.generateBriefImage(uuid, inline);

    expect(() => f.core.imageCandidateFile(other, candidate.id)).toThrow(InvalidInputError);
    await expect(f.core.useImageCandidate(other, candidate.id)).rejects.toBeInstanceOf(InvalidInputError);
  });
});

describe('封面卡片自動設精選', () => {
  it('用了封面那張：上傳後自動設成精選，核准照既有規則失效', async () => {
    const { f } = await setup();
    const uuid = newJob(f.core);
    const { cover } = await withBriefs(f.core, uuid);
    expect(f.core.getJob(uuid).imageBriefs.find((brief) => brief.id === cover)!.isFeatured).toBe(true);
    const candidate = await f.core.generateBriefImage(uuid, cover);
    approveJob(f.core, uuid);

    const { media: asset, autoFeature } = await f.core.useImageCandidate(uuid, candidate.id);

    const detail = f.core.getJob(uuid);
    expect(autoFeature?.outcome).toBe('set');
    expect(detail.featuredMediaId).toBe(asset.id);
    expect(detail.approval?.valid).toBe(false);
    expect(detail.state).toBe('RENDERED');
  });

  it('手動「上傳這張」到封面卡片也一樣', async () => {
    const { f } = await setup();
    const uuid = newJob(f.core);
    await withBriefs(f.core, uuid);

    const result = await f.core.addMediaWithOutcome(uuid, {
      bytes: TINY_PNG,
      mimeType: 'image/png',
      filename: 'cover',
      briefKey: COVER_BRIEF.key,
    });
    expect(result.autoFeature?.outcome).toBe('set');
    expect(f.core.getJob(uuid).featuredMediaId).toBe(result.media.id);
  });

  it('沒對上任何配圖需求的上傳，不會自動設精選', async () => {
    const { f } = await setup();
    const uuid = newJob(f.core);
    await f.core.addMedia(uuid, { bytes: TINY_PNG, mimeType: 'image/png', filename: 'a' });
    await f.core.addMedia(uuid, { bytes: TINY_PNG, mimeType: 'image/png', filename: 'b', briefKey: 'not-a-brief' });
    expect(f.core.getJob(uuid).featuredMediaId).toBeNull();
  });

  it('templateData 的 featuredImageBriefKey 指到的那條就是封面', async () => {
    const { f } = await setup({
      briefs: [{ ...INLINE_BRIEF, key: 'hero', placement: '第 1 段之後' }],
    });
    const uuid = newJob(f.core, 'read-think', {
      title: '看得見的錯誤',
      body: P('一個制度要活下來。'),
      featuredImageBriefKey: 'hero',
    });
    await f.core.runAgentReview(uuid, { provider: 'codex', task: 'images' });
    const brief = f.core.getJob(uuid).imageBriefs[0]!;
    expect(brief.isFeatured).toBe(true);

    const candidate = await f.core.generateBriefImage(uuid, brief.id);
    const { media: asset } = await f.core.useImageCandidate(uuid, candidate.id);
    const detail = f.core.getJob(uuid);
    expect(detail.featuredMediaId).toBe(asset.id);
    expect(detail.blockers.join('、')).not.toContain('精選圖片');
  });

  it('templateData 有 featuredImageBriefKey 時只認它：key 叫 featured 的也不算', async () => {
    const { f } = await setup({
      briefs: [
        { ...INLINE_BRIEF, key: 'hero', placement: '第 1 段之後' },
        { ...COVER_BRIEF, key: 'featured' },
      ],
    });
    const uuid = newJob(f.core, 'read-think', {
      title: '看得見的錯誤',
      body: P('一個制度要活下來。'),
      featuredImageBriefKey: 'hero',
    });
    await f.core.runAgentReview(uuid, { provider: 'codex', task: 'images' });
    const byKey = Object.fromEntries(f.core.getJob(uuid).imageBriefs.map((brief) => [brief.key, brief.isFeatured]));
    expect(byKey).toEqual({ hero: true, featured: false });
  });

  it('placement 只看開頭：「放在『精選書單』那段之後」不算封面', async () => {
    const { f } = await setup({
      briefs: [
        { ...INLINE_BRIEF, key: 'books', placement: '放在『精選書單』那段之後' },
        { ...INLINE_BRIEF, key: 'shelf', placement: '第 2 段之後，封面感的構圖' },
        { ...INLINE_BRIEF, key: 'list', placement: '精選書單之後' },
      ],
    });
    const uuid = newJob(f.core);
    await f.core.runAgentReview(uuid, { provider: 'codex', task: 'images' });
    expect(f.core.getJob(uuid).imageBriefs.every((brief) => !brief.isFeatured)).toBe(true);
  });

  it('使用者已經選了別張當封面：不覆蓋，並講清楚', async () => {
    const { f } = await setup();
    const uuid = newJob(f.core);
    const { cover } = await withBriefs(f.core, uuid);
    const chosen = await f.core.addMedia(uuid, { bytes: TINY_PNG, mimeType: 'image/png', filename: 'mine' });
    f.core.setFeaturedMedia(uuid, chosen.id);

    const candidate = await f.core.generateBriefImage(uuid, cover);
    const result = await f.core.useImageCandidate(uuid, candidate.id);

    expect(result.autoFeature?.outcome).toBe('kept-existing');
    expect(result.autoFeature?.message).toContain('設為精選');
    expect(f.core.getJob(uuid).featuredMediaId).toBe(chosen.id);
  });

  it('封面這條「換一張」：目前的封面就是這條的圖，換成新的', async () => {
    const { f } = await setup();
    const uuid = newJob(f.core);
    await withBriefs(f.core, uuid);
    const first = await f.core.addMediaWithOutcome(uuid, {
      bytes: TINY_PNG,
      mimeType: 'image/png',
      filename: 'a',
      briefKey: COVER_BRIEF.key,
    });
    const second = await f.core.addMediaWithOutcome(uuid, {
      bytes: TINY_PNG,
      mimeType: 'image/png',
      filename: 'b',
      briefKey: COVER_BRIEF.key,
    });
    expect(first.autoFeature?.outcome).toBe('set');
    expect(second.autoFeature?.outcome).toBe('set');
    expect(f.core.getJob(uuid).featuredMediaId).toBe(second.media.id);
  });

  it('設精選失敗：上傳照樣成功，但結果要講出來', async () => {
    const { f } = await setup();
    const uuid = newJob(f.core);
    await withBriefs(f.core, uuid);
    vi.spyOn(f.core, 'setFeaturedMedia').mockImplementation(() => {
      throw new Error('這一版渲染不過');
    });

    const result = await f.core.addMediaWithOutcome(uuid, {
      bytes: TINY_PNG,
      mimeType: 'image/png',
      filename: 'cover',
      briefKey: COVER_BRIEF.key,
    });
    expect(result.autoFeature).toMatchObject({ outcome: 'failed' });
    expect(result.autoFeature?.message).toContain('這一版渲染不過');
    expect(f.core.getJob(uuid).featuredMediaId).toBeNull();
  });

  it('key 以 cover 開頭、或 placement 寫「封面」也算封面；一般的不算', async () => {
    const { f } = await setup({
      briefs: [
        { ...INLINE_BRIEF, key: 'cover-image', placement: '文章最上方' },
        { ...INLINE_BRIEF, key: 'top', placement: '封面' },
        { ...INLINE_BRIEF, key: 'discovery', placement: '第 3 段之後' },
      ],
    });
    const uuid = newJob(f.core);
    await f.core.runAgentReview(uuid, { provider: 'codex', task: 'images' });
    const byKey = Object.fromEntries(f.core.getJob(uuid).imageBriefs.map((brief) => [brief.key, brief.isFeatured]));
    expect(byKey).toEqual({ 'cover-image': true, top: true, discovery: false });
  });
});
