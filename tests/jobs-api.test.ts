import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { buildApp } from '../src/server/app.js';
import { loadConfig } from '../src/config/env.js';
import { loadTemplateRegistry } from '../src/templates/registry.js';
import { loadPublishTargets } from '../src/wordpress/targets.js';
import { paths } from '../src/config/paths.js';
import { AgentRegistry } from '../src/agents/registry.js';
import { createCoreFixture, TINY_PNG, type CoreFixture } from './helpers/core-fixture.js';
import { FakeAdapter } from './helpers/fake-adapter.js';

/**
 * HTTP 介面測試。
 *
 * 用 buildApp 注入測試用的 CoreService（工作區指向暫存目錄），
 * 這樣路由層跑的是真的核心邏輯，但不會寫進專案的 drafts/ 與 generated-images/。
 */

const headers = { host: '127.0.0.1:3000' };
const SOURCE = '今天讀完這本書，想到很多事。\n\n不是書裡寫的那些。';

let app: FastifyInstance | null = null;
let fixture: CoreFixture | null = null;

afterEach(async () => {
  await app?.close();
  await fixture?.cleanup();
  app = null;
  fixture = null;
});

async function build(options: Parameters<typeof createCoreFixture>[0] = {}): Promise<FastifyInstance> {
  fixture = await createCoreFixture(options);
  app = await buildApp({
    config: loadConfig({ APP_HOST: '127.0.0.1', APP_PORT: '3000', LOG_LEVEL: 'silent' }),
    db: fixture.db.handle,
    templates: await loadTemplateRegistry(paths.templates),
    agents: new AgentRegistry({ adapters: options.adapters ?? [] }),
    targets: await loadPublishTargets(join(paths.config, 'examples', 'remusplus.json')),
    core: fixture.core,
    wordpress: null,
  });
  await app.ready();
  return app;
}

async function createJob(instance: FastifyInstance): Promise<string> {
  const res = await instance.inject({
    method: 'POST',
    url: '/api/jobs',
    headers,
    payload: { targetKey: 'diary', sourceText: SOURCE, title: '20260828' },
  });
  expect(res.statusCode).toBe(201);
  return res.json().job.uuid as string;
}

