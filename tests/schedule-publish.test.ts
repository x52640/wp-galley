import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkSchedule, checkInFlightSchedule } from '../src/contract/schedule.js';
import { nonDraftUpdateMessage } from '../src/wordpress/posts.js';
import { approveJob, createCoreFixture, defaultWordPressHandler, type CoreFixture } from './helpers/core-fixture.js';

let fixture: CoreFixture | null = null;
afterEach(async () => { await fixture?.cleanup(); fixture = null; vi.restoreAllMocks(); });
const scheduledAt = () => new Date(Date.now() + 24 * 60 * 60_000).toISOString();
const writes = () => fixture!.requests.filter(r => r.method === 'POST').map(r => JSON.parse(r.body));
async function setup(options: Parameters<typeof createCoreFixture>[0] = {}) {
  fixture = await createCoreFixture({ ...options, wordpress: 'in-process' });
  const uuid = fixture.core.createJob({ targetKey: 'diary', title: '20261030', sourceText: '這是一篇測試文章。' }).uuid;
  approveJob(fixture.core, uuid);
  return { core: fixture.core, uuid };
}

describe('排程時間共用契約', () => {
  const now = Date.parse('2026-10-30T00:00:00Z');
  it.each([undefined, 'garbage', '2026-02-30T00:00:00Z', '2026-10-30T08:06:00', '2026-10-30T00:06:00+00:00',
    '2026-10-29T23:59:00Z', '2026-10-30T00:04:00Z', '2026-10-30T00:05:00Z'])('拒絕缺少、非 UTC、錯誤或太近的時間 %s', value => {
    expect(checkSchedule(value, now)).not.toBeNull();
  });
  it('六分鐘後可排程', () => expect(checkSchedule('2026-10-30T00:06:00Z', now)).toBeNull());
});

describe('排程發布與取消（只用假 WordPress）', () => {
  it('先建草稿、再送 future 與 date_gmt，存回實際日期與事件', async () => {
    const { core, uuid } = await setup();
    const dateGmt = scheduledAt();
    const result = await core.publish(uuid, { status: 'future', scheduledAt: dateGmt, confirm: true });
    expect(writes()).toEqual([expect.objectContaining({ status: 'draft' }), { status: 'future', date_gmt: dateGmt }]);
    expect(result).toMatchObject({ status: 'future', dateGmt });
    expect(core.getJob(uuid).published).toMatchObject({ status: 'future', dateGmt });
    expect(core.listJobs()[0]).toMatchObject({ publishedStatus: 'future', publishedDateGmt: dateGmt });
    expect(core.listEvents(uuid).filter(e => e.eventType === 'publish' && e.status === 'succeeded')[0]?.detail).toMatchObject({ scheduledAt: dateGmt });
  });
  it.each([undefined, 'invalid', '2000-01-01T00:00:00Z', new Date(Date.now() + 4 * 60_000).toISOString()])('後端拒絕 %s、零寫入', async scheduledAt => {
    const { core, uuid } = await setup();
    await expect(core.publish(uuid, { status: 'future', ...(scheduledAt === undefined ? {} : { scheduledAt }), confirm: true })).rejects.toThrow(/排程/);
    expect(writes()).toEqual([]);
    expect(core.getJob(uuid).state).toBe('APPROVED');
  });
  it('沒有再次確認就不排程', async () => {
    const { core, uuid } = await setup();
    await expect(core.publish(uuid, { status: 'future', scheduledAt: scheduledAt() })).rejects.toThrow(/確認/);
    expect(writes()).toEqual([]);
  });
  it.each(['create', 'read'] as const)('核准在 %s 時撤銷就停在草稿', async when => {
    let uuid = '';
    const base = defaultWordPressHandler();
    const f = await setup({ handler: r => {
      if ((when === 'create' && r.method === 'POST' && r.path.endsWith('/diary')) ||
          (when === 'read' && r.method === 'GET' && /\/diary\/\d+/.test(r.path))) fixture!.core.revokeApproval(uuid, '反悔了');
      return base(r);
    } });
    uuid = f.uuid;
    await expect(f.core.publish(uuid, { status: 'future', scheduledAt: scheduledAt(), confirm: true })).rejects.toThrow(/撤銷.*草稿/);
    expect(writes()).toEqual([expect.objectContaining({ status: 'draft' })]);
  });
  it.each([['future', 'publish'], ['publish', 'future']] as const)('要求 %s、WordPress 回 %s 就如實回報', async (requested, actual) => {
    const base = defaultWordPressHandler();
    const { core, uuid } = await setup({ handler: r => {
      const response = base(r);
      if (r.method === 'POST' && JSON.parse(r.body).status === requested) return { ...response, body: { ...(response.body as object), status: actual } };
      return response;
    } });
    const result = await core.publish(uuid, { status: requested, scheduledAt: scheduledAt(), confirm: true });
    expect(result.status).toBe(actual);
    expect(core.getJob(uuid).published?.status).toBe(actual);
  });
  it('future 的拒絕訊息引導取消排程', () => expect(nonDraftUpdateMessage('future')).toMatch(/這篇已排程.*取消排程/));
  it('取消不用核准、只改草稿並重設日期，保存快照，job 仍是 PUBLISHED', async () => {
    const { core, uuid } = await setup();
    await core.publish(uuid, { status: 'future', scheduledAt: scheduledAt(), confirm: true });
    core.revokeApproval(uuid, '撤銷核准');
    const cancelled = await core.cancelSchedule(uuid);
    expect(writes().at(-1)).toEqual({ status: 'draft', date: null, date_gmt: null });
    expect(cancelled.status).toBe('draft');
    expect(core.getJob(uuid).published?.status).toBe('draft');
    expect(core.getJob(uuid).state).toBe('PUBLISHED');
    expect(core.listEvents(uuid).some(e => e.eventType === 'schedule_cancelled' && e.status === 'succeeded')).toBe(true);
    await expect(core.cancelSchedule(uuid)).rejects.toThrow(/草稿/);
  });
  it.each(['publish', 'title', 'date'] as const)('遠端的 %s 已變動就拒絕取消、零額外寫入', async change => {
    let armed = false;
    const base = defaultWordPressHandler();
    const { core, uuid } = await setup({ handler: r => {
      const response = base(r);
      if (armed && r.method === 'GET' && /\/diary\/\d+/.test(r.path)) {
        const changed = change === 'publish' ? { status: 'publish' } : change === 'title' ? { title: { raw: '後台改了' } } : { date_gmt: '2099-01-01T00:00:00' };
        return { ...response, body: { ...(response.body as object), ...changed } };
      }
      return response;
    } });
    await core.publish(uuid, { status: 'future', scheduledAt: scheduledAt(), confirm: true });
    armed = true;
    await expect(core.cancelSchedule(uuid)).rejects.toThrow(change === 'publish' ? /已公開/ : /改過/);
    expect(writes()).toHaveLength(2);
    expect(core.getJob(uuid).published?.status).toBe('future');
  });
});


