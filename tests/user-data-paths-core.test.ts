import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { coreInternals, createCoreFixture, TINY_PNG, type CoreFixture } from './helpers/core-fixture.js';
import { FakeAdapter } from './helpers/fake-adapter.js';

/**
 * CoreService 跟資料目錄（D-035，P8-T003）：DB 寫相對路徑、讀時以資料目錄解析、舊的絕對路徑照舊能用，
 * Agent 的工作目錄仍然只能在 drafts/ 裡。暫存資料目錄的路徑含空白（core-fixture 建的）。
 *
 * 一律 FakeAdapter、假 WordPress，不呼叫真實 CLI、不連真站。
 */

const SOURCE = '今天讀完這本書。\n\n想到很多事。';
const P = (text: string): string => `<p class="wp-block-paragraph">${text}</p>`;
const BRIEF = {
  key: 'cover',
  purpose: '封面',
  prompt: '木桌上的舊筆記本',
  aspectRatio: '16:9',
  altText: '舊筆記本',
  placement: '精選圖片',
};

let fixture: CoreFixture | null = null;
afterEach(async () => {
  await fixture?.cleanup();
  fixture = null;
});

function reviewResult(imageBriefs: unknown[] = []) {
  return {
    ok: true as const,
    data: {
      title: '20260828',
      summary: '看過了',
      correctedSource: SOURCE,
      changes: [],
      observations: [],
      templateData: { title: '20260828', body: P('今天讀完這本書。') },
      imageBriefs,
    },
    meta: { runId: 'fake', agentId: 'codex' as const, model: null, durationMs: 1, stderrTail: '' },
  };
}

async function setup(): Promise<{ f: CoreFixture; codex: FakeAdapter; dataDir: string }> {
  const codex = new FakeAdapter('codex', 'Codex', { result: reviewResult([BRIEF]), image: {} });
  fixture = await createCoreFixture({ adapters: [codex] });
  const dataDir = coreInternals(fixture.core).dataDir;
  return { f: fixture, codex, dataDir };
}

const row = (f: CoreFixture, sql: string, ...params: (string | number)[]): Record<string, unknown> =>
  f.db.handle.prepare(sql).get(...params) as Record<string, unknown>;

function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !rel.split(sep).includes('..');
}

describe('寫入一律相對資料目錄', () => {
  it('建稿：workspace_path 是 drafts/<uuid>，資料夾真的在資料目錄裡', async () => {
    const { f, dataDir } = await setup();
    expect(dataDir).toContain(' '); // 路徑含空白
    const uuid = f.core.createJob({ targetKey: 'diary', sourceText: SOURCE, title: '20260828' }).uuid;
    expect(row(f, 'SELECT workspace_path AS v FROM jobs WHERE uuid = ?', uuid)['v']).toBe(`drafts/${uuid}`);
    expect(existsSync(join(dataDir, 'drafts', uuid))).toBe(true);
  });

  it('上傳圖與生圖候選：local_path 相對、讀得到檔、刪圖刪得到本機副本', async () => {
    const { f, dataDir } = await setup();
    const uuid = f.core.createJob({ targetKey: 'diary', sourceText: SOURCE, title: '20260828' }).uuid;

    const asset = await f.core.addMedia(uuid, { bytes: TINY_PNG, mimeType: 'image/png', filename: 'x' });
    const stored = row(f, 'SELECT local_path AS v FROM media_assets WHERE id = ?', asset.id)['v'] as string;
    expect(stored.startsWith('/')).toBe(false);
    expect(existsSync(join(dataDir, stored))).toBe(true);

    await f.core.runAgentReview(uuid, { provider: 'codex', task: 'images' });
    const briefId = f.core.getJob(uuid).imageBriefs[0]!.id;
    const candidate = await f.core.generateBriefImage(uuid, briefId);
    const candidatePath = row(f, 'SELECT local_path AS v FROM image_candidates WHERE id = ?', candidate.id)['v'] as string;
    expect(candidatePath.startsWith('/')).toBe(false);
    const served = f.core.imageCandidateFile(uuid, candidate.id);
    expect(served.path).toBe(join(dataDir, candidatePath));
    expect(existsSync(served.path)).toBe(true);
    // 用這張：上傳時讀得到候選圖檔。
    await f.core.useImageCandidate(uuid, candidate.id);

    f.core.removeMedia(uuid, asset.id);
    expect(existsSync(join(dataDir, stored))).toBe(false);
  });
});

