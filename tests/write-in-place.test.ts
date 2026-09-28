import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { buildApp } from '../src/server/app.js';
import { loadConfig } from '../src/config/env.js';
import { loadTemplateRegistry } from '../src/templates/registry.js';
import { loadPublishTargets } from '../src/wordpress/targets.js';
import { paths } from '../src/config/paths.js';
import { AgentRegistry } from '../src/agents/registry.js';
import { EMPTY_BODY_HTML, EMPTY_BODY_MESSAGE, isBlankBody } from '../src/contract/empty-body.js';
import { checkPlainTitle, flattenTitleText } from '../src/contract/plain-title.js';
import { InvalidInputError } from '../src/core/errors.js';
import { decideProofSave, newJobRequest } from '../src/ui/lib/write-in-place.js';
import { approveJob, createCoreFixture, type CoreFixture } from './helpers/core-fixture.js';
import { FakeAdapter } from './helpers/fake-adapter.js';

/**
 * P5-T029（D-030）：新稿件只問類型與標題，建立後直接在文章上寫；標題在文章上直接改。
 * 測試全部用假 adapter 與假站台：不呼叫真實 Agent CLI、不連真實 WordPress。
 */

let fixture: CoreFixture | null = null;
let app: FastifyInstance | null = null;
afterEach(async () => {
  await app?.close();
  await fixture?.cleanup();
  app = null;
  fixture = null;
});

const META = { runId: 'fake', agentId: 'codex', model: null, durationMs: 1, stderrTail: '' } as const;
const REVIEW_OUTPUT = {
  ok: true as const,
  data: { summary: '看過了', templateData: { title: '20260928', body: '<p>一</p>' }, changes: [], observations: [], imageBriefs: [] },
  meta: META,
};

describe('isBlankBody', () => {
  it.each([
    ['', true],
    [EMPTY_BODY_HTML, true],
    ['<p><br></p>\n<p>&nbsp;</p>', true],
    ['<p class="wp-block-paragraph"> 　 </p><hr>', true],
    ['<p>一</p>', false],
    ['<p>&amp;</p>', false],
    ['<figure class="wp-block-image"><img src="https://example.test/a.png" alt=""></figure>', false],
  ])('%j → %s', (html, blank) => {
    expect(isBlankBody(html)).toBe(blank);
  });
});

describe('checkPlainTitle', () => {
  it('前後空白修掉', () => {
    expect(checkPlainTitle('  20260928 ')).toEqual({ ok: true, title: '20260928' });
  });
  it('空的不准存；日記提示 YYYYMMDD', () => {
    expect(checkPlainTitle('   ')).toMatchObject({ ok: false, message: '標題不能是空的' });
    expect(checkPlainTitle('', { diary: true })).toMatchObject({ ok: false, message: expect.stringMatching(/YYYYMMDD/) });
  });
  it('不能換行、不能有控制字元、最多 120 字', () => {
    expect(checkPlainTitle('一\n二').ok).toBe(false);
    expect(checkPlainTitle('一\u0007二').ok).toBe(false);
    expect(checkPlainTitle('字'.repeat(121)).ok).toBe(false);
    expect(checkPlainTitle('字'.repeat(120)).ok).toBe(true);
  });
  it('字面上的角括號是字，不是 HTML', () => {
    expect(checkPlainTitle('<b>粗</b>')).toEqual({ ok: true, title: '<b>粗</b>' });
  });
  it('編輯框裡的換行攤平成空格', () => {
    expect(flattenTitleText('一\n二\r\n三')).toBe('一 二 三');
  });
});

