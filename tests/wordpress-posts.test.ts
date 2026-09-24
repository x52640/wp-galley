import { afterEach, describe, expect, it } from 'vitest';
import { WordPressClient } from '../src/wordpress/client.js';
import {
  createDraft,
  RemoteChangedError,
  setStatus,
  snapshotOf,
  updateDraft,
  type PostFields,
} from '../src/wordpress/posts.js';
import { PublishTargetSchema, type PublishTarget } from '../src/wordpress/targets.js';
import { startMockWordPress, type MockResponse, type MockWordPress } from './helpers/mock-wordpress.js';

const TARGET: PublishTarget = PublishTargetSchema.parse({
  key: 'diary',
  displayName: '日•記',
  contentType: 'diary',
  postType: 'diary',
  restBase: 'diary',
  templateId: 'diary-v1',
  taxonomy: 'diary-category',
  allowCreate: true,
  allowUpdate: true,
});

const FIELDS: PostFields = {
  title: '20260828',
  content: '<!-- wp:paragraph -->\n<p>今天。</p>\n<!-- /wp:paragraph -->',
};

function postBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1839,
    status: 'draft',
    link: 'https://www.remusplus.com/?p=1839',
    slug: '20260828',
    title: { raw: '20260828', rendered: '20260828' },
    content: { raw: FIELDS.content, rendered: '<p>今天。</p>' },
    featured_media: 0,
    date_gmt: '2026-08-28T01:00:00',
    modified_gmt: '2026-08-28T01:00:00',
    ...overrides,
  };
}

let mock: MockWordPress | null = null;

afterEach(async () => {
  await mock?.close();
  mock = null;
});

function clientFor(server: MockWordPress): WordPressClient {
  return new WordPressClient({
    baseUrl: server.url,
    username: 'ai_publisher',
    appPassword: 'abcd EFGH 1234 ijkl MNOP 5678',
    sleepImpl: async () => {},
  });
}

describe('建立草稿', () => {
  it('狀態一律寫死成 draft', async () => {
    mock = await startMockWordPress(() => ({ status: 201, body: postBody() }));
    await createDraft(clientFor(mock), TARGET, FIELDS);

    const sent = JSON.parse(mock.requests[0]!.body);
    expect(sent.status).toBe('draft');
    expect(mock.requests[0]!.path).toContain('/wp-json/wp/v2/diary');
  });

  it('只送白名單欄位，不會覆蓋沒打算動的東西', async () => {
    mock = await startMockWordPress(() => ({ status: 201, body: postBody() }));
    await createDraft(clientFor(mock), TARGET, {
      ...FIELDS,
      slug: '20260828',
      excerpt: '摘要',
      featuredMediaId: 1370,
      terms: { 'diary-category': [12] },
    });

    const sent = JSON.parse(mock.requests[0]!.body);
    expect(Object.keys(sent).sort()).toEqual(
      ['content', 'diary-category', 'excerpt', 'featured_media', 'slug', 'status', 'title'].sort(),
    );
    expect(sent.featured_media).toBe(1370);
    expect(sent['diary-category']).toEqual([12]);
  });

  it('分類法打錯就擋下來，不要把值送到別的欄位', async () => {
    mock = await startMockWordPress(() => ({ status: 201, body: postBody() }));
    await expect(
      createDraft(clientFor(mock), TARGET, { ...FIELDS, terms: { 'read-think-tag': [42] } }),
    ).rejects.toThrow('只接受分類法 diary-category');
    expect(mock.requests).toHaveLength(0);
  });

  it('target 不允許建立時直接拒絕，不發請求', async () => {
    mock = await startMockWordPress(() => ({ status: 201, body: postBody() }));
    const readOnly = PublishTargetSchema.parse({ ...TARGET, allowCreate: false });
    await expect(createDraft(clientFor(mock), readOnly, FIELDS)).rejects.toThrow('不允許建立新內容');
    expect(mock.requests).toHaveLength(0);
  });

  it('建立不重試——重試可能建出兩篇一樣的草稿', async () => {
    mock = await startMockWordPress(() => ({ status: 500, body: {} }));
    await expect(createDraft(clientFor(mock), TARGET, FIELDS)).rejects.toThrow();
    expect(mock.requests).toHaveLength(1);
  });
});

