import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { approveJob, createCoreFixture, TINY_PNG, type CoreFixture } from './helpers/core-fixture.js';
import { PublishBlockedError } from '../src/core/errors.js';
import { FakeAdapter } from './helpers/fake-adapter.js';
import { InvalidInputError } from '../src/core/errors.js';
import { APP_PASSWORD_IN_CONTENT_MESSAGE } from '../src/core/service.js';
import { createMutableScrubber, type MutableScrubber } from '../src/config/secrets.js';
import { buildApp } from '../src/server/app.js';
import { loadConfig } from '../src/config/env.js';
import { loadTemplateRegistry } from '../src/templates/registry.js';
import { loadPublishTargets } from '../src/wordpress/targets.js';
import { paths } from '../src/config/paths.js';
import { AgentRegistry } from '../src/agents/registry.js';
import { createTestDatabase } from './helpers/test-db.js';

/**
 * 審查 #5（D-023，P5-T023）：使用者把目前設定的 WordPress 應用程式密碼貼進正文、校稿指示、
 * 或任何會送給 Agent 的地方——在儲存／派工時直接拒絕，錯誤訊息本身不含密碼。
 *
 * 一律用合成密碼、FakeAdapter、本機假 WordPress。
 */

const PASSWORD_BARE = 'Zq7vXk2mPa9LwR4tBn6cYd8e';
const PASSWORD_SPACED = 'Zq7v Xk2m Pa9L wR4t Bn6c Yd8e';
const SOURCE = '第一段：清晨出門。\n\n第二段：下午下雨。\n\n第三段：晚上寫字。';

let fixture: CoreFixture | null = null;
let app: FastifyInstance | null = null;
let db: ReturnType<typeof createTestDatabase> | null = null;

afterEach(async () => {
  await app?.close();
  await fixture?.cleanup();
  db?.cleanup();
  app = null;
  fixture = null;
  db = null;
});

function codex(): FakeAdapter {
  return new FakeAdapter('codex', 'Codex', {
    result: {
      ok: true,
      data: { title: 't', summary: 's', changes: [], observations: [], templateData: {}, imageBriefs: [] },
      meta: { runId: 'x', agentId: 'codex', model: null, durationMs: 1, stderrTail: '' },
    },
    image: {},
  });
}

/** 遮蔽器一開始就認得「去掉空白」的那個樣子（設定精靈存的就是這樣）。 */
async function setup(known: string[] = [PASSWORD_BARE]): Promise<{
  f: CoreFixture;
  agent: FakeAdapter;
  secrets: MutableScrubber;
}> {
  const agent = codex();
  const secrets = createMutableScrubber(known);
  fixture = await createCoreFixture({ adapters: [agent], scrub: secrets.scrub });
  return { f: fixture, agent, secrets };
}

function expectRejected(fn: () => unknown): void {
  let caught: unknown;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(InvalidInputError);
  const message = (caught as Error).message;
  expect(message).toBe(APP_PASSWORD_IN_CONTENT_MESSAGE);
  expect(message).not.toContain(PASSWORD_BARE);
  expect(JSON.stringify((caught as InvalidInputError).details ?? null)).not.toContain(PASSWORD_BARE);
}

async function expectRejectedAsync(promise: Promise<unknown>): Promise<void> {
  const caught = await promise.then(
    () => null,
    (error: unknown) => error,
  );
  expect(caught).toBeInstanceOf(InvalidInputError);
  expect((caught as Error).message).toBe(APP_PASSWORD_IN_CONTENT_MESSAGE);
}

function jobCount(f: CoreFixture): number {
  return (f.db.handle.prepare('SELECT COUNT(*) AS n FROM jobs').get() as { n: number }).n;
}

