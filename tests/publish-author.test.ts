import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { approveJob, createCoreFixture, defaultWordPressHandler, type CoreFixture } from './helpers/core-fixture.js';
import { startMockWordPress, wpError, type MockResponse, type MockWordPress, type RecordedRequest } from './helpers/mock-wordpress.js';
import { createTestDatabase, type TestDatabase } from './helpers/test-db.js';
import { PublishBlockedError } from '../src/core/errors.js';
import { WordPressClient } from '../src/wordpress/client.js';
import { AuthorListUnavailableError, fetchAuthorChoices } from '../src/wordpress/authors.js';
import { diffSnapshots, type RemoteSnapshot } from '../src/wordpress/posts.js';
import {
  createTargetRegistry,
  loadPublishTargets,
  PublishTargetSchema,
  PublishTargetsFileSchema,
  writeDefaultAuthor,
} from '../src/wordpress/targets.js';
import { readSiteConfig, writeSiteConfig } from '../src/wordpress/setup.js';
import { buildApp, type SetupFiles } from '../src/server/app.js';
import { loadConfig } from '../src/config/env.js';
import { loadTemplateRegistry } from '../src/templates/registry.js';
import { AgentRegistry } from '../src/agents/registry.js';
import { paths } from '../src/config/paths.js';

/**
 * P5-T024（D-024）：發布時指定作者。
 *
 * 假 WordPress 照 WordPress 核心 `WP_REST_Users_Controller::get_items_permissions_check` 的規則模擬
 * （docs/specs/wordpress-site.md「作者」）：
 * - `context=edit`、`roles`、`capabilities` 都要 `list_users`——只有 Administrator 有，Editor 沒有 → 403。
 * - `who=authors` 只要能編輯某個支援作者的內容類型（`edit_posts`）就可以，Editor、Author 都行。
 * - 指定別人當作者要 `edit_others_posts`（`create_item_permissions_check`），Author 沒有 → 403。
 * 絕不連真站。
 */

const SOURCE = '今天讀完這本書，想到很多事。\n\n不是書裡寫的那些，而是別的。';
const APP_PASSWORD = 'abcd EFGH 1234 ijkl MNOP 5678';

type Role = 'editor' | 'author' | 'administrator';

const CAPS: Record<Role, Record<string, boolean>> = {
  administrator: { edit_posts: true, edit_others_posts: true, publish_posts: true, list_users: true },
  editor: { edit_posts: true, edit_others_posts: true, publish_posts: true, upload_files: true },
  author: { edit_posts: true, publish_posts: true, upload_files: true },
};

/** 站上的使用者（view context 會回的欄位，外加一個不該被帶出去的 email）。 */
const USERS = [
  { id: 2, name: 'Remus', slug: 'remus', email: 'remus@example.test', url: '', description: '', link: 'https://example.test/author/remus', avatar_urls: {} },
  { id: 7, name: 'AI Romulus', slug: 'ai_publisher', email: 'ai@example.test', url: '', description: '', link: 'https://example.test/author/ai', avatar_urls: {} },
];

const query = (request: RecordedRequest): URLSearchParams => new URLSearchParams(request.path.split('?')[1] ?? '');
const pathOf = (request: RecordedRequest): string => request.path.split('?')[0] ?? '';