describe('更新時的草稿狀態與寫入前回呼（P5-T022，審查 #1、#2）', () => {
  it('更新固定帶 status:draft', async () => {
    const remote = postBody();
    mock = await startMockWordPress(() => ({ body: remote }));
    await updateDraft(clientFor(mock), TARGET, 1839, FIELDS, { expect: snapshotOf(remote as never, TARGET.taxonomy) });

    const sent = JSON.parse(mock.requests.find((r) => r.method === 'POST')!.body);
    expect(sent.status).toBe('draft');
  });

  it('遠端不是草稿：拒絕，一個寫入都不送', async () => {
    const remote = postBody({ status: 'publish' });
    mock = await startMockWordPress(() => ({ body: remote }));
    await expect(
      updateDraft(clientFor(mock), TARGET, 1839, FIELDS, { expect: snapshotOf(remote as never, TARGET.taxonomy) }),
    ).rejects.toThrow(/已經是 publish/);
    expect(mock.requests.filter((r) => r.method === 'POST')).toHaveLength(0);
  });

  it('beforeWrite 在讀回遠端之後、寫入之前呼叫；丟錯就不寫', async () => {
    const remote = postBody();
    mock = await startMockWordPress(() => ({ body: remote }));
    let getsAtCall = -1;
    const stop = (): void => {
      getsAtCall = mock!.requests.length;
      throw new Error('停');
    };
    await expect(
      updateDraft(clientFor(mock), TARGET, 1839, FIELDS, {
        expect: snapshotOf(remote as never, TARGET.taxonomy),
        beforeWrite: stop,
      }),
    ).rejects.toThrow('停');
    await expect(
      setStatus(clientFor(mock), TARGET, 1839, 'publish', {
        expect: snapshotOf(remote as never, TARGET.taxonomy),
        beforeWrite: stop,
      }),
    ).rejects.toThrow('停');
    expect(getsAtCall).toBe(2);
    expect(mock.requests.filter((r) => r.method === 'POST')).toHaveLength(0);
  });
});

