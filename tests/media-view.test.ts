import { describe, expect, it } from 'vitest';

import {
  IMAGE_FILE_ACCEPT,
  assetLabel,
  briefDraftHint,
  briefDraftStatus,
  briefEditTitle,
  briefIdleHint,
  briefLastFailure,
  briefRunState,
  briefWhere,
  canGenerateBrief,
  canSaveBriefDraft,
  candidateHint,
  changedBody,
  generationUnavailableReason,
  isPlacedInBody,
  minePurposeText,
} from '../src/ui/lib/media-view.js';
import { BRIEF_PROMPT_MAX } from '../src/contract/brief-prompt.js';
import { USER_NOTE_MAX } from '../src/contract/user-note.js';
import type { AutoPlaceResult, LoadedJob, MediaAsset } from '../src/ui/service/types.js';

/** 配圖面板（MediaPanel／BriefCard／MediaRow）畫面的判斷（P5-T044）。 */

type Run = NonNullable<LoadedJob['agentRun']>;
const run = (over: Partial<Run>): Run => ({
  status: 'running',
  provider: 'codex',
  task: 'generate-image',
  briefId: 7,
  startedAt: '2026-10-05T01:00:00Z',
  finishedAt: null,
  errorMessage: null,
  ...over,
}) as Run;

const asset = (over: Partial<MediaAsset>): MediaAsset => ({
  id: 41,
  jobId: 1,
  mimeType: 'image/png',
  byteSize: 1000,
  sha256: 'x',
  width: null,
  height: null,
  altText: null,
  caption: null,
  briefKey: null,
  wordpressMediaId: null,
  url: null,
  placed: false,
  placedAfterBlockIndex: null,
  ...over,
}) as MediaAsset;

const ready = { available: true, provider: 'codex', reason: null } as const;

describe('assetLabel', () => {
  it('Agent 建議的圖用 key', () => {
    expect(assetLabel(asset({ briefKey: 'rainy_crossing', altText: '雨' }))).toBe('rainy_crossing');
  });
  it('使用者請 AI 配的（user-…）用替代文字，沒有就用編號', () => {
    expect(assetLabel(asset({ briefKey: 'user-ab12', altText: '雨天' }))).toBe('雨天');
    expect(assetLabel(asset({ briefKey: 'user-ab12' }))).toBe('AI 配的圖 #41');
  });
  it('自己上傳的：替代文字，沒有就「圖片 #id」', () => {
    expect(assetLabel(asset({ altText: '路口' }))).toBe('路口');
    expect(assetLabel(asset({}))).toBe('圖片 #41');
  });
});

describe('isPlacedInBody', () => {
  it('放在某段之後才算；最前面（-1）與沒放都不算', () => {
    expect(isPlacedInBody({ placedAfterBlockIndex: 0 })).toBe(true);
    expect(isPlacedInBody({ placedAfterBlockIndex: 3 })).toBe(true);
    expect(isPlacedInBody({ placedAfterBlockIndex: -1 })).toBe(false);
    expect(isPlacedInBody({ placedAfterBlockIndex: null })).toBe(false);
  });
});

describe('changedBody', () => {
  it('放進去或換掉才算動到正文', () => {
    const place = (outcome: AutoPlaceResult['outcome']): AutoPlaceResult => ({ outcome, message: '', afterBlockIndex: null });
    expect(changedBody(place('placed'))).toBe(true);
    expect(changedBody(place('replaced'))).toBe(true);
    for (const outcome of ['not-found', 'ambiguous', 'agent-running', 'failed'] as const) {
      expect(changedBody(place(outcome))).toBe(false);
    }
  });
});

describe('briefWhere／minePurposeText', () => {
  it('沒有錨點是 null；有就講之前／之後', () => {
    expect(briefWhere({ anchor: null, anchorPosition: 'after' })).toBeNull();
    expect(briefWhere({ anchor: '積水', anchorPosition: 'after' })).toBe('「積水」那段之後');
    expect(briefWhere({ anchor: '積水', anchorPosition: 'before' })).toBe('「積水」那段之前');
  });
  it('想要那句、沒寫時看是不是選字配的', () => {
    expect(minePurposeText({ note: '水彩風', fromSelection: false })).toBe('想要：水彩風');
    expect(minePurposeText({ note: null, fromSelection: true })).toBe('沒有特別要求：Codex 讀你選的這段自己決定畫面');
    expect(minePurposeText({ note: null, fromSelection: false })).toBe('沒有特別要求：Codex 讀前後段落自己決定畫面');
  });
});