/** 使用者端點照 WordPress 核心的權限規則回應。其餘交給 fallback。 */
function usersHandler(
  role: Role,
  fallback: (request: RecordedRequest) => MockResponse = () => wpError('rest_no_route', 'no route', 404),
  options: { listBlocked?: boolean; listStatus?: number; onList?: () => void; noCapabilities?: boolean } = {},
): (request: RecordedRequest) => MockResponse {
  const caps = CAPS[role];
  return (request) => {
    const path = pathOf(request);
    const q = query(request);
    if (path === '/wp-json/wp/v2/users/me') {
      // 自己的資料用 context=edit 看得到（get_item_permissions_check：本人一律可以）。
      return { body: { id: 7, name: 'AI Romulus', slug: 'ai_publisher', roles: [role], ...(q.get('context') === 'edit' && !options.noCapabilities ? { capabilities: caps } : {}) } };
    }
    if (path === '/wp-json/wp/v2/users') {
      options.onList?.();
      if (options.listBlocked) return wpError('rest_user_cannot_view', '安全外掛擋掉了', options.listStatus ?? 403);
      const hasList = caps['list_users'] === true;
      if ([...q.keys()].some((key) => key.startsWith('roles')) && !hasList) return wpError('rest_user_cannot_view', 'Sorry, you are not allowed to filter users by role.', 403);
      if ([...q.keys()].some((key) => key.startsWith('capabilities')) && !hasList) return wpError('rest_user_cannot_view', 'Sorry, you are not allowed to filter users by capability.', 403);
      if (q.get('context') === 'edit' && !hasList) return wpError('rest_forbidden_context', 'Sorry, you are not allowed to edit users.', 403);
      if (q.get('who') === 'authors' && caps['edit_posts'] !== true) return wpError('rest_forbidden_who', 'Sorry, you are not allowed to query users by this parameter.', 403);
      return { body: USERS, headers: { 'X-WP-TotalPages': '1' } };
    }
    // 建稿／更新帶了別人當作者：沒有 edit_others_posts 就 403。
    if (request.method === 'POST' && /^\/wp-json\/wp\/v2\/(diary|read-think)(\/\d+)?$/.test(path)) {
      const payload = JSON.parse(request.body || '{}') as Record<string, unknown>;
      if (payload['author'] !== undefined && payload['author'] !== 7 && caps['edit_others_posts'] !== true) {
        return wpError('rest_cannot_edit_others', 'Sorry, you are not allowed to update posts as this user.', 403);
      }
    }
    return fallback(request);
  };
}

/** 預設假站台，但建稿回應帶 author（照 payload，沒帶就是登入的帳號 7）。 */
function withAuthorEcho(): (request: RecordedRequest) => MockResponse {
  const base = defaultWordPressHandler();
  return (request) => {
    const result = base(request);
    if (request.method === 'POST' && /^\/wp-json\/wp\/v2\/(diary|read-think)(\/\d+)?$/.test(pathOf(request))) {
      const payload = JSON.parse(request.body || '{}') as Record<string, unknown>;
      return { ...result, body: { ...(result.body as object), author: payload['author'] ?? 7 } };
    }
    return result;
  };
}

function remusTargets(defaultAuthorId: number | null) {
  const raw = JSON.parse(readFileSync(join(paths.config, 'examples', 'remusplus.json'), 'utf8')) as { targets: unknown[] };
  return createTargetRegistry(
    raw.targets.map((target) => PublishTargetSchema.parse(target)),
    { defaultAuthorId },
  );
}

let fixture: CoreFixture | null = null;
let mock: MockWordPress | null = null;
let app: FastifyInstance | null = null;
let db: TestDatabase | null = null;
const dirs: string[] = [];

afterEach(async () => {
  await fixture?.cleanup();
  await mock?.close();
  await app?.close();
  db?.cleanup();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  fixture = null;
  mock = null;
  app = null;
  db = null;
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'wp-publisher-author-'));
  dirs.push(dir);
  return dir;
}

async function clientFor(role: Role, options: { listBlocked?: boolean } = {}): Promise<{ client: WordPressClient; mock: MockWordPress }> {
  mock = await startMockWordPress(usersHandler(role, undefined, options));
  return {
    mock,
    client: new WordPressClient({ baseUrl: mock.url, username: 'ai', appPassword: APP_PASSWORD, maxRetries: 0, sleepImpl: async () => undefined }),
  };
}

