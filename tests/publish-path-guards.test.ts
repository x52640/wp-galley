import { afterEach, describe, expect, it } from 'vitest';

import {
  approveJob,
  createCoreFixture,
  defaultWordPressHandler,
  TINY_PNG,
  type CoreFixture,
} from './helpers/core-fixture.js';
import { PublishBlockedError } from '../src/core/errors.js';
import { createTargetRegistry, PublishTargetSchema } from '../src/wordpress/targets.js';
import type { RecordedRequest } from './helpers/mock-wordpress.js';

/**
 * P5-T022（審查 #3、#2、#1、#13）：發布路徑的防護。
 * 一律對著本機假 WordPress 跑，絕不連真站。
 */

const SOURCE = '今天讀完這本書，想到很多事。\n\n不是書裡寫的那些，而是別的。';

let fixture: CoreFixture | null = null;

afterEach(async () => {
  await fixture?.cleanup();
  fixture = null;
});

async function setup(options: Parameters<typeof createCoreFixture>[0] = {}): Promise<CoreFixture> {
  fixture = await createCoreFixture(options);
  return fixture;
}

const pathOf = (request: RecordedRequest): string => request.path.split('?')[0] ?? '';
const writes = (f: CoreFixture): RecordedRequest[] => f.requests.filter((request) => request.method !== 'GET');

/** 綁定固定物件的 target：不建新的，永遠更新同一個 ID（目前唯一會走到「更新既有文章」的路）。 */
const FIXED_TARGET = {
  key: 'fixed',
  displayName: '固定物件',
  contentType: 'longform',
  postType: 'read-think',
  restBase: 'read-think',
  templateId: 'longform-v1',
  taxonomy: 'read-think-tag',
  fixedObjectId: 777,
  allowCreate: false,
  allowUpdate: true,
  requireFeaturedImage: false,
};

function fixedTargets() {
  return createTargetRegistry([PublishTargetSchema.parse(FIXED_TARGET)]);
}

/** 遠端那篇 777。狀態、封面、分類可以在測試裡改。 */
function remotePost(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 777,
    status: 'draft',
    link: 'https://example.test/?p=777',
    slug: 'fixed',
    title: { raw: '固定頁', rendered: '固定頁' },
    content: { raw: '<p>遠端內容</p>', rendered: '<p>遠端內容</p>' },
    featured_media: 0,
    'read-think-tag': [],
    date_gmt: '2026-08-28T00:00:00',
    modified_gmt: '2026-08-28T00:00:00',
    ...overrides,
  };
}

function fixedHandler(remote: () => Record<string, unknown>) {
  return (request: RecordedRequest) => {
    const path = pathOf(request);
    if (path === '/wp-json/wp/v2/read-think-tag') return { body: [], headers: { 'X-WP-TotalPages': '1' } };
    if (path === '/wp-json/wp/v2/read-think/777') {
      if (request.method === 'POST') {
        const payload = JSON.parse(request.body || '{}') as Record<string, unknown>;
        return { body: { ...remote(), ...(typeof payload['status'] === 'string' ? { status: payload['status'] } : {}) } };
      }
      return { body: remote() };
    }
    return { status: 404, body: { code: 'rest_no_route', message: '找不到端點', data: { status: 404 } } };
  };
}

// --- #3：換圖／上傳與發布的競態 ------------------------------------------------