describe('briefRunState', () => {
  it('正在畫這張：generating、帶開始時間', () => {
    const state = briefRunState(run({}), 7, false);
    expect(state).toEqual({ runningHere: true, runningElsewhere: false, generating: true, runStartedAt: '2026-10-05T01:00:00Z' });
  });
  it('別張在畫、或別的動作在跑：runningElsewhere', () => {
    expect(briefRunState(run({ briefId: 8 }), 7, false).runningElsewhere).toBe(true);
    expect(briefRunState(run({ task: 'review', briefId: null }), 7, false).runningElsewhere).toBe(true);
  });
  it('自己按下去還在等回應也算 generating；沒在跑就都不是', () => {
    expect(briefRunState(null, 7, true)).toEqual({ runningHere: false, runningElsewhere: false, generating: true, runStartedAt: undefined });
    expect(briefRunState(run({ status: 'succeeded' }), 7, false).generating).toBe(false);
  });
});

describe('briefLastFailure', () => {
  it('這張上次生圖失敗或逾時才講，附原因', () => {
    expect(briefLastFailure(run({ status: 'failed', errorMessage: '沒登入' }), 7)).toBe('上次生圖失敗了：沒登入');
    expect(briefLastFailure(run({ status: 'timeout' }), 7)).toBe('上次生圖逾時了');
  });
  it('別張、取消、成功、沒跑過都不講', () => {
    expect(briefLastFailure(run({ status: 'failed', briefId: 8 }), 7)).toBeNull();
    expect(briefLastFailure(run({ status: 'cancelled' }), 7)).toBeNull();
    expect(briefLastFailure(run({ status: 'succeeded' }), 7)).toBeNull();
    expect(briefLastFailure(null, 7)).toBeNull();
  });
});

describe('generationUnavailableReason／canGenerateBrief', () => {
  it('還沒問到不講；不能用時講原因，沒原因用預設', () => {
    expect(generationUnavailableReason(null)).toBeNull();
    expect(generationUnavailableReason(ready)).toBeNull();
    expect(generationUnavailableReason({ available: false, provider: 'codex', reason: '沒登入' })).toBe('沒登入');
    expect(generationUnavailableReason({ available: false, provider: null, reason: null })).toBe('現在不能生圖');
  });
  const base = { generation: ready, generating: false, runningElsewhere: false, busy: false, editing: false };
  it('Codex 能用、沒在跑、沒在忙、沒在改才給生', () => {
    expect(canGenerateBrief(base)).toBe(true);
    expect(canGenerateBrief({ ...base, generation: null })).toBe(false);
    expect(canGenerateBrief({ ...base, generating: true })).toBe(false);
    expect(canGenerateBrief({ ...base, runningElsewhere: true })).toBe(false);
    expect(canGenerateBrief({ ...base, busy: true })).toBe(false);
    expect(canGenerateBrief({ ...base, editing: true })).toBe(false);
  });
});

describe('briefDraftStatus／canSaveBriefDraft', () => {
  it('Agent 那條：用 prompt 上限，空的不行', () => {
    expect(briefDraftStatus('  ', false)).toEqual({ length: 0, max: BRIEF_PROMPT_MAX, tooLong: false, empty: true });
    expect(briefDraftStatus('x'.repeat(BRIEF_PROMPT_MAX + 1), false).tooLong).toBe(true);
  });
  it('使用者那條：用一句話上限，可以留空', () => {
    expect(briefDraftStatus('', true)).toEqual({ length: 0, max: USER_NOTE_MAX, tooLong: false, empty: false });
    expect(briefDraftStatus('水彩  風', true).length).toBe(4);
  });
  it('沒在改是 0', () => {
    expect(briefDraftStatus(null, false).length).toBe(0);
  });
  const ok = { editing: true, tooLong: false, empty: false, generating: false, saving: false };
  it('存：在改、字數合格、沒在畫、沒在存', () => {
    expect(canSaveBriefDraft(ok)).toBe(true);
    for (const key of ['tooLong', 'empty', 'generating', 'saving'] as const) {
      expect(canSaveBriefDraft({ ...ok, [key]: true })).toBe(false);
    }
    expect(canSaveBriefDraft({ ...ok, editing: false })).toBe(false);
  });
});

