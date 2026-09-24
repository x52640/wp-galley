import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { paths } from '../src/config/paths.js';
import { loadPublishTargets } from '../src/wordpress/targets.js';
import { sourceTemplateData, taxonomyTemplateData } from '../src/ui/components/panels/template-data.js';
import { createCoreFixture, type CoreFixture } from './helpers/core-fixture.js';

/**
 * P5-T021（審查 #14、#15）：分類、網址片段在 UI 上可以清空，
 * 清空時送出的 templateData 要**拿掉那個鍵**——
 * 分類送空字串會被 schema 的 minLength:1 擋下；網址片段不送卻留著舊值，等於沒清。
 *
 * 「通過 schema」用後端同一條路（CoreService.createRevision 會渲染並驗證），不另寫一套驗證。
 */

const BODY = '<p class="wp-block-paragraph">今天讀完這本書。</p>';

let fixture: CoreFixture | null = null;
afterEach(async () => {
  await fixture?.cleanup();
  fixture = null;
});

describe('taxonomyTemplateData', () => {
  it('單選清空：拿掉 category 鍵，不送空字串', () => {
    const out = taxonomyTemplateData({ title: 't', body: 'b', category: '隨筆' }, false, []);
    expect(out).toEqual({ title: 't', body: 'b' });
    expect('category' in out).toBe(false);
  });

  it('單選有值：寫進 category', () => {
    expect(taxonomyTemplateData({ title: 't', category: '舊' }, false, ['新'])).toEqual({ title: 't', category: '新' });
  });

  it('多選（長文 tags）清空仍送空陣列', () => {
    expect(taxonomyTemplateData({ title: 't', tags: ['a'] }, true, [])).toEqual({ title: 't', tags: [] });
  });

  it('資料為 null 時也能組', () => {
    expect(taxonomyTemplateData(null, false, [])).toEqual({});
  });
});

describe('sourceTemplateData', () => {
  it('清空網址片段：舊的 slug 不能留著', () => {
    const out = sourceTemplateData({ title: '舊', body: 'x', slug: 'old-slug', category: '隨筆' }, {
      title: '新',
      body: 'y',
      slug: '',
    });
    expect(out).toEqual({ title: '新', body: 'y', category: '隨筆' });
    expect('slug' in out).toBe(false);
  });

  it('有填網址片段就寫進去，其他欄位保留', () => {
    expect(sourceTemplateData({ category: '隨筆', slug: 'a' }, { title: 't', body: 'b', slug: 'b' })).toEqual({
      category: '隨筆',
      title: 't',
      body: 'b',
      slug: 'b',
    });
  });
});

describe('清空後存得進去，重新讀取確實不見', () => {
  it('日記（diary-v1）：清空分類', async () => {
    fixture = await createCoreFixture();
    const { core } = fixture;
    const uuid = core.createJob({
      targetKey: 'diary',
      sourceText: '',
      templateData: { title: '20260828', body: BODY, category: '隨筆' },
    }).uuid;
    const base = core.getJob(uuid).currentRevision!;

    core.createRevision(uuid, {
      templateData: taxonomyTemplateData(base.templateData, false, []),
      expectedContentHash: base.contentHash,
    });

    expect('category' in core.getJob(uuid).currentRevision!.templateData).toBe(false);
  });

  it('日記（diary-v1）：清空網址片段', async () => {
    fixture = await createCoreFixture();
    const { core } = fixture;
    const uuid = core.createJob({
      targetKey: 'diary',
      sourceText: '',
      templateData: { title: '20260828', body: BODY, slug: '20260828' },
    }).uuid;
    const base = core.getJob(uuid).currentRevision!;

    core.createRevision(uuid, {
      templateData: sourceTemplateData(base.templateData, { title: '20260828', body: BODY, slug: '' }),
      expectedContentHash: base.contentHash,
    });

    expect('slug' in core.getJob(uuid).currentRevision!.templateData).toBe(false);
  });

  it('通用文章（article-v1）：清空分類', async () => {
    fixture = await createCoreFixture({
      targets: await loadPublishTargets(join(paths.config, 'publish-targets.example.json')),
    });
    const { core } = fixture;
    const uuid = core.createJob({
      targetKey: 'post',
      sourceText: '',
      templateData: { title: '通用文章', body: BODY, category: '教學', slug: 'hello' },
    }).uuid;
    const base = core.getJob(uuid).currentRevision!;

    core.createRevision(uuid, {
      templateData: taxonomyTemplateData(base.templateData, false, []),
      expectedContentHash: base.contentHash,
    });
    const afterCategory = core.getJob(uuid).currentRevision!;
    expect('category' in afterCategory.templateData).toBe(false);

    core.createRevision(uuid, {
      templateData: sourceTemplateData(afterCategory.templateData, { title: '通用文章', body: BODY, slug: '' }),
      expectedContentHash: afterCategory.contentHash,
    });
    expect('slug' in core.getJob(uuid).currentRevision!.templateData).toBe(false);
  });

  it('對照：送空字串的分類會被 schema 擋下（這就是 #14 的原狀）', async () => {
    fixture = await createCoreFixture();
    const { core } = fixture;
    const uuid = core.createJob({
      targetKey: 'diary',
      sourceText: '',
      templateData: { title: '20260828', body: BODY, category: '隨筆' },
    }).uuid;
    const base = core.getJob(uuid).currentRevision!;
    expect(() =>
      core.createRevision(uuid, { templateData: { ...base.templateData, category: '' } }),
    ).toThrow();
  });
});
