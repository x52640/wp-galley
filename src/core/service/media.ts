/** 媒體：上傳、換圖、移除、放位置、精選圖片，以及上傳後的自動放位置／自動設精選。 */

import { rmSync } from 'node:fs';
import type { AutoFeatureResult, AutoPlaceResult, MediaAsset, Revision } from '../../contract/api.js';
import { InvalidInputError, MediaError } from '../errors.js';
import {
  escapeHtml,
  findBlocksContaining,
  insertBlockAfter,
  containsImage,
  findImageBlockIndex,
  removeImageFromBody,
  replaceImageInBody,
  splitTopLevelBlocks,
} from '../html-blocks.js';
import type { JobRow, MediaAssetRow } from '../repository.js';
import { isFeaturedBrief } from '../image-generation.js';
import { isContentMutable } from '../state-machine.js';
import { uploadMedia } from '../../media/upload.js';
import type { AddMediaInput, MediaUploadOutcome } from './types.js';
import { OTHER_SITE_MEDIA_MESSAGE, featuredInput } from './context.js';
import {
  AUTO_FEATURE_AGENT_RUNNING,
  AUTO_FEATURE_KEPT_EXISTING,
  AUTO_FEATURE_SET,
  AUTO_PLACE_AGENT_RUNNING,
  placeByAnchor,
  replacedResult,
} from '../../contract/auto-place.js';
import { taskLocksContent } from '../../contract/agent-run.js';
import type { CoreContext } from './context.js';

/**
 * 圖片區塊。class 全部在模板 allowlist 裡（見各模板的 manifest.json），
 * 所以 sanitize 不會把它洗掉；`wp-image-<id>` 也是後面辨識「這張圖有沒有被放進
 * 正文」的依據。
 */
export function buildFigureHtml(
  url: string,
  alt: string,
  caption: string | null,
  mediaId: number,
): string {
  const captionHtml =
    caption && caption.trim().length > 0
      ? `<figcaption class="wp-element-caption">${escapeHtml(caption)}</figcaption>`
      : '';
  return (
    `<figure class="wp-block-image size-large aligncenter">` +
    `<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" class="wp-image-${mediaId}" />` +
    `${captionHtml}</figure>`
  );
}

export class MediaModule {
  constructor(private readonly ctx: CoreContext) {}

  /**
   * 上傳圖片。**上傳本身不改變正文**，所以不會讓核准失效——要等
   * `placeMedia` 或 `setFeaturedMedia` 才算內容改動。
   *
   * 例外：帶的 briefKey 對上封面那條配圖需求，而且目前沒有別的封面時，會接著自動
   * `setFeaturedMedia`（D-017），那一步照規則撤銷核准。結果要看的話用 `addMediaWithOutcome`。
   */
  async addMedia(uuid: string, input: AddMediaInput): Promise<MediaAsset> {
    return (await this.addMediaWithOutcome(uuid, input)).media;
  }

  /**
   * 同 `addMedia`，另外回報封面有沒有自動設成精選（沒對上封面是 null），以及內文圖有沒有
   * 照錨點自動放進正文（沒對上內文圖是 null，P5-T016）。
   */
  async addMediaWithOutcome(uuid: string, input: AddMediaInput): Promise<MediaUploadOutcome> {
    // 替代文字與說明會進正文（放圖時寫進 figure），之後的校稿會送給 Agent。目前的內容也先看：
    // 自動放圖、設封面會建新版本，舊內容有密碼的話會在那裡被擋——那時圖已經傳上 WordPress 了。
    this.ctx.assertNoAppPassword(input.altText, input.caption, ...this.ctx.currentContentOf(this.ctx.requireJob(uuid)));
    return this.ctx.trackWordPress(() => this.trackMediaUpload(uuid, () => this.addMediaUntracked(uuid, input)));
  }

  /** 上傳／換圖期間在 `mediaUploads` 記一筆，發布看到就拒絕（審查 #3）。 */
  private async trackMediaUpload<T>(uuid: string, fn: () => Promise<T>): Promise<T> {
    this.ctx.mediaUploads.set(uuid, (this.ctx.mediaUploads.get(uuid) ?? 0) + 1);
    try {
      return await fn();
    } finally {
      const left = (this.ctx.mediaUploads.get(uuid) ?? 1) - 1;
      if (left > 0) this.ctx.mediaUploads.set(uuid, left);
      else this.ctx.mediaUploads.delete(uuid);
    }
  }

