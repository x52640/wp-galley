import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { buildApp } from '../src/server/app.js';
import { loadConfig } from '../src/config/env.js';
import { loadTemplateRegistry } from '../src/templates/registry.js';
import { loadPublishTargets } from '../src/wordpress/targets.js';
import { paths } from '../src/config/paths.js';
import { AgentRegistry } from '../src/agents/registry.js';
import { ContentChangedError } from '../src/core/errors.js';
import type { CoreService } from '../src/core/service.js';
import { approveJob, createCoreFixture, type CoreFixture } from './helpers/core-fixture.js';

/**
 * P5-T005：建立 revision 時帶 `expectedContentHash`，後端要真的比對。
 *
 * 情境是兩個面板（原稿、分類）各自從同一版抄了整份 templateData：先送的存進去，
 * 後送的那份如果不擋，會把先送的欄位悄悄蓋回去。
 */

const SOURCE = '今天讀完這本書，想到很多事。\n\n不是書裡寫的那些，而是別的。';
const BODY = '<p class="wp-block-paragraph">今天讀完這本書，想到很多事。</p>';
const headers = { host: '127.0.0.1:3000' };

let fixture: CoreFixture | null = null;
let app: FastifyInstance | null = null;

afterEach(async () => {
  await app?.close();
  await fixture?.cleanup();
  app = null;
  fixture = null;
});

async function setup(): Promise<CoreFixture> {
  fixture = await createCoreFixture();
  return fixture;
}

function newDiaryJob(core: CoreService): string {
  return core.createJob({ targetKey: 'diary', sourceText: SOURCE, title: '20260828' }).uuid;
}

function currentHash(core: CoreService, uuid: string): string {
  return core.getJob(uuid).currentRevision!.contentHash;
}

describe('createRevision 的 expectedContentHash', () => {
  it('帶對的 hash：照常建立新版本', async () => {
    const { core } = await setup();
    const uuid = newDiaryJob(core);
    const before = core.listRevisions(uuid).length;

    const revision = core.createRevision(uuid, {
      templateData: { title: '20260828', body: BODY },
      expectedContentHash: currentHash(core, uuid),
    });

    expect(core.listRevisions(uuid)).toHaveLength(before + 1);
    expect(currentHash(core, uuid)).toBe(revision.contentHash);
  });

  it('不帶 hash：照舊建立新版本', async () => {
    const { core } = await setup();
    const uuid = newDiaryJob(core);
    const before = core.listRevisions(uuid).length;

    core.createRevision(uuid, { templateData: { title: '20260828', body: BODY } });

    expect(core.listRevisions(uuid)).toHaveLength(before + 1);
  });

  it('帶錯的 hash：丟 ContentChangedError，什麼都不寫、核准也不動', async () => {
    const { core } = await setup();
    const uuid = newDiaryJob(core);
    approveJob(core, uuid);
    const revisionsBefore = core.listRevisions(uuid).length;
    const eventsBefore = core.listEvents(uuid).length;
    const hashBefore = currentHash(core, uuid);

    let caught: unknown;
    try {
      core.createRevision(uuid, {
        templateData: { title: '改過的標題', body: BODY },
        expectedContentHash: 'f'.repeat(64),
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ContentChangedError);
    expect((caught as ContentChangedError).code).toBe('CONTENT_CHANGED');
    expect(core.listRevisions(uuid)).toHaveLength(revisionsBefore);
    expect(core.listEvents(uuid)).toHaveLength(eventsBefore);
    expect(currentHash(core, uuid)).toBe(hashBefore);
    const detail = core.getJob(uuid);
    expect(detail.state).toBe('APPROVED');
    expect(detail.approval?.valid).toBe(true);
    expect(detail.title).toBe('20260828');
  });

  it('兩個面板從同一版出發：後送的被擋下，先送的修改留著', async () => {
    const { core } = await setup();
    const uuid = newDiaryJob(core);
    const base = core.getJob(uuid).currentRevision!;

    // 原稿面板先存：改了正文。
    core.createRevision(uuid, {
      templateData: { ...base.templateData, body: BODY },
      expectedContentHash: base.contentHash,
    });
    const afterFirst = core.getJob(uuid).currentRevision!;

    // 分類面板還拿著舊版的整份資料，送出時會把正文蓋回去——必須被擋下。
    expect(() =>
      core.createRevision(uuid, {
        templateData: { ...base.templateData, category: 'x' },
        expectedContentHash: base.contentHash,
      }),
    ).toThrow(ContentChangedError);

    expect(core.getJob(uuid).currentRevision!.contentHash).toBe(afterFirst.contentHash);
    expect(core.getJob(uuid).currentRevision!.templateData.body).toBe(BODY);
  });

  it('直接在文章上改（editedBody）帶錯的 hash 也擋', async () => {
    const { core } = await setup();
    const uuid = newDiaryJob(core);
    const before = core.listRevisions(uuid).length;

    expect(() =>
      core.createRevision(uuid, { editedBody: BODY, expectedContentHash: '0'.repeat(64) }),
    ).toThrow(ContentChangedError);
    expect(core.listRevisions(uuid)).toHaveLength(before);
  });
});

describe('POST /api/jobs/:uuid/revisions 的 expectedContentHash', () => {
  async function build(): Promise<{ instance: FastifyInstance; core: CoreService }> {
    const f = await setup();
    app = await buildApp({
      config: loadConfig({ APP_HOST: '127.0.0.1', APP_PORT: '3000', LOG_LEVEL: 'silent' }),
      db: f.db.handle,
      templates: await loadTemplateRegistry(paths.templates),
      agents: new AgentRegistry({ adapters: [] }),
      targets: await loadPublishTargets(join(paths.config, 'examples', 'remusplus.json')),
      core: f.core,
      wordpress: null,
    });
    await app.ready();
    return { instance: app, core: f.core };
  }

  it('帶錯的 hash 回 409 CONTENT_CHANGED，訊息叫人重新讀取', async () => {
    const { instance, core } = await build();
    const uuid = newDiaryJob(core);
    const before = core.listRevisions(uuid).length;

    const res = await instance.inject({
      method: 'POST',
      url: `/api/jobs/${uuid}/revisions`,
      headers,
      payload: { templateData: { title: '20260828', body: BODY }, expectedContentHash: 'a'.repeat(64) },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('CONTENT_CHANGED');
    expect(res.json().error.message).toContain('重新讀取');
    expect(core.listRevisions(uuid)).toHaveLength(before);
  });

  it('帶對的 hash 回 201', async () => {
    const { instance, core } = await build();
    const uuid = newDiaryJob(core);

    const res = await instance.inject({
      method: 'POST',
      url: `/api/jobs/${uuid}/revisions`,
      headers,
      payload: { templateData: { title: '20260828', body: BODY }, expectedContentHash: currentHash(core, uuid) },
    });

    expect(res.statusCode).toBe(201);
  });

  it('不帶 hash 回 201', async () => {
    const { instance, core } = await build();
    const uuid = newDiaryJob(core);

    const res = await instance.inject({
      method: 'POST',
      url: `/api/jobs/${uuid}/revisions`,
      headers,
      payload: { templateData: { title: '20260828', body: BODY } },
    });

    expect(res.statusCode).toBe(201);
  });

  it('hash 格式不對回 400', async () => {
    const { instance, core } = await build();
    const uuid = newDiaryJob(core);

    const res = await instance.inject({
      method: 'POST',
      url: `/api/jobs/${uuid}/revisions`,
      headers,
      payload: { templateData: { title: '20260828', body: BODY }, expectedContentHash: 'not-a-hash' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_FAILED');
  });
});
