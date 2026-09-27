import { afterEach, describe, expect, it } from 'vitest';

import { approveJob, createCoreFixture, type CoreFixture } from './helpers/core-fixture.js';
import { FakeAdapter } from './helpers/fake-adapter.js';
import type { AgentResult } from '../src/agents/types.js';

/**
 * 使用者改過的配圖描述不被 AI 蓋掉（D-027，P5-T027）。
 *
 * P5-T025 讓使用者能在卡片上改 Agent 那條的畫面描述（prompt）。之後任何一趟 Agent（校驗、一鍵配圖）
 * 回同一個 key 時都走 `storeImageBriefs` → upsert；改過的描述要保留使用者的版本，其他欄位照常更新。
 * 「改過」的判斷用既有的 `image_brief_edited` 事件（field = prompt），不加 migration。
 *
 * 一律用 FakeAdapter＋本機假 WordPress，絕不呼叫真實 CLI、不連真實網站。
 */

const SOURCE = [
  '第一段：清晨出門，巷口的早餐店已經排了隊。',
  '第二段：下午的雨下得很急，路口積了一小攤水。',
  '第三段：傍晚雨停，天邊透出一點橘紅。',
].join('\n\n');

interface BriefOut {
  key: string;
  purpose: string;
  prompt: string;
  aspectRatio: string;
  altText: string;
  caption?: string;
  placement?: string;
  anchor?: string;
}

const INLINE: BriefOut = {
  key: 'rainy_crossing',
  purpose: '第二段的雨天路口',
  prompt: '雨天路口積水反射紅色招牌，寫實攝影風格',
  aspectRatio: '4:3',
  altText: '雨天路口的積水',
  placement: '第 2 段之後',
  anchor: '第二段：下午的雨下得很急',
};

const COVER: BriefOut = {
  key: 'featured',
  purpose: '精選圖片',
  prompt: '攤開的舊筆記本放在木桌上，桌燈側光',
  aspectRatio: '16:9',
  altText: '木桌上攤開的舊筆記本',
  placement: '精選圖片',
};

function imagesResult(briefs: BriefOut[]): AgentResult<unknown> {
  return {
    ok: true,
    data: { title: '20260828', summary: '配圖', changes: [], observations: [], templateData: {}, imageBriefs: briefs },
    meta: { runId: 'x', agentId: 'codex', model: null, durationMs: 1, stderrTail: '' },
  };
}

/** 一般「校驗」那一趟：有提案，也順便給配圖需求。 */
function reviewResult(briefs: BriefOut[]): AgentResult<unknown> {
  return {
    ok: true,
    data: {
      title: '20260828',
      summary: '補了標點',
      correctedSource: SOURCE,
      changes: [{ type: 'clarity', before: '很急', after: '很急。', reason: '語感', meaningChanged: false }],
      observations: [],
      templateData: { title: '20260828', body: '<p class="wp-block-paragraph">Agent 改過的內容。</p>' },
      imageBriefs: briefs,
    },
    meta: { runId: 'y', agentId: 'codex', model: null, durationMs: 1, stderrTail: '' },
  };
}

let fixture: CoreFixture | null = null;

afterEach(async () => {
  await fixture?.cleanup();
  fixture = null;
});

interface Setup {
  readonly f: CoreFixture;
  readonly uuid: string;
  /** 換掉下一趟 Agent 回什麼。 */
  next(result: AgentResult<unknown>): void;
  runImages(): Promise<unknown>;
  runReview(): Promise<unknown>;
  idOf(key: string): number;
  brief(key: string): ReturnType<CoreFixture['core']['getJob']>['imageBriefs'][number];
}

async function setup(first: BriefOut[] = [INLINE, COVER]): Promise<Setup> {
  const behaviour: { result: AgentResult<unknown>; image: object } = { result: imagesResult(first), image: {} };
  const codex = new FakeAdapter('codex', 'Codex', behaviour);
  fixture = await createCoreFixture({ adapters: [codex] });
  const f = fixture;
  const uuid = f.core.createJob({ targetKey: 'diary', sourceText: SOURCE, title: '20260828' }).uuid;
  await f.core.runAgentReview(uuid, { provider: 'codex', task: 'images' });
  const brief = (key: string) => f.core.getJob(uuid).imageBriefs.find((row) => row.key === key)!;
  return {
    f,
    uuid,
    next: (result) => {
      behaviour.result = result;
    },
    runImages: () => f.core.runAgentReview(uuid, { provider: 'codex', task: 'images' }),
    runReview: () => f.core.runAgentReview(uuid, { provider: 'codex' }),
    idOf: (key) => brief(key).id,
    brief,
  };
}

