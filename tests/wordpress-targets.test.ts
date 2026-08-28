import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { paths } from '../src/config/paths.js';
import {
  loadPublishTargets,
  PublishTargetError,
  PublishTargetSchema,
  validateTargetsAgainstSite,
} from '../src/wordpress/targets.js';

const VALID = {
  key: 'diary',
  displayName: '日•記',
  contentType: 'diary',
  postType: 'diary',
  restBase: 'diary',
  templateId: 'diary-v1',
  taxonomy: 'diary-category',
  allowCreate: true,
  allowUpdate: true,
};

async function writeTargetsFile(content: unknown): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'targets-'));
  const file = join(dir, 'publish-targets.json');
  await writeFile(file, typeof content === 'string' ? content : JSON.stringify(content), 'utf8');
  return file;
}

describe('專案自己的設定檔', () => {
  it('config/publish-targets.json 載得起來，兩個目標都在', async () => {
    const registry = await loadPublishTargets(join(paths.config, 'publish-targets.json'));
    expect(registry.list().map((t) => t.key)).toEqual(['read-think', 'diary']);

    const longform = registry.get('read-think');
    expect(longform.taxonomy).toBe('read-think-tag');
    // 長文 15/15 篇都有精選圖片，日記 0/100 篇有。
    expect(longform.requireFeaturedImage).toBe(true);
    expect(registry.get('diary').requireFeaturedImage).toBe(false);
  });

  it('預設不允許建立分類項目', async () => {
    const registry = await loadPublishTargets(join(paths.config, 'publish-targets.json'));
    for (const target of registry.list()) {
      expect(target.allowCreateTerms).toBe(false);
    }
  });
});

describe('設定驗證', () => {
  it('開關預設全部保守', () => {
    const minimal = PublishTargetSchema.parse({
      key: 'x',
      displayName: 'X',
      contentType: 'diary',
      postType: 'x',
      restBase: 'x',
      templateId: 'diary-v1',
    });
    expect(minimal.allowCreate).toBe(false);
    expect(minimal.allowUpdate).toBe(false);
    expect(minimal.allowCreateTerms).toBe(false);
    expect(minimal.taxonomy).toBeNull();
  });

  it('首頁沒綁固定 Page ID 就不給過', () => {
    expect(() =>
      PublishTargetSchema.parse({ ...VALID, key: 'home', contentType: 'homepage' }),
    ).toThrow(/fixedObjectId/);
  });

  it('綁了固定 ID 又允許建立新內容是矛盾的', () => {
    expect(() =>
      PublishTargetSchema.parse({ ...VALID, fixedObjectId: 1665, allowCreate: true }),
    ).toThrow(/allowCreate/);
  });

  it('沒設分類法卻允許建立分類項目會被擋', () => {
    expect(() =>
      PublishTargetSchema.parse({ ...VALID, taxonomy: null, allowCreateTerms: true }),
    ).toThrow(/allowCreateTerms/);
  });

  it('key 重複會被擋', async () => {
    const file = await writeTargetsFile({ targets: [VALID, { ...VALID, displayName: '另一個' }] });
    await expect(loadPublishTargets(file)).rejects.toThrow(/key 重複/);
  });

  it('多餘的欄位會被擋——打錯欄位名不該被默默忽略', async () => {
    const file = await writeTargetsFile({ targets: [{ ...VALID, allowCreat: true }] });
    await expect(loadPublishTargets(file)).rejects.toBeInstanceOf(PublishTargetError);
  });

  it('檔案不存在或不是 JSON 都給看得懂的訊息', async () => {
    await expect(loadPublishTargets('/nope/publish-targets.json')).rejects.toThrow(/找不到發布目標設定/);
    const broken = await writeTargetsFile('{ 這不是 JSON');
    await expect(loadPublishTargets(broken)).rejects.toThrow(/不是合法 JSON/);
  });
});

describe('拿站台實況驗證設定', () => {
  const SITE = {
    diary: { rest_base: 'diary', taxonomies: ['diary-category'] },
    'read-think': { rest_base: 'read-think', taxonomies: ['read-think-tag'] },
  };

  it('設定與站台一致時沒有問題', () => {
    const target = PublishTargetSchema.parse(VALID);
    expect(validateTargetsAgainstSite([target], SITE)).toEqual([]);
  });

  it('內容類型不存在時指出可能是 show_in_rest 沒開', () => {
    const target = PublishTargetSchema.parse({ ...VALID, postType: 'notes', restBase: 'notes' });
    const issues = validateTargetsAgainstSite([target], SITE);
    expect(issues[0]!.message).toContain('show_in_rest');
  });

  it('restBase 對不上會被指出來', () => {
    const target = PublishTargetSchema.parse({ ...VALID, restBase: 'diaries' });
    const issues = validateTargetsAgainstSite([target], SITE);
    expect(issues[0]!.message).toContain('WordPress 回報的是 diary');
  });

  it('分類法掛錯地方會被指出來', () => {
    const target = PublishTargetSchema.parse({ ...VALID, taxonomy: 'read-think-tag' });
    const issues = validateTargetsAgainstSite([target], SITE);
    expect(issues[0]!.message).toContain('沒有分類法 read-think-tag');
  });
});
