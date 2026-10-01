/** 媒體：上傳、換圖、移除、放位置、精選圖片，上傳後自動放位置／設精選（對應後端 `service/media.ts`）。 */

import { runLocksContent } from '../../../contract/agent-run.js';
import {
  AUTO_FEATURE_AGENT_RUNNING,
  AUTO_FEATURE_KEPT_EXISTING,
  AUTO_FEATURE_SET,
  AUTO_PLACE_AGENT_RUNNING,
  placeByAnchor,
  replacedResult,
} from '../../../contract/auto-place.js';
import { findIgnoringSpaces } from '../../../contract/text-match.js';
import { hasWpImageClass } from '../../../contract/media-marker.js';
import type { AddMediaInput, AutoPlaceResult, ImageBrief, MediaAsset, MediaUploadResult, PublisherApi } from '../types.js';
import { media } from './data.js';
import type { FixtureJob } from './store.js';
import {
  blockText,
  bodyBlocks,
  clone,
  delay,
  figureHtml,
  invalidateApproval,
  mustGet,
  readBody,
  replaceBody,
} from './context.js';

/** 校稿或一鍵配圖正在跑（生圖、建議網址不算）：這時建新版本會讓那一趟的結果作廢，跟後端 contentRunActive 同一份規則。 */
function contentRunActive(job: FixtureJob): boolean {
  return runLocksContent(job.agentRun);
}

/** 上傳後照錨點自動放（後端 autoPlace）：放不放、講什麼用共用契約的 `placeByAnchor`。 */
async function fixtureAutoPlace(job: FixtureJob, asset: MediaAsset, brief: ImageBrief): Promise<AutoPlaceResult> {
  if (contentRunActive(job)) return AUTO_PLACE_AGENT_RUNNING;
  // 「換一張」：同一條需求較新的舊圖還在正文裡，新圖接替它的位置。
  const blocks = bodyBlocks(readBody(job));
  const previous = [...job.media]
    .reverse()
    .find(
      (row) =>
        row.id !== asset.id &&
        row.briefKey === brief.key &&
        row.wordpressMediaId !== null &&
        blocks.some((html) => hasWpImageClass(html, row.wordpressMediaId!)),
    );
  if (previous) {
    const figure = figureHtml(asset);
    const next = blocks.map((html) => (hasWpImageClass(html, previous.wordpressMediaId!) ? figure : html));
    replaceBody(job, next.join('\n'), '換一張配圖');
    return replacedResult(next.findIndex((html) => html === figure) - 1);
  }
  const decision = placeByAnchor(brief, (anchor) =>
    bodyBlocks(readBody(job)).flatMap((html, index) => (findIgnoringSpaces(blockText(html), anchor) === null ? [] : [index])),
  );
  if (decision.place) await mediaApi.placeMedia(job.uuid, asset.id, decision.afterBlockIndex);
  return decision.result;
}

