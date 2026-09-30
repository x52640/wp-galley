import { join } from 'node:path';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';

import { paths } from '../src/config/paths.js';
import { InvalidInputError } from '../src/core/errors.js';
import { applyDisabledTargets } from '../src/wordpress/setup.js';
import {
  createTargetRegistry,
  loadPublishTargets,
  PublishTargetError,
  type PublishTarget,
} from '../src/wordpress/targets.js';
import { approveJob, createCoreFixture, type CoreFixture } from './helpers/core-fixture.js';

/**
 * 停用不要的文章類型（D-032，P5-T032）。
 *
 * 停用＝從「新稿件」隱藏，不是刪除：建稿拒絕，但已經用這個類型的舊稿件照常編輯、發布。
 * 規則在 docs/specs/wordpress-site.md「設定精靈」與 templates.md「發布目標的欄位」。
 */

const SOURCE = '今天讀完這本書。\n\n想到很多事。';

let fixture: CoreFixture | null = null;

afterEach(async () => {
  await fixture?.cleanup();
  fixture = null;
});

async function remusTargets(): Promise<PublishTarget[]> {
  return (await loadPublishTargets(join(paths.config, 'examples', 'remusplus.json'))).list();
}

/** 把日記停用後的 registry（模擬精靈存檔後當場套用）。 */
async function diaryDisabled(): Promise<ReturnType<typeof createTargetRegistry>> {
  const targets = (await remusTargets()).map((target) => (target.key === 'diary' ? { ...target, disabled: true } : target));
  return createTargetRegistry(targets);
}

describe('設定檔的停用標記', () => {
  it('舊檔沒有這個欄位：全部視為啟用', async () => {
    const targets = await remusTargets();
    expect(targets.map((target) => [target.key, target.disabled])).toEqual([
      ['read-think', false],
      ['diary', false],
    ]);
  });

  it('寫了 "disabled": true 的載得起來，registry 照樣列出、照樣 get 得到', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'targets-'));
    const file = join(dir, 'publish-targets.json');
    const raw = JSON.parse(await readFile(join(paths.config, 'examples', 'remusplus.json'), 'utf8'));
    raw.targets[1].disabled = true;
    await writeFile(file, JSON.stringify(raw));
    const registry = await loadPublishTargets(file);
    expect(registry.list().map((target) => target.key)).toEqual(['read-think', 'diary']);
    expect(registry.get('diary').disabled).toBe(true);
  });

  it('停用標記只能是布林值', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'targets-'));
    const file = join(dir, 'publish-targets.json');
    const raw = JSON.parse(await readFile(join(paths.config, 'examples', 'remusplus.json'), 'utf8'));
    raw.targets[1].disabled = 'yes';
    await writeFile(file, JSON.stringify(raw));
    await expect(loadPublishTargets(file)).rejects.toThrow(PublishTargetError);
  });
});

describe('applyDisabledTargets：只動停用標記', () => {
  const raw = (): Record<string, unknown>[] => [
    { key: 'a', displayName: 'A', extra: 1 },
    { key: 'b', displayName: 'B', disabled: false },
    { key: 'c', displayName: 'C', disabled: true },
  ];

  it('啟用→停用加在最後；停用→啟用拿掉欄位；狀態沒變的原樣（連 disabled: false 都不動）', () => {
    const { targets, changed } = applyDisabledTargets(raw(), ['a']);
    expect(changed).toBe(true);
    expect(targets).toEqual([
      { key: 'a', displayName: 'A', extra: 1, disabled: true },
      { key: 'b', displayName: 'B', disabled: false },
      { key: 'c', displayName: 'C' },
    ]);
    expect(Object.keys(targets[0]!)).toEqual(['key', 'displayName', 'extra', 'disabled']);
  });

  it('寫著 disabled: false 的要停用：原地改值，不換位置', () => {
    const { targets } = applyDisabledTargets(raw(), ['b', 'c']);
    expect(Object.keys(targets[1]!)).toEqual(['key', 'displayName', 'disabled']);
    expect(targets[1]!['disabled']).toBe(true);
    expect(targets[2]).toEqual({ key: 'c', displayName: 'C', disabled: true });
  });

  it('跟現在一樣：changed 是 false，內容不變', () => {
    const { targets, changed } = applyDisabledTargets(raw(), ['c']);
    expect(changed).toBe(false);
    expect(targets).toEqual(raw());
  });

  it('全部停用：拒絕', () => {
    expect(() => applyDisabledTargets(raw(), ['a', 'b', 'c'])).toThrow(/至少/);
  });

  it('設定檔裡沒有的 key：拒絕', () => {
    expect(() => applyDisabledTargets(raw(), ['zzz'])).toThrow(/zzz/);
  });
});

describe('CoreService：停用的類型', () => {
  it('createJob 拒絕停用的類型（不信任前端），講怎麼打開；可用清單不列停用的', async () => {
    fixture = await createCoreFixture({ targets: await diaryDisabled() });
    const error = (() => {
      try {
        fixture.core.createJob({ targetKey: 'diary', sourceText: SOURCE });
        return null;
      } catch (caught) {
        return caught;
      }
    })();
    expect(error).toBeInstanceOf(InvalidInputError);
    expect((error as Error).message).toContain('停用');
    expect((error as Error).message).toContain('設定');

    const unknown = (() => {
      try {
        fixture.core.createJob({ targetKey: 'nope', sourceText: SOURCE });
        return null;
      } catch (caught) {
        return caught as Error;
      }
    })();
    expect(unknown?.message).toContain('read-think');
    expect(unknown?.message).not.toContain('diary');

    expect(fixture.core.createJob({ targetKey: 'read-think', sourceText: SOURCE }).state).toBe('SOURCE');
  });

  it('已經用這個類型的舊稿件：照常打開、編輯、核准、發布（假 WordPress）', async () => {
    fixture = await createCoreFixture();
    const uuid = fixture.core.createJob({ targetKey: 'diary', sourceText: SOURCE, title: '20260930' }).uuid;

    // 精靈存檔後當場套用：換成日記停用的 registry。
    fixture.core.reconfigure({ targets: await diaryDisabled() });

    const detail = fixture.core.getJob(uuid);
    expect(detail.target).toMatchObject({ key: 'diary', displayName: '日•記' });

    fixture.core.createRevision(uuid, { editedBody: '<p>改過的第一段</p>', origin: 'manual' });
    approveJob(fixture.core, uuid);
    await expect(fixture.core.publish(uuid, { status: 'draft' })).resolves.toMatchObject({ created: true });
    expect(fixture.core.getJob(uuid).state).toBe('PUBLISHED');
    expect(fixture.requests.some((request) => request.method === 'POST' && request.path.startsWith('/wp-json/wp/v2/diary'))).toBe(true);
  });

  it('openJobCountsByTarget：只算進行中的（已發布、已取消的不算）', async () => {
    fixture = await createCoreFixture();
    const a = fixture.core.createJob({ targetKey: 'diary', sourceText: SOURCE }).uuid;
    fixture.core.createJob({ targetKey: 'diary', sourceText: SOURCE });
    fixture.core.createJob({ targetKey: 'read-think', sourceText: SOURCE });
    fixture.core.cancelJob(a);
    expect(fixture.core.openJobCountsByTarget()).toEqual({ diary: 1, 'read-think': 1 });
  });
});
