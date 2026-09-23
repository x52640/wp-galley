import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { paths } from '../src/config/paths.js';
import {
  loadPublishTargets,
  PublishTargetError,
  PublishTargetSchema,
  SITE_CONFIG_MISSING_MESSAGE,
  validateTargetsAgainstSite,
} from '../src/wordpress/targets.js';
import { loadTemplateRegistry } from '../src/templates/registry.js';

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

describe('repo 附的站台設定範例', () => {
  it('作者站台 config/examples/remusplus.json 載得起來，兩個目標都在', async () => {
    const registry = await loadPublishTargets(join(paths.config, 'examples', 'remusplus.json'));
    expect(registry.list().map((t) => t.key)).toEqual(['read-think', 'diary']);

    const longform = registry.get('read-think');
    expect(longform.taxonomy).toBe('read-think-tag');
    // 長文 15/15 篇都有精選圖片，日記 0/100 篇有。
    expect(longform.requireFeaturedImage).toBe(true);
    expect(registry.get('diary').requireFeaturedImage).toBe(false);
  });

  it('通用範例 config/publish-targets.example.json：文章掛 category，頁面沒有分類法', async () => {
    const registry = await loadPublishTargets(join(paths.config, 'publish-targets.example.json'));
    expect(registry.list().map((t) => t.key)).toEqual(['post', 'page']);

    const post = registry.get('post');
    expect(post).toMatchObject({ contentType: 'article', postType: 'post', restBase: 'posts', templateId: 'article-v1', taxonomy: 'category' });
    const page = registry.get('page');
    expect(page).toMatchObject({ contentType: 'article', postType: 'page', restBase: 'pages', templateId: 'article-v1', taxonomy: null });
    // 別人的站不一定每篇都有封面，不強制。
    expect(post.requireFeaturedImage).toBe(false);
    expect(page.requireFeaturedImage).toBe(false);
  });

  it('兩份範例都不允許建立分類項目（D-004）', async () => {
    for (const file of ['publish-targets.example.json', join('examples', 'remusplus.json')]) {
      const registry = await loadPublishTargets(join(paths.config, file));
      for (const target of registry.list()) {
        expect(target.allowCreateTerms).toBe(false);
      }
    }
  });

  it('每個 target 指到的模板都存在，而且內容類型對得上', async () => {
    const templates = await loadTemplateRegistry(paths.templates);
    for (const file of ['publish-targets.example.json', join('examples', 'remusplus.json')]) {
      const registry = await loadPublishTargets(join(paths.config, file));
      for (const target of registry.list()) {
        expect(templates.has(target.templateId), `${file} ${target.key}`).toBe(true);
        expect(templates.get(target.templateId).manifest.contentType).toBe(target.contentType);
      }
    }
  });
});

