import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createCoreFixture, type CoreFixture } from './helpers/core-fixture.js';
import { FakeAdapter } from './helpers/fake-adapter.js';
import { AgentRegistry } from '../src/agents/registry.js';
import { CoreService } from '../src/core/service.js';
import { loadTemplateRegistry } from '../src/templates/registry.js';
import { loadPublishTargets } from '../src/wordpress/targets.js';
import { paths } from '../src/config/paths.js';
import type { AgentAdapter } from '../src/agents/types.js';

/**
 * Agent 執行的生命週期（P5-T020，審查 #11、#12）。
 *
 * - 重啟：記憶體裡的 activeRuns 沒了，DB 的 agent_runs 卻還是 running。用「同一個 DB 再建一個
 *   CoreService」模擬後端重啟。
 * - 排隊中取消：concurrency 1 的佇列裡還沒輪到就被取消的校稿，輪到時不能再叫 adapter（花額度）。
 *
 * 一律 FakeAdapter，絕不呼叫真實 CLI。
 */

const SOURCE = '今天讀完這本書，想到很多事。\n\n不是書裡寫的那些，而是別的。';
const RESTART_MESSAGE = '後端重啟，這次沒有完成';

const BRIEFS_RESULT = {
  ok: true as const,
  data: {
    title: '20260828',
    summary: '配圖建議',
    correctedSource: '（略）',
    changes: [],
    observations: [],
    templateData: { title: '20260828', body: '<p class="wp-block-paragraph">x</p>' },
    imageBriefs: [
      {
        key: 'rainy_crossing',
        purpose: '第二段的雨天路口',
        prompt: '雨天路口積水反射紅色招牌',
        aspectRatio: '4:3',
        altText: '雨天路口的積水',
        placement: '第 2 段之後',
      },
    ],
  },
  meta: { runId: 'fake', agentId: 'codex' as const, model: null, durationMs: 1, stderrTail: '' },
};

let fixture: CoreFixture | null = null;

afterEach(async () => {
  await fixture?.cleanup();
  fixture = null;
});

function newJob(core: CoreService): string {
  return core.createJob({ targetKey: 'diary', sourceText: SOURCE, title: '20260828' }).uuid;
}

/** 同一個 DB 再建一個 CoreService：等於後端重啟（記憶體全清，DB 還在）。 */
async function restart(f: CoreFixture, adapters: AgentAdapter[]): Promise<CoreService> {
  return new CoreService({
    db: f.db.handle,
    templates: await loadTemplateRegistry(paths.templates),
    targets: await loadPublishTargets(join(paths.config, 'examples', 'remusplus.json')),
    agents: new AgentRegistry({ adapters }),
    wordpress: null,
    dataDir: f.db.dir,
    draftsDir: join(f.db.dir, 'drafts'),
    mediaDir: join(f.db.dir, 'media'),
  });
}

/**
 * 一道閘：Agent 開跑後停在這裡，直到測試放行。`started` 在第一次開跑時 resolve——
 * 測試靠它確定「已經在跑」，不靠計時。
 */
function gate(): { started: Promise<void>; enter: () => Promise<void>; open: () => void } {
  let open = (): void => undefined;
  let markStarted = (): void => undefined;
  const wait = new Promise<void>((resolve) => {
    open = resolve;
  });
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  return {
    started,
    enter: () => {
      markStarted();
      return wait;
    },
    open,
  };
}

/** 把結束時間改成一個不可能自然出現的值，之後若被改寫一眼看得出來。 */
function pinFinishedAt(f: CoreFixture, uuid: string): void {
  f.db.handle
    .prepare(
      "UPDATE agent_runs SET finished_at = '2000-01-01 00:00:00' WHERE id = (SELECT MAX(ar.id) FROM agent_runs ar JOIN jobs j ON j.id = ar.job_id WHERE j.uuid = ?)",
    )
    .run(uuid);
}