describe('POST/GET /api/jobs', () => {
  it('建立 job 回 201，並帶回 uuid 與初始狀態', async () => {
    const instance = await build();
    const res = await instance.inject({
      method: 'POST',
      url: '/api/jobs',
      headers,
      payload: { targetKey: 'diary', sourceText: SOURCE, title: '20260828' },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().job).toMatchObject({ state: 'SOURCE', targetKey: 'diary' });
  });

  it('缺欄位回 400 並說明哪裡錯', async () => {
    const instance = await build();
    const res = await instance.inject({ method: 'POST', url: '/api/jobs', headers, payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_FAILED');
    expect(JSON.stringify(res.json().error.details)).toContain('targetKey');
  });

  it('不存在的發布目標回 400', async () => {
    const instance = await build();
    const res = await instance.inject({
      method: 'POST',
      url: '/api/jobs',
      headers,
      payload: { targetKey: 'nope', sourceText: SOURCE },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INVALID_INPUT');
  });

  it('列表可以用 ?state= 篩選，未知狀態回 400', async () => {
    const instance = await build();
    await createJob(instance);

    const ok = await instance.inject({ method: 'GET', url: '/api/jobs?state=SOURCE', headers });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().jobs).toHaveLength(1);

    const bad = await instance.inject({ method: 'GET', url: '/api/jobs?state=NOPE', headers });
    expect(bad.statusCode).toBe(400);
  });

  it('找不到 job 回 404', async () => {
    const instance = await build();
    const res = await instance.inject({ method: 'GET', url: '/api/jobs/not-a-job', headers });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('JOB_NOT_FOUND');
  });

  it('job 詳情一次給齊前端要的欄位', async () => {
    const instance = await build();
    const uuid = await createJob(instance);

    const res = await instance.inject({ method: 'GET', url: `/api/jobs/${uuid}`, headers });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Object.keys(body).sort()).toEqual(
      [
        'agentRun',
        'approval',
        'blockers',
        'bodyEmpty',
        'currentRevision',
        'featuredMediaId',
        'imageBriefs',
        'marks',
        'media',
        'openFactCheckContradictions',
        'previewUrl',
        'published',
        'review',
        'revisionCount',
        'sourceText',
        'state',
        'target',
        'template',
        'title',
        'uuid',
      ].sort(),
    );
    expect(body.template).toMatchObject({ id: 'diary-v1', strictness: 'flexible' });
  });

  it('DELETE 取消 job', async () => {
    const instance = await build();
    const uuid = await createJob(instance);
    const res = await instance.inject({ method: 'DELETE', url: `/api/jobs/${uuid}`, headers });
    expect(res.statusCode).toBe(200);
    expect(res.json().job.state).toBe('CANCELLED');
  });
});

describe('渲染、預覽與差異', () => {
  it('render 回傳預覽文件與 hash', async () => {
    const instance = await build();
    const uuid = await createJob(instance);

    const res = await instance.inject({ method: 'POST', url: `/api/jobs/${uuid}/render`, headers });
    expect(res.statusCode).toBe(200);
    expect(res.json().state).toBe('RENDERED');
    expect(res.json().contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(res.json().previewDocument).toMatch(/^<!doctype html>/i);
  });

  it('preview 回 text/html，而且允許被本機 iframe 嵌入', async () => {
    const instance = await build();
    const uuid = await createJob(instance);
    await instance.inject({ method: 'POST', url: `/api/jobs/${uuid}/render`, headers });

    const res = await instance.inject({ method: 'GET', url: `/api/jobs/${uuid}/preview`, headers });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    // 校樣要能放進 iframe，所以這條路徑不能掛 X-Frame-Options: DENY。
    expect(res.headers['x-frame-options']).toBeUndefined();
    expect(String(res.headers['content-security-policy'])).toContain('frame-ancestors');
  });

  it('其他路徑仍然禁止被嵌入', async () => {
    const instance = await build();
    const res = await instance.inject({ method: 'GET', url: '/api/jobs', headers });
    expect(res.headers['x-frame-options']).toBe('DENY');
  });

  it('diff 回傳校對符號', async () => {
    const instance = await build();
    const uuid = await createJob(instance);
    await instance.inject({
      method: 'POST',
      url: `/api/jobs/${uuid}/revisions`,
      headers,
      payload: {
        templateData: {
          title: '20260828',
          body: '<p class="wp-block-paragraph">今天讀完這本書，想到很多事。</p><p class="wp-block-paragraph">不是書裡寫的那些。</p><p class="wp-block-paragraph">多一段。</p>',
        },
      },
    });

    const res = await instance.inject({ method: 'GET', url: `/api/jobs/${uuid}/diff`, headers });
    expect(res.statusCode).toBe(200);
    expect(res.json().marks.some((mark: { kind: string }) => mark.kind === 'inserted')).toBe(true);
  });

  it('內容不合模板規則回 422', async () => {
    const instance = await build();
    const uuid = await createJob(instance);
    const res = await instance.inject({
      method: 'POST',
      url: `/api/jobs/${uuid}/revisions`,
      headers,
      payload: { templateData: { title: '只有標題' } },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('CONTENT_INVALID');
  });
});

describe('核准與發布', () => {
  async function readyToApprove(instance: FastifyInstance): Promise<{ uuid: string; hash: string }> {
    const uuid = await createJob(instance);
    await instance.inject({ method: 'POST', url: `/api/jobs/${uuid}/render`, headers });
    await instance.inject({ method: 'GET', url: `/api/jobs/${uuid}/preview`, headers });
    const detail = await instance.inject({ method: 'GET', url: `/api/jobs/${uuid}`, headers });
    return { uuid, hash: detail.json().currentRevision.contentHash as string };
  }

  it('核准成功回 201', async () => {
    const instance = await build();
    const { uuid, hash } = await readyToApprove(instance);

    const res = await instance.inject({
      method: 'POST',
      url: `/api/jobs/${uuid}/approve`,
      headers,
      payload: { contentHash: hash },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().approval.valid).toBe(true);
  });

  it('hash 對不上回 409', async () => {
    const instance = await build();
    const { uuid } = await readyToApprove(instance);

    const res = await instance.inject({
      method: 'POST',
      url: `/api/jobs/${uuid}/approve`,
      headers,
      payload: { contentHash: 'a'.repeat(64) },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('CONTENT_CHANGED');
  });

  it('沒看過預覽就核准回 409（狀態機擋下）', async () => {
    const instance = await build();
    const uuid = await createJob(instance);
    const render = await instance.inject({ method: 'POST', url: `/api/jobs/${uuid}/render`, headers });

    const res = await instance.inject({
      method: 'POST',
      url: `/api/jobs/${uuid}/approve`,
      headers,
      payload: { contentHash: render.json().contentHash },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('INVALID_TRANSITION');
  });

  it('撤銷核准後 job 退回 RENDERED', async () => {
    const instance = await build();
    const { uuid, hash } = await readyToApprove(instance);
    await instance.inject({
      method: 'POST',
      url: `/api/jobs/${uuid}/approve`,
      headers,
      payload: { contentHash: hash },
    });

    const res = await instance.inject({
      method: 'DELETE',
      url: `/api/jobs/${uuid}/approve`,
      headers,
      payload: { reason: '再看一次' },
    });
    expect(res.statusCode).toBe(200);

    const detail = await instance.inject({ method: 'GET', url: `/api/jobs/${uuid}`, headers });
    expect(detail.json().state).toBe('RENDERED');
    expect(detail.json().approval.valid).toBe(false);
  });

  it('沒核准就發布回 409', async () => {
    const instance = await build();
    const uuid = await createJob(instance);

    const res = await instance.inject({
      method: 'POST',
      url: `/api/jobs/${uuid}/publish`,
      headers,
      payload: { status: 'draft' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('PUBLISH_BLOCKED');
    expect(fixture!.requests).toHaveLength(0);
  });

  it('核准後發布成功', async () => {
    const instance = await build();
    const { uuid, hash } = await readyToApprove(instance);
    await instance.inject({
      method: 'POST',
      url: `/api/jobs/${uuid}/approve`,
      headers,
      payload: { contentHash: hash },
    });

    const res = await instance.inject({
      method: 'POST',
      url: `/api/jobs/${uuid}/publish`,
      headers,
      payload: { status: 'draft' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().result).toMatchObject({ created: true, status: 'draft' });
  });
});

describe('媒體', () => {
  const payload = {
    filename: 'cover',
    mimeType: 'image/png',
    dataBase64: Buffer.from(TINY_PNG).toString('base64'),
    altText: '封面',
  };

  it('上傳、插入正文、設為封面、移除', async () => {
    const instance = await build();
    const uuid = await createJob(instance);

    const upload = await instance.inject({
      method: 'POST',
      url: `/api/jobs/${uuid}/media`,
      headers,
      payload,
    });
    expect(upload.statusCode).toBe(201);
    const assetId = upload.json().media.id as number;
    expect(upload.json().media.url).toContain('https://example.test/');

    const place = await instance.inject({
      method: 'POST',
      url: `/api/jobs/${uuid}/media/${assetId}/place`,
      headers,
      payload: { afterBlockIndex: 0 },
    });
    expect(place.statusCode).toBe(200);
    expect(place.json().revision.publishHtml).toContain('wp-image-');

    const featured = await instance.inject({
      method: 'POST',
      url: `/api/jobs/${uuid}/media/${assetId}/featured`,
      headers,
    });
    expect(featured.statusCode).toBe(200);
    expect(featured.json().revision.featuredMediaId).toBe(assetId);

    const removed = await instance.inject({
      method: 'DELETE',
      url: `/api/jobs/${uuid}/media/${assetId}`,
      headers,
    });
    expect(removed.statusCode).toBe(200);

    const detail = await instance.inject({ method: 'GET', url: `/api/jobs/${uuid}`, headers });
    expect(detail.json().media).toHaveLength(0);
    expect(detail.json().featuredMediaId).toBeNull();
  });

  it('不接受 SVG，錯誤訊息說明怎麼修', async () => {
    const instance = await build();
    const uuid = await createJob(instance);

    const res = await instance.inject({
      method: 'POST',
      url: `/api/jobs/${uuid}/media`,
      headers,
      payload: { ...payload, mimeType: 'image/svg+xml' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toContain('PNG');
  });

  it('圖片編號不合法回 400', async () => {
    const instance = await build();
    const uuid = await createJob(instance);
    const res = await instance.inject({
      method: 'POST',
      url: `/api/jobs/${uuid}/media/abc/place`,
      headers,
      payload: { afterBlockIndex: 0 },
    });
    expect(res.statusCode).toBe(400);
  });
});

/** 提了一項錯字建議與一個要人判斷的觀察。SOURCE 的第一段是「今天讀完這本書，想到很多事。」 */
function reviewAdapter(): FakeAdapter {
  return new FakeAdapter('codex', 'Codex', {
    result: {
      ok: true,
      data: {
        title: '20260828',
        summary: '補了標點',
        correctedSource: '今天讀完這本書，想到很多事情。',
        changes: [
          { type: 'clarity', before: '很多事', after: '很多事情', reason: '語感', meaningChanged: false },
        ],
        observations: [
          {
            kind: 'missing-source',
            blockIndex: 0,
            excerpt: '這本書',
            detail: '沒有寫是哪一本書',
            suggestion: '補上書名',
          },
        ],
        templateData: {
          title: '20260828',
          body:
            '<p class="wp-block-paragraph">今天讀完這本書，想到很多事情。</p>' +
            '<p class="wp-block-paragraph">不是書裡寫的那些，而是別的。</p>',
        },
        imageBriefs: [],
      },
      meta: { runId: 'r', agentId: 'codex', model: null, durationMs: 1, stderrTail: '' },
    },
  });
}

describe('Agent 路由', () => {
  it('派工成功回傳待處理清單，而不是一個新版本', async () => {
    const instance = await build({ adapters: [reviewAdapter()] });
    const uuid = await createJob(instance);

    const res = await instance.inject({
      method: 'POST',
      url: `/api/jobs/${uuid}/agent`,
      headers,
      payload: { provider: 'codex', instruction: '幫我校錯字' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().summary).toBe('補了標點');
    expect(res.json().review.pendingCount).toBe(2);
    expect(res.json()).not.toHaveProperty('revision');

    // 內容還是原稿，只有一個版本。
    const revisions = await instance.inject({ method: 'GET', url: `/api/jobs/${uuid}/revisions`, headers });
    expect(revisions.json().revisions).toHaveLength(1);
  });

  it('未知的 provider 回 400', async () => {
    const instance = await build();
    const uuid = await createJob(instance);
    const res = await instance.inject({
      method: 'POST',
      url: `/api/jobs/${uuid}/agent`,
      headers,
      payload: { provider: 'gpt' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('取消沒有執行中的 Agent 也不會爆', async () => {
    const instance = await build();
    const uuid = await createJob(instance);
    const res = await instance.inject({ method: 'DELETE', url: `/api/jobs/${uuid}/agent`, headers });
    expect(res.statusCode).toBe(200);
  });
});

describe('待處理清單路由', () => {
  /** 建一個 job 並跑一次校稿，回傳 uuid 與清單上的項目。 */
  async function withReview(instance: Awaited<ReturnType<typeof build>>): Promise<{
    uuid: string;
    items: { id: number; ordinal: number; type: string; state: string }[];
  }> {
    const uuid = await createJob(instance);
    await instance.inject({
      method: 'POST',
      url: `/api/jobs/${uuid}/agent`,
      headers,
      payload: { provider: 'codex' },
    });
    const res = await instance.inject({ method: 'GET', url: `/api/jobs/${uuid}/review`, headers });
    return { uuid, items: res.json().review.items };
  }

  it('GET /review 給出清單，改動與觀察在同一張表上', async () => {
    const instance = await build({ adapters: [reviewAdapter()] });
    const { items } = await withReview(instance);
    expect(items.map((item) => item.type)).toEqual(['change', 'observation']);
    expect(items.every((item) => item.state === 'pending')).toBe(true);
  });

  it('套用勾選的項目會產生新版本', async () => {
    const instance = await build({ adapters: [reviewAdapter()] });
    const { uuid, items } = await withReview(instance);

    const res = await instance.inject({
      method: 'POST',
      url: `/api/jobs/${uuid}/review/resolve`,
      headers,
      payload: { itemIds: [items[0]!.id], decision: 'apply' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().revision.publishHtml).toContain('很多事情');
    expect(res.json().applied).toHaveLength(1);
  });

  it('decision 只認得 apply 與 skip', async () => {
    const instance = await build({ adapters: [reviewAdapter()] });
    const { uuid, items } = await withReview(instance);
    const res = await instance.inject({
      method: 'POST',
      url: `/api/jobs/${uuid}/review/resolve`,
      headers,
      payload: { itemIds: [items[0]!.id], decision: 'delete' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('全部接受走另一條路徑，觀察留在清單上', async () => {
    const instance = await build({ adapters: [reviewAdapter()] });
    const { uuid } = await withReview(instance);

    const res = await instance.inject({
      method: 'POST',
      url: `/api/jobs/${uuid}/review/accept-all`,
      headers,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().review.pendingCount).toBe(1);
  });

  it('丟棄提案之後清單就沒了', async () => {
    const instance = await build({ adapters: [reviewAdapter()] });
    const { uuid } = await withReview(instance);

    const res = await instance.inject({ method: 'DELETE', url: `/api/jobs/${uuid}/review`, headers });
    expect(res.statusCode).toBe(200);
    const after = await instance.inject({ method: 'GET', url: `/api/jobs/${uuid}/review`, headers });
    expect(after.json().review).toBeNull();
  });

  it('沒有提案時套用回 400，說得出原因', async () => {
    const instance = await build();
    const uuid = await createJob(instance);
    const res = await instance.inject({
      method: 'POST',
      url: `/api/jobs/${uuid}/review/resolve`,
      headers,
      payload: { itemIds: [1], decision: 'apply' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INVALID_INPUT');
  });

  it('GET /compare 給左右對照，逐詞標出差異', async () => {
    const instance = await build({ adapters: [reviewAdapter()] });
    const { uuid } = await withReview(instance);

    const res = await instance.inject({ method: 'GET', url: `/api/jobs/${uuid}/compare`, headers });
    expect(res.statusCode).toBe(200);
    expect(res.json().against).toBe('proposal');
    const added = res
      .json()
      .rows.flatMap((row: { right: { op: string; text: string }[] | null }) => row.right ?? [])
      .filter((segment: { op: string }) => segment.op === 'added');
    expect(added.map((segment: { text: string }) => segment.text)).toContain('事情');
  });

  it('against 只認得 proposal 與 previous', async () => {
    const instance = await build({ adapters: [reviewAdapter()] });
    const { uuid } = await withReview(instance);
    const res = await instance.inject({
      method: 'GET',
      url: `/api/jobs/${uuid}/compare?against=whatever`,
      headers,
    });
    expect(res.statusCode).toBe(400);
  });
});