describe('排程的額外守門', () => {
  it('MCP 不能排程，零寫入', async () => {
    const { core, uuid } = await setup();
    await expect(core.publish(uuid, { status: 'future', scheduledAt: scheduledAt(), confirm: true, actor: 'mcp' })).rejects.toThrow(/本機發布面板/);
    expect(writes()).toEqual([]);
  });
  it('取消回應不是草稿時保存真實狀態並說明沒取消成功', async () => {
    const base = defaultWordPressHandler();
    const { core, uuid } = await setup({ handler: r => {
      const response = base(r);
      if (r.method === 'POST' && JSON.parse(r.body).date_gmt === null) return { ...response, body: { ...(response.body as object), status: 'future' } };
      return response;
    } });
    await core.publish(uuid, { status: 'future', scheduledAt: scheduledAt(), confirm: true });
    await expect(core.cancelSchedule(uuid)).rejects.toThrow(/沒有取消成功/);
    expect(core.getJob(uuid).published?.status).toBe('future');
  });
  it('缺少快照不能取消排程', async () => {
    const { core, uuid } = await setup();
    await core.publish(uuid, { status: 'future', scheduledAt: scheduledAt(), confirm: true });
    fixture!.db.handle.prepare('UPDATE wordpress_objects SET remote_snapshot_json = NULL').run();
    await expect(core.cancelSchedule(uuid)).rejects.toThrow(/比對基準/);
    expect(writes()).toHaveLength(2);
  });
});