function count(f: CoreFixture, table: string): number {
  return (f.db.handle.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
}

function events(f: CoreFixture, eventType: string): { actor: string; status: string; detail_json: string | null }[] {
  return f.db.handle
    .prepare('SELECT actor, status, detail_json FROM publish_events WHERE event_type = ? ORDER BY id')
    .all(eventType) as unknown as { actor: string; status: string; detail_json: string | null }[];
}

describe('後端重啟：DB 裡還是 running 的 Agent 執行', () => {
  it('校稿跑到一半重啟：新的 CoreService 一建好就把它結成失敗，並記一筆事件', async () => {
    const hold = gate();
    const codex = new FakeAdapter('codex', 'Codex', { result: BRIEFS_RESULT, onRun: () => hold.enter() });
    fixture = await createCoreFixture({ adapters: [codex] });
    const uuid = newJob(fixture.core);

    const pending = fixture.core.runAgentReview(uuid, { provider: 'codex' }).catch((error: unknown) => error);
    await hold.started;
    expect(fixture.core.getJob(uuid).agentRun?.status).toBe('running');
    const stateBefore = fixture.core.getJob(uuid).state;

    const after = await restart(fixture, [new FakeAdapter('codex', 'Codex', { result: BRIEFS_RESULT })]);
    const detail = after.getJob(uuid);
    expect(detail.agentRun).toMatchObject({ status: 'failed', errorMessage: RESTART_MESSAGE, task: 'review' });
    expect(detail.agentRun?.finishedAt).not.toBeNull();
    // 只動 agent_runs：稿件狀態不變。
    expect(detail.state).toBe(stateBefore);

    const logged = events(fixture, 'agent_interrupted');
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ actor: 'system', status: 'failed' });
    expect(JSON.parse(logged[0]!.detail_json!)).toMatchObject({ purpose: 'review', provider: 'codex' });

    // 舊行程那一趟（真實世界裡已經死了）就算回來了，也不能把紀錄翻回來或生出提案、配圖需求。
    pinFinishedAt(fixture, uuid);
    hold.open();
    expect(await pending).toBeInstanceOf(Error);
    expect(after.getJob(uuid).agentRun).toMatchObject({
      status: 'failed',
      errorMessage: RESTART_MESSAGE,
      finishedAt: '2000-01-01 00:00:00',
    });
    expect(count(fixture, 'review_proposals')).toBe(0);
    expect(count(fixture, 'image_briefs')).toBe(0);
    expect(after.getReview(uuid)).toBeNull();

    // 重啟之後可以重新派工，不會被「已經有一個 Agent 在跑」擋住。
    await expect(after.runAgentReview(uuid, { provider: 'codex', task: 'images' })).resolves.toMatchObject({
      status: 'succeeded',
    });
  });

  it('生圖跑到一半重啟也一樣結掉（所有種類的 running 都清）', async () => {
    const hold = gate();
    const codex = new FakeAdapter('codex', 'Codex', { result: BRIEFS_RESULT, image: { onRun: () => hold.enter() } });
    fixture = await createCoreFixture({ adapters: [codex] });
    const uuid = newJob(fixture.core);
    await fixture.core.runAgentReview(uuid, { provider: 'codex', task: 'images' });
    const brief = fixture.core.getJob(uuid).imageBriefs[0]!.id;

    const pending = fixture.core.generateBriefImage(uuid, brief).catch((error: unknown) => error);
    await hold.started;
    expect(fixture.core.getJob(uuid).agentRun).toMatchObject({ status: 'running', task: 'generate-image' });

    const after = await restart(fixture, [new FakeAdapter('codex', 'Codex')]);
    expect(after.getJob(uuid).agentRun).toMatchObject({
      status: 'failed',
      task: 'generate-image',
      errorMessage: RESTART_MESSAGE,
    });

    pinFinishedAt(fixture, uuid);
    hold.open();
    expect(await pending).toBeInstanceOf(Error);
    expect(after.getJob(uuid).agentRun).toMatchObject({
      status: 'failed',
      errorMessage: RESTART_MESSAGE,
      finishedAt: '2000-01-01 00:00:00',
    });
    expect(count(fixture, 'image_candidates')).toBe(0);
  });

  it('不是 running 的紀錄一筆都不動', async () => {
    const codex = new FakeAdapter('codex', 'Codex', { result: BRIEFS_RESULT });
    fixture = await createCoreFixture({ adapters: [codex] });
    const uuid = newJob(fixture.core);
    await fixture.core.runAgentReview(uuid, { provider: 'codex', task: 'images' });
    const before = fixture.db.handle.prepare('SELECT * FROM agent_runs ORDER BY id').all();

    await restart(fixture, [codex]);

    expect(fixture.db.handle.prepare('SELECT * FROM agent_runs ORDER BY id').all()).toEqual(before);
    expect(events(fixture, 'agent_interrupted')).toHaveLength(0);
  });

  it('記憶體裡查不到、DB 卻還是 running：按取消也要把 DB 那筆結掉', async () => {
    fixture = await createCoreFixture({ adapters: [new FakeAdapter('codex', 'Codex')] });
    const uuid = newJob(fixture.core);
    const jobId = (fixture.db.handle.prepare('SELECT id FROM jobs WHERE uuid = ?').get(uuid) as { id: number }).id;
    // 啟動清理之後才出現的孤兒（例如別的路徑留下的）：直接寫進 DB。
    fixture.db.handle
      .prepare("INSERT INTO agent_runs (job_id, provider, purpose, status) VALUES (?, 'codex', 'review', 'running')")
      .run(jobId);
    expect(fixture.core.getJob(uuid).agentRun?.status).toBe('running');

    fixture.core.cancelAgentRun(uuid);

    expect(fixture.core.getJob(uuid).agentRun).toMatchObject({ status: 'cancelled', errorMessage: '使用者取消' });
    expect(events(fixture, 'agent_cancelled')).toHaveLength(1);
  });
});