describe('空內文建稿（後端）', () => {
  it('沒有原稿也建得起來；校樣渲染得出來、有地方打字', async () => {
    fixture = await createCoreFixture();
    const { core } = fixture;
    const uuid = core.createJob({ targetKey: 'read-think', sourceText: '', title: '還沒寫' }).uuid;
    const detail = core.getJob(uuid);
    expect(detail.title).toBe('還沒寫');
    expect(detail.bodyEmpty).toBe(true);
    expect(detail.currentRevision?.templateData['body']).toBe(EMPTY_BODY_HTML);
    const rendered = core.render(uuid);
    expect(rendered.publishHtml).toBe(EMPTY_BODY_HTML);
    expect(core.getPreviewDocument(uuid).html).toContain('class="preview-body"');
  });

  it('三個模板都收（hybrid 的結構規則不擋空段落）', async () => {
    fixture = await createCoreFixture();
    for (const targetKey of ['diary', 'read-think']) {
      const uuid = fixture.core.createJob({ targetKey, sourceText: '' }).uuid;
      expect(() => fixture!.core.render(uuid)).not.toThrow();
    }
  });

  it('發布面板的「還不能發布」列出空正文；有字之後就不列', async () => {
    fixture = await createCoreFixture();
    const { core } = fixture;
    const uuid = core.createJob({ targetKey: 'diary', sourceText: '', title: '20260928' }).uuid;
    expect(core.getJob(uuid).blockers).toContain(EMPTY_BODY_MESSAGE);
    core.createRevision(uuid, { editedBody: '<p>今天下雨。</p>' });
    const detail = core.getJob(uuid);
    expect(detail.bodyEmpty).toBe(false);
    expect(detail.blockers).not.toContain(EMPTY_BODY_MESSAGE);
  });

  it('不能核准空文章，也就發不出去', async () => {
    fixture = await createCoreFixture();
    const { core } = fixture;
    const uuid = core.createJob({ targetKey: 'diary', sourceText: '', title: '20260928' }).uuid;
    expect(() => approveJob(core, uuid)).toThrow(EMPTY_BODY_MESSAGE);
    expect(core.getJob(uuid).state).not.toBe('APPROVED');
    await expect(core.publish(uuid, { status: 'draft' })).rejects.toThrow();
    // 一個請求都沒送到假站台。
    expect(fixture.requests.filter((request) => request.method !== 'GET')).toEqual([]);
  });

  it('寫了字就照常核准、發布（只存草稿）', async () => {
    fixture = await createCoreFixture();
    const { core } = fixture;
    const uuid = core.createJob({ targetKey: 'diary', sourceText: '', title: '20260928' }).uuid;
    core.createRevision(uuid, { editedBody: '<p>今天下雨。</p>' });
    approveJob(core, uuid);
    const result = await core.publish(uuid, { status: 'draft' });
    expect(result.status).toBe('draft');
  });

  it('把字全刪掉再存：存成空段落，不是 schema 錯誤', async () => {
    fixture = await createCoreFixture();
    const { core } = fixture;
    const uuid = core.createJob({ targetKey: 'diary', sourceText: '一段字', title: '20260928' }).uuid;
    core.createRevision(uuid, { editedBody: '<p><br></p>' });
    expect(core.getJob(uuid).currentRevision?.templateData['body']).toBe(EMPTY_BODY_HTML);
    expect(core.getJob(uuid).bodyEmpty).toBe(true);
  });

  it('空正文不送 AI 校稿、也不跑一鍵配圖（不花額度，講清楚原因）', async () => {
    const adapter = new FakeAdapter('codex', 'Codex', { result: REVIEW_OUTPUT });
    fixture = await createCoreFixture({ adapters: [adapter] });
    const { core } = fixture;
    const uuid = core.createJob({ targetKey: 'diary', sourceText: '', title: '20260928' }).uuid;
    await expect(core.runAgentReview(uuid, { provider: 'codex' })).rejects.toThrow(/正文是空的/);
    await expect(core.runAgentReview(uuid, { provider: 'codex', task: 'images' })).rejects.toThrow(InvalidInputError);
    expect(adapter.calls).toHaveLength(0);
  });

  it('建議網址：只有標題也照常（看的是標題）', async () => {
    const adapter = new FakeAdapter('codex', 'Codex', {
      result: { ok: true, data: { slugs: ['still-raining', 'rainy-day', 'rain'] }, meta: META },
    });
    fixture = await createCoreFixture({ adapters: [adapter] });
    const { core } = fixture;
    const uuid = core.createJob({ targetKey: 'read-think', sourceText: '', title: '下雨天' }).uuid;
    const result = await core.suggestSlugs(uuid, { provider: 'codex' });
    expect(result.slugs.length).toBeGreaterThan(0);
    expect(adapter.calls).toHaveLength(1);
  });

  it('拖放／貼上建稿不受影響：原稿照舊轉成段落', async () => {
    fixture = await createCoreFixture();
    const { core } = fixture;
    const uuid = core.createJob({ targetKey: 'diary', sourceText: '第一段\n\n第二段', title: '20260928' }).uuid;
    const detail = core.getJob(uuid);
    expect(detail.bodyEmpty).toBe(false);
    expect(detail.currentRevision?.publishHtml).toBe(
      '<p class="wp-block-paragraph">第一段</p>\n<p class="wp-block-paragraph">第二段</p>',
    );
  });
});

