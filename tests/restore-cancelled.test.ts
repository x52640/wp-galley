import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { buildApp } from '../src/server/app.js';
import { loadConfig } from '../src/config/env.js';
import { loadTemplateRegistry } from '../src/templates/registry.js';
import { loadPublishTargets } from '../src/wordpress/targets.js';
import { paths } from '../src/config/paths.js';
import { AgentRegistry } from '../src/agents/registry.js';
import { InvalidTransitionError, type JobState } from '../src/core/state-machine.js';
import type { CoreService } from '../src/core/service.js';
import { approveJob, createCoreFixture, type CoreFixture } from './helpers/core-fixture.js';

/**
 * 已取消的稿件可以恢復（D-031，P5-T030）。
 *
 * 規則在 docs/specs/state-machine.md「恢復已取消的稿件」：回到取消前的狀態，
 * 取消前是 APPROVED 的回 RENDERED（核准不復活），記不到就回 SOURCE。
 */

const SOURCE = '今天讀完這本書，想到很多事。\n\n不是書裡寫的那些，而是別的。';
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

function newJob(core: CoreService): string {
  return core.createJob({ targetKey: 'diary', sourceText: SOURCE, title: '20260930' }).uuid;
}

/** 走不到的狀態（REVIEWED、MEDIA_READY 要跑 Agent）直接改 DB；這裡測的是恢復規則，不是怎麼走到那裡。 */
function forceState(f: CoreFixture, uuid: string, state: JobState): void {
  f.db.handle.prepare('UPDATE jobs SET state = ? WHERE uuid = ?').run(state, uuid);
}

/** 把最近一筆取消事件的 detail 換掉，模擬本 Task 之前取消的（沒記）或壞掉的紀錄。 */
function setCancelDetail(f: CoreFixture, uuid: string, detailJson: string | null): void {
  f.db.handle
    .prepare(`
      UPDATE publish_events SET detail_json = ?
      WHERE id = (
        SELECT e.id FROM publish_events e JOIN jobs j ON j.id = e.job_id
        WHERE j.uuid = ? AND e.event_type = 'job_cancelled' ORDER BY e.id DESC LIMIT 1
      )
    `)
    .run(detailJson, uuid);
}

describe('取消時記下取消前的狀態', () => {
  it('job_cancelled 事件的 detail 有 fromState', async () => {
    const { core } = await setup();
    const uuid = newJob(core);
    core.render(uuid);
    core.cancelJob(uuid);
    const event = core.listEvents(uuid).find((e) => e.eventType === 'job_cancelled');
    expect(event?.detail).toEqual({ fromState: 'RENDERED' });
  });
});

describe('恢復回到哪裡', () => {
  it.each(['SOURCE', 'REVIEWED', 'MEDIA_READY', 'RENDERED', 'PREVIEWED'] as JobState[])(
    '取消前是 %s → 回到 %s',
    async (state) => {
      const f = await setup();
      const uuid = newJob(f.core);
      forceState(f, uuid, state);
      f.core.cancelJob(uuid);
      expect(f.core.restoreJob(uuid).state).toBe(state);
      expect(f.core.getJob(uuid).state).toBe(state);
    },
  );

  it('取消前是 APPROVED → 回 RENDERED，核准維持撤銷、要重新核准', async () => {
    const { core } = await setup();
    const uuid = newJob(core);
    approveJob(core, uuid);
    expect(core.getJob(uuid).approval).not.toBeNull();

    core.cancelJob(uuid);
    expect(core.restoreJob(uuid).state).toBe('RENDERED');

    const detail = core.getJob(uuid);
    // 章還看得到，但已經撕掉；資料庫裡也沒有任何未撤銷的核准。
    expect(detail.approval?.valid).toBe(false);
    expect(fixture!.db.handle.prepare('SELECT COUNT(*) AS n FROM approvals WHERE revoked_at IS NULL').get()).toEqual({ n: 0 });
    expect(detail.blockers).toContain('還沒看過校樣，開啟預覽後才能核准');
    // 重新走一次就能再核准。
    core.getPreviewDocument(uuid);
    const hash = core.getJob(uuid).currentRevision!.contentHash;
    expect(core.approve(uuid, { contentHash: hash, actor: 'ui' }).contentHash).toBe(hash);
  });

  it.each([
    ['沒有記錄（本 Task 之前取消的）', null],
    ['detail 解析不了', '{壞掉'],
    ['沒有 fromState', '{}'],
    ['fromState 不是字串', '{"fromState":3}'],
    ['fromState 不是合法狀態', '{"fromState":"NOPE"}'],
    ['fromState 是終止狀態', '{"fromState":"CANCELLED"}'],
    ['fromState 是發布中', '{"fromState":"PUBLISHING"}'],
    ['fromState 是已發布', '{"fromState":"PUBLISHED"}'],
  ])('%s → 回 SOURCE', async (_label, detailJson) => {
    const f = await setup();
    const uuid = newJob(f.core);
    f.core.render(uuid);
    f.core.cancelJob(uuid);
    setCancelDetail(f, uuid, detailJson);
    expect(f.core.restoreJob(uuid).state).toBe('SOURCE');
  });

  it('取消好幾次：照最近那一次的 fromState', async () => {
    const { core } = await setup();
    const uuid = newJob(core);
    core.cancelJob(uuid); // 第一次：SOURCE
    core.restoreJob(uuid);
    core.render(uuid);
    core.cancelJob(uuid); // 第二次：RENDERED
    expect(core.restoreJob(uuid).state).toBe('RENDERED');
  });

  it('記一筆 job_restored 事件（actor ui，detail 有目標狀態）', async () => {
    const { core } = await setup();
    const uuid = newJob(core);
    core.render(uuid);
    core.cancelJob(uuid);
    core.restoreJob(uuid);
    const event = core.listEvents(uuid).find((e) => e.eventType === 'job_restored');
    expect(event).toMatchObject({ actor: 'ui', status: 'succeeded', detail: { toState: 'RENDERED' } });
  });
});