describe('排在佇列裡就被取消的校稿與生圖', () => {
  const request = { systemPrompt: 's', userPrompt: 'u', workspaceDir: '/tmp', timeoutMs: 1000, maxOutputBytes: 1000 };

  it('registry：輪到時已取消就不叫 adapter', async () => {
    const hold = gate();
    const codex = new FakeAdapter('codex', 'Codex', { onRun: () => hold.enter() });
    const registry = new AgentRegistry({ adapters: [codex] });

    const first = registry.runStructured('codex', request, {}, 'run-a');
    await hold.started;
    const second = registry.runStructured('codex', request, {}, 'run-b');
    await registry.cancel('codex', 'run-b');
    hold.open();

    await first;
    expect(await second).toMatchObject({ ok: false, reason: 'cancelled' });
    expect(codex.calls.map((call) => call.runId)).toEqual(['run-a']);
  });

  it('CoreService 校稿：第二篇排隊時取消，Agent 只跑第一篇；取消的原因與結束時間不被改寫', async () => {
    const hold = gate();
    const codex = new FakeAdapter('codex', 'Codex', { result: BRIEFS_RESULT, onRun: () => hold.enter() });
    fixture = await createCoreFixture({ adapters: [codex] });
    const a = newJob(fixture.core);
    const b = newJob(fixture.core);

    const first = fixture.core.runAgentReview(a, { provider: 'codex', task: 'images' });
    await hold.started;
    const second = fixture.core.runAgentReview(b, { provider: 'codex', task: 'images' }).catch((error: unknown) => error);
    fixture.core.cancelAgentRun(b);
    pinFinishedAt(fixture, b);
    hold.open();

    await first;
    expect(await second).toBeInstanceOf(Error);
    expect(codex.calls).toHaveLength(1);
    expect(fixture.core.getJob(b).agentRun).toMatchObject({
      status: 'cancelled',
      errorMessage: '使用者取消',
      finishedAt: '2000-01-01 00:00:00',
    });
  });

  it('CoreService 生圖：排隊時取消，不叫 Codex 畫；取消的原因與結束時間不被改寫', async () => {
    const hold = gate();
    const codex = new FakeAdapter('codex', 'Codex', { result: BRIEFS_RESULT, image: { onRun: () => hold.enter() } });
    fixture = await createCoreFixture({ adapters: [codex] });
    const a = newJob(fixture.core);
    const b = newJob(fixture.core);
    await fixture.core.runAgentReview(a, { provider: 'codex', task: 'images' });
    await fixture.core.runAgentReview(b, { provider: 'codex', task: 'images' });
    const briefA = fixture.core.getJob(a).imageBriefs[0]!.id;
    const briefB = fixture.core.getJob(b).imageBriefs[0]!.id;

    const first = fixture.core.generateBriefImage(a, briefA);
    await hold.started;
    const second = fixture.core.generateBriefImage(b, briefB).catch((error: unknown) => error);
    fixture.core.cancelAgentRun(b);
    pinFinishedAt(fixture, b);
    hold.open();

    await first;
    expect(await second).toBeInstanceOf(Error);
    expect(codex.imageCalls).toHaveLength(1);
    expect(fixture.core.getJob(b).agentRun).toMatchObject({
      status: 'cancelled',
      task: 'generate-image',
      errorMessage: '使用者取消',
      finishedAt: '2000-01-01 00:00:00',
    });
  });
});