  /**
   * 上傳要等網路；等回來時工作可能已經不能改了（發布了、取消了）。那就**不寫任何本機紀錄**，
   * 記一筆失敗事件、丟清楚的錯誤（審查 #3）。圖已經在 WordPress 媒體庫，發布台不自動刪使用者站上的東西。
   */
  private assertMutableAfterUpload(
    job: JobRow,
    wordpressMediaId: number,
    eventType: 'media_added' | 'media_replaced',
  ): void {
    const fresh = this.ctx.requireJob(job.uuid);
    if (isContentMutable(fresh.state)) return;
    const message =
      `上傳期間工作項目變成 ${fresh.state}，不能再改內容，所以這張圖沒有記進發布台。` +
      `圖已經傳到 WordPress 媒體庫（第 ${wordpressMediaId} 號），發布台不會自動刪除；不需要的話可以到媒體庫刪掉。`;
    this.ctx.repo.insertEvent({
      jobId: job.id,
      revisionId: null,
      approvalId: null,
      actor: 'ui',
      eventType,
      status: 'failed',
      detail: this.ctx.scrub({ mediaId: wordpressMediaId, state: fresh.state, message }),
    });
    throw new InvalidInputError(message);
  }

  private async addMediaUntracked(uuid: string, input: AddMediaInput): Promise<MediaUploadOutcome> {
    const job = this.ctx.requireJob(uuid);
    this.ctx.assertMutable(job);
    const client = this.ctx.requireWordPress();

    const uploaded = await uploadMedia(client, {
      bytes: input.bytes,
      mimeType: input.mimeType,
      filename: input.filename,
      ...(input.altText === undefined ? {} : { altText: input.altText }),
      ...(input.caption === undefined ? {} : { caption: input.caption }),
    });
    this.assertMutableAfterUpload(job, uploaded.media.id, 'media_added');

    const localPath = this.ctx.writeLocalCopy(job.uuid, uploaded.sha256, input.mimeType, input.bytes);

    const row = this.ctx.repo.insertMedia({
      jobId: job.id,
      briefKey: input.briefKey ?? null,
      localPath,
      mimeType: input.mimeType,
      byteSize: input.bytes.byteLength,
      sha256: uploaded.sha256,
      altText: input.altText ?? uploaded.media.alt_text ?? null,
      caption: input.caption ?? null,
      wordpressMediaId: uploaded.media.id,
      uploadedAt: new Date().toISOString(),
    });

    this.ctx.repo.upsertWordPressObject({
      siteId: this.ctx.siteId,
      jobId: job.id,
      objectType: 'media',
      wordpressId: uploaded.media.id,
      status: 'inherit',
      link: uploaded.media.source_url,
      remoteHash: null,
      remoteModifiedGmt: null,
    });

    this.ctx.repo.insertEvent({
      jobId: job.id,
      revisionId: null,
      approvalId: null,
      actor: 'ui',
      eventType: 'media_added',
      status: 'succeeded',
      detail: this.ctx.scrub({ mediaId: uploaded.media.id, bytes: input.bytes.byteLength }),
    });

    // 走到這裡圖已經在 WordPress 媒體庫了。接下來的自動設精選／自動放位置出任何錯都只能是
    // 「上傳成功、但沒設好」：往外丟的話，「用這張」會把一張其實已經上傳的候選圖放回去，再按就重複上傳。
    const autoFeature = this.afterUpload(job, row.id, 'auto_featured', () => this.autoFeature(job, row.id, input.briefKey), (reason) => ({
      outcome: 'failed' as const,
      message: `圖已經上傳，但沒能設成精選圖片：${reason}`,
    }));
    const autoPlace =
      autoFeature === null
        ? this.afterUpload(job, row.id, 'auto_placed', () => this.autoPlace(job, row.id, input.briefKey), (reason) => ({
            outcome: 'failed' as const,
            message: `圖已經上傳，但沒能放進正文：${reason}`,
            afterBlockIndex: null,
          }))
        : null;

    const latest = this.ctx.repo.latestRevision(job.id);
    return { media: this.ctx.toMedia(row, latest ? this.ctx.toRevision(latest) : null), autoFeature, autoPlace };
  }

