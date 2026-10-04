/** 生圖、用這張、在文章上請 AI 配一張（對應後端 `service/images.ts`）。 */

import { positionAnchor } from '../../../contract/position-anchor.js';
import { checkUserNote } from '../../../contract/user-note.js';
import {
  checkSelectionImage,
  locateSelection,
  selectionBasisLabel,
  selectionSpotAnchor,
  selectionSpots,
  SELECTION_SPOTS_CHANGED_MESSAGE,
  spotEdges,
  spotEdgesMatch,
} from '../../../contract/selection-image.js';
import type { ImageBrief, ImageCandidate, ImageGenerationStatus, MediaUploadResult, PublisherApi } from '../types.js';
import { GREY_PNG } from './data.js';
import type { FixtureJob } from './store.js';
import { blockText, bodyBlocks, clone, delay, mustGet, readBody } from './context.js';
import { mediaApi } from './media.js';

/** 示範資料模式加 `&codex=off`：模擬 Codex 沒登入，練「請 AI 配一張」停用的樣子。 */
function fixtureCodexOff(): boolean {
  return typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('codex') === 'off';
}

/** 假的生圖：等幾秒（練計時器），沒被停止就給一張灰色的候選圖。跟後端一樣不上傳、不動內容。 */
async function fixtureGenerate(job: FixtureJob, briefId: number): Promise<ImageCandidate> {
  job.agentRun = {
    status: 'running',
    provider: 'codex',
    task: 'generate-image',
    briefId,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    errorMessage: null,
  };
  await delay(3200);
  if (job.agentRun.status === 'cancelled') throw new Error('執行已取消');
  const candidate: ImageCandidate = {
    id: Math.floor(Math.random() * 90_000) + 10_000,
    briefId,
    url: GREY_PNG,
    mimeType: 'image/png',
    byteSize: 1_742_336,
    width: 1672,
    height: 941,
    createdAt: new Date().toISOString(),
  };
  job.agentRun = { ...job.agentRun, status: 'succeeded', finishedAt: new Date().toISOString() };
  job.imageBriefs = job.imageBriefs.map((row) => (row.id === briefId ? { ...row, candidate } : row));
  return clone(candidate);
}