describe('只有 CANCELLED 能恢復', () => {
  it.each(['SOURCE', 'RENDERED', 'PREVIEWED', 'APPROVED', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'SUPERSEDED'] as JobState[])(
    '%s 恢復被拒，狀態不變、不記事件',
    async (state) => {
      const f = await setup();
      const uuid = newJob(f.core);
      forceState(f, uuid, state);
      expect(() => f.core.restoreJob(uuid)).toThrow(InvalidTransitionError);
      expect(f.core.getJob(uuid).state).toBe(state);
      expect(f.core.listEvents(uuid).some((e) => e.eventType === 'job_restored')).toBe(false);
    },
  );
});

describe('恢復之前：CANCELLED 照舊不能改、不能發布', () => {
  it('渲染不會把 CANCELLED 推回 RENDERED（轉移表有這條邊，但只給恢復用）', async () => {
    const { core } = await setup();
    const uuid = newJob(core);
    core.cancelJob(uuid);
    expect(core.render(uuid).state).toBe('CANCELLED');
    expect(core.getJob(uuid).state).toBe('CANCELLED');
    core.getPreviewDocument(uuid);
    expect(core.getJob(uuid).state).toBe('CANCELLED');
  });

  it('不能改內容、有發布 blocker、發布被拒且一個請求都不送', async () => {
    const f = await setup();
    const uuid = newJob(f.core);
    approveJob(f.core, uuid);
    f.core.cancelJob(uuid);

    expect(() => f.core.createRevision(uuid, { reason: '再改' })).toThrow(/不能再改內容/);
    expect(f.core.getJob(uuid).blockers).toContain('工作項目已經是 CANCELLED，不能再發布');

    const before = f.requests.length;
    await expect(f.core.publish(uuid, { status: 'draft' })).rejects.toThrow();
    expect(f.requests.length).toBe(before);
    expect(f.core.getJob(uuid).state).toBe('CANCELLED');
  });

  it('清單裡仍是 CANCELLED（總覽照狀態分到「已結束」）', async () => {
    const { core } = await setup();
    const uuid = newJob(core);
    core.cancelJob(uuid);
    expect(core.listJobs({ state: ['CANCELLED'] }).map((job) => job.uuid)).toEqual([uuid]);
  });
});

describe('恢復之後能繼續編輯', () => {
  it('可以建新版本，也可以再取消', async () => {
    const { core } = await setup();
    const uuid = newJob(core);
    core.cancelJob(uuid);
    core.restoreJob(uuid);
    const revision = core.createRevision(uuid, { editedBody: '<p class="wp-block-paragraph">恢復後再寫一段。</p>' });
    expect(revision.number).toBe(2);
    expect(core.cancelJob(uuid).state).toBe('CANCELLED');
  });
});

describe('POST /api/jobs/:uuid/restore', () => {
  async function build(): Promise<FastifyInstance> {
    fixture = await createCoreFixture();
    app = await buildApp({
      config: loadConfig({ APP_HOST: '127.0.0.1', APP_PORT: '3000', LOG_LEVEL: 'silent' }),
      db: fixture.db.handle,
      templates: await loadTemplateRegistry(paths.templates),
      agents: new AgentRegistry({ adapters: [] }),
      targets: await loadPublishTargets(join(paths.config, 'examples', 'remusplus.json')),
      core: fixture.core,
      wordpress: null,
    });
    await app.ready();
    return app;
  }

  it('恢復已取消的稿件，回 JobResponse', async () => {
    const instance = await build();
    const uuid = newJob(fixture!.core);
    fixture!.core.render(uuid);
    await instance.inject({ method: 'DELETE', url: `/api/jobs/${uuid}`, headers });

    const res = await instance.inject({ method: 'POST', url: `/api/jobs/${uuid}/restore`, headers });
    expect(res.statusCode).toBe(200);
    expect(res.json().job).toMatchObject({ uuid, state: 'RENDERED' });
  });

  it('沒取消的稿件 → 409 INVALID_TRANSITION', async () => {
    const instance = await build();
    const uuid = newJob(fixture!.core);
    const res = await instance.inject({ method: 'POST', url: `/api/jobs/${uuid}/restore`, headers });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('INVALID_TRANSITION');
  });

  it('找不到稿件 → 404', async () => {
    const instance = await build();
    const res = await instance.inject({ method: 'POST', url: '/api/jobs/no-such-job/restore', headers });
    expect(res.statusCode).toBe(404);
  });

  it('從別的網站送來的 → 403，稿件維持取消', async () => {
    const instance = await build();
    const uuid = newJob(fixture!.core);
    fixture!.core.cancelJob(uuid);
    const res = await instance.inject({
      method: 'POST',
      url: `/api/jobs/${uuid}/restore`,
      headers: { ...headers, origin: 'https://evil.example' },
    });
    expect(res.statusCode).toBe(403);
    expect(fixture!.core.getJob(uuid).state).toBe('CANCELLED');
  });
});