  /**
   * 換圖。契約把它列為會改變 content_hash 的方法，所以**一律先撤銷核准**——
   * 就算這張圖還沒插進正文也一樣。寧可多撤一次，也不要漏掉。
   *
   * AI 查證跑的期間照常換（D-036：查證不改文章，不鎖內容）。
   */
  async replaceMedia(uuid: string, assetId: number, input: AddMediaInput): Promise<MediaAsset> {
    this.ctx.assertNoAppPassword(input.altText, input.caption, ...this.ctx.currentContentOf(this.ctx.requireJob(uuid)));
    return this.ctx.trackWordPress(() =>
      this.trackMediaUpload(uuid, () => this.replaceMediaUntracked(uuid, assetId, input)),
    );
  }

  private async replaceMediaUntracked(uuid: string, assetId: number, input: AddMediaInput): Promise<MediaAsset> {
    const job = this.ctx.requireJob(uuid);
    this.ctx.assertMutable(job);
    const old = this.ctx.requireMedia(job, assetId);
    const client = this.ctx.requireWordPress();

    this.ctx.approval.invalidateApproval(job, '換圖');

    const uploaded = await uploadMedia(client, {
      bytes: input.bytes,
      mimeType: input.mimeType,
      filename: input.filename,
      ...(input.altText === undefined ? {} : { altText: input.altText }),
      ...(input.caption === undefined ? {} : { caption: input.caption }),
    });
    this.assertMutableAfterUpload(job, uploaded.media.id, 'media_replaced');

    const localPath = this.ctx.writeLocalCopy(job.uuid, uploaded.sha256, input.mimeType, input.bytes);
    const row = this.ctx.repo.updateMedia(assetId, {
      localPath,
      mimeType: input.mimeType,
      byteSize: input.bytes.byteLength,
      sha256: uploaded.sha256,
      altText: input.altText ?? old.alt_text,
      caption: input.caption ?? old.caption,
      wordpressMediaId: uploaded.media.id,
      uploadedAt: new Date().toISOString(),
    });

    this.ctx.repo.upsertWordPressObject({
      siteId: this.ctx.siteId,
      jobId: job.id,
      objectType: 'media',
      wordpressId: uploaded.media.id,
      status: 'inherit',
      link: uploaded.media.source_url,
      remoteHash: null,
      remoteModifiedGmt: null,
    });

    // 正文裡引用到舊圖的地方要換成新圖，否則發出去的還是舊網址。
    const revisionRow = this.ctx.repo.latestRevision(job.id);
    if (revisionRow) {
      const payload = this.ctx.payloadOf(revisionRow);
      const body = String(payload.templateData[this.ctx.requireTemplate(job).manifest.publishSlot] ?? '');
      const oldId = old.wordpress_media_id;
      const figure = buildFigureHtml(
        uploaded.media.source_url,
        row.alt_text ?? '',
        row.caption,
        uploaded.media.id,
      );
      const swapped =
        oldId === null
          ? { html: body, replaced: 0 }
          : replaceImageInBody(body, oldId, figure);

      if (swapped.replaced > 0 || payload.featuredMediaAssetId === assetId) {
        this.ctx.content.createRevision(job.uuid, {
          origin: 'media',
          templateData: {
            ...payload.templateData,
            [this.ctx.requireTemplate(job).manifest.publishSlot]: swapped.html,
          },
          reason: '換圖',
        });
      }
    }

    this.ctx.repo.insertEvent({
      jobId: job.id,
      revisionId: null,
      approvalId: null,
      actor: 'ui',
      eventType: 'media_replaced',
      status: 'succeeded',
      detail: this.ctx.scrub({ assetId, mediaId: uploaded.media.id }),
    });

    const latest = this.ctx.repo.latestRevision(job.id);
    return this.ctx.toMedia(this.ctx.repo.mediaById(assetId)!, latest ? this.ctx.toRevision(latest) : null);
  }