describe('建立與儲存：內容裡有密碼就整個拒絕', () => {
  it('原稿貼了密碼（WordPress 顯示的有空白樣子）→ 拒絕，不建 job', async () => {
    const { f } = await setup();
    expectRejected(() =>
      f.core.createJob({ targetKey: 'diary', sourceText: `密碼是 ${PASSWORD_SPACED} 記一下`, title: '20260828' }),
    );
    expect(jobCount(f)).toBe(0);
  });

  it('遮蔽器只認得有空白的樣子，貼的是沒空白的 → 一樣拒絕', async () => {
    const { f } = await setup([PASSWORD_SPACED]);
    expectRejected(() => f.core.createJob({ targetKey: 'diary', sourceText: `x${PASSWORD_BARE}x` }));
  });

  it('空白換成換行、tab、兩個空格也認得', async () => {
    const { f } = await setup();
    expectRejected(() =>
      f.core.createJob({ targetKey: 'diary', sourceText: 'Zq7v\nXk2m\tPa9L  wR4t Bn6c Yd8e' }),
    );
  });

  it('標題與 templateData 裡也算', async () => {
    const { f } = await setup();
    expectRejected(() => f.core.createJob({ targetKey: 'diary', sourceText: SOURCE, title: PASSWORD_BARE }));
    expectRejected(() =>
      f.core.createJob({ targetKey: 'diary', sourceText: '', templateData: { title: 't', body: `<p>${PASSWORD_BARE}</p>` } }),
    );
    expect(jobCount(f)).toBe(0);
  });

  it('直接在文章上改（editedBody）、整份 templateData、sourceText 都擋，版本數不變', async () => {
    const { f } = await setup();
    const uuid = f.core.createJob({ targetKey: 'diary', sourceText: SOURCE, title: '20260828' }).uuid;
    const before = f.core.listRevisions(uuid).length;
    expectRejected(() => f.core.createRevision(uuid, { editedBody: `<p>${PASSWORD_SPACED}</p>` }));
    expectRejected(() => f.core.createRevision(uuid, { templateData: { title: PASSWORD_BARE } }));
    expectRejected(() => f.core.createRevision(uuid, { sourceText: PASSWORD_BARE }));
    expect(f.core.listRevisions(uuid)).toHaveLength(before);
  });

  it('沒有密碼的內容照常存（不誤擋）', async () => {
    const { f } = await setup();
    const uuid = f.core.createJob({ targetKey: 'diary', sourceText: SOURCE, title: '20260828' }).uuid;
    expect(() => f.core.createRevision(uuid, { editedBody: '<p>Zq7v 只是四個字</p>' })).not.toThrow();
  });

  it('上傳圖片的替代文字、說明有密碼 → 拒絕，一個請求都沒送出', async () => {
    const { f } = await setup();
    const uuid = f.core.createJob({ targetKey: 'diary', sourceText: SOURCE, title: '20260828' }).uuid;
    await expectRejectedAsync(
      f.core.addMedia(uuid, { bytes: TINY_PNG, mimeType: 'image/png', filename: 'a', altText: PASSWORD_BARE }),
    );
    await expectRejectedAsync(
      f.core.addMedia(uuid, { bytes: TINY_PNG, mimeType: 'image/png', filename: 'a', caption: PASSWORD_SPACED }),
    );
    expect(f.requests).toHaveLength(0);
  });
});

describe('派工：送給 Agent 的東西裡有密碼就不派', () => {
  it('校稿指示有密碼 → 拒絕，Agent 沒被叫', async () => {
    const { f, agent } = await setup();
    const uuid = f.core.createJob({ targetKey: 'diary', sourceText: SOURCE, title: '20260828' }).uuid;
    await expectRejectedAsync(f.core.runAgentReview(uuid, { provider: 'codex', instruction: `幫我看 ${PASSWORD_BARE}` }));
    expect(agent.calls).toHaveLength(0);
    expect(f.core.getJob(uuid).agentRun ?? null).toBeNull();
  });

  it('密碼是之後才設定的（舊內容裡本來就有）→ 派工時照樣擋', async () => {
    const { f, agent, secrets } = await setup([]);
    const uuid = f.core.createJob({ targetKey: 'diary', sourceText: `舊稿 ${PASSWORD_BARE}`, title: '20260828' }).uuid;
    secrets.add([PASSWORD_BARE]);
    await expectRejectedAsync(f.core.runAgentReview(uuid, { provider: 'codex' }));
    await expectRejectedAsync(
      f.core.requestImageAtPosition(uuid, {
        afterBlockIndex: 0,
        contentHash: f.core.getJob(uuid).currentRevision!.contentHash,
      }),
    );
    expect(agent.calls).toHaveLength(0);
    expect(agent.imageCalls).toHaveLength(0);
  });

  it('請 AI 配一張的那句話有密碼 → 拒絕，不建需求、不生圖', async () => {
    const { f, agent } = await setup();
    const uuid = f.core.createJob({ targetKey: 'diary', sourceText: SOURCE, title: '20260828' }).uuid;
    await expectRejectedAsync(
      f.core.requestImageAtPosition(uuid, {
        afterBlockIndex: 0,
        contentHash: f.core.getJob(uuid).currentRevision!.contentHash,
        note: PASSWORD_SPACED,
      }),
    );
    expect((f.db.handle.prepare('SELECT COUNT(*) AS n FROM image_briefs').get() as { n: number }).n).toBe(0);
    expect(agent.imageCalls).toHaveLength(0);
  });
});

