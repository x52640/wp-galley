import { afterEach, describe, expect, it } from 'vitest';
import { approveJob, createCoreFixture, TINY_PNG, type CoreFixture } from './helpers/core-fixture.js';
import type { CoreService } from '../src/core/service.js';

/**
 * 設定精靈換站之後（P8-T002）：任何東西都不能打到錯的站。
 *
 * - 發到過舊站的稿件：在新站上不會「更新第 N 號」（新站的第 N 號是別人的東西），也不會偷偷改發一篇新的。
 * - 傳到舊站媒體庫的圖：不能當新站的封面、不能放進正文、發布前會擋。
 * - 換回舊站：一切照舊。
 * 換設定的期間，會碰 WordPress 的動作一律擋；有動作在跑時不准換。
 */

const SOURCE = '今天讀完這本書，想到很多事。\n\n不是書裡寫的那些，而是別的。';
const SITE_A = { key: 'https://a.example', displayName: 'https://a.example', baseUrl: 'https://a.example', username: 'ming' };
const SITE_B = { key: 'https://b.example', displayName: 'https://b.example', baseUrl: 'https://b.example', username: 'ming' };

let fixture: CoreFixture | null = null;
afterEach(async () => {
  await fixture?.cleanup();
  fixture = null;
});

async function setupOnA(): Promise<CoreFixture> {
  fixture = await createCoreFixture();
  fixture.core.reconfigure({ site: SITE_A });
  return fixture;
}

function newDiary(core: CoreService): string {
  return core.createJob({ targetKey: 'diary', sourceText: SOURCE, title: '20260828' }).uuid;
}

/** 把已發布的稿件退回可以再核准的狀態（模擬發布到一半失敗、之後重試）。 */
function reopen(f: CoreFixture, uuid: string): void {
  f.db.handle.prepare("UPDATE jobs SET state = 'RENDERED' WHERE uuid = ?").run(uuid);
}

function writesAfter(f: CoreFixture, from: number) {
  return f.requests.slice(from).filter((request) => request.method !== 'GET');
}

describe('換站之後', () => {
  it('發到過舊站的稿件：新站上不更新、不新建，講清楚；換回舊站照常更新', async () => {
    const f = await setupOnA();
    const uuid = newDiary(f.core);
    approveJob(f.core, uuid);
    const first = await f.core.publish(uuid, { status: 'draft' });
    expect(first.created).toBe(true);

    f.core.reconfigure({ site: SITE_B });
    // 已經有遠端物件、又要再發一次的真實情境是「發到一半失敗後重試」；這裡直接把狀態退回去模擬。
    reopen(f, uuid);
    approveJob(f.core, uuid);

    const before = f.requests.length;
    await expect(f.core.publish(uuid, { status: 'draft' })).rejects.toThrow(/另一個站（https:\/\/a\.example，第 \d+ 號）/);
    expect(writesAfter(f, before)).toHaveLength(0);

    f.core.reconfigure({ site: SITE_A });
    reopen(f, uuid);
    approveJob(f.core, uuid);
    const again = await f.core.publish(uuid, { status: 'draft' });
    expect(again.created).toBe(false);
    expect(again.wordpressId).toBe(first.wordpressId);
  });

  it('封面是舊站的圖：發布前擋下，一個寫入都不送', async () => {
    const f = await setupOnA();
    const uuid = newDiary(f.core);
    const media = await f.core.addMedia(uuid, { bytes: TINY_PNG, mimeType: 'image/png', filename: 'a.png' });
    f.core.setFeaturedMedia(uuid, media.id);
    f.core.reconfigure({ site: SITE_B });
    approveJob(f.core, uuid);

    const before = f.requests.length;
    await expect(f.core.publish(uuid, { status: 'draft' })).rejects.toThrow(/封面圖是傳到另一個站的/);
    expect(writesAfter(f, before)).toHaveLength(0);
  });

  it('正文裡放了舊站的圖：發布前擋下', async () => {
    const f = await setupOnA();
    const uuid = newDiary(f.core);
    const media = await f.core.addMedia(uuid, { bytes: TINY_PNG, mimeType: 'image/png', filename: 'a.png' });
    f.core.placeMedia(uuid, media.id, 0);
    f.core.reconfigure({ site: SITE_B });
    approveJob(f.core, uuid);

    await expect(f.core.publish(uuid, { status: 'draft' })).rejects.toThrow(/正文裡有 1 張圖是傳到另一個站的/);
  });

  it('舊站的圖不能設成封面、不能放進正文；在新站重新上傳的可以', async () => {
    const f = await setupOnA();
    const uuid = newDiary(f.core);
    const old = await f.core.addMedia(uuid, { bytes: TINY_PNG, mimeType: 'image/png', filename: 'a.png' });
    f.core.reconfigure({ site: SITE_B });

    expect(() => f.core.setFeaturedMedia(uuid, old.id)).toThrow(/另一個站的媒體庫/);
    expect(() => f.core.placeMedia(uuid, old.id, 0)).toThrow(/另一個站的媒體庫/);

    const fresh = await f.core.addMedia(uuid, { bytes: TINY_PNG, mimeType: 'image/png', filename: 'b.png' });
    expect(() => f.core.setFeaturedMedia(uuid, fresh.id)).not.toThrow();
    approveJob(f.core, uuid);
    const result = await f.core.publish(uuid, { status: 'draft' });
    expect(result.created).toBe(true);
  });

  it('兩個站的媒體庫編號撞號：各算各的', async () => {
    const f = await setupOnA();
    const onA = newDiary(f.core);
    const a = await f.core.addMedia(onA, { bytes: TINY_PNG, mimeType: 'image/png', filename: 'a.png' });
    f.core.reconfigure({ site: SITE_B });
    // 假站台的編號一路往上加，這裡手動讓 B 站也出現同一個編號的圖（屬於另一篇）。
    const onB = newDiary(f.core);
    const b = await f.core.addMedia(onB, { bytes: TINY_PNG, mimeType: 'image/png', filename: 'b.png' });
    f.db.handle
      .prepare('UPDATE media_assets SET wordpress_media_id = ? WHERE id = ?')
      .run(a.wordpressMediaId, b.id);
    f.db.handle
      .prepare("UPDATE wordpress_objects SET wordpress_id = ? WHERE object_type = 'media' AND wordpress_id = ?")
      .run(a.wordpressMediaId, b.wordpressMediaId);

    expect(() => f.core.setFeaturedMedia(onA, a.id)).toThrow(/另一個站/);
    expect(() => f.core.setFeaturedMedia(onB, b.id)).not.toThrow();
  });

  it('沒有站台紀錄的舊資料不受影響（當成目前這個站）', async () => {
    fixture = await createCoreFixture(); // 沒有 site：物件的 site_id 是 NULL
    const f = fixture;
    const uuid = newDiary(f.core);
    const media = await f.core.addMedia(uuid, { bytes: TINY_PNG, mimeType: 'image/png', filename: 'a.png' });
    approveJob(f.core, uuid);
    await f.core.publish(uuid, { status: 'draft' });

    f.core.reconfigure({ site: SITE_A });
    reopen(f, uuid);
    expect(() => f.core.setFeaturedMedia(uuid, media.id)).not.toThrow();
    approveJob(f.core, uuid);
    const again = await f.core.publish(uuid, { status: 'draft' });
    expect(again.created).toBe(false);
  });

  it('currentSiteUsage 數得出這個站發過幾篇、傳過幾張', async () => {
    const f = await setupOnA();
    const uuid = newDiary(f.core);
    await f.core.addMedia(uuid, { bytes: TINY_PNG, mimeType: 'image/png', filename: 'a.png' });
    approveJob(f.core, uuid);
    await f.core.publish(uuid, { status: 'draft' });
    expect(f.core.currentSiteUsage()).toEqual({ publishedJobs: 1, uploadedMedia: 1 });
    f.core.reconfigure({ site: SITE_B });
    expect(f.core.currentSiteUsage()).toEqual({ publishedJobs: 0, uploadedMedia: 0 });
  });
});