  /**
   * 移除圖片。只從這個工作項目移除，**不會刪掉 WordPress 媒體庫的檔案**——
   * 那張圖可能已經被別篇文章用了，發布台沒有立場替使用者做這個決定。
   */
  removeMedia(uuid: string, assetId: number): void {
    const job = this.ctx.requireJob(uuid);
    this.ctx.assertMutable(job);
    const asset = this.ctx.requireMedia(job, assetId);
    const template = this.ctx.requireTemplate(job);

    const revisionRow = this.ctx.repo.latestRevision(job.id);
    if (revisionRow) {
      const payload = this.ctx.payloadOf(revisionRow);
      const body = String(payload.templateData[template.manifest.publishSlot] ?? '');
      const wpId = asset.wordpress_media_id;
      // 只拿掉圖片節點，同一段的文字留著（審查 #9）。
      const stripped = wpId === null ? { html: body, touched: 0 } : removeImageFromBody(body, wpId);

      const wasFeatured = payload.featuredMediaAssetId === assetId;
      if (stripped.touched > 0 || wasFeatured) {
        // 走 createRevision，核准失效因此自動處理。
        this.ctx.content.createRevision(job.uuid, {
          origin: 'media',
          templateData: { ...payload.templateData, [template.manifest.publishSlot]: stripped.html },
          ...(wasFeatured ? { featuredMediaId: null } : {}),
          reason: '移除圖片',
        });
      }
    }

    this.ctx.repo.deleteMedia(assetId);
    rmSync(this.ctx.localFile(asset.local_path), { force: true });
    this.ctx.repo.insertEvent({
      jobId: job.id,
      revisionId: null,
      approvalId: null,
      actor: 'ui',
      eventType: 'media_removed',
      status: 'succeeded',
      detail: this.ctx.scrub({ assetId }),
    });
  }

  /** 換封面。走 createRevision，所以核准會失效。 */
  setFeaturedMedia(uuid: string, assetId: number | null): Revision {
    this.ctx.assertNotReconfiguring();
    const job = this.ctx.requireJob(uuid);
    if (assetId !== null && this.ctx.mediaOnOtherSite(this.ctx.requireMedia(job, assetId))) {
      throw new MediaError(OTHER_SITE_MEDIA_MESSAGE);
    }
    return this.ctx.content.createRevision(uuid, {
      origin: 'media',
      featuredMediaId: assetId,
      reason: assetId === null ? '清除精選圖片' : '設定精選圖片',
    });
  }

  /**
   * 把圖片插進正文的第 n 個頂層區塊後面（-1 代表插在最前面）。
   *
   * 索引是以**目前這一版渲染出來的 publishHtml** 為準，跟 UI 上看到的區塊、
   * 跟校對符號的 blockIndex 是同一套，符號才不會標錯段。
   */
  placeMedia(uuid: string, assetId: number, afterBlockIndex: number): Revision {
    this.ctx.assertNotReconfiguring();
    const job = this.ctx.requireJob(uuid);
    this.ctx.assertMutable(job);
    const asset = this.ctx.requireMedia(job, assetId);
    const template = this.ctx.requireTemplate(job);
    const revisionRow = this.ctx.requireRevision(job);

    if (this.ctx.mediaOnOtherSite(asset)) throw new MediaError(OTHER_SITE_MEDIA_MESSAGE);
    const url = this.ctx.mediaUrl(asset);
    if (asset.wordpress_media_id === null || url === null) {
      throw new MediaError('這張圖還沒上傳到 WordPress，無法插進正文');
    }

    const currentHtml = revisionRow.rendered_html ?? '';
    const blocks = splitTopLevelBlocks(currentHtml);
    const blockCount = blocks.length;

    // 上限是 blockCount - 1，不是 blockCount。「插在最後一塊後面」已經是最大的
    // 合法位置了；再多一格從來就不存在，以前是被 insertBlockAfter 默默夾回去，
    // 使用者以為自己指定了位置，其實系統幫他改了一個。寧可回報錯誤。
    const maxIndex = blockCount - 1;
    if (afterBlockIndex < -1 || afterBlockIndex > maxIndex) {
      throw new InvalidInputError(
        `插入位置 ${afterBlockIndex} 超出範圍（目前有 ${blockCount} 個區塊，可用的位置是 -1 到 ${maxIndex}）`,
      );
    }

    // 這張圖已經在正文裡就是「搬家」，不是「再放一張」。先把舊的拿掉再插，
    // 否則同一張圖會出現兩次，而 toMedia() 只回報第一個，畫面上完全看不出來。
    // 只拿掉圖片節點（連同包它的 figure）；同一段還有字就留著那段（審查 #9）。
    const wpId = asset.wordpress_media_id;
    const existing = removeImageFromBody(currentHtml, wpId);

    // 整塊被拿掉的區塊如果排在目標位置前面，目標位置就要往前挪同樣的格數——
    // 使用者指的是**他現在看到的**第幾塊。留下文字的那塊沒消失，不用挪。
    const removedBefore = existing.droppedIndexes.filter((index) => index <= afterBlockIndex).length;
    const baseHtml = existing.html;
    const targetIndex = afterBlockIndex - removedBefore;

    const figure = buildFigureHtml(url, asset.alt_text ?? '', asset.caption, asset.wordpress_media_id);
    const nextBody = insertBlockAfter(baseHtml, targetIndex, figure);
    const payload = this.ctx.payloadOf(revisionRow);

    return this.ctx.content.createRevision(uuid, {
      origin: 'media',
      templateData: { ...payload.templateData, [template.manifest.publishSlot]: nextBody },
      reason: existing.touched > 0 ? '移動圖片位置' : '插入圖片',
    });
  }