describe('讀到舊的絕對路徑照舊能用', () => {
  it('候選圖與媒體的 local_path 是絕對路徑：送得出去、用得了、刪得掉', async () => {
    const { f, dataDir } = await setup();
    const uuid = f.core.createJob({ targetKey: 'diary', sourceText: SOURCE, title: '20260828' }).uuid;
    await f.core.runAgentReview(uuid, { provider: 'codex', task: 'images' });
    const briefId = f.core.getJob(uuid).imageBriefs[0]!.id;
    const candidate = await f.core.generateBriefImage(uuid, briefId);

    // 模擬「別處」的舊資料：檔案放在資料目錄外，DB 存絕對路徑。
    const outside = join(dirname(dataDir), `${'legacy root'}-${uuid}`, 'c.png');
    mkdirSync(dirname(outside), { recursive: true });
    writeFileSync(outside, TINY_PNG);
    f.db.handle.prepare('UPDATE image_candidates SET local_path = ? WHERE id = ?').run(outside, candidate.id);
    expect(f.core.imageCandidateFile(uuid, candidate.id).path).toBe(outside);
    const outcome = await f.core.useImageCandidate(uuid, candidate.id);

    f.db.handle.prepare('UPDATE media_assets SET local_path = ? WHERE id = ?').run(outside, outcome.media.id);
    f.core.removeMedia(uuid, outcome.media.id);
    expect(existsSync(outside)).toBe(false);
  });
});

describe('別的根目錄留下的絕對路徑（重 clone 後把舊資料複製過來，010 沒轉到）', () => {
  it('圖讀得到資料目錄裡的同一個相對位置；Agent 工作目錄是資料目錄的 drafts/<uuid>', async () => {
    const { f, codex, dataDir } = await setup();
    const uuid = f.core.createJob({ targetKey: 'diary', sourceText: SOURCE, title: '20260828' }).uuid;
    await f.core.runAgentReview(uuid, { provider: 'codex', task: 'images' });
    const briefId = f.core.getJob(uuid).imageBriefs[0]!.id;
    const candidate = await f.core.generateBriefImage(uuid, briefId);

    const moved = join(dataDir, 'generated-images', uuid, 'candidates', 'c.png');
    mkdirSync(dirname(moved), { recursive: true });
    writeFileSync(moved, TINY_PNG);
    const oldRoot = '/Users/someone/old clone';
    f.db.handle
      .prepare('UPDATE image_candidates SET local_path = ? WHERE id = ?')
      .run(`${oldRoot}/generated-images/${uuid}/candidates/c.png`, candidate.id);
    f.db.handle.prepare('UPDATE jobs SET workspace_path = ? WHERE uuid = ?').run(`${oldRoot}/drafts/${uuid}`, uuid);

    expect(f.core.imageCandidateFile(uuid, candidate.id).path).toBe(moved);
    await f.core.useImageCandidate(uuid, candidate.id); // 上傳時讀得到檔

    await f.core.runAgentReview(uuid, { provider: 'codex' });
    expect(codex.calls.at(-1)!.request.workspaceDir).toBe(join(dataDir, 'drafts', uuid));
  });
});

describe('Agent 工作目錄仍限制在 drafts/ 裡', () => {
  it('相對路徑解析到資料目錄的 drafts/<uuid>（路徑含空白）', async () => {
    const { f, codex, dataDir } = await setup();
    const uuid = f.core.createJob({ targetKey: 'diary', sourceText: SOURCE, title: '20260828' }).uuid;
    await f.core.runAgentReview(uuid, { provider: 'codex' });
    const workspace = codex.calls.at(-1)!.request.workspaceDir;
    expect(workspace).toBe(join(dataDir, 'drafts', uuid));
    expect(isInside(join(dataDir, 'drafts'), workspace)).toBe(true);
  });

  it('DB 裡的路徑逃出 drafts/（被改過、或舊的別處絕對路徑）：改用 drafts/<uuid>，不在外面跑', async () => {
    const { f, codex, dataDir } = await setup();
    const uuid = f.core.createJob({ targetKey: 'diary', sourceText: SOURCE, title: '20260828' }).uuid;
    for (const tampered of ['../../outside', '/tmp', 'drafts', `drafts/${uuid}/../../..`]) {
      f.db.handle.prepare('UPDATE jobs SET workspace_path = ? WHERE uuid = ?').run(tampered, uuid);
      await f.core.runAgentReview(uuid, { provider: 'codex' });
      const workspace = codex.calls.at(-1)!.request.workspaceDir;
      expect(workspace).toBe(join(dataDir, 'drafts', uuid));
    }
  });

  it('舊的絕對路徑剛好在 drafts/ 裡：照用；資料夾不見了就補建', async () => {
    const { f, codex, dataDir } = await setup();
    const uuid = f.core.createJob({ targetKey: 'diary', sourceText: SOURCE, title: '20260828' }).uuid;
    const absolute = join(dataDir, 'drafts', uuid);
    f.db.handle.prepare('UPDATE jobs SET workspace_path = ? WHERE uuid = ?').run(absolute, uuid);
    rmSync(absolute, { recursive: true, force: true });
    await f.core.runAgentReview(uuid, { provider: 'codex' });
    expect(codex.calls.at(-1)!.request.workspaceDir).toBe(absolute);
    expect(existsSync(absolute)).toBe(true);
  });
});
