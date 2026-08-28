import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CoreService } from '../../src/core/service.js';
import { AgentRegistry } from '../../src/agents/registry.js';
import { WordPressClient } from '../../src/wordpress/client.js';
import { loadPublishTargets, type PublishTargetRegistry } from '../../src/wordpress/targets.js';
import { loadTemplateRegistry } from '../../src/templates/registry.js';
import { paths } from '../../src/config/paths.js';
import { createTestDatabase, type TestDatabase } from './test-db.js';
import { startMockWordPress, type MockResponse, type MockWordPress, type RecordedRequest } from './mock-wordpress.js';
import type { AgentAdapter } from '../../src/agents/types.js';

/**
 * 階段 5 的測試腳手架。
 *
 * 兩條紅線在這裡實現：**絕不呼叫真實 Agent CLI**（一律 FakeAdapter），
 * **絕不連真實 WordPress**（一律 startMockWordPress 起的本機假站台）。
 */

const APP_PASSWORD = 'test PASSWORD 1234 abcd';

export interface CoreFixture {
  readonly core: CoreService;
  readonly db: TestDatabase;
  readonly mock: MockWordPress | null;
  readonly requests: RecordedRequest[];
  cleanup(): Promise<void>;
}

export interface CoreFixtureOptions {
  /** 不給就用預設的假站台；給 null 代表「WordPress 未設定」。 */
  readonly wordpress?: 'mock' | 'none';
  readonly adapters?: AgentAdapter[];
  readonly handler?: (request: RecordedRequest, index: number) => MockResponse;
  /** 測發布前置檢查用：換成開關不同的 target。 */
  readonly targets?: PublishTargetRegistry;
}

/** 預設的假 WordPress：接受媒體上傳、建立與更新文章、列出分類項目。 */
export function defaultWordPressHandler(): (request: RecordedRequest) => MockResponse {
  let nextMediaId = 900;
  let nextPostId = 500;
  const posts = new Map<number, Record<string, unknown>>();

  return (request) => {
    const path = request.path.split('?')[0] ?? '';

    if (path === '/wp-json/wp/v2/media') {
      nextMediaId += 1;
      return {
        status: 201,
        body: {
          id: nextMediaId,
          source_url: `https://example.test/wp-content/uploads/${nextMediaId}.png`,
          mime_type: 'image/png',
          media_type: 'image',
          alt_text: '',
          title: { raw: 'upload', rendered: 'upload' },
        },
      };
    }

    const mediaMatch = /^\/wp-json\/wp\/v2\/media\/(\d+)$/.exec(path);
    if (mediaMatch) {
      const id = Number(mediaMatch[1]);
      return {
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

    // 分類項目：永遠回空陣列，讓 resolveTerms 把名稱歸類到 unknown。
    if (path === '/wp-json/wp/v2/diary-category' || path === '/wp-json/wp/v2/read-think-tag') {
      return { body: [], headers: { 'X-WP-TotalPages': '1' } };
    }

    const collection = /^\/wp-json\/wp\/v2\/(diary|read-think)$/.exec(path);
    if (collection && request.method === 'POST') {
      nextPostId += 1;
      const payload = JSON.parse(request.body || '{}') as Record<string, unknown>;
      const post = {
        id: nextPostId,
        status: 'draft',
        link: `https://example.test/?p=${nextPostId}`,
        slug: String(payload['slug'] ?? `post-${nextPostId}`),
        title: { raw: String(payload['title'] ?? ''), rendered: String(payload['title'] ?? '') },
        content: { raw: String(payload['content'] ?? ''), rendered: String(payload['content'] ?? '') },
        featured_media: Number(payload['featured_media'] ?? 0),
        date_gmt: '2026-08-28T00:00:00',
        modified_gmt: '2026-08-28T00:00:00',
      };
      posts.set(nextPostId, post);
      return { status: 201, body: post };
    }

    const single = /^\/wp-json\/wp\/v2\/(?:diary|read-think)\/(\d+)$/.exec(path);
    if (single) {
      const id = Number(single[1]);
      const existing = posts.get(id) ?? {
        id,
        status: 'draft',
        link: `https://example.test/?p=${id}`,
        slug: `post-${id}`,
        title: { raw: '', rendered: '' },
        content: { raw: '', rendered: '' },
        featured_media: 0,
        date_gmt: '2026-08-28T00:00:00',
        modified_gmt: '2026-08-28T00:00:00',
      };
      if (request.method === 'POST') {
        const payload = JSON.parse(request.body || '{}') as Record<string, unknown>;
        const merged = {
          ...existing,
          ...(payload['status'] === undefined ? {} : { status: String(payload['status']) }),
          ...(payload['content'] === undefined
            ? {}
            : { content: { raw: String(payload['content']), rendered: String(payload['content']) } }),
        };
        posts.set(id, merged);
        return { body: merged };
      }
      posts.set(id, existing);
      return { body: existing };
    }

    return { status: 404, body: { code: 'rest_no_route', message: '找不到端點', data: { status: 404 } } };
  };
}

export async function createCoreFixture(options: CoreFixtureOptions = {}): Promise<CoreFixture> {
  const db = createTestDatabase();
  const workDir = mkdtempSync(join(tmpdir(), 'wp-publisher-core-'));

  let mock: MockWordPress | null = null;
  let client: WordPressClient | null = null;

  if (options.wordpress !== 'none') {
    mock = await startMockWordPress(options.handler ?? defaultWordPressHandler());
    client = new WordPressClient({
      baseUrl: mock.url,
      username: 'tester',
      appPassword: APP_PASSWORD,
      maxRetries: 0,
      sleepImpl: async () => undefined,
    });
  }

  const core = new CoreService({
    db: db.handle,
    templates: await loadTemplateRegistry(paths.templates),
    targets: options.targets ?? (await loadPublishTargets(join(paths.config, 'publish-targets.json'))),
    agents: new AgentRegistry({ adapters: options.adapters ?? [] }),
    wordpress: client,
    draftsDir: join(workDir, 'drafts'),
    mediaDir: join(workDir, 'media'),
  });

  return {
    core,
    db,
    mock,
    requests: mock?.requests ?? [],
    cleanup: async () => {
      await mock?.close();
      db.cleanup();
      rmSync(workDir, { recursive: true, force: true });
    },
  };
}

/** 1×1 的 PNG，用來測上傳流程。內容是什麼不重要，只要是合法位元組。 */
export const TINY_PNG = new Uint8Array(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ),
);

/** 走完「渲染 → 預覽 → 核准」，讓測試可以直接進到發布那一步。 */
export function approveJob(core: CoreService, uuid: string): string {
  core.render(uuid);
  core.getPreviewDocument(uuid);
  const detail = core.getJob(uuid);
  const hash = detail.currentRevision!.contentHash;
  core.approve(uuid, { contentHash: hash, actor: 'ui' });
  return hash;
}