async function publishFixture(role: Role, defaultAuthorId: number | null): Promise<CoreFixture> {
  fixture = await createCoreFixture({ handler: usersHandler(role, withAuthorEcho()), targets: remusTargets(defaultAuthorId) });
  return fixture;
}

function createApproved(f: CoreFixture): string {
  const job = f.core.createJob({ targetKey: 'diary', sourceText: SOURCE, title: '20260924' });
  approveJob(f.core, job.uuid);
  return job.uuid;
}

const postWrites = (f: CoreFixture): Record<string, unknown>[] =>
  f.requests
    .filter((request) => request.method === 'POST' && /^\/wp-json\/wp\/v2\/(diary|read-think)(\/\d+)?$/.test(pathOf(request)))
    .map((request) => JSON.parse(request.body || '{}') as Record<string, unknown>);

// --- 取得可當作者的人 -----------------------------------------------------------

describe('fetchAuthorChoices：WordPress 的使用者清單', () => {
  it('Editor：用 who=authors 列（不用 context=edit／roles／capabilities，那些要 list_users），只留 id 與名字', async () => {
    const { client, mock: site } = await clientFor('editor');
    const choices = await fetchAuthorChoices(client);

    expect(choices.canChooseOthers).toBe(true);
    expect(choices.currentUser).toEqual({ id: 7, name: 'AI Romulus' });
    expect(choices.authors).toEqual([
      { id: 2, name: 'Remus' },
      { id: 7, name: 'AI Romulus' },
    ]);
    expect(JSON.stringify(choices)).not.toContain('@example.test');
    const list = site.requests.find((request) => pathOf(request) === '/wp-json/wp/v2/users')!;
    expect(query(list).get('who')).toBe('authors');
    expect(query(list).get('context')).toBeNull();
    expect([...query(list).keys()].some((key) => key.startsWith('roles') || key.startsWith('capabilities'))).toBe(false);
  });

  it('Author（沒有 edit_others_posts）：只能用自己，說明怎麼改，不去列別人', async () => {
    const { client, mock: site } = await clientFor('author');
    const choices = await fetchAuthorChoices(client);

    expect(choices.canChooseOthers).toBe(false);
    expect(choices.authors).toEqual([{ id: 7, name: 'AI Romulus' }]);
    expect(choices.notice).toContain('只能用自己當作者');
    expect(choices.notice).toContain('Editor');
    expect(site.requests.some((request) => pathOf(request) === '/wp-json/wp/v2/users')).toBe(false);
  });

  it('站上擋掉使用者清單（安全外掛）：不當成「只能用自己」，丟 AuthorListUnavailableError', async () => {
    const { client } = await clientFor('editor', { listBlocked: true });
    await expect(fetchAuthorChoices(client)).rejects.toThrow(AuthorListUnavailableError);
    await expect(fetchAuthorChoices(client)).rejects.toThrow(/不讓這個帳號列出使用者/);
  });

  it('capabilities 被外掛拿掉：不用角色猜「只能用自己」，照樣去列清單', async () => {
    mock = await startMockWordPress(usersHandler('author', undefined, { noCapabilities: true }));
    const client = new WordPressClient({ baseUrl: mock.url, username: 'ai', appPassword: APP_PASSWORD, maxRetries: 0, sleepImpl: async () => undefined });
    const choices = await fetchAuthorChoices(client);
    expect(choices.canChooseOthers).toBe(true);
    expect(choices.authors.map((author) => author.id)).toEqual([2, 7]);
  });
});

// --- 站台設定檔的預設作者 -------------------------------------------------------