describe('換設定的期間', () => {
  it('旗子立著：上傳、換圖、發布、放圖、設封面一律擋；放下之後照常', async () => {
    const f = await setupOnA();
    const uuid = newDiary(f.core);
    const media = await f.core.addMedia(uuid, { bytes: TINY_PNG, mimeType: 'image/png', filename: 'a.png' });
    approveJob(f.core, uuid);

    expect(f.core.tryBeginReconfigure()).toBeNull();
    const input = { bytes: TINY_PNG, mimeType: 'image/png', filename: 'b.png' };
    await expect(f.core.addMedia(uuid, input)).rejects.toThrow(/設定精靈正在儲存/);
    await expect(f.core.replaceMedia(uuid, media.id, input)).rejects.toThrow(/設定精靈正在儲存/);
    await expect(f.core.publish(uuid, { status: 'draft' })).rejects.toThrow(/設定精靈正在儲存/);
    expect(() => f.core.placeMedia(uuid, media.id, 0)).toThrow(/設定精靈正在儲存/);
    expect(() => f.core.setFeaturedMedia(uuid, media.id)).toThrow(/設定精靈正在儲存/);
    expect(f.core.tryBeginReconfigure()).toMatch(/儲存中/);
    f.core.endReconfigure();

    await expect(f.core.publish(uuid, { status: 'draft' })).resolves.toMatchObject({ created: true });
  });

  it('有上傳正在跑：不准開始換設定，reconfigure 也拒絕', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    fixture = await createCoreFixture();
    const f = fixture;
    f.core.reconfigure({ site: SITE_A });
    const uuid = newDiary(f.core);

    // 讓上傳卡在 WordPress 那一端：用一個慢的假站台請求。
    const slowClient = {
      request: async () => {
        await gate;
        return {
          data: { id: 1, source_url: 'https://a.example/1.png', mime_type: 'image/png', media_type: 'image', alt_text: '', title: { raw: '', rendered: '' } },
          status: 201,
          totalItems: null,
          totalPages: null,
        };
      },
    };
    f.core.reconfigure({ wordpress: slowClient as never });
    const upload = f.core.addMedia(uuid, { bytes: TINY_PNG, mimeType: 'image/png', filename: 'a.png' });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(f.core.tryBeginReconfigure()).toMatch(/上傳/);
    expect(() => f.core.reconfigure({ site: SITE_B })).toThrow(/不能換設定/);
    release();
    await upload;
    expect(f.core.tryBeginReconfigure()).toBeNull();
    f.core.endReconfigure();
  });
});