describe('排程途中採一分鐘門檻', () => {
  const now = Date.parse('2026-10-30T00:00:00Z');
  it('前置檢查拒絕四分鐘，但寫入前的三分鐘可通過、三十秒拒絕', () => {
    expect(checkSchedule(new Date(now + 4 * 60_000).toISOString(), now)).not.toBeNull();
    expect(checkInFlightSchedule(new Date(now + 3 * 60_000).toISOString(), now)).toBeNull();
    expect(checkInFlightSchedule(new Date(now + 30_000).toISOString(), now)).not.toBeNull();
    expect(checkInFlightSchedule(new Date(now + 60_000).toISOString(), now)).toBeNull();
    expect(checkInFlightSchedule('bad', now)).not.toBeNull();
  });
  it('建立草稿的慢網路讓剩餘時間變三分鐘，仍可完成排程', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    const base = defaultWordPressHandler();
    const { core, uuid } = await setup({ handler: request => {
      const response = base(request);
      if (request.method === 'POST' && request.path.endsWith('/diary')) clock.mockReturnValue(now + 3 * 60_000);
      return response;
    } });
    await expect(core.publish(uuid, { status: 'future', scheduledAt: new Date(now + 6 * 60_000).toISOString(), confirm: true })).resolves.toMatchObject({ status: 'future' });
    expect(core.getJob(uuid).state).toBe('PUBLISHED');
    expect(writes()).toHaveLength(2);
  });
});

describe('取消排程須提醒可能已公開', () => {
  it.each([['已過時間', -10_000], ['剩一分鐘', 60_000], ['剩三分鐘', 180_000]] as const)('%s', async (_label, remaining) => {
    const { core, uuid } = await setup();
    const date = scheduledAt();
    await core.publish(uuid, { status: 'future', scheduledAt: date, confirm: true });
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse(date) - remaining);
    const result = await core.cancelSchedule(uuid);
    expect(result.status).toBe('draft');
    if (remaining < 120_000) expect(result.publicationWarning).toMatch(/可能.*公開.*電子報.*分享.*網站確認/);
    else expect(result.publicationWarning).toBeNull();
  });
  it('取消的寫入等到只剩一分鐘才回應，仍要提醒', async () => {
    const base = defaultWordPressHandler();
    let date = '';
    const { core, uuid } = await setup({ handler: request => {
      const response = base(request);
      if (request.method === 'POST' && JSON.parse(request.body).date_gmt === null) {
        vi.spyOn(Date, 'now').mockReturnValue(Date.parse(date) - 60_000);
      }
      return response;
    } });
    date = scheduledAt();
    await core.publish(uuid, { status: 'future', scheduledAt: date, confirm: true });
    expect((await core.cancelSchedule(uuid)).publicationWarning).toMatch(/網站確認/);
  });
});


describe('排程門檻與取消提示的邊界', () => {
  it('查分類等到剩三分鐘，仍能建立草稿再排程', async () => {
    const now = Date.parse('2026-10-30T00:00:00Z');
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    const base = defaultWordPressHandler();
    const { core, uuid } = await setup({ handler: request => {
      if (request.path.split('?')[0]?.endsWith('/diary-category')) clock.mockReturnValue(now + 3 * 60_000);
      return base(request);
    } });
    core.createRevision(uuid, { templateData: { title: '20261030', body: '<p>測試內文</p>', category: '生活' } });
    approveJob(core, uuid);
    await expect(core.publish(uuid, { status: 'future', scheduledAt: new Date(now + 6 * 60_000).toISOString(), confirm: true })).resolves.toMatchObject({ status: 'future' });
    expect(writes()).toHaveLength(2);
  });
  it('寫入前只剩三十秒，拒絕改成排程', async () => {
    const now = Date.parse('2026-10-30T00:00:00Z');
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    const base = defaultWordPressHandler();
    const { core, uuid } = await setup({ handler: request => {
      const response = base(request);
      if (request.method === 'POST' && request.path.endsWith('/diary')) clock.mockReturnValue(now + 5.5 * 60_000);
      return response;
    } });
    await expect(core.publish(uuid, { status: 'future', scheduledAt: new Date(now + 6 * 60_000).toISOString(), confirm: true })).rejects.toThrow(/1 分鐘/);
    expect(writes()).toEqual([expect.objectContaining({ status: 'draft' })]);
  });
  it('取消時已公開：拒絕且講出副作用與網站確認', async () => {
    const base = defaultWordPressHandler();
    let cancel = false;
    const { core, uuid } = await setup({ handler: request => {
      const response = base(request);
      if (cancel && request.method === 'GET') return { ...response, body: { ...(response.body as object), status: 'publish' } };
      return response;
    } });
    await core.publish(uuid, { status: 'future', scheduledAt: scheduledAt(), confirm: true });
    cancel = true;
    await expect(core.cancelSchedule(uuid)).rejects.toThrow(/已公開.*電子報.*分享.*網站確認/);
    expect(writes()).toHaveLength(2);
  });
});