describe('站台設定檔：defaultAuthorId', () => {
  it('頂層選填欄位；不給是 null；不是正整數就拒絕', async () => {
    const dir = tempDir();
    const file = join(dir, 'publish-targets.json');
    const raw = JSON.parse(readFileSync(join(paths.config, 'examples', 'remusplus.json'), 'utf8')) as Record<string, unknown>;

    writeFileSync(file, JSON.stringify(raw));
    expect((await loadPublishTargets(file)).defaultAuthorId).toBeNull();

    writeFileSync(file, JSON.stringify({ ...raw, defaultAuthorId: 2 }));
    expect((await loadPublishTargets(file)).defaultAuthorId).toBe(2);

    expect(PublishTargetsFileSchema.safeParse({ ...raw, defaultAuthorId: 0 }).success).toBe(false);
    expect(PublishTargetsFileSchema.safeParse({ ...raw, defaultAuthorId: '2' }).success).toBe(false);
  });

  it('範例檔 config/examples/default-author.json 讀得進來', async () => {
    const registry = await loadPublishTargets(join(paths.config, 'examples', 'default-author.json'));
    expect(registry.defaultAuthorId).toBe(2);
    expect(registry.list().map((target) => target.key)).toEqual(['post', 'page']);
  });

  it('writeDefaultAuthor：只改這一個欄位，target 原樣保留；null 拿掉欄位', async () => {
    const dir = tempDir();
    const file = join(dir, 'publish-targets.json');
    const original = readFileSync(join(paths.config, 'examples', 'remusplus.json'), 'utf8');
    writeFileSync(file, original);

    await writeDefaultAuthor(file, 2);
    const written = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    expect(written['defaultAuthorId']).toBe(2);
    expect(written['targets']).toEqual(JSON.parse(original).targets);

    await writeDefaultAuthor(file, null);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(JSON.parse(original));
  });

  it('writeDefaultAuthor：壞掉的檔不碰', async () => {
    const dir = tempDir();
    const file = join(dir, 'publish-targets.json');
    writeFileSync(file, '{ not json');
    await expect(writeDefaultAuthor(file, 2)).rejects.toThrow();
    expect(readFileSync(file, 'utf8')).toBe('{ not json');
  });

  it('設定精靈重寫設定檔時保留預設作者', async () => {
    const dir = tempDir();
    const file = join(dir, 'publish-targets.json');
    const raw = JSON.parse(readFileSync(join(paths.config, 'examples', 'remusplus.json'), 'utf8')) as Record<string, unknown>;
    writeFileSync(file, JSON.stringify({ ...raw, defaultAuthorId: 2 }));

    const current = await readSiteConfig(file);
    expect(current.defaultAuthorId).toBe(2);
    await writeSiteConfig(file, current.rawTargets, {
      backupsDir: join(dir, 'backups'),
      rootDir: dir,
      hadFile: true,
      defaultAuthorId: current.defaultAuthorId,
    });
    expect((JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>)['defaultAuthorId']).toBe(2);
  });
});

// --- 發布 ---------------------------------------------------------------------

