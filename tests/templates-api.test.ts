import { describe, expect, it, afterAll, beforeAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server/app.js';
import { loadConfig } from '../src/config/env.js';
import { loadTemplateRegistry } from '../src/templates/registry.js';
import { paths } from '../src/config/paths.js';
import { createTestDatabase } from './helpers/test-db.js';

const db = createTestDatabase();
let app: FastifyInstance;
const headers = { host: '127.0.0.1:3000' };

beforeAll(async () => {
  app = await buildApp({
    config: loadConfig({ APP_HOST: '127.0.0.1', APP_PORT: '3000', LOG_LEVEL: 'silent' }),
    db: db.handle,
    templates: await loadTemplateRegistry(paths.templates),
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  db.cleanup();
});

describe('GET /api/templates', () => {
  it('列出模板的版本、內容類型與嚴格度', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/templates', headers });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.templates.map((t: { id: string }) => t.id).sort()).toEqual(['diary-v1', 'longform-v1']);
    const longform = body.templates.find((t: { id: string }) => t.id === 'longform-v1');
    expect(longform.contentType).toBe('longform');
    expect(longform.strictness).toBe('hybrid');
    expect(longform.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(longform.rules).toContain('h3');
  });
});

describe('POST /api/templates/:id/preview', () => {
  const body = { data: { title: '20260522', body: '<p class="wp-block-paragraph">內文</p>' } };

  it('回傳預覽文件、要發布的 HTML 與 hash', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/templates/diary-v1/preview',
      headers,
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    const result = res.json();
    expect(result.previewDocument).toMatch(/^<!doctype html>/i);
    expect(result.publishHtml).toBe('<p class="wp-block-paragraph">內文</p>');
    expect(result.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.templateHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('資料不合 schema 時回 422 並說明哪裡錯', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/templates/diary-v1/preview',
      headers,
      payload: { data: { title: '只有標題' } },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('TEMPLATE_VALIDATION_FAILED');
    expect(JSON.stringify(res.json().error.details)).toMatch(/body/);
  });

  it('長文用 h4 會被擋下並回報是哪條規則', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/templates/longform-v1/preview',
      headers,
      payload: { data: { title: '標題', body: '<h4>太細</h4><p>字</p>' } },
    });
    expect(res.statusCode).toBe(422);
    expect(JSON.stringify(res.json().error.details)).toContain('allowedHeadingLevels');
  });

  it('不存在的模板回 404', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/templates/nope-v1/preview',
      headers,
      payload: body,
    });
    expect(res.statusCode).toBe(404);
  });
});