describe('briefEditTitle／briefDraftHint', () => {
  it('在畫的時候講等它跑完', () => {
    expect(briefEditTitle(true, true)).toBe('Codex 正在畫這張，等它跑完再改');
    expect(briefEditTitle(false, true)).toBe('改你想要的那句');
    expect(briefEditTitle(false, false)).toBe('改這段描述；之後生圖照改過的畫');
  });
  it('有候選圖時多講一句留著；在畫時不講', () => {
    expect(briefDraftHint({ generating: false, mine: false, hasCandidate: true })).toBe(
      '存了之後，「用 Codex 生圖」就照這段畫；之後 AI 再給建議也不會蓋掉。 已經生好的那張留著，想要新的就再生一張。',
    );
    expect(briefDraftHint({ generating: true, mine: false, hasCandidate: true })).toBe('Codex 正在畫這張，等它跑完再改。');
    expect(briefDraftHint({ generating: false, mine: true, hasCandidate: false })).toBe(
      '存的時候，會用文章裡這個位置目前前後的段落，重新組給 Codex 的指令。',
    );
  });
});

describe('candidateHint', () => {
  const brief = { isFeatured: false, fulfilled: false, anchor: '積水', anchorPosition: 'after', origin: 'agent' } as const;
  it('封面：會自動設精選；有核准時講會失效', () => {
    expect(candidateHint({ ...brief, isFeatured: true }, true)).toBe(
      '按「用這張」會上傳到 WordPress 媒體庫；還沒有別的封面時會自動設成精選圖片。 換封面會讓目前的核准失效。',
    );
  });
  it('已上傳過：換到原本的位置', () => {
    expect(candidateHint({ ...brief, fulfilled: true, anchor: null }, false)).toBe(
      '按「用這張」會上傳到 WordPress 媒體庫；原本那張在正文裡的話，新圖放到它的位置。',
    );
  });
  it('有錨點：Agent 那條自動放、使用者那條放回選的位置', () => {
    expect(candidateHint(brief, true)).toBe(
      '按「用這張」會上傳到 WordPress 媒體庫，並自動放進正文上面那段之後（找不到那段就不放）。 放進正文會讓目前的核准失效。',
    );
    expect(candidateHint({ ...brief, origin: 'user', anchorPosition: 'before' }, false)).toBe(
      '按「用這張」會上傳到 WordPress 媒體庫，並放回你選的位置（「積水」那段之前；找不到那段就不放）。不滿意就再生一張，不用它也沒關係。',
    );
  });
  it('沒有錨點：位置自己選，不講核准', () => {
    expect(candidateHint({ ...brief, anchor: null }, true)).toBe(
      '按「用這張」會上傳到 WordPress 媒體庫，位置要自己選。不滿意就再生一張，不用它也沒關係。',
    );
  });
});

describe('briefIdleHint', () => {
  const brief = { isFeatured: false, fulfilled: false, anchor: '積水', origin: 'agent' } as const;
  it('封面、會自動放、換一張，三選一', () => {
    expect(briefIdleHint({ ...brief, isFeatured: true, fulfilled: true }, false)).toBe(
      '這是封面：上傳（或生圖後「用這張」）的圖，在還沒有別的封面時會自動設成精選。',
    );
    expect(briefIdleHint(brief, true)).toBe('上傳（或生圖後「用這張」）的圖會自動放進正文上面那段之後。 放進正文會讓目前的核准失效。');
    expect(briefIdleHint({ ...brief, origin: 'user' }, false)).toBe('上傳（或生圖後「用這張」）的圖會放回你選的位置。');
    expect(briefIdleHint({ ...brief, fulfilled: true }, true)).toBe(
      '「換一張」：原本那張在正文裡的話，新圖會放到它的位置，舊圖拿出正文（留在媒體庫）。 換進正文會讓目前的核准失效。',
    );
  });
  it('沒錨點、還沒上傳：沒有說明', () => {
    expect(briefIdleHint({ ...brief, anchor: null }, true)).toBeNull();
  });
});

describe('IMAGE_FILE_ACCEPT', () => {
  it('收 SVG（之後轉 PNG）', () => {
    expect(IMAGE_FILE_ACCEPT).toBe('image/png,image/jpeg,image/webp,image/gif,image/svg+xml,.svg');
  });
});
