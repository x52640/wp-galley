import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { createCoreFixture, type CoreFixture } from './helpers/core-fixture.js';
import { FakeAdapter } from './helpers/fake-adapter.js';
import { createFakeFetcher } from './helpers/fake-fetcher.js';
import { buildApp, realFactCheckFetcher } from '../src/server/app.js';
import { loadConfig } from '../src/config/env.js';
import { loadTemplateRegistry } from '../src/templates/registry.js';
import { loadPublishTargets } from '../src/wordpress/targets.js';
import { paths } from '../src/config/paths.js';
import { AgentRegistry } from '../src/agents/registry.js';
import { FACTCHECK_FIND_SCHEMA, FACTCHECK_JUDGE_SCHEMA } from '../src/agents/output-contract.js';
import type { FactCheckListResponse, FactCheckRunResult, JobDetail } from '../src/contract/api.js';

/**
 * AI 查證的 HTTP 路由（P6-T004；docs/specs/http-api.md）。假 adapter＋假取回器，不連網路、不呼叫真實 CLI。
 */

const BODY =
  '<p class="wp-block-paragraph">這部片 1995 年上映。</p><p class="wp-block-paragraph">導演是法蘭克·達拉邦特。</p>';
const WIKI = '刺激1995是1994年的美國電影。本片於1994年9月10日在多倫多國際電影節首映。';

let fixture: CoreFixture | null = null;
let app: FastifyInstance | null = null;

afterEach(async () => {
  await app?.close();
  await fixture?.cleanup();
  app = null;
  fixture = null;
});

async function build(onRun?: (call: number) => void): Promise<{ app: FastifyInstance; uuid: string; adapter: FakeAdapter }> {
  const fetcher = createFakeFetcher({ wikipedia: { 'zh:刺激1995': { title: '刺激1995', text: WIKI } } });
  const adapter: FakeAdapter = new FakeAdapter('claude', 'Claude', {
    hostedSearch: true,
    respond: ({ schema }) => {
      if (schema === FACTCHECK_FIND_SCHEMA) {
        return {
          data: {
            claims: [{ excerpt: '這部片 1995 年上映', claim: '1995 年上映', queries: [{ q: '刺激1995', lang: 'zh' }], candidateUrls: [] }],
          },
        };
      }
      if (schema === FACTCHECK_JUDGE_SCHEMA) {
        return {
          data: {
            findings: [
              {
                claimIndex: 0,
                verdict: 'contradicted',
                evidence: '1994',
                citations: [{ ref: 'S1', quote: '本片於1994年9月10日在多倫多國際電影節首映' }],
              },
            ],
          },
        };
      }
      return { data: {} };
    },
    onRun: () => onRun?.(adapter.calls.length),
  });
  fixture = await createCoreFixture({ adapters: [adapter], factCheckFetcher: fetcher.factory });
  const uuid = fixture.core.createJob({ targetKey: 'read-think', sourceText: '一段。', title: '刺激1995' }).uuid;
  fixture.core.createRevision(uuid, { editedBody: BODY });
  app = await buildApp({
    config: loadConfig({ APP_HOST: '127.0.0.1', APP_PORT: '3000', LOG_LEVEL: 'silent' }),
    db: fixture.db.handle,
    templates: await loadTemplateRegistry(paths.templates),
    agents: new AgentRegistry({ adapters: [adapter] }),
    targets: await loadPublishTargets(join(paths.config, 'examples', 'remusplus.json')),
    core: fixture.core,
    wordpress: null,
  });
  await app.ready();
  return { app, uuid, adapter };
}