  /**
   * 上傳成功之後的附帶動作（自動設精選、自動放位置）。任何例外——包括動作本身一開頭就丟的——
   * 都收成 `failed` 結果並記一筆失敗事件，不往外丟：圖已經在媒體庫了，呼叫端要知道「上傳成功」。
   */
  private afterUpload<T>(
    job: JobRow,
    assetId: number,
    eventType: string,
    action: () => T | null,
    failed: (reason: string) => T,
  ): T | null {
    try {
      return action();
    } catch (error) {
      const reason = this.ctx.scrub(error instanceof Error ? error.message : String(error));
      this.ctx.repo.insertEvent({
        jobId: job.id,
        revisionId: null,
        approvalId: null,
        actor: 'ui',
        eventType,
        status: 'failed',
        detail: { assetId, message: reason },
      });
      return failed(reason);
    }
  }

  /**
   * 這篇稿件有沒有正在跑、而且結果要對著目前內容套用的 Agent 動作（校稿、一鍵配圖）。
   *
   * 那種動作跑完會檢查「派工時的那一版還是不是目前這一版」（`assertAgentResultStillApplies`），
   * 不是就整份丟掉。所以它跑的期間，上傳的附帶動作不能建新版本，否則使用者等了一分鐘的結果會作廢。
   * 生圖不在此列：候選圖不是對著某一版文字做的。
   */
  private contentRunActive(job: JobRow): boolean {
    const active = this.ctx.activeRuns.get(job.uuid);
    if (!active) return false;
    return taskLocksContent(this.ctx.repo.agentRunById(active.rowId)?.purpose);
  }

  /**
   * 對上內文圖那條配圖需求的圖，上傳後自動放進正文（D-020，P5-T016）。手動上傳與「用這張」都走這裡。
   *
   * 1. AI 還在跑（`contentRunActive`）：不放，講「等它跑完再放」——放了會讓那一趟的結果作廢。
   * 2. 「換一張」：這條需求之前的圖還在正文裡，新圖接替它的位置（同一個新版本裡把舊圖拿出正文，
   *    舊圖留在媒體庫）。
   * 3. 否則照錨點：對著**目前這一版**找（忽略空白），剛好一段對得上才放在那一段之後；
   *    找不到、不只一段、沒有錨點，都不放，結果講給使用者聽。不用 Agent 當時看到的段落編號。
   *
   * 放進正文照既有規則建新版本、撤銷核准。沒對上配圖需求（或對上的是封面，那條由 `autoFeature`
   * 處理）就回 null。例外由呼叫端（`afterUpload`）收成 `failed`。
   */
  private autoPlace(job: JobRow, assetId: number, briefKey: string | undefined): AutoPlaceResult | null {
    if (briefKey === undefined) return null;
    const brief = this.ctx.repo
      .listImageBriefs(job.id)
      .find((row) => row.brief_key === briefKey && row.dismissed_at === null);
    if (!brief) return null;
    const latest = this.ctx.repo.latestRevision(job.id);
    const featuredKey = latest ? this.ctx.payloadOf(latest).templateData['featuredImageBriefKey'] : undefined;
    if (isFeaturedBrief(featuredInput(brief), featuredKey)) return null;

    if (this.contentRunActive(job)) return AUTO_PLACE_AGENT_RUNNING;

    const html = latest?.rendered_html ?? '';
    const blocks = splitTopLevelBlocks(html);

    // 「換一張」：同一條需求較新的舊圖優先（一般只會有一張在正文裡）。
    // 認圖的規則跟換圖本身同一套（img 的 class），正文文字寫著「wp-image-N」不算。
    const previous = this.ctx.repo
      .listMedia(job.id)
      .filter((row) => row.id !== assetId && row.brief_key === brief.brief_key && row.wordpress_media_id !== null)
      .reverse()
      .find((row) => containsImage(html, row.wordpress_media_id!));
    if (previous) return this.replaceInBody(job, assetId, previous);

    // 照錨點：放不放、講什麼在共用契約（示範資料也用同一份，P5-T033）。
    const decision = placeByAnchor(
      { origin: brief.origin, anchorPosition: brief.anchor_position, anchor: brief.anchor },
      (anchor) => findBlocksContaining(blocks, anchor),
    );
    if (decision.place) this.placeMedia(job.uuid, assetId, decision.afterBlockIndex);
    return decision.result;
  }