describe('#3 換圖／上傳等待期間的變動', () => {
  /** 第 n 次（從 1 起算）上傳時跑 hook，並讓那次上傳晚一點回來。 */
  function uploadHook(uploadNumber: number, hook: () => void) {
    const base = defaultWordPressHandler();
    let uploads = 0;
    return (request: RecordedRequest) => {
      const response = base(request);
      if (request.method === 'POST' && pathOf(request) === '/wp-json/wp/v2/media') {
        uploads += 1;
        if (uploads === uploadNumber) {
          hook();
          return { ...response, delayMs: 300 };
        }
      }
      return response;
    };
  }

  it('換圖上傳期間工作變成不能改（取消），回來後不覆寫本機媒體紀錄、講清楚圖留在媒體庫', async () => {
    let uuid = '';
    const f = await setup({ handler: uploadHook(2, () => fixture!.core.cancelJob(uuid)) });
    uuid = f.core.createJob({ targetKey: 'diary', sourceText: SOURCE, title: '20260828' }).uuid;
    const asset = await f.core.addMedia(uuid, { bytes: TINY_PNG, mimeType: 'image/png', filename: 'a' });
    f.core.placeMedia(uuid, asset.id, 0);
    const revisionsBefore = f.core.listRevisions(uuid).length;

    const error = await f.core
      .replaceMedia(uuid, asset.id, { bytes: TINY_PNG, mimeType: 'image/png', filename: 'b' })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect(String((error as Error).message)).toMatch(/CANCELLED/);
    expect(String((error as Error).message)).toMatch(/媒體庫/);
    // 本機紀錄還是舊那張，沒有新版本，也沒有記「換圖成功」。
    const media = f.core.getJob(uuid).media.find((item) => item.id === asset.id);
    expect(media?.wordpressMediaId).toBe(asset.wordpressMediaId);
    expect(f.core.listRevisions(uuid)).toHaveLength(revisionsBefore);
    const replacedEvents = f.core.listEvents(uuid).filter((event) => event.eventType === 'media_replaced');
    expect(replacedEvents.map((event) => event.status)).toEqual(['failed']);
  });

  it('上傳期間工作變成不能改，回來後不新增本機媒體紀錄', async () => {
    let uuid = '';
    const f = await setup({ handler: uploadHook(1, () => fixture!.core.cancelJob(uuid)) });
    uuid = f.core.createJob({ targetKey: 'diary', sourceText: SOURCE, title: '20260828' }).uuid;

    await expect(
      f.core.addMedia(uuid, { bytes: TINY_PNG, mimeType: 'image/png', filename: 'a' }),
    ).rejects.toThrow(/媒體庫/);
    expect(f.core.getJob(uuid).media).toHaveLength(0);
    const addedEvents = f.core.listEvents(uuid).filter((event) => event.eventType === 'media_added');
    expect(addedEvents.map((event) => event.status)).toEqual(['failed']);
  });

  it('換圖上傳期間重新核准再發布，發布會被拒絕', async () => {
    let uuid = '';
    let publishing: Promise<unknown> | null = null;
    const f = await setup({
      handler: uploadHook(2, () => {
        approveJob(fixture!.core, uuid);
        publishing = fixture!.core.publish(uuid, { status: 'draft' });
        publishing.catch(() => undefined);
      }),
    });
    uuid = f.core.createJob({ targetKey: 'diary', sourceText: SOURCE, title: '20260828' }).uuid;
    const asset = await f.core.addMedia(uuid, { bytes: TINY_PNG, mimeType: 'image/png', filename: 'a' });
    f.core.placeMedia(uuid, asset.id, 0);
    approveJob(f.core, uuid);

    await f.core.replaceMedia(uuid, asset.id, { bytes: TINY_PNG, mimeType: 'image/png', filename: 'b' });

    expect(publishing).not.toBeNull();
    await expect(publishing!).rejects.toThrow(/圖片正在上傳/);
    expect(writes(f).filter((request) => pathOf(request) === '/wp-json/wp/v2/diary')).toHaveLength(0);
    // 換圖照常完成：新版本、核准失效。
    expect(f.core.getJob(uuid).state).toBe('RENDERED');
  });

  it('上傳圖片期間按發布會被拒絕', async () => {
    let uuid = '';
    let publishing: Promise<unknown> | null = null;
    const f = await setup({
      handler: uploadHook(1, () => {
        publishing = fixture!.core.publish(uuid, { status: 'draft' });
        publishing.catch(() => undefined);
      }),
    });
    uuid = f.core.createJob({ targetKey: 'diary', sourceText: SOURCE, title: '20260828' }).uuid;
    approveJob(f.core, uuid);

    await f.core.addMedia(uuid, { bytes: TINY_PNG, mimeType: 'image/png', filename: 'a' });

    await expect(publishing!).rejects.toThrow(PublishBlockedError);
    expect(f.core.getJob(uuid).state).toBe('APPROVED');
    // 上傳結束後就能發。
    await expect(f.core.publish(uuid, { status: 'draft' })).resolves.toMatchObject({ created: true });
  });
});

// --- #2：PUBLISHING 期間撤銷核准 ------------------------------------------------