describe('發布時的作者', () => {
  it('沒設預設、沒指定：不送 author，也不去問使用者清單（維持原行為）', async () => {
    const f = await publishFixture('editor', null);
    const uuid = createApproved(f);
    const result = await f.core.publish(uuid, { status: 'draft' });

    expect(postWrites(f)[0]).not.toHaveProperty('author');
    expect(f.requests.some((request) => pathOf(request).startsWith('/wp-json/wp/v2/users'))).toBe(false);
    expect(result.author).toBeNull();
  });

  it('有預設作者：建稿送 author，結果與發布事件都記下實際送出的作者', async () => {
    const f = await publishFixture('editor', 2);
    const uuid = createApproved(f);
    const result = await f.core.publish(uuid, { status: 'draft' });

    expect(postWrites(f)[0]!['author']).toBe(2);
    expect(result.author).toEqual({ id: 2, name: 'Remus' });
    const events = f.core.listEvents(uuid).filter((event) => event.eventType === 'publish');
    const started = events.find((event) => event.status === 'started')!;
    const succeeded = events.find((event) => event.status === 'succeeded')!;
    expect(started.detail).toMatchObject({ authorId: 2 });
    expect(succeeded.detail).toMatchObject({ authorId: 2 });
  });

  it('這一篇指定的作者蓋過預設', async () => {
    const f = await publishFixture('editor', 2);
    const uuid = createApproved(f);
    const result = await f.core.publish(uuid, { status: 'draft', authorId: 7 });
    expect(postWrites(f)[0]!['author']).toBe(7);
    expect(result.author).toEqual({ id: 7, name: 'AI Romulus' });
  });

  it('指定的作者不在站上可當作者的名單：拒絕、零寫入；核准不受影響，改對了照樣能發', async () => {
    const f = await publishFixture('editor', null);
    const uuid = createApproved(f);

    await expect(f.core.publish(uuid, { status: 'draft', authorId: 99 })).rejects.toThrow(PublishBlockedError);
    expect(postWrites(f)).toHaveLength(0);
    const job = f.core.getJob(uuid);
    expect(job.state).toBe('APPROVED');
    expect(job.approval?.valid).toBe(true);

    // 換一個作者不需要重新核准：作者是發布選項，不是核准的內容。
    const result = await f.core.publish(uuid, { status: 'draft', authorId: 2 });
    expect(result.author?.id).toBe(2);
  });

  it('預設作者已經不在這個站（例如換過站）：拒絕並說要去重選，不默默改用 AI 帳號', async () => {
    const f = await publishFixture('editor', 42);
    const uuid = createApproved(f);
    await expect(f.core.publish(uuid, { status: 'draft' })).rejects.toThrow(/預設作者/);
    expect(postWrites(f)).toHaveLength(0);
  });

  it('Author 帳號指定別人：發布前就拒絕並說明，不等 WordPress 403', async () => {
    const f = await publishFixture('author', null);
    const uuid = createApproved(f);
    await expect(f.core.publish(uuid, { status: 'draft', authorId: 2 })).rejects.toThrow(/只能用自己當作者/);
    expect(postWrites(f)).toHaveLength(0);
  });

  it('Author 帳號、預設作者是別人：不送 author（反正只能是自己），照常發', async () => {
    const f = await publishFixture('author', 2);
    const uuid = createApproved(f);
    const result = await f.core.publish(uuid, { status: 'draft' });
    expect(postWrites(f)[0]).not.toHaveProperty('author');
    expect(result.author).toBeNull();
  });

  it('清單 403（安全外掛）＋有預設作者：發布前拒絕、零寫入、有 rejected 事件、維持 APPROVED', async () => {
    fixture = await createCoreFixture({
      handler: usersHandler('editor', withAuthorEcho(), { listBlocked: true }),
      targets: remusTargets(2),
    });
    const uuid = createApproved(fixture);
    await expect(fixture.core.publish(uuid, { status: 'draft' })).rejects.toThrow(
      /讀不到站上的作者清單，這次沒有發布，免得作者被記成發布台的帳號；稍後再試/,
    );
    expect(postWrites(fixture)).toHaveLength(0);
    const job = fixture.core.getJob(uuid);
    expect(job.state).toBe('APPROVED');
    expect(job.approval?.valid).toBe(true);
    const rejected = fixture.core.listEvents(uuid).filter((event) => event.eventType === 'publish' && event.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect(JSON.stringify(rejected[0]!.detail)).toContain('讀不到站上的作者清單');
  });

  it('清單讀取失敗（伺服器錯誤）＋指定作者：同樣拒絕、零寫入、有事件', async () => {
    fixture = await createCoreFixture({
      handler: usersHandler('editor', withAuthorEcho(), { listBlocked: true, listStatus: 500 }),
      targets: remusTargets(null),
    });
    const uuid = createApproved(fixture);
    await expect(fixture.core.publish(uuid, { status: 'draft', authorId: 2 })).rejects.toThrow(PublishBlockedError);
    expect(postWrites(fixture)).toHaveLength(0);
    expect(fixture.core.getJob(uuid).state).toBe('APPROVED');
    expect(fixture.core.listEvents(uuid).some((event) => event.eventType === 'publish' && event.status === 'rejected')).toBe(true);
  });

  it('清單讀不到但沒有要送的作者：不問站台，照舊發（作者是發布台的帳號，結果 author 是 null）', async () => {
    fixture = await createCoreFixture({
      handler: usersHandler('editor', withAuthorEcho(), { listBlocked: true }),
      targets: remusTargets(null),
    });
    const uuid = createApproved(fixture);
    const result = await fixture.core.publish(uuid, { status: 'draft' });
    expect(result.author).toBeNull();
  });

  it('取作者清單途中核准被撤銷：零寫入', async () => {
    let uuid = '';
    let core: CoreFixture['core'] | null = null;
    fixture = await createCoreFixture({
      handler: usersHandler('editor', withAuthorEcho(), { onList: () => core?.revokeApproval(uuid, '測試：途中撤銷') }),
      targets: remusTargets(2),
    });
    core = fixture.core;
    uuid = createApproved(fixture);
    await expect(fixture.core.publish(uuid, { status: 'draft' })).rejects.toThrow();
    expect(postWrites(fixture)).toHaveLength(0);
  });

  it('更新固定物件（fixedObjectId）也送 author', async () => {
    const remote = {
      id: 777,
      status: 'draft',
      link: 'https://example.test/?p=777',
      slug: 'fixed',
      title: { raw: '固定頁', rendered: '固定頁' },
      content: { raw: '<p>遠端內容</p>', rendered: '<p>遠端內容</p>' },
      featured_media: 0,
      author: 7,
      'read-think-tag': [],
      date_gmt: '2026-08-28T00:00:00',
      modified_gmt: '2026-08-28T00:00:00',
    };
    const fallback = (request: RecordedRequest): MockResponse => {
      const path = pathOf(request);
      if (path === '/wp-json/wp/v2/read-think-tag') return { body: [], headers: { 'X-WP-TotalPages': '1' } };
      if (path === '/wp-json/wp/v2/read-think/777') {
        if (request.method === 'POST') {
          const payload = JSON.parse(request.body || '{}') as Record<string, unknown>;
          return { body: { ...remote, ...(typeof payload['author'] === 'number' ? { author: payload['author'] } : {}) } };
        }
        return { body: remote };
      }
      return wpError('rest_no_route', 'no route', 404);
    };
    const fixed = PublishTargetSchema.parse({
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
    });
    fixture = await createCoreFixture({ handler: usersHandler('editor', fallback), targets: createTargetRegistry([fixed], { defaultAuthorId: 2 }) });
    const job = fixture.core.createJob({ targetKey: 'fixed', sourceText: SOURCE, title: '固定頁' });
    approveJob(fixture.core, job.uuid);
    // 第一次先記下遠端基準（沒有基準不覆蓋），第二次才真的更新。
    await expect(fixture.core.publish(job.uuid, { status: 'draft' })).rejects.toThrow(/比對基準/);
    await fixture.core.publish(job.uuid, { status: 'draft' });

    const update = fixture.requests.find((request) => request.method === 'POST' && pathOf(request) === '/wp-json/wp/v2/read-think/777')!;
    expect((JSON.parse(update.body) as Record<string, unknown>)['author']).toBe(2);
  });
});

describe('遠端快照比對作者', () => {
  const base: RemoteSnapshot = {
    id: 1, status: 'draft', modifiedGmt: 'x', contentHash: 'h', title: 't', slug: 's', featuredMediaId: 0, terms: null,
  };
  it('後台有人改了作者：算遠端被改過（更新會送 author，不能無聲蓋掉）', () => {
    expect(diffSnapshots({ ...base, author: 7 }, { ...base, author: 2 })).toEqual(['作者']);
  });
  it('P5-T024 之前存的快照沒有作者欄位：不比，免得每次更新都誤報', () => {
    expect(diffSnapshots(base, { ...base, author: 2 })).toEqual([]);
  });
});

describe('CoreService.listAuthors', () => {
  it('回清單、目前帳號、預設作者；預設作者不在名單就附說明', async () => {
    const f = await publishFixture('editor', 42);
    const listed = await f.core.listAuthors();
    expect(listed.authors.map((author) => author.id)).toEqual([2, 7]);
    expect(listed.currentUser).toEqual({ id: 7, name: 'AI Romulus' });
    expect(listed.canChooseOthers).toBe(true);
    expect(listed.defaultAuthorId).toBe(42);
    expect(listed.defaultAuthor).toBeNull();
    expect(listed.notice).toContain('預設作者');
  });

  it('清單讀不到：listUnavailable，說明有預設作者時發布會被擋', async () => {
    fixture = await createCoreFixture({
      handler: usersHandler('editor', withAuthorEcho(), { listBlocked: true }),
      targets: remusTargets(2),
    });
    const listed = await fixture.core.listAuthors();
    expect(listed.listUnavailable).toBe(true);
    expect(listed.canChooseOthers).toBe(false);
    expect(listed.currentUser).toEqual({ id: 7, name: 'AI Romulus' });
    expect(listed.notice).toContain('發布會被擋下');
  });

  it('預設作者在名單裡：defaultAuthor 帶名字，沒有說明', async () => {
    const f = await publishFixture('editor', 2);
    const listed = await f.core.listAuthors();
    expect(listed.defaultAuthor).toEqual({ id: 2, name: 'Remus' });
    expect(listed.notice).toBeNull();
  });
});

// --- HTTP ---------------------------------------------------------------------

const headers = { host: '127.0.0.1:3000', 'content-type': 'application/json' };

async function buildServer(role: Role, siteConfig: Record<string, unknown> | null): Promise<{ app: FastifyInstance; files: SetupFiles }> {
  const dir = tempDir();
  const files: SetupFiles = {
    envFile: join(dir, '.env'),
    envExampleFile: join(dir, '.env.example'),
    siteConfigFile: join(dir, 'publish-targets.json'),
    backupsDir: join(dir, 'backups'),
    rootDir: dir,
  };
  const raw = JSON.parse(readFileSync(join(paths.config, 'examples', 'remusplus.json'), 'utf8')) as Record<string, unknown>;
  writeFileSync(files.siteConfigFile, JSON.stringify(siteConfig ?? raw));
  mock = await startMockWordPress(usersHandler(role, withAuthorEcho()));
  db = createTestDatabase();
  app = await buildApp({
    config: loadConfig({ APP_HOST: '127.0.0.1', APP_PORT: '3000', LOG_LEVEL: 'silent' }),
    db: db.handle,
    templates: await loadTemplateRegistry(paths.templates),
    agents: new AgentRegistry({ adapters: [] }),
    targets: await loadPublishTargets(files.siteConfigFile),
    wordpress: new WordPressClient({ baseUrl: mock.url, username: 'ai', appPassword: APP_PASSWORD, maxRetries: 0, sleepImpl: async () => undefined }),
    setupFiles: files,
  });
  await app.ready();
  return { app, files };
}

describe('HTTP：作者', () => {
  it('GET /api/wordpress/authors：只回 id 與名字，不帶 email 等個資', async () => {
    const { app } = await buildServer('editor', null);
    const res = await app.inject({ method: 'GET', url: '/api/wordpress/authors', headers });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.authors).toEqual([
      { id: 2, name: 'Remus' },
      { id: 7, name: 'AI Romulus' },
    ]);
    expect(body.defaultAuthorId).toBeNull();
    expect(res.body).not.toContain('@example.test');
    expect(res.body).not.toContain('avatar');
  });

  it('POST /api/setup/default-author：寫進站台設定檔、當場生效；不在名單就 400、檔案不動', async () => {
    const { app, files } = await buildServer('editor', null);
    const before = readFileSync(files.siteConfigFile, 'utf8');

    const bad = await app.inject({ method: 'POST', url: '/api/setup/default-author', headers, payload: { authorId: 99 } });
    expect(bad.statusCode).toBe(400);
    expect(readFileSync(files.siteConfigFile, 'utf8')).toBe(before);

    const ok = await app.inject({ method: 'POST', url: '/api/setup/default-author', headers, payload: { authorId: 2 } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().defaultAuthor).toEqual({ id: 2, name: 'Remus' });
    expect((JSON.parse(readFileSync(files.siteConfigFile, 'utf8')) as Record<string, unknown>)['defaultAuthorId']).toBe(2);

    // 設好之後什麼都不用點：發布不帶 authorId 就用預設。
    const created = await app.inject({ method: 'POST', url: '/api/jobs', headers, payload: { targetKey: 'diary', sourceText: SOURCE, title: '20260924' } });
    const uuid = created.json().job.uuid as string;
    await app.inject({ method: 'POST', url: `/api/jobs/${uuid}/render`, headers, payload: {} });
    const preview = await app.inject({ method: 'GET', url: `/api/jobs/${uuid}/preview`, headers });
    await app.inject({ method: 'POST', url: `/api/jobs/${uuid}/approve`, headers, payload: { contentHash: preview.headers.etag!.replaceAll('"', '') } });
    const published = await app.inject({ method: 'POST', url: `/api/jobs/${uuid}/publish`, headers, payload: { status: 'draft', confirm: true } });
    expect(published.statusCode).toBe(200);
    expect(published.json().result.author).toEqual({ id: 2, name: 'Remus' });

    const cleared = await app.inject({ method: 'POST', url: '/api/setup/default-author', headers, payload: { authorId: null } });
    expect(cleared.statusCode).toBe(200);
    expect(JSON.parse(readFileSync(files.siteConfigFile, 'utf8'))).not.toHaveProperty('defaultAuthorId');
  });

  it('POST /api/setup/default-author：Author 帳號設別人 → 400', async () => {
    const { app } = await buildServer('author', null);
    const res = await app.inject({ method: 'POST', url: '/api/setup/default-author', headers, payload: { authorId: 2 } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toContain('只能用自己當作者');
  });

  it('POST /api/setup/default-author：不是 JSON 就擋（跟設定精靈同一套守門）', async () => {
    const { app } = await buildServer('editor', null);
    const res = await app.inject({
      method: 'POST',
      url: '/api/setup/default-author',
      headers: { host: '127.0.0.1:3000', 'content-type': 'text/plain' },
      payload: '{"authorId":2}',
    });
    expect(res.statusCode).toBe(415);
  });

  it('發布請求帶 authorId：不在名單 409、在名單照送', async () => {
    const { app } = await buildServer('editor', null);
    const created = await app.inject({ method: 'POST', url: '/api/jobs', headers, payload: { targetKey: 'diary', sourceText: SOURCE, title: '20260924' } });
    const uuid = created.json().job.uuid as string;
    await app.inject({ method: 'POST', url: `/api/jobs/${uuid}/render`, headers, payload: {} });
    const preview = await app.inject({ method: 'GET', url: `/api/jobs/${uuid}/preview`, headers });
    await app.inject({ method: 'POST', url: `/api/jobs/${uuid}/approve`, headers, payload: { contentHash: preview.headers.etag!.replaceAll('"', '') } });

    const bad = await app.inject({ method: 'POST', url: `/api/jobs/${uuid}/publish`, headers, payload: { status: 'draft', authorId: 99 } });
    expect(bad.statusCode).toBe(409);
    const ok = await app.inject({ method: 'POST', url: `/api/jobs/${uuid}/publish`, headers, payload: { status: 'draft', authorId: 2 } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().result.author).toEqual({ id: 2, name: 'Remus' });
  });
});
