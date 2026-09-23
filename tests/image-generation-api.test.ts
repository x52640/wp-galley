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
 * 生圖的 HTTP 介面（P5-T013）。FakeAdapter＋假 WordPress，不碰真實 CLI 與網站。
 */

const headers = { host: '127.0.0.1:3000' };

let app: FastifyInstance | null = null;
let fixture: CoreFixture | null = null;

afterEach(async () => {
  await app?.close();
  await fixture?.cleanup();
  app = null;
  fixture = null;
});

const COVER = {
  key: 'featured',
  purpose: '精選圖片',
  prompt: '木桌上的舊筆記本',
  aspectRatio: '16:9',
  altText: '舊筆記本',
  placement: '精選圖片',
};

function codex(withImage = true): FakeAdapter {
  return new FakeAdapter('codex', 'Codex', {
    result: {
      ok: true,
      data: {
        title: '20260828',
        summary: '配圖',
        correctedSource: '',
        changes: [],
        observations: [],
        templateData: {},
        imageBriefs: [COVER],
      },
      meta: { runId: 'x', agentId: 'codex', model: null, durationMs: 1, stderrTail: '' },
    },
    ...(withImage ? { image: {} } : {}),
  });
}

async function build(adapters = [codex()]): Promise<FastifyInstance> {
  fixture = await createCoreFixture({ adapters });
  app = await buildApp({
    config: loadConfig({ APP_HOST: '127.0.0.1', APP_PORT: '3000', LOG_LEVEL: 'silent' }),
    db: fixture.db.handle,
    templates: await loadTemplateRegistry(paths.templates),
    agents: new AgentRegistry({ adapters }),
    targets: await loadPublishTargets(join(paths.config, 'examples', 'remusplus.json')),
    core: fixture.core,
    wordpress: null,
  });
  await app.ready();
  return app;
}

async function jobWithBrief(instance: FastifyInstance): Promise<{ uuid: string; briefId: number }> {
  const created = await instance.inject({
    method: 'POST',
    url: '/api/jobs',
    headers,
    payload: { targetKey: 'diary', sourceText: '今天。', title: '20260828' },
  });
  const uuid = created.json().job.uuid as string;
  const run = await instance.inject({
    method: 'POST',
    url: `/api/jobs/${uuid}/agent`,
    headers,
    payload: { provider: 'codex', task: 'images' },
  });
  expect(run.statusCode).toBe(200);
  const detail = await instance.inject({ method: 'GET', url: `/api/jobs/${uuid}`, headers });
  return { uuid, briefId: detail.json().imageBriefs[0].id as number };
}

describe('生圖 API', () => {
  it('GET /api/image-generation 回報能不能生圖', async () => {
    const instance = await build();
    const res = await instance.inject({ method: 'GET', url: '/api/image-generation', headers });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ available: true, provider: 'codex', reason: null });
  });

  it('沒有 Codex 時回報不能生圖，生圖請求回 503', async () => {
    const instance = await build([codex(false)]);
    const status = await instance.inject({ method: 'GET', url: '/api/image-generation', headers });
    expect(status.json()).toMatchObject({ available: false, provider: null });

    const { uuid, briefId } = await jobWithBrief(instance);
    const res = await instance.inject({ method: 'POST', url: `/api/jobs/${uuid}/briefs/${briefId}/generate`, headers });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.message).toContain('Codex');
  });

  it('生圖 → 取得候選圖 → 用這張：封面自動設精選', async () => {
    const instance = await build();
    const { uuid, briefId } = await jobWithBrief(instance);

    const generated = await instance.inject({
      method: 'POST',
      url: `/api/jobs/${uuid}/briefs/${briefId}/generate`,
      headers,
    });
    expect(generated.statusCode).toBe(200);
    const candidate = generated.json().candidate as { id: number; url: string };
    expect(candidate.url).toBe(`/api/jobs/${uuid}/candidates/${candidate.id}`);

    const image = await instance.inject({ method: 'GET', url: candidate.url, headers });
    expect(image.statusCode).toBe(200);
    expect(image.headers['content-type']).toBe('image/png');
    expect(image.headers['cache-control']).toBe('no-store');
    expect(Buffer.from(image.rawPayload).equals(Buffer.from(TINY_PNG))).toBe(true);

    const used = await instance.inject({ method: 'POST', url: `${candidate.url}/use`, headers });
    expect(used.statusCode).toBe(201);
    const media = used.json().media as { id: number; briefKey: string };
    expect(media.briefKey).toBe('featured');
    expect(used.json().autoFeature).toMatchObject({ outcome: 'set' });

    const detail = (await instance.inject({ method: 'GET', url: `/api/jobs/${uuid}`, headers })).json();
    expect(detail.featuredMediaId).toBe(media.id);
    expect(detail.imageBriefs[0]).toMatchObject({ fulfilled: true, isFeatured: true, candidate: null });
  });

  it('POST /media 對上封面那條也回報自動設精選的結果', async () => {
    const instance = await build();
    const { uuid } = await jobWithBrief(instance);
    const res = await instance.inject({
      method: 'POST',
      url: `/api/jobs/${uuid}/media`,
      headers,
      payload: {
        filename: 'cover',
        mimeType: 'image/png',
        dataBase64: Buffer.from(TINY_PNG).toString('base64'),
        briefKey: 'featured',
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().autoFeature).toMatchObject({ outcome: 'set' });
    // 封面不放進正文（P5-T016）。
    expect(res.json().autoPlace).toBeNull();
  });

  it('POST /media 對上內文圖：回報自動放到錨點的結果（P5-T016）', async () => {
    const inline = { ...COVER, key: 'inline_one', placement: '第 1 段之後', anchor: '今天' };
    const instance = await build([
      new FakeAdapter('codex', 'Codex', {
        result: {
          ok: true,
          data: {
            title: '20260828',
            summary: '配圖',
            correctedSource: '',
            changes: [],
            observations: [],
            templateData: {},
            imageBriefs: [inline],
          },
          meta: { runId: 'x', agentId: 'codex', model: null, durationMs: 1, stderrTail: '' },
        },
        image: {},
      }),
    ]);
    const { uuid } = await jobWithBrief(instance);
    const res = await instance.inject({
      method: 'POST',
      url: `/api/jobs/${uuid}/media`,
      headers,
      payload: {
        filename: 'inline',
        mimeType: 'image/png',
        dataBase64: Buffer.from(TINY_PNG).toString('base64'),
        briefKey: 'inline_one',
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().autoPlace).toMatchObject({ outcome: 'placed', afterBlockIndex: 0 });
    expect(res.json().media).toMatchObject({ placed: true, placedAfterBlockIndex: 0 });
    const detail = (await instance.inject({ method: 'GET', url: `/api/jobs/${uuid}`, headers })).json();
    expect(detail.imageBriefs[0].anchor).toBe('今天');
  });

  it('候選圖編號不合法或不屬於這篇稿件：不給', async () => {
    const instance = await build();
    const { uuid } = await jobWithBrief(instance);
    const bad = await instance.inject({ method: 'GET', url: `/api/jobs/${uuid}/candidates/abc`, headers });
    expect(bad.statusCode).toBe(400);
    const missing = await instance.inject({ method: 'GET', url: `/api/jobs/${uuid}/candidates/9999`, headers });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().error.code).toBe('INVALID_INPUT');
  });
});