describe('在文章上改標題（後端）', () => {
  it('標題跟內文一起存成同一個新版本，核准失效', async () => {
    fixture = await createCoreFixture();
    const { core } = fixture;
    const uuid = core.createJob({ targetKey: 'diary', sourceText: '一段字', title: '20260927' }).uuid;
    approveJob(core, uuid);
    const before = core.getJob(uuid).revisionCount;
    core.createRevision(uuid, { editedBody: '<p>改過的字</p>', editedTitle: ' 20260928 ', origin: 'manual' });
    const detail = core.getJob(uuid);
    expect(detail.revisionCount).toBe(before + 1);
    expect(detail.title).toBe('20260928');
    expect(detail.currentRevision?.templateData['title']).toBe('20260928');
    expect(detail.currentRevision?.publishHtml).toContain('改過的字');
    expect(detail.approval?.valid).toBe(false);
  });

  it('只改標題也可以（其他欄位照舊）', async () => {
    fixture = await createCoreFixture();
    const { core } = fixture;
    const uuid = core.createJob({ targetKey: 'diary', sourceText: '一段字', title: '20260927' }).uuid;
    const body = core.getJob(uuid).currentRevision?.publishHtml;
    core.createRevision(uuid, { editedTitle: '20260928' });
    const detail = core.getJob(uuid);
    expect(detail.title).toBe('20260928');
    expect(detail.currentRevision?.publishHtml).toBe(body);
  });

  it('標題跟內文都沒變就不建新版本', async () => {
    fixture = await createCoreFixture();
    const { core } = fixture;
    const uuid = core.createJob({ targetKey: 'diary', sourceText: '一段字', title: '20260927' }).uuid;
    const detail = core.getJob(uuid);
    core.createRevision(uuid, { editedBody: detail.currentRevision!.publishHtml, editedTitle: '20260927' });
    expect(core.getJob(uuid).revisionCount).toBe(1);
  });

  it.each([
    ['', /YYYYMMDD/],
    ['   ', /標題不能是空的/],
    ['一\n二', /不能換行/],
    ['字'.repeat(121), /最多 120/],
  ])('不收 %j', async (title, message) => {
    fixture = await createCoreFixture();
    const { core } = fixture;
    const uuid = core.createJob({ targetKey: 'diary', sourceText: '一段字', title: '20260927' }).uuid;
    expect(() => core.createRevision(uuid, { editedBody: '<p>改</p>', editedTitle: title })).toThrow(message);
    expect(core.getJob(uuid).revisionCount).toBe(1);
  });

  it('不能跟整份 templateData 一起給', async () => {
    fixture = await createCoreFixture();
    const { core } = fixture;
    const uuid = core.createJob({ targetKey: 'diary', sourceText: '一段字', title: '20260927' }).uuid;
    expect(() =>
      core.createRevision(uuid, { templateData: { title: 'a', body: '<p>b</p>' }, editedTitle: 'c' }),
    ).toThrow(InvalidInputError);
  });

  it('HTTP：POST /api/jobs 收空原稿、POST revisions 收 editedTitle', async () => {
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
    const headers = { host: '127.0.0.1:3000' };
    const created = await app.inject({
      method: 'POST',
      url: '/api/jobs',
      headers,
      payload: { targetKey: 'diary', sourceText: '', title: '20260928' },
    });
    expect(created.statusCode).toBe(201);
    const uuid = created.json().job.uuid as string;
    const saved = await app.inject({
      method: 'POST',
      url: `/api/jobs/${uuid}/revisions`,
      headers,
      payload: { editedBody: '<p>今天</p>', editedTitle: '20260929' },
    });
    expect(saved.statusCode).toBe(201);
    const detail = await app.inject({ method: 'GET', url: `/api/jobs/${uuid}`, headers });
    expect(detail.json().title).toBe('20260929');
    expect(detail.json().bodyEmpty).toBe(false);
    const bad = await app.inject({
      method: 'POST',
      url: `/api/jobs/${uuid}/revisions`,
      headers,
      payload: { editedTitle: '   ' },
    });
    expect(bad.statusCode).toBe(400);
  });
});