describe('更新前的遠端變動偵測', () => {
  it('遠端沒被動過就正常更新', async () => {
    const remote = postBody();
    mock = await startMockWordPress((req): MockResponse => ({ body: req.method === 'GET' ? remote : postBody() }));

    const expected = snapshotOf(remote as never, TARGET.taxonomy);
    await updateDraft(clientFor(mock), TARGET, 1839, FIELDS, { expect: expected });

    expect(mock.requests[0]!.method).toBe('GET'); // 先重讀
    expect(mock.requests[1]!.method).toBe('POST'); // 才寫入
  });

  it('遠端修改時間變了就中止，絕不覆蓋', async () => {
    const loaded = postBody();
    const changed = postBody({ modified_gmt: '2026-08-28T02:30:00' });
    mock = await startMockWordPress((req): MockResponse => ({ body: req.method === 'GET' ? changed : changed }));

    await expect(
      updateDraft(clientFor(mock), TARGET, 1839, FIELDS, { expect: snapshotOf(loaded as never, TARGET.taxonomy) }),
    ).rejects.toBeInstanceOf(RemoteChangedError);

    // 只有那一次重讀，沒有任何寫入。
    expect(mock.requests.filter((r) => r.method === 'POST')).toHaveLength(0);
  });

  it('修改時間一樣但內容被改過也算變動', async () => {
    // modified_gmt 只到秒，而且有些外掛改內容不會更新它。
    const loaded = postBody();
    const changed = postBody({ content: { raw: '<p>別人改的內容</p>', rendered: '' } });
    mock = await startMockWordPress(() => ({ body: changed }));

    const error = await updateDraft(clientFor(mock), TARGET, 1839, FIELDS, {
      expect: snapshotOf(loaded as never, TARGET.taxonomy),
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RemoteChangedError);
    expect((error as RemoteChangedError).message).toContain('被改過');
  });

  it('target 不允許更新時直接拒絕，連重讀都不做', async () => {
    mock = await startMockWordPress(() => ({ body: postBody() }));
    const createOnly = PublishTargetSchema.parse({ ...TARGET, allowUpdate: false });
    await expect(
      updateDraft(clientFor(mock), createOnly, 1839, FIELDS, { expect: snapshotOf(postBody() as never, TARGET.taxonomy) }),
    ).rejects.toThrow('不允許更新既有內容');
    expect(mock.requests).toHaveLength(0);
  });
});

describe('狀態變更', () => {
  it('改狀態同樣要先確認遠端沒被動過', async () => {
    const remote = postBody();
    mock = await startMockWordPress((req): MockResponse => ({
      body: req.method === 'GET' ? remote : postBody({ status: 'publish' }),
    }));

    const result = await setStatus(clientFor(mock), TARGET, 1839, 'publish', {
      expect: snapshotOf(remote as never, TARGET.taxonomy),
    });

    expect(mock.requests[0]!.method).toBe('GET');
    expect(JSON.parse(mock.requests[1]!.body)).toEqual({ status: 'publish' });
    expect(result.status).toBe('publish');
  });

  it('遠端被動過就不改狀態', async () => {
    const loaded = postBody();
    mock = await startMockWordPress(() => ({ body: postBody({ modified_gmt: '2026-08-28T09:00:00' }) }));
    await expect(
      setStatus(clientFor(mock), TARGET, 1839, 'publish', { expect: snapshotOf(loaded as never, TARGET.taxonomy) }),
    ).rejects.toBeInstanceOf(RemoteChangedError);
    expect(mock.requests.filter((r) => r.method === 'POST')).toHaveLength(0);
  });
});

describe('快照比對的欄位涵蓋 buildPayload 會覆寫的每一個', () => {
  /**
   * 只比 modified_gmt 與內容 hash 是不夠的：我們每次更新都會覆寫標題、網址代稱、
   * 精選圖片與分類。少比一個，別人在那個欄位上的修改就會被無聲蓋掉。
   */
  const cases: { name: string; changed: Record<string, unknown>; field: string }[] = [
    { name: '標題', changed: { title: { raw: '別人改的', rendered: '別人改的' } }, field: '標題' },
    { name: '網址代稱', changed: { slug: 'someone-else' }, field: '網址代稱' },
    { name: '精選圖片', changed: { featured_media: 42 }, field: '精選圖片' },
    { name: '狀態', changed: { status: 'publish' }, field: '狀態' },
    { name: '分類', changed: { 'diary-category': [7] }, field: '分類' },
  ];

  for (const testCase of cases) {
    it(`遠端只改了${testCase.name}也偵測得到`, async () => {
      const loaded = postBody({ 'diary-category': [1, 2] });
      const changed = postBody({ 'diary-category': [1, 2], ...testCase.changed });
      mock = await startMockWordPress(() => ({ body: changed }));

      const error = await updateDraft(clientFor(mock), TARGET, 1839, FIELDS, {
        expect: snapshotOf(loaded as never, TARGET.taxonomy),
      }).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(RemoteChangedError);
      expect((error as RemoteChangedError).changedFields.join('')).toContain(testCase.field);
      expect(mock.requests.filter((r) => r.method === 'POST')).toHaveLength(0);
    });
  }

  it('分類的順序不影響比對（我們沒改它就不算改動）', async () => {
    const loaded = postBody({ 'diary-category': [2, 1] });
    mock = await startMockWordPress((req): MockResponse => ({
      body: req.method === 'GET' ? postBody({ 'diary-category': [1, 2] }) : postBody(),
    }));

    await expect(
      updateDraft(clientFor(mock), TARGET, 1839, FIELDS, {
        expect: snapshotOf(loaded as never, TARGET.taxonomy),
      }),
    ).resolves.toBeDefined();
  });
});