describe('本機站台設定檔不存在', () => {
  it('不崩潰：回一個空的 registry，並講清楚下一步', async () => {
    const registry = await loadPublishTargets('/nope/publish-targets.json');
    expect(registry.list()).toEqual([]);
    expect(registry.has('post')).toBe(false);
    expect(registry.setupRequired).toBe(SITE_CONFIG_MISSING_MESSAGE);
    expect(SITE_CONFIG_MISSING_MESSAGE).toBe(
      '還沒有站台設定：先跑設定精靈，或複製 config/publish-targets.example.json',
    );
    expect(() => registry.get('post')).toThrow(SITE_CONFIG_MISSING_MESSAGE);
  });

  it('設定檔存在時沒有 setupRequired', async () => {
    const registry = await loadPublishTargets(join(paths.config, 'publish-targets.example.json'));
    expect(registry.setupRequired).toBeUndefined();
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

  it('不是 JSON 給看得懂的訊息；空的 targets 仍然擋（那是寫壞了，不是還沒設定）', async () => {
    const empty = await writeTargetsFile({ targets: [] });
    await expect(loadPublishTargets(empty)).rejects.toBeInstanceOf(PublishTargetError);
    const broken = await writeTargetsFile('{ 這不是 JSON');
    await expect(loadPublishTargets(broken)).rejects.toThrow(/不是合法 JSON/);
  });
});

const SITE = {
  diary: { rest_base: 'diary', taxonomies: ['diary-category'] },
  'read-think': { rest_base: 'read-think', taxonomies: ['read-think-tag'] },
};
const SITE_TAXONOMIES = {
  'diary-category': { rest_base: 'diary-category' },
  'read-think-tag': { rest_base: 'read-think-tag' },
};
const CORE_TYPES = {
  post: { rest_base: 'posts', taxonomies: ['category', 'post_tag'] },
  page: { rest_base: 'pages', taxonomies: [] },
};
const CORE_TAXONOMIES = {
  category: { rest_base: 'categories' },
  post_tag: { rest_base: 'tags' },
};

describe('拿站台實況驗證設定', () => {
  it('通用範例對一個全新的 WordPress 站沒有問題（post／page 是核心內建）', async () => {
    const registry = await loadPublishTargets(join(paths.config, 'publish-targets.example.json'));
    expect(validateTargetsAgainstSite(registry.list(), CORE_TYPES, CORE_TAXONOMIES)).toEqual([]);
  });

  it('post 掛 category 卻沒寫 taxonomyRestBase：講清楚要加什麼', () => {
    const post = PublishTargetSchema.parse({
      key: 'post', displayName: '文章', contentType: 'article', postType: 'post', restBase: 'posts',
      templateId: 'article-v1', taxonomy: 'category',
    });
    const issues = validateTargetsAgainstSite([post], CORE_TYPES, CORE_TAXONOMIES);
    expect(issues).toEqual([
      {
        targetKey: 'post',
        message: '分類法 category 的 REST 名稱是 categories，請在設定檔加上 taxonomyRestBase: "categories"',
      },
    ]);
  });

  it('taxonomyRestBase 寫錯也會被指出來', () => {
    const post = PublishTargetSchema.parse({
      key: 'post', displayName: '文章', contentType: 'article', postType: 'post', restBase: 'posts',
      templateId: 'article-v1', taxonomy: 'category', taxonomyRestBase: 'category-list',
    });
    const issues = validateTargetsAgainstSite([post], CORE_TYPES, CORE_TAXONOMIES);
    expect(issues[0]!.message).toContain('taxonomyRestBase: "categories"');
  });

  it('內容類型說有這個分類法，但 /wp/v2/taxonomies 裡找不到（沒開 show_in_rest）', () => {
    const issues = validateTargetsAgainstSite([PublishTargetSchema.parse(VALID)], SITE, {});
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain('找不到分類法 diary-category');
  });

  it('作者站台設定對作者站台沒有問題', async () => {
    const registry = await loadPublishTargets(join(paths.config, 'examples', 'remusplus.json'));
    expect(validateTargetsAgainstSite(registry.list(), SITE, SITE_TAXONOMIES)).toEqual([]);
  });

  it('taxonomy 也限制格式（它會接進網址）；作者站台的 slug 照樣通過', () => {
    expect(() => PublishTargetSchema.parse({ ...VALID, taxonomy: '../users/me' })).toThrow();
    expect(() => PublishTargetSchema.parse({ ...VALID, taxonomy: 'post_tag' })).not.toThrow();
    expect(() => PublishTargetSchema.parse({ ...VALID, taxonomy: 'read-think-tag' })).not.toThrow();
    expect(() => PublishTargetSchema.parse({ ...VALID, taxonomy: 'diary-category' })).not.toThrow();
  });

  it('內容類型接受 article，不接受契約外的值', () => {
    expect(PublishTargetSchema.parse({ ...VALID, contentType: 'article' }).contentType).toBe('article');
    expect(() => PublishTargetSchema.parse({ ...VALID, contentType: 'news' })).toThrow();
  });


  it('設定與站台一致時沒有問題', () => {
    const target = PublishTargetSchema.parse(VALID);
    expect(validateTargetsAgainstSite([target], SITE, SITE_TAXONOMIES)).toEqual([]);
  });

  it('內容類型不存在時指出可能是 show_in_rest 沒開', () => {
    const target = PublishTargetSchema.parse({ ...VALID, postType: 'notes', restBase: 'notes' });
    const issues = validateTargetsAgainstSite([target], SITE, SITE_TAXONOMIES);
    expect(issues[0]!.message).toContain('show_in_rest');
  });

  it('restBase 對不上會被指出來', () => {
    const target = PublishTargetSchema.parse({ ...VALID, restBase: 'diaries' });
    const issues = validateTargetsAgainstSite([target], SITE, SITE_TAXONOMIES);
    expect(issues[0]!.message).toContain('WordPress 回報的是 diary');
  });

  it('分類法掛錯地方會被指出來', () => {
    const target = PublishTargetSchema.parse({ ...VALID, taxonomy: 'read-think-tag' });
    const issues = validateTargetsAgainstSite([target], SITE, SITE_TAXONOMIES);
    expect(issues[0]!.message).toContain('沒有分類法 read-think-tag');
  });
});