describe('新稿件畫面送出的東西（前端）', () => {
  it('按鈕進來：只有類型與標題，原稿是空的，建立後直接進打字模式', () => {
    expect(newJobRequest({ targetKey: 'diary', title: ' 20260928 ' })).toEqual({
      request: { targetKey: 'diary', sourceText: '', title: '20260928' },
      editOnOpen: true,
    });
  });
  it('標題留空就不送（後端給「未命名」）', () => {
    expect(newJobRequest({ targetKey: 'diary', title: '  ' }).request).toEqual({ targetKey: 'diary', sourceText: '' });
  });
  it('拖放／貼上進來：帶著原稿建立，不進打字模式', () => {
    expect(newJobRequest({ targetKey: 'diary', title: '', initialText: '第一段\n\n第二段' })).toEqual({
      request: { targetKey: 'diary', sourceText: '第一段\n\n第二段' },
      editOnOpen: false,
    });
  });
});

describe('打字模式的儲存（前端）', () => {
  const base = { bodyOriginal: '<p>一</p>', dropped: [], force: false, titleOriginal: '20260927', diary: true };

  it('都沒改：不送', () => {
    expect(decideProofSave({ ...base, bodyCleaned: '<p>一</p>', titleText: '20260927' })).toEqual({ kind: 'unchanged' });
  });
  it('空文章打開又關上（空段落整理前後長得不同）也算沒改', () => {
    expect(
      decideProofSave({ ...base, bodyOriginal: EMPTY_BODY_HTML, bodyCleaned: '', titleText: '20260927' }),
    ).toEqual({ kind: 'unchanged' });
  });
  it('只改標題：只送標題', () => {
    expect(decideProofSave({ ...base, bodyCleaned: '<p>一</p>', titleText: ' 20260928 ' })).toEqual({
      kind: 'save',
      editedTitle: '20260928',
    });
  });
  it('標題與內文都改：一起送', () => {
    expect(decideProofSave({ ...base, bodyCleaned: '<p>二</p>', titleText: '20260928' })).toEqual({
      kind: 'save',
      editedBody: '<p>二</p>',
      editedTitle: '20260928',
    });
  });
  it('標題清空：不送，講原因（日記提示 YYYYMMDD）', () => {
    const decision = decideProofSave({ ...base, bodyCleaned: '<p>二</p>', titleText: '  ' });
    expect(decision).toMatchObject({ kind: 'invalid-title', message: expect.stringMatching(/YYYYMMDD/) });
  });
  it('標題裡的換行攤平', () => {
    expect(decideProofSave({ ...base, bodyCleaned: '<p>一</p>', titleText: '2026\n0928' })).toEqual({
      kind: 'save',
      editedTitle: '2026 0928',
    });
  });
  it('有會被拿掉的格式：先問', () => {
    expect(
      decideProofSave({ ...base, bodyCleaned: '<p>二</p>', titleText: '20260927', dropped: ['底線'] }),
    ).toEqual({ kind: 'confirm-drop', dropped: ['底線'] });
  });
});