export const imagesApi: Pick<PublisherApi, 'getImageGenerationStatus' | 'generateBriefImage' | 'requestImageAtPosition' | 'requestImageFromSelection' | 'useImageCandidate'> = {
  async getImageGenerationStatus(): Promise<ImageGenerationStatus> {
    await delay(120);
    if (fixtureCodexOff()) {
      return {
        available: false,
        provider: 'codex',
        reason: '只有 Codex 能生圖，但它現在不能用：尚未登入，請在終端機執行 `codex login`',
      };
    }
    return { available: true, provider: 'codex', reason: null };
  },

  /**
   * 假的生圖：等幾秒（練「執行中」的計時器），然後給一張灰色的候選圖。
   * 跟後端一樣：**不上傳、不動內容、不撕核准**；等待中按停止就不收。
   */
  async generateBriefImage(uuid: string, briefId: number): Promise<ImageCandidate> {
    const job = mustGet(uuid);
    if (job.agentRun?.status === 'running') throw new Error('這個工作項目已經有一個 Agent 在跑了，先取消或等它跑完');
    const brief = job.imageBriefs.find((row) => row.id === briefId);
    if (!brief) throw new Error(`找不到這個工作項目的配圖需求 ${briefId}`);
    return fixtureGenerate(job, briefId);
  },

  /**
   * 「請 AI 配一張」（P5-T018）：建一條使用者發起的配圖需求，馬上回來，生圖在背後跑（跟後端一樣不等）。
   */
  async requestImageAtPosition(uuid, input): Promise<ImageBrief> {
    await delay(200);
    const job = mustGet(uuid);
    if (fixtureCodexOff()) throw new Error('只有 Codex 能生圖，但它現在不能用：尚未登入，請在終端機執行 `codex login`');
    if (job.agentRun?.status === 'running') throw new Error('這個工作項目已經有一個 Agent 在跑了，先取消或等它跑完');
    if (input.contentHash !== job.currentRevision?.contentHash) {
      throw new Error('文章在你按下去之前換了一版，位置可能已經不對了。重新讀取之後再選一次位置。');
    }
    const texts = bodyBlocks(readBody(job)).map((html) => blockText(html).replace(/\s+/g, ' ').trim());
    if (input.afterBlockIndex < -1 || input.afterBlockIndex > texts.length - 1) {
      throw new Error(`插入位置 ${input.afterBlockIndex} 超出範圍`);
    }
    const checked = checkUserNote(input.note);
    if (!checked.ok) throw new Error(checked.message);
    const note = checked.note;
    // 錨點跟後端同一份（`contract/position-anchor.ts`）。
    const { anchor, position } = positionAnchor(
      texts.map((text) => ({ text })),
      input.afterBlockIndex,
    );
    const brief: ImageBrief = {
      id: Math.floor(Math.random() * 90_000) + 10_000,
      key: `user-${Math.random().toString(16).slice(2, 10)}`,
      purpose: '你在文章上指定位置、請 AI 配的圖',
      prompt: '（示範資料：後端會用前後段落與你的那句話組成生圖指令）',
      aspectRatio: '16:9',
      altText: '',
      caption: null,
      placement: null,
      anchor,
      fulfilled: false,
      dismissed: false,
      createdAt: new Date().toISOString(),
      isFeatured: false,
      candidate: null,
      origin: 'user',
      anchorPosition: position,
      note,
      promptEdited: false,
      fromSelection: false,
    };
    job.imageBriefs = [...job.imageBriefs, brief];
    void fixtureGenerate(job, brief.id).catch(() => undefined);
    return clone(brief);
  },

  /**
   * 「用此段配圖」（P5-T038）：規則跟後端同一份（字數、跨段定位、位置選項、錨點、卡片依據）；prompt 只放說明。
   */
  async requestImageFromSelection(uuid, input): Promise<ImageBrief> {
    await delay(200);
    const job = mustGet(uuid);
    if (fixtureCodexOff()) throw new Error('只有 Codex 能生圖，但它現在不能用：尚未登入，請在終端機執行 `codex login`');
    if (job.agentRun?.status === 'running') throw new Error('這個工作項目已經有一個 Agent 在跑了，先取消或等它跑完');
    const checkedNote = checkUserNote(input.note);
    if (!checkedNote.ok) throw new Error(checkedNote.message);
    const checked = checkSelectionImage(input.selection);
    if (!checked.ok) throw new Error(checked.message);
    if (input.contentHash !== job.currentRevision?.contentHash) {
      throw new Error('文章在你按下去之前換了一版，位置可能已經不對了。重新讀取之後再選一次位置。');
    }
    const blocks = bodyBlocks(readBody(job)).map((html) => ({ text: blockText(html).replace(/\s+/g, ' ').trim() }));
    const located = locateSelection(blocks, input.selection);
    if (!located.ok) throw new Error(located.message);
    const spots = selectionSpots(blocks, located.first, located.last);
    if (input.spotCount !== undefined && input.spotCount !== spots.length) throw new Error(SELECTION_SPOTS_CHANGED_MESSAGE);
    const spot = spots.find((candidate) => candidate.spot === (input.spot ?? 0));
    if (spot === undefined) throw new Error(`位置 ${input.spot} 不在選取範圍內`);
    if (
      (input.spotBefore !== undefined || input.spotAfter !== undefined) &&
      !spotEdgesMatch({ before: input.spotBefore ?? '', after: input.spotAfter ?? '' }, spotEdges(blocks, spot.afterBlockIndex))
    ) {
      throw new Error(SELECTION_SPOTS_CHANGED_MESSAGE);
    }
    const { anchor, position } = selectionSpotAnchor(blocks, spot);
    const brief: ImageBrief = {
      id: Math.floor(Math.random() * 90_000) + 10_000,
      key: `user-${Math.random().toString(16).slice(2, 10)}`,
      purpose: selectionBasisLabel(input.selection),
      prompt: '（示範資料：後端會用你選的那段、文章標題與小節標題、你的那句話組成生圖指令）',
      aspectRatio: '16:9',
      altText: '',
      caption: null,
      placement: null,
      anchor,
      fulfilled: false,
      dismissed: false,
      createdAt: new Date().toISOString(),
      isFeatured: false,
      candidate: null,
      origin: 'user',
      anchorPosition: position,
      note: checkedNote.note,
      promptEdited: false,
      fromSelection: true,
    };
    job.imageBriefs = [...job.imageBriefs, brief];
    void fixtureGenerate(job, brief.id).catch(() => undefined);
    return clone(brief);
  },

  async useImageCandidate(uuid: string, candidateId: number, altText?: string): Promise<MediaUploadResult> {
    const job = mustGet(uuid);
    const brief = job.imageBriefs.find((row) => row.candidate?.id === candidateId);
    if (!brief || !brief.candidate) throw new Error(`找不到這個工作項目的候選圖 ${candidateId}`);
    const result = await mediaApi.addMedia(uuid, {
      file: new Blob([new Uint8Array(brief.candidate.byteSize)], { type: brief.candidate.mimeType }),
      filename: brief.origin === 'user' ? `illustration-${brief.key.slice(5, 11)}` : brief.key,
      mimeType: brief.candidate.mimeType,
      altText: altText?.trim() || brief.altText,
      briefKey: brief.key,
      ...(brief.caption === null ? {} : { caption: brief.caption }),
    });
    job.imageBriefs = job.imageBriefs.map((row) => (row.id === brief.id ? { ...row, candidate: null } : row));
    return result;
  },
};