describe('改過的描述，之後的 Agent 不蓋掉（D-027）', () => {
  it('改過 → 按「校驗」回同一個 key → 描述保留使用者的版本，卡片標「改過」', async () => {
    const s = await setup();
    s.f.core.updateImageBrief(s.uuid, s.idOf(INLINE.key), { prompt: '黃昏的路口，水彩風' });
    expect(s.brief(INLINE.key).promptEdited).toBe(true);

    s.next(reviewResult([{ ...INLINE, prompt: 'AI 的新描述：夜裡的路口' }]));
    await s.runReview();

    expect(s.brief(INLINE.key).prompt).toBe('黃昏的路口，水彩風');
    expect(s.brief(INLINE.key).promptEdited).toBe(true);
    expect(s.brief(INLINE.key).id).toBe(s.idOf(INLINE.key));
  });

  it('改過 → 再按一次「一鍵配圖」也一樣保留', async () => {
    const s = await setup();
    s.f.core.updateImageBrief(s.uuid, s.idOf(COVER.key), { prompt: '窗邊的一杯咖啡' });

    s.next(imagesResult([{ ...COVER, prompt: 'AI 另寫的封面' }]));
    await s.runImages();

    expect(s.brief(COVER.key).prompt).toBe('窗邊的一杯咖啡');
  });

  it('沒改過 → 照常換成 Agent 的新描述，沒有「改過」標記', async () => {
    const s = await setup();
    expect(s.brief(INLINE.key).promptEdited).toBe(false);

    s.next(reviewResult([{ ...INLINE, prompt: 'AI 的新描述：夜裡的路口' }]));
    await s.runReview();

    expect(s.brief(INLINE.key).prompt).toBe('AI 的新描述：夜裡的路口');
    expect(s.brief(INLINE.key).promptEdited).toBe(false);
  });

  it('改過之後，Agent 更新的其他欄位（用途、比例、alt、說明、位置、錨點）照常更新，只有描述保留', async () => {
    const s = await setup();
    s.f.core.updateImageBrief(s.uuid, s.idOf(INLINE.key), { prompt: '黃昏的路口，水彩風' });

    s.next(
      imagesResult([
        {
          key: INLINE.key,
          purpose: '新的用途',
          prompt: 'AI 的新描述',
          aspectRatio: '16:9',
          altText: '新的 alt',
          caption: '新的說明',
          placement: '第 3 段之後',
          anchor: '第三段：傍晚雨停',
        },
      ]),
    );
    await s.runImages();

    expect(s.brief(INLINE.key)).toMatchObject({
      prompt: '黃昏的路口，水彩風',
      purpose: '新的用途',
      aspectRatio: '16:9',
      altText: '新的 alt',
      caption: '新的說明',
      placement: '第 3 段之後',
      anchor: '第三段：傍晚雨停',
      promptEdited: true,
    });
  });

  it('多條混合：改過的保留、沒改過的更新、新的 key 照常新增；另一篇稿件的改動不算這篇的', async () => {
    const s = await setup();
    s.f.core.updateImageBrief(s.uuid, s.idOf(INLINE.key), { prompt: '我改的路口' });

    // 另一篇稿件也有同 key 的需求並被改過：不影響這篇。
    const other = s.f.core.createJob({ targetKey: 'diary', sourceText: SOURCE, title: '20260829' }).uuid;
    await s.f.core.runAgentReview(other, { provider: 'codex', task: 'images' });

    s.next(
      imagesResult([
        { ...INLINE, prompt: 'AI 新路口' },
        { ...COVER, prompt: 'AI 新封面' },
        { key: 'evening_sky', purpose: '第三段的天空', prompt: '雨後橘紅的天空', aspectRatio: '3:2', altText: '雨後的天空' },
      ]),
    );
    await s.runImages();

    expect(s.brief(INLINE.key)).toMatchObject({ prompt: '我改的路口', promptEdited: true });
    expect(s.brief(COVER.key)).toMatchObject({ prompt: 'AI 新封面', promptEdited: false });
    expect(s.brief('evening_sky')).toMatchObject({ prompt: '雨後橘紅的天空', promptEdited: false });

    const otherCover = s.f.core.getJob(other).imageBriefs.find((row) => row.key === COVER.key)!;
    s.f.core.updateImageBrief(other, otherCover.id, { prompt: '別篇改的封面' });
    s.next(imagesResult([{ ...COVER, prompt: 'AI 再一版封面' }]));
    await s.runImages();
    expect(s.brief(COVER.key)).toMatchObject({ prompt: 'AI 再一版封面', promptEdited: false });
  });

  it('Agent 這趟沒回那個 key：改過的那條原封不動', async () => {
    const s = await setup();
    s.f.core.updateImageBrief(s.uuid, s.idOf(INLINE.key), { prompt: '我改的路口' });
    s.next(imagesResult([{ ...COVER, prompt: 'AI 新封面' }]));
    await s.runImages();
    expect(s.brief(INLINE.key)).toMatchObject({ prompt: '我改的路口', promptEdited: true });
  });

  it('改過又改成跟 AI 原本一字不差：仍算「改過」，之後照樣保留（沒有「交還給 AI」這條路）', async () => {
    const s = await setup();
    const id = s.idOf(INLINE.key);
    s.f.core.updateImageBrief(s.uuid, id, { prompt: '先改一下' });
    s.f.core.updateImageBrief(s.uuid, id, { prompt: INLINE.prompt });

    s.next(imagesResult([{ ...INLINE, prompt: 'AI 的新描述' }]));
    await s.runImages();

    expect(s.brief(INLINE.key)).toMatchObject({ prompt: INLINE.prompt, promptEdited: true });
  });

  it('改過、按了「不要了」、Agent 再提同一個 key：復活（既有行為，另案），描述仍是使用者的版本', async () => {
    const s = await setup();
    const id = s.idOf(INLINE.key);
    s.f.core.updateImageBrief(s.uuid, id, { prompt: '我改的路口' });
    s.f.core.dismissImageBrief(s.uuid, id);
    expect(s.f.core.getJob(s.uuid).imageBriefs.some((row) => row.id === id)).toBe(false);

    s.next(imagesResult([{ ...INLINE, prompt: 'AI 的新描述' }]));
    await s.runImages();

    expect(s.brief(INLINE.key)).toMatchObject({ id, prompt: '我改的路口', promptEdited: true });
  });

  it('描述保留、比例沒變：已經生好的候選圖留著；比例變了才算過時', async () => {
    const s = await setup();
    const id = s.idOf(INLINE.key);
    s.f.core.updateImageBrief(s.uuid, id, { prompt: '我改的路口' });
    const candidate = await s.f.core.generateBriefImage(s.uuid, id);
    expect(s.brief(INLINE.key).candidate?.id).toBe(candidate.id);

    s.next(imagesResult([{ ...INLINE, prompt: 'AI 的新描述', altText: '新的 alt' }]));
    await s.runImages();
    expect(s.brief(INLINE.key).candidate?.id).toBe(candidate.id);

    s.next(imagesResult([{ ...INLINE, prompt: 'AI 的新描述', aspectRatio: '1:1' }]));
    await s.runImages();
    expect(s.brief(INLINE.key).candidate).toBeNull();
    expect(s.brief(INLINE.key).prompt).toBe('我改的路口');
  });

  it('沒改過的：Agent 重提照舊讓候選圖過時（行為不變）', async () => {
    const s = await setup();
    const id = s.idOf(INLINE.key);
    await s.f.core.generateBriefImage(s.uuid, id);
    s.next(imagesResult([{ ...INLINE }]));
    await s.runImages();
    expect(s.brief(INLINE.key).candidate).toBeNull();
  });

  it('不影響核准、不建新版本；事件記下哪些 key 保留了使用者的描述（不記內容）', async () => {
    const s = await setup();
    s.f.core.updateImageBrief(s.uuid, s.idOf(INLINE.key), { prompt: '我改的路口' });
    const hash = approveJob(s.f.core, s.uuid);
    const before = s.f.core.getJob(s.uuid);

    s.next(imagesResult([{ ...INLINE, prompt: 'AI 的新描述' }, { ...COVER, prompt: 'AI 新封面' }]));
    await s.runImages();

    const after = s.f.core.getJob(s.uuid);
    expect(after.currentRevision!.contentHash).toBe(hash);
    expect(after.currentRevision!.id).toBe(before.currentRevision!.id);
    expect(after.approval?.valid).toBe(true);

    const proposed = s.f.core.listEvents(s.uuid).find((event) => event.eventType === 'image_briefs_proposed')!;
    expect(proposed.detail).toMatchObject({ count: 2, keptUserPrompt: [INLINE.key] });
    expect(JSON.stringify(proposed.detail)).not.toContain('我改的路口');
  });

  it('使用者那條（origin = user）改「想要：…」那句不會讓 Agent 的需求被當成改過', async () => {
    const s = await setup();
    const { brief, generation } = await s.f.core.requestImageAtPosition(s.uuid, {
      afterBlockIndex: 0,
      contentHash: s.f.core.getJob(s.uuid).currentRevision!.contentHash,
    });
    await generation;
    s.f.core.updateImageBrief(s.uuid, brief.id, { note: '水彩' });
    expect(s.f.core.getJob(s.uuid).imageBriefs.find((row) => row.id === brief.id)!.promptEdited).toBe(false);

    s.next(imagesResult([{ ...INLINE, prompt: 'AI 的新描述' }]));
    await s.runImages();
    expect(s.brief(INLINE.key)).toMatchObject({ prompt: 'AI 的新描述', promptEdited: false });
  });
});