describe('舊內容（密碼設定前就存進去的）：核准、發布、上傳都擋', () => {
  async function legacy(): Promise<{ f: CoreFixture; secrets: MutableScrubber; uuid: string }> {
    const { f, secrets } = await setup([]);
    const uuid = f.core.createJob({ targetKey: 'diary', sourceText: `舊稿 ${PASSWORD_SPACED}`, title: '20260828' }).uuid;
    return { f, secrets, uuid };
  }

  it('核准 → 拒絕，狀態不變', async () => {
    const { f, secrets, uuid } = await legacy();
    f.core.render(uuid);
    f.core.getPreviewDocument(uuid);
    secrets.add([PASSWORD_BARE]);
    const state = f.core.getJob(uuid).state;
    expectRejected(() =>
      f.core.approve(uuid, { contentHash: f.core.getJob(uuid).currentRevision!.contentHash, actor: 'ui' }),
    );
    expect(f.core.getJob(uuid).state).toBe(state);
  });

  it('已經核准了才設定密碼 → 發布時擋，一個請求都沒送到 WordPress', async () => {
    const { f, secrets, uuid } = await legacy();
    approveJob(f.core, uuid);
    secrets.add([PASSWORD_BARE]);
    const caught = await f.core.publish(uuid, { status: 'draft' }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(caught).toBeInstanceOf(PublishBlockedError);
    expect((caught as Error).message).toBe(APP_PASSWORD_IN_CONTENT_MESSAGE);
    expect(f.requests).toHaveLength(0);
  });

  it('上傳圖片：送到 WordPress 之前就擋（不等上傳完才在建版本時擋）', async () => {
    const { f, secrets, uuid } = await legacy();
    secrets.add([PASSWORD_BARE]);
    await expectRejectedAsync(f.core.addMedia(uuid, { bytes: TINY_PNG, mimeType: 'image/png', filename: 'a' }));
    expect(f.requests).toHaveLength(0);
  });

  it('換圖：送到 WordPress 之前就擋', async () => {
    const { f, secrets, uuid } = await legacy();
    const asset = await f.core.addMedia(uuid, { bytes: TINY_PNG, mimeType: 'image/png', filename: 'a' });
    secrets.add([PASSWORD_BARE]);
    const before = f.requests.length;
    await expectRejectedAsync(f.core.replaceMedia(uuid, asset.id, { bytes: TINY_PNG, mimeType: 'image/png', filename: 'b' }));
    expect(f.requests).toHaveLength(before);
  });
});

describe('HTTP：回 400，訊息與 log 都不含密碼', () => {
  it('POST /api/jobs 貼了密碼', async () => {
    db = createTestDatabase();
    const lines: string[] = [];
    app = await buildApp({
      config: loadConfig({
        APP_HOST: '127.0.0.1',
        APP_PORT: '3000',
        LOG_LEVEL: 'info',
        WORDPRESS_URL: 'https://example.test',
        WORDPRESS_USERNAME: 'tester',
        WORDPRESS_APP_PASSWORD: PASSWORD_SPACED,
      }),
      db: db.handle,
      templates: await loadTemplateRegistry(paths.templates),
      agents: new AgentRegistry({ adapters: [] }),
      targets: await loadPublishTargets(join(paths.config, 'examples', 'remusplus.json')),
      logStream: { write: (line) => void lines.push(line) },
    });
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/api/jobs',
      headers: { host: '127.0.0.1:3000' },
      payload: { targetKey: 'diary', sourceText: `我的密碼 ${PASSWORD_BARE}` },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toBe(APP_PASSWORD_IN_CONTENT_MESSAGE);
    expect(res.body).not.toContain(PASSWORD_BARE);
    const log = lines.join('');
    expect(log).not.toContain(PASSWORD_BARE);
    expect(log).not.toContain(PASSWORD_SPACED);
  });
});