describe('POST /api/jobs/:uuid/factchecks', () => {
  it('跑完回 200 { run, findings }；GET 讀得到、JobDetail 帶提醒條數', async () => {
    const { app, uuid } = await build();
    const res = await app.inject({ method: 'POST', url: `/api/jobs/${uuid}/factchecks`, payload: { provider: 'claude', scope: 'article' } });
    expect(res.statusCode).toBe(200);
    const body = res.json<FactCheckRunResult>();
    expect(body.run).toMatchObject({ status: 'succeeded', scope: 'article', provider: 'claude' });
    expect(body.findings[0]).toMatchObject({ verdict: 'contradicted', blockIndex: 0 });

    const list = await app.inject({ method: 'GET', url: `/api/jobs/${uuid}/factchecks` });
    expect(list.statusCode).toBe(200);
    expect(list.json<FactCheckListResponse>()).toMatchObject({ openContradictions: 1, latestRun: { id: body.run.id } });

    const detail = (await app.inject({ method: 'GET', url: `/api/jobs/${uuid}` })).json<JobDetail>();
    expect(detail.openFactCheckContradictions).toBe(1);
    expect(detail.agentRun).toMatchObject({ task: 'factcheck', status: 'succeeded' });
    // 不是 blocker。
    expect(detail.blockers.join('')).not.toContain('查證');
  });

  it.each([
    ['scope 錯誤', { provider: 'claude', scope: 'paragraph' }],
    ['選字查證沒給 selection', { provider: 'claude', scope: 'selection' }],
    ['整篇查證卻給 selection', { provider: 'claude', scope: 'article', selection: '這部片 1995 年上映' }],
    ['觀察卡片沒給編號', { provider: 'claude', scope: 'observation' }],
    ['多送欄位', { provider: 'claude', scope: 'article', excerpt: 'x' }],
    ['provider 錯誤', { provider: 'gpt', scope: 'article' }],
  ])('%s → 400', async (_label, payload) => {
    const { app, uuid, adapter } = await build();
    const res = await app.inject({ method: 'POST', url: `/api/jobs/${uuid}/factchecks`, payload });
    expect(res.statusCode).toBe(400);
    expect(adapter.calls).toHaveLength(0);
  });

  it('選字找不到、觀察卡片不存在 → 400 INVALID_INPUT', async () => {
    const { app, uuid, adapter } = await build();
    const missing = await app.inject({
      method: 'POST',
      url: `/api/jobs/${uuid}/factchecks`,
      payload: { provider: 'claude', scope: 'selection', selection: '文章裡沒有這一句' },
    });
    expect(missing.statusCode).toBe(400);
    expect(missing.json<{ error: { code: string } }>().error.code).toBe('INVALID_INPUT');
    const card = await app.inject({
      method: 'POST',
      url: `/api/jobs/${uuid}/factchecks`,
      payload: { provider: 'claude', scope: 'observation', observationItemId: 4242 },
    });
    expect(card.statusCode).toBe(400);
    expect(card.json<{ error: { code: string } }>().error.code).toBe('INVALID_INPUT');
    expect(adapter.calls).toHaveLength(0);
  });

  it('觀察卡片種類不對 → 400', async () => {
    const { app, uuid } = await build();
    // 塞一份含 gap 觀察的提案（不經過 Agent）。
    const db = fixture!.db.handle;
    const jobId = (db.prepare('SELECT id FROM jobs WHERE uuid = ?').get(uuid) as { id: number }).id;
    const rev = db.prepare('SELECT id, content_hash FROM revisions WHERE job_id = ? ORDER BY id DESC').get(jobId) as {
      id: number;
      content_hash: string;
    };
    db.prepare(
      "INSERT INTO review_proposals (id, job_id, base_revision_id, base_content_hash, provider, proposed_data_json, status) VALUES (77, ?, ?, ?, 'claude', '{}', 'open')",
    ).run(jobId, rev.id, rev.content_hash);
    db.prepare(
      "INSERT INTO review_items (id, proposal_id, ordinal, item_type, state, payload_json) VALUES (88, 77, 0, 'observation', 'pending', ?)",
    ).run(JSON.stringify({ kind: 'gap', blockIndex: 0, excerpt: '這部片 1995 年上映', detail: 'd', suggestion: 's' }));
    const res = await app.inject({
      method: 'POST',
      url: `/api/jobs/${uuid}/factchecks`,
      payload: { provider: 'claude', scope: 'observation', observationItemId: 88 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: { message: string } }>().error.message).toContain('不能查證');
  });

  it('跨站一律 403（POST、GET、DELETE）', async () => {
    const { app, uuid, adapter } = await build();
    const headers = { 'sec-fetch-site': 'cross-site' };
    for (const req of [
      { method: 'POST' as const, url: `/api/jobs/${uuid}/factchecks`, payload: { provider: 'claude', scope: 'article' } },
      { method: 'GET' as const, url: `/api/jobs/${uuid}/factchecks` },
      { method: 'DELETE' as const, url: `/api/jobs/${uuid}/factchecks/1` },
    ]) {
      const res = await app.inject({ ...req, headers });
      expect(res.statusCode, `${req.method} ${req.url}`).toBe(403);
    }
    expect(adapter.calls).toHaveLength(0);
  });

  it('另一個查證在跑時再發起 → 502 AGENT_ERROR；停止走 DELETE /agent', async () => {
    let second: { statusCode: number; json: () => unknown } | null = null;
    let cancelled: number | null = null;
    const ctx: { app?: FastifyInstance; uuid?: string } = {};
    const built = await build(async (call) => {
      if (call !== 1) return;
      const res = await ctx.app!.inject({
        method: 'POST',
        url: `/api/jobs/${ctx.uuid}/factchecks`,
        payload: { provider: 'claude', scope: 'article' },
      });
      second = res;
      cancelled = (await ctx.app!.inject({ method: 'DELETE', url: `/api/jobs/${ctx.uuid}/agent` })).statusCode;
    });
    ctx.app = built.app;
    ctx.uuid = built.uuid;
    const res = await built.app.inject({ method: 'POST', url: `/api/jobs/${built.uuid}/factchecks`, payload: { provider: 'claude', scope: 'article' } });
    expect(second!.statusCode).toBe(502);
    expect(cancelled).toBe(200);
    expect(res.statusCode).toBe(502);
    expect(res.json<{ error: { message: string } }>().error.message).toContain('已停止');
    const list = (await built.app.inject({ method: 'GET', url: `/api/jobs/${built.uuid}/factchecks` })).json<FactCheckListResponse>();
    expect(list.findings).toHaveLength(0);
    expect(list.latestRun?.status).toBe('cancelled');
  });
});

describe('DELETE /api/jobs/:uuid/factchecks/:id', () => {
  it('知道了 → { dismissed: true }；不存在 400；編號不合法 400', async () => {
    const { app, uuid } = await build();
    const run = (
      await app.inject({ method: 'POST', url: `/api/jobs/${uuid}/factchecks`, payload: { provider: 'claude', scope: 'article' } })
    ).json<FactCheckRunResult>();
    const id = run.findings[0]!.id;
    const res = await app.inject({ method: 'DELETE', url: `/api/jobs/${uuid}/factchecks/${id}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ dismissed: true });
    expect((await app.inject({ method: 'DELETE', url: `/api/jobs/${uuid}/factchecks/999` })).statusCode).toBe(400);
    expect((await app.inject({ method: 'DELETE', url: `/api/jobs/${uuid}/factchecks/abc` })).statusCode).toBe(400);
  });

  it('POST /revisions 帶 resolveFactCheckId：去原文改之後結案', async () => {
    const { app, uuid } = await build();
    const run = (
      await app.inject({ method: 'POST', url: `/api/jobs/${uuid}/factchecks`, payload: { provider: 'claude', scope: 'article' } })
    ).json<FactCheckRunResult>();
    const res = await app.inject({
      method: 'POST',
      url: `/api/jobs/${uuid}/revisions`,
      payload: { editedBody: BODY.replace('1995', '1994'), resolveFactCheckId: run.findings[0]!.id },
    });
    expect(res.statusCode).toBe(201);
    const list = (await app.inject({ method: 'GET', url: `/api/jobs/${uuid}/factchecks` })).json<FactCheckListResponse>();
    expect(list.findings[0]!.status).toBe('resolved-by-edit');
  });
});

describe('正式的取回器', () => {
  it('realFactCheckFetcher 建得出取回器（不發任何請求）', () => {
    const fetcher = realFactCheckFetcher('9.9.9')({
      articleText: '文章',
      containsSecret: () => false,
      signal: new AbortController().signal,
    });
    expect(typeof fetcher.fetchUrl).toBe('function');
  });
});