describe('#2 發布途中撤銷核准', () => {
  function diaryJobWithCategory(f: CoreFixture): string {
    return f.core.createJob({
      targetKey: 'diary',
      sourceText: SOURCE,
      templateData: { title: '20260828', body: '<p class="wp-block-paragraph">內文</p>', category: '生活' },
    }).uuid;
  }

  it('建草稿時被撤銷：不改成公開，停在草稿、工作標失敗、記事件、講清楚', async () => {
    let uuid = '';
    const base = defaultWordPressHandler();
    const f = await setup({
      handler: (request) => {
        if (request.method === 'POST' && pathOf(request) === '/wp-json/wp/v2/diary') {
          fixture!.core.revokeApproval(uuid, '使用者反悔了');
        }
        return base(request);
      },
    });
    uuid = diaryJobWithCategory(f);
    approveJob(f.core, uuid);

    const error = await f.core.publish(uuid, { status: 'publish' }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(PublishBlockedError);
    expect(String((error as Error).message)).toMatch(/核准.*撤銷/);
    expect(String((error as Error).message)).toMatch(/草稿/);
    // 沒有任何把狀態改成公開的請求。
    expect(f.requests.some((request) => request.body.includes('"publish"'))).toBe(false);
    expect(f.core.getJob(uuid).state).toBe('FAILED');
    expect(
      f.core.listEvents(uuid).some((event) => event.eventType === 'publish' && event.status === 'failed'),
    ).toBe(true);
  });

  it('查分類時被撤銷：一個寫入請求都不送', async () => {
    let uuid = '';
    const base = defaultWordPressHandler();
    const f = await setup({
      handler: (request) => {
        if (pathOf(request) === '/wp-json/wp/v2/diary-category') fixture!.core.revokeApproval(uuid, '反悔');
        return base(request);
      },
    });
    uuid = diaryJobWithCategory(f);
    approveJob(f.core, uuid);

    await expect(f.core.publish(uuid, { status: 'publish' })).rejects.toThrow(/核准.*撤銷/);
    expect(writes(f)).toHaveLength(0);
    expect(f.core.getJob(uuid).state).toBe('FAILED');
  });
});

describe('#2 撤銷發生在寫入前讀遠端的那段等待', () => {
  it('setStatus 讀遠端期間被撤銷：不送 status:publish，工作標失敗', async () => {
    let uuid = '';
    const base = defaultWordPressHandler();
    const f = await setup({
      handler: (request) => {
        if (request.method === 'GET' && /^\/wp-json\/wp\/v2\/diary\/\d+$/.test(pathOf(request))) {
          fixture!.core.revokeApproval(uuid, '反悔');
        }
        return base(request);
      },
    });
    uuid = f.core.createJob({ targetKey: 'diary', sourceText: SOURCE, title: '20260828' }).uuid;
    approveJob(f.core, uuid);

    const error = await f.core.publish(uuid, { status: 'publish' }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(PublishBlockedError);
    expect(String((error as Error).message)).toMatch(/核准.*撤銷/);
    expect(String((error as Error).message)).toMatch(/草稿/);
    // 只有建草稿那一個寫入，沒有改成公開的請求。
    expect(writes(f).map(pathOf)).toEqual(['/wp-json/wp/v2/diary']);
    expect(f.core.getJob(uuid).state).toBe('FAILED');
  });

  it('updateDraft 讀遠端期間被撤銷：零寫入，工作標失敗', async () => {
    let uuid = '';
    let armed = false;
    let gets = 0;
    const base = fixedHandler(() => remotePost());
    const f = await setup({
      targets: fixedTargets(),
      handler: (request) => {
        if (armed && request.method === 'GET' && pathOf(request) === '/wp-json/wp/v2/read-think/777') {
          gets += 1;
          // 第 1 次是前置檢查的比對，第 2 次是 updateDraft 裡寫入前的比對。
          if (gets === 2) fixture!.core.revokeApproval(uuid, '反悔');
        }
        return base(request);
      },
    });
    uuid = f.core.createJob({ targetKey: 'fixed', sourceText: SOURCE, title: '固定頁' }).uuid;
    approveJob(f.core, uuid);
    await expect(f.core.publish(uuid, { status: 'draft' })).rejects.toThrow(/比對基準/);

    armed = true;
    await expect(f.core.publish(uuid, { status: 'draft' })).rejects.toThrow(/核准.*撤銷/);
    expect(gets).toBe(2);
    expect(writes(f)).toHaveLength(0);
    expect(f.core.getJob(uuid).state).toBe('FAILED');
  });
});

// --- #1：更新既有文章時選草稿 ------------------------------------------------

describe('#1 更新既有文章時選草稿', () => {
  for (const [status, choice] of [
    ['publish', 'draft'],
    ['future', 'draft'],
    ['publish', 'publish'],
    ['private', 'publish'],
  ] as const) {
    it(`遠端那篇是 ${status}、使用者選 ${choice}：直接拒絕、不送任何寫入`, async () => {
      const f = await setup({ targets: fixedTargets(), handler: fixedHandler(() => remotePost({ status })) });
      const uuid = f.core.createJob({ targetKey: 'fixed', sourceText: SOURCE, title: '固定頁' }).uuid;
      approveJob(f.core, uuid);
      await expect(f.core.publish(uuid, { status: 'draft' })).rejects.toThrow(/比對基準/);

      await expect(f.core.publish(uuid, { status: choice })).rejects.toThrow(
        new RegExp(`已經是 ${status}.*不支援修改已公開的文章.*Q-5`),
      );
      expect(writes(f)).toHaveLength(0);
      // 前置檢查擋下，沒進 PUBLISHING，核准還在。
      expect(f.core.getJob(uuid).state).toBe('APPROVED');
    });
  }

  it('遠端是草稿：更新時固定帶 status:draft', async () => {
    const f = await setup({ targets: fixedTargets(), handler: fixedHandler(() => remotePost()) });
    const uuid = f.core.createJob({ targetKey: 'fixed', sourceText: SOURCE, title: '固定頁' }).uuid;
    approveJob(f.core, uuid);
    await expect(f.core.publish(uuid, { status: 'draft' })).rejects.toThrow(/比對基準/);

    await f.core.publish(uuid, { status: 'draft' });
    const update = writes(f).find((request) => pathOf(request) === '/wp-json/wp/v2/read-think/777');
    expect(JSON.parse(update!.body)).toMatchObject({ status: 'draft' });
  });
});

// --- #13：更新既有文章時清除封面與分類 ------------------------------------------

describe('#13 更新既有文章時送完整的封面與分類', () => {
  it('沒有封面、沒有分類：送 featured_media 0 與空分類陣列', async () => {
    const f = await setup({
      targets: fixedTargets(),
      handler: fixedHandler(() => remotePost({ featured_media: 1370, 'read-think-tag': [12] })),
    });
    const uuid = f.core.createJob({ targetKey: 'fixed', sourceText: SOURCE, title: '固定頁' }).uuid;
    approveJob(f.core, uuid);
    await expect(f.core.publish(uuid, { status: 'draft' })).rejects.toThrow(/比對基準/);

    await f.core.publish(uuid, { status: 'draft' });
    const update = writes(f).find((request) => pathOf(request) === '/wp-json/wp/v2/read-think/777');
    const payload = JSON.parse(update!.body) as Record<string, unknown>;
    expect(payload['featured_media']).toBe(0);
    expect(payload['read-think-tag']).toEqual([]);
  });

  it('有分類名稱但全部查不到：不送分類欄位（不清掉遠端的），照報 unknownTerms', async () => {
    const f = await setup({
      targets: fixedTargets(),
      handler: fixedHandler(() => remotePost({ 'read-think-tag': [12] })),
    });
    const uuid = f.core.createJob({
      targetKey: 'fixed',
      sourceText: SOURCE,
      templateData: { title: '固定頁', body: '<p class="wp-block-paragraph">內文</p>', tags: ['查不到'] },
    }).uuid;
    approveJob(f.core, uuid);
    await expect(f.core.publish(uuid, { status: 'draft' })).rejects.toThrow(/比對基準/);

    const result = await f.core.publish(uuid, { status: 'draft' });
    expect(result.unknownTerms).toEqual(['查不到']);
    const update = writes(f).find((request) => pathOf(request) === '/wp-json/wp/v2/read-think/777');
    expect(JSON.parse(update!.body)).not.toHaveProperty('read-think-tag');
  });

  it('建立新稿維持原樣：沒有封面、沒有分類就不送那兩個欄位', async () => {
    const f = await setup();
    const uuid = f.core.createJob({ targetKey: 'diary', sourceText: SOURCE, title: '20260828' }).uuid;
    approveJob(f.core, uuid);

    await f.core.publish(uuid, { status: 'draft' });
    const created = writes(f).find((request) => pathOf(request) === '/wp-json/wp/v2/diary');
    const payload = JSON.parse(created!.body) as Record<string, unknown>;
    expect(payload).not.toHaveProperty('featured_media');
    expect(payload).not.toHaveProperty('diary-category');
  });
});