export const mediaApi: Pick<PublisherApi, 'addMedia' | 'replaceMedia' | 'removeMedia' | 'placeMedia' | 'setFeaturedMedia'> = {
  async addMedia(uuid: string, input: AddMediaInput): Promise<MediaUploadResult> {
    await delay(500);
    const job = mustGet(uuid);
    // 上傳本身不改正文，核准不失效（跟後端一樣）；自動放進正文或設精選時才失效。
    const asset: MediaAsset = {
      // 跟後端一樣：上傳成功就有 WordPress 的媒體編號與網址，才放得進正文（P5-T016）。
      ...media(Math.floor(Math.random() * 900) + 100, input.altText ?? '', true),
      byteSize: input.file.size,
      mimeType: input.mimeType,
      briefKey: input.briefKey ?? null,
      ...(input.caption === undefined ? {} : { caption: input.caption }),
    };
    job.media = [...job.media, asset];

    // 對上配圖需求就算完成；封面那條在沒有別的封面時自動設成精選（跟後端的 autoFeature 一樣，
    // 不覆蓋使用者選的封面）。
    const brief = input.briefKey === undefined ? undefined : job.imageBriefs.find((row) => row.key === input.briefKey);
    if (!brief) return { media: clone(asset), autoFeature: null, autoPlace: null };
    job.imageBriefs = job.imageBriefs.map((row) => (row.id === brief.id ? { ...row, fulfilled: true } : row));
    if (!brief.isFeatured) {
      const autoPlace = await fixtureAutoPlace(job, asset, brief);
      const placed = job.media.find((row) => row.id === asset.id) ?? asset;
      return { media: clone(placed), autoFeature: null, autoPlace };
    }

    if (contentRunActive(job)) return { media: clone(asset), autoFeature: AUTO_FEATURE_AGENT_RUNNING, autoPlace: null };
    const current = job.media.find((row) => row.id === job.featuredMediaId);
    if (current && current.briefKey !== brief.key) {
      return { media: clone(asset), autoFeature: AUTO_FEATURE_KEPT_EXISTING, autoPlace: null };
    }
    await mediaApi.setFeaturedMedia(uuid, asset.id);
    return { media: clone({ ...asset, featured: true }), autoFeature: AUTO_FEATURE_SET, autoPlace: null };
  },

  async replaceMedia(uuid: string, assetId: number, input: AddMediaInput) {
    await delay(500);
    const job = mustGet(uuid);
    invalidateApproval(job, '換掉了一張圖片');
    const replaced: MediaAsset = {
      ...media(assetId, input.altText ?? '', false),
      byteSize: input.file.size,
      mimeType: input.mimeType,
    };
    job.media = job.media.map((asset) => (asset.id === assetId ? replaced : asset));
    return replaced;
  },

  async removeMedia(uuid: string, assetId: number) {
    await delay();
    const job = mustGet(uuid);
    invalidateApproval(job, '移除了一張圖片');
    const removed = job.media.find((asset) => asset.id === assetId);
    if (removed?.wordpressMediaId != null) {
      const wpId = removed.wordpressMediaId;
      const blocks = bodyBlocks(readBody(job));
      if (blocks.some((html) => hasWpImageClass(html, wpId))) {
        replaceBody(job, blocks.filter((html) => !hasWpImageClass(html, wpId)).join('\n'), '移除了一張圖片');
      }
    }
    job.media = job.media.filter((asset) => asset.id !== assetId);
    if (job.featuredMediaId === assetId) job.featuredMediaId = null;
  },

  /** 真的把圖插進正文（校樣上看得到），跟後端一樣：已經在正文裡就是搬家。 */
  async placeMedia(uuid: string, assetId: number, afterBlockIndex: number) {
    await delay();
    const job = mustGet(uuid);
    const asset = job.media.find((row) => row.id === assetId);
    if (!asset || asset.wordpressMediaId === null || asset.url === null) {
      throw new Error('這張圖還沒上傳到 WordPress，無法插進正文');
    }
    const wpId = asset.wordpressMediaId;
    const blocks = bodyBlocks(readBody(job));
    if (afterBlockIndex < -1 || afterBlockIndex > blocks.length - 1) {
      throw new Error(`插入位置 ${afterBlockIndex} 超出範圍`);
    }
    const removedBefore = blocks.filter((html, index) => hasWpImageClass(html, wpId) && index <= afterBlockIndex).length;
    const kept = blocks.filter((html) => !hasWpImageClass(html, wpId));
    const target = afterBlockIndex - removedBefore;
    const figure = figureHtml(asset);
    kept.splice(target + 1, 0, figure);
    replaceBody(job, kept.join('\n'), '移動了圖片的位置');
  },

  async setFeaturedMedia(uuid: string, assetId: number | null) {
    await delay();
    const job = mustGet(uuid);
    invalidateApproval(job, '換了精選圖片');
    job.featuredMediaId = assetId;
    job.media = job.media.map((asset) => ({ ...asset, featured: asset.id === assetId }));
    job.blockers = job.blockers.filter((b) => !b.includes('精選圖片'));
  },
};