  /**
   * 「換一張」：新圖放到舊圖在正文裡的位置，舊圖在同一個新版本裡拿出正文（它留在媒體庫與這篇稿件的
   * 圖片清單裡，要不要移除由使用者決定）。舊圖在正文裡出現不只一次時每一處都換成新圖。
   */
  private replaceInBody(job: JobRow, assetId: number, previous: MediaAssetRow): AutoPlaceResult {
    const template = this.ctx.requireTemplate(job);
    const revisionRow = this.ctx.requireRevision(job);
    const asset = this.ctx.requireMedia(job, assetId);
    const url = this.ctx.mediaUrl(asset);
    if (asset.wordpress_media_id === null || url === null) {
      throw new MediaError('這張圖還沒上傳到 WordPress，無法插進正文');
    }
    const oldId = previous.wordpress_media_id!;
    const payload = this.ctx.payloadOf(revisionRow);
    const body = String(payload.templateData[template.manifest.publishSlot] ?? '');
    const figure = buildFigureHtml(url, asset.alt_text ?? '', asset.caption, asset.wordpress_media_id);
    const swapped = replaceImageInBody(body, oldId, figure);
    if (swapped.replaced === 0) {
      // 不假裝換好了：舊圖其實不在要改的正文裡，回報「換了」會讓使用者以為新圖已經在文章上。
      throw new MediaError('正文裡找不到原本那張圖，沒有換。請用「在這裡插圖」或圖片的「插入位置」自己放。');
    }
    const revision = this.ctx.content.createRevision(job.uuid, {
      origin: 'media',
      templateData: { ...payload.templateData, [template.manifest.publishSlot]: swapped.html },
      reason: '換一張配圖',
    });
    const at = findImageBlockIndex(revision.publishHtml, asset.wordpress_media_id!);
    return replacedResult(at - 1);
  }

  /**
   * 對上封面那條配圖需求的圖，上傳後自動設成精選（D-017）。手動上傳與「用這張」都走這裡。
   *
   * **不覆蓋使用者選的封面**：只有目前沒有精選圖片、或目前的精選就是這條需求的圖（「換一張」）
   * 才設。設精選是內容改動，照既有規則撤銷核准。設不成時上傳照樣成功（圖已經在媒體庫），
   * 結果回給呼叫端讓畫面講出來，另記一筆事件。沒對上封面就回 null。
   */
  private autoFeature(job: JobRow, assetId: number, briefKey: string | undefined): AutoFeatureResult | null {
    if (briefKey === undefined) return null;
    const brief = this.ctx.repo
      .listImageBriefs(job.id)
      .find((row) => row.brief_key === briefKey && row.dismissed_at === null);
    if (!brief) return null;
    const latest = this.ctx.repo.latestRevision(job.id);
    const payload = latest ? this.ctx.payloadOf(latest) : null;
    const featuredKey = payload?.templateData['featuredImageBriefKey'];
    if (!isFeaturedBrief(featuredInput(brief), featuredKey)) return null;

    // 設精選會建新版本；校稿或配圖正在跑的時候建，那一趟跑完的結果就會作廢（見 contentRunActive）。
    if (this.contentRunActive(job)) return AUTO_FEATURE_AGENT_RUNNING;

    const currentId = payload?.featuredMediaAssetId ?? null;
    if (currentId !== null && currentId !== assetId) {
      const current = this.ctx.repo.mediaById(currentId);
      if (current !== null && current.brief_key !== brief.brief_key) return AUTO_FEATURE_KEPT_EXISTING;
    }

    try {
      this.setFeaturedMedia(job.uuid, assetId);
      return AUTO_FEATURE_SET;
    } catch (error) {
      const reason = this.ctx.scrub(error instanceof Error ? error.message : String(error));
      this.ctx.repo.insertEvent({
        jobId: job.id,
        revisionId: null,
        approvalId: null,
        actor: 'ui',
        eventType: 'auto_featured',
        status: 'failed',
        detail: { assetId, message: reason },
      });
      return {
        outcome: 'failed',
        message: `圖已經上傳，但沒能設成精選：${reason}。請按圖片上的「設為精選」再試一次。`,
      };
    }
  }
}
