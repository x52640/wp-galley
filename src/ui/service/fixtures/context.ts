/**
 * 示範資料各領域共用的小工具（對應後端 `service/context.ts`）：讀稿件、拆正文、換一版正文、撕核准。
 * 規則本身（錨點、待處理數、能改哪一欄…）不寫在這裡，一律用 `src/contract` 的純函式（P5-T033）。
 */

import { EMPTY_BODY_MESSAGE, isBlankBody } from '../../../contract/empty-body.js';
import { hasWpImageClass } from '../../../contract/media-marker.js';
import type { MediaAsset } from '../types.js';
import { store, type FixtureJob } from './store.js';

/** 標題與貼上的原稿是字：跟後端的 autoescape 一樣逃脫。 */
export function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 跟後端 getJob 一樣：正文空的就標出來，發布面板的「還不能發布」也列出來（P5-T029）。 */
export function syncEmptyBody(job: FixtureJob): void {
  job.bodyEmpty = isBlankBody(job.currentRevision?.publishHtml);
  const others = job.blockers.filter((blocker) => blocker !== EMPTY_BODY_MESSAGE);
  job.blockers = job.bodyEmpty ? [EMPTY_BODY_MESSAGE, ...others] : others;
}

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function readBody(job: FixtureJob): string {
  const value = job.currentRevision?.templateData['body'];
  return typeof value === 'string' ? value : '';
}

export function mustGet(uuid: string): FixtureJob {
  const job = store.get(uuid);
  if (!job) throw new Error(`示範資料裡沒有這篇稿件：${uuid}`);
  return job;
}

export function nextHash(): string {
  return Math.random().toString(16).slice(2, 10) + Math.random().toString(16).slice(2, 10);
}

/** 內容一改就撕掉印章，並退回 RENDERED——跟 CoreService 該做的事一樣。 */
export function invalidateApproval(job: FixtureJob, _reason: string): void {
  if (job.approval && job.approval.valid) {
    job.approval = { ...job.approval, valid: false };
    if (job.state === 'APPROVED') job.state = 'RENDERED';
    job.blockers = ['內容改過了，核准已失效，請重新預覽並核准'];
  }
}

/**
 * 正文的頂層區塊（HTML）。示範資料跑在瀏覽器裡，直接借 DOMParser 拆；規則跟後端的
 * splitTopLevelBlocks 一樣只看頂層元素（示範資料的正文沒有裸文字）。
 */
export function bodyBlocks(html: string): string[] {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  return Array.from(doc.body.firstElementChild?.children ?? []).map((element) => element.outerHTML);
}

export function blockText(html: string): string {
  return new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '';
}

/** 圖片在不在正文、在第幾段之後，跟後端一樣從正文算，不另外記。 */
export function syncPlacement(job: FixtureJob): void {
  const blocks = bodyBlocks(readBody(job));
  job.media = job.media.map((asset) => {
    const at =
      asset.wordpressMediaId === null ? -1 : blocks.findIndex((html) => hasWpImageClass(html, asset.wordpressMediaId!));
    return { ...asset, placed: at >= 0, placedAfterBlockIndex: at >= 0 ? at - 1 : null };
  });
}

/** 換一版正文：版本 +1、換 hash、撕核准。跟後端 createRevision 的效果一樣。 */
export function replaceBody(job: FixtureJob, body: string, reason: string): void {
  if (!job.currentRevision) return;
  invalidateApproval(job, reason);
  job.currentRevision = {
    ...job.currentRevision,
    number: job.currentRevision.number + 1,
    origin: 'media',
    contentHash: nextHash().padEnd(64, '0'),
    templateData: { ...job.currentRevision.templateData, body },
    publishHtml: body,
  };
  job.revisionCount += 1;
  syncPlacement(job);
}

/** 正文裡的圖片區塊，跟後端 buildFigureHtml 同樣的形狀。 */
export function figureHtml(asset: MediaAsset): string {
  const caption = asset.caption ? `<figcaption class="wp-element-caption">${asset.caption}</figcaption>` : '';
  return (
    `<figure class="wp-block-image size-large aligncenter"><img src="${asset.url ?? ''}" alt="${asset.altText ?? ''}" ` +
    `class="wp-image-${asset.wordpressMediaId}" />${caption}</figure>`
  );
}

export const delay = (ms = 220): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
