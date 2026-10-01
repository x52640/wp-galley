/** 發布：前置檢查、讀遠端比對、建立或更新 WordPress 文章。 */

import type { PublishResult } from '../../contract/api.js';
import { PublishBlockedError } from '../errors.js';
import { containsImage } from '../html-blocks.js';
import type { ApprovalRow, EventActor, JobRow, MediaAssetRow, RevisionRow, WordPressObjectRow } from '../repository.js';
import { EMPTY_BODY_MESSAGE, isBlankBody } from '../../contract/empty-body.js';
import { assertTransition } from '../state-machine.js';
import type { WordPressClient } from '../../wordpress/client.js';
import { toBlockMarkup } from '../../wordpress/blocks.js';
import { BlockDefaultsSchema } from '../../wordpress/block-types.js';
import {
  assertUnchanged,
  createDraft,
  fetchSnapshot,
  setStatus,
  snapshotOf,
  updateDraft,
  nonDraftUpdateMessage,
  type PostFields,
  type RemoteSnapshot,
} from '../../wordpress/posts.js';
import { resolveTerms } from '../../wordpress/terms.js';
import type { Post } from '../../wordpress/schemas.js';
import { taxonomyRestBaseOf, type PublishTarget } from '../../wordpress/targets.js';
import type { PublishInput, RevisionPayload } from './types.js';
import { OTHER_SITE_MEDIA_MESSAGE, APP_PASSWORD_IN_CONTENT_MESSAGE } from './context.js';
import type { CoreContext } from './context.js';

/**
 * 一次發布的前置檢查結果。
 *
 * 存在的理由是「檢查完到動手之間會經過網路」：讀遠端要幾百毫秒，那段時間裡
 * 另一個請求可以建新 revision、撤銷核准、或取消整個 job。所以前置檢查被做成一個
 * **可以重跑的純讀取函式**，讀完遠端之後再跑一次，比對兩次拿到的是不是同一版、
 * 同一張核准，一致才動手。任何一個欄位被快取起來重用，那個欄位就是一個 TOCTOU 洞。
 */
interface PublishPlan {
  readonly job: JobRow;
  readonly approval: ApprovalRow;
  readonly revisionRow: RevisionRow;
  readonly payload: RevisionPayload;
  readonly featured: MediaAssetRow | null;
  readonly existing: WordPressObjectRow | null;
  /** 要更新的既有物件 ID；null 代表這次是建立新的。 */
  readonly targetId: number | null;
  readonly creating: boolean;
}

/**
 * 讀回存下來的遠端快照。
 *
 * 讀不出來、形狀不對、或 id 對不上就回傳 null——也就是「沒有比對基準」。
 * 硬湊一份殘缺的基準出來比對，會變成隨機的假衝突或隨機的漏偵測，兩種都比誠實地
 * 說「沒有基準」糟。
 */
function parseSnapshot(json: string | null, expectedId: number): RemoteSnapshot | null {
  if (json === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const value = parsed as Partial<RemoteSnapshot>;
  if (
    value.id !== expectedId ||
    typeof value.status !== 'string' ||
    typeof value.contentHash !== 'string' ||
    typeof value.title !== 'string' ||
    typeof value.slug !== 'string' ||
    typeof value.featuredMediaId !== 'number'
  ) {
    return null;
  }
  return {
    id: value.id,
    status: value.status,
    modifiedGmt: typeof value.modifiedGmt === 'string' ? value.modifiedGmt : null,
    contentHash: value.contentHash,
    title: value.title,
    slug: value.slug,
    featuredMediaId: value.featuredMediaId,
    terms: Array.isArray(value.terms) ? [...value.terms] : null,
  };
}

export class PublishModule {
  constructor(private readonly ctx: CoreContext) {}

  /**
   * 發布。
   *
   * 五道前置檢查依序跑，**任何一項沒過就不送出任何請求**。順序是刻意的：
   * 先確認人核准過（1、2），再確認這次操作被 target 允許（3、4），
   * 最後才去讀遠端確認沒被別人改過（5）——第 5 項要連線，前四項不必。
   *
   * 第 5 項要等網路，而**等待就是一個空窗**：那幾百毫秒裡，另一個請求可以建新
   * revision、撤銷核准、或整個取消 job。所以第 1、2、3 項在讀完遠端之後會**再跑
   * 一次**，而且比對兩次拿到的是不是同一版、同一張核准——不一致就中止。
   * 同一個 job 同時只能有一次發布在跑（`publishing`），第二次直接拒絕而不是默默跟進。
   */
  async publish(uuid: string, input: PublishInput): Promise<PublishResult> {
    return this.ctx.trackWordPress(() => this.publishUntracked(uuid, input));
  }

  private async publishUntracked(uuid: string, input: PublishInput): Promise<PublishResult> {
    const job = this.ctx.requireJob(uuid);
    const target = this.ctx.targetOf(job);
    if (!target) throw new PublishBlockedError('這個工作項目沒有綁定發布目標');
    this.ctx.templates.get(target.templateId); // 模板不見了要現在就炸，不要發到一半才發現
    const client = this.ctx.requireWordPress();
    const actor: EventActor = input.actor ?? 'ui';

    if (this.ctx.publishing.has(job.uuid)) {
      throw this.rejectPublish(job, actor, '這個工作項目已經有一次發布在進行中，等它結束再試');
    }
    if (this.ctx.mediaUploads.has(job.uuid)) {
      throw this.rejectPublish(job, actor, '這篇有圖片正在上傳或替換到 WordPress，等它完成、重新確認預覽再發布');
    }
    this.ctx.publishing.add(job.uuid);
    try {
      return await this.runPublish(job.uuid, target, input, actor, client);
    } finally {
      this.ctx.publishing.delete(job.uuid);
    }
  }

  private async runPublish(
    uuid: string,
    target: PublishTarget,
    input: PublishInput,
    actor: EventActor,
    client: WordPressClient,
  ): Promise<PublishResult> {
    // 檢查 1–4。全部是讀取，所以待會兒可以原封不動重跑一次。
    const planned = this.preflightPublish(uuid, target, input, actor);

    // 4c. 作者（P5-T024）：發布選項，不是核准的內容。要送的話先確認站上允許，不行就在寫入前拒絕。
    const author = await this.ctx.authors.resolvePublishAuthor(planned.job, actor, client, input.authorId);

    // 5. 更新既有內容時，遠端不能在我們載入之後被改過。
    let expect: RemoteSnapshot | null = null;
    if (!planned.creating) {
      expect = await this.baselineFor(client, target, planned, actor);
      await assertUnchanged(client, target, planned.targetId!, expect);
    }

    // 讀遠端要等網路。等完之後世界可能已經不一樣了，所以重跑一次檢查，
    // 而且**後面用的全部是重跑的結果**——沿用上面那份就等於發布一個沒被檢查過的版本。
    const plan = this.preflightPublish(uuid, target, input, actor);
    if (
      plan.revisionRow.id !== planned.revisionRow.id ||
      plan.revisionRow.content_hash !== planned.revisionRow.content_hash ||
      plan.approval.id !== planned.approval.id
    ) {
      throw this.rejectPublish(
        plan.job,
        actor,
        '內容或核准在檢查遠端狀態的期間變動了，這次發布已中止。請重新預覽並核准後再發布',
      );
    }

    const { job, approval, revisionRow, payload, featured, creating, targetId } = plan;

    // 5b. 更新既有文章：遠端那篇不是草稿就拒絕，不論使用者選草稿或公開（審查 #1）。
    //     那等於「修改已發布文章」，Q-5 未裁定；而且更新不帶 status 時 WordPress 維持原狀態，
    //     「存成草稿」會直接改到線上的內容。
    if (!creating) {
      const refused = nonDraftUpdateMessage(expect!.status);
      if (refused !== null) throw this.rejectPublish(job, actor, refused);
    }

    // 前置檢查全過，才開始真的動遠端。
    assertTransition(job.state, 'PUBLISHING');
    this.ctx.repo.updateJobState(job.id, 'PUBLISHING');
    this.ctx.repo.insertEvent({
      jobId: job.id,
      revisionId: revisionRow.id,
      approvalId: approval.id,
      actor,
      eventType: 'publish',
      status: 'started',
      detail: this.ctx.scrub({ status: input.status, targetKey: target.key, creating, authorId: author?.id ?? null }),
    });

    try {
      // 區塊預設值跟著模板走：作者站台的模板不寫（medium 字級、圖片置中），通用模板全部 null。
      const template = this.ctx.templates.get(target.templateId);
      const conversion = toBlockMarkup(
        revisionRow.rendered_html ?? '',
        BlockDefaultsSchema.parse(template.manifest.blockDefaults ?? {}),
      );
      const terms = await this.resolveTargetTerms(client, target, payload.templateData);
      // 文章 JSON 裡放 term id 的欄位＝分類法的 REST 名稱（核心 category 是 categories）。
      const termsField = taxonomyRestBaseOf(target);

      // 建立新稿：沒有封面、沒有分類就省略（WordPress 預設就是沒有）。
      // 更新既有文章：封面一律送（沒有送 0）；分類清單是空的就送 []（審查 #13）——不送的話
      // WordPress 會留著舊的，線上那篇就跟核准的內容對不上。例外：填了分類名稱卻全部查不到，
      // 不送（不要因為查不到就把遠端的分類清掉），unknownTerms 照報。
      const featuredId = featured?.wordpress_media_id ?? 0;
      const fields: PostFields = {
        title: this.ctx.titleOf(payload.templateData) ?? job.title ?? '未命名',
        content: conversion.markup,
        ...(typeof payload.templateData['slug'] === 'string'
          ? { slug: payload.templateData['slug'] as string }
          : {}),
        ...(!creating || featuredId > 0 ? { featuredMediaId: featuredId } : {}),
        ...(termsField !== null && (terms.ids.length > 0 || (!creating && terms.unknown.length === 0))
          ? { terms: { [termsField]: terms.ids } }
          : {}),
        // 建稿與更新（fixedObjectId）都送；沒有要送的作者就省略，WordPress 維持原本的作者。
        ...(author === null ? {} : { authorId: author.id }),
      };

      // 查分類、讀遠端都要等網路，這段期間核准可能被撤銷（審查 #2）。每一個寫入請求送出前
      // 同步確認一次（建新稿前面沒有讀遠端，直接檢查；更新與改狀態走 beforeWrite，讀完遠端才檢查）。
      const noWriteMessage = '發布途中核准被撤銷了，這次沒有送出任何內容到 WordPress，工作項目標成失敗。';
      let post: Post;
      if (creating) {
        this.ctx.approval.assertApprovalUnchanged(job, approval, noWriteMessage);
        post = await createDraft(client, target, fields);
      } else {
        post = await updateDraft(client, target, targetId!, fields, {
          expect: expect!,
          beforeWrite: () => this.ctx.approval.assertApprovalUnchanged(job, approval, noWriteMessage),
        });
      }

      if (input.status === 'publish') {
        // 改成公開是收不回來的一步（電子報、自動分享）。沒了核准就維持寫進去時的狀態，不改公開。
        const written = post;
        post = await setStatus(client, target, post.id, 'publish', {
          expect: snapshotOf(post, termsField),
          beforeWrite: () =>
            this.ctx.approval.assertApprovalUnchanged(
              job,
              approval,
              `發布途中核准被撤銷了，所以沒有把文章改成公開：WordPress 上那篇（第 ${written.id} 號）` +
                `維持${written.status === 'draft' ? '草稿' : `原本的 ${written.status} 狀態`}，工作項目標成失敗。`,
            ),
        });
      }

      // 快照整包存下來，下一次更新才有東西可以比對（見 baselineFor）。
      const snapshot = snapshotOf(post, termsField);
      this.ctx.repo.upsertWordPressObject({
        siteId: this.ctx.siteId,
        jobId: job.id,
        objectType: target.postType,
        wordpressId: post.id,
        status: post.status,
        link: post.link,
        remoteHash: snapshot.contentHash,
        remoteModifiedGmt: snapshot.modifiedGmt,
        remoteSnapshotJson: JSON.stringify(snapshot),
      });

      this.ctx.repo.updateJobState(job.id, 'PUBLISHED');
      this.ctx.repo.insertEvent({
        jobId: job.id,
        revisionId: revisionRow.id,
        approvalId: approval.id,
        actor,
        eventType: 'publish',
        status: 'succeeded',
        detail: this.ctx.scrub({
          wordpressId: post.id,
          status: post.status,
          unknownTerms: terms.unknown,
          authorId: author?.id ?? null,
        }),
      });

      return {
        wordpressId: post.id,
        status: post.status,
        link: post.link,
        created: creating,
        unknownTerms: [...terms.unknown],
        fallbackBlocks: conversion.fallbackCount,
        author,
      };
    } catch (error) {
      this.ctx.repo.updateJobState(job.id, 'FAILED');
      this.ctx.repo.insertEvent({
        jobId: job.id,
        revisionId: revisionRow.id,
        approvalId: approval.id,
        actor,
        eventType: 'publish',
        status: 'failed',
        detail: this.ctx.scrub({ message: error instanceof Error ? error.message : String(error) }),
      });
      throw error;
    }
  }

  /**
   * 發布前置檢查 1–4。**純讀取、可以重跑**，這一點是刻意的：
   * 讀遠端之前跑一次、讀完之後再跑一次，才擋得住等待期間的變動。
   *
   * 每一次都從 DB 重新讀 job、核准與 revision，不接受呼叫端傳進來的快取值——
   * 傳得進來就代表可以傳一份過期的進來。
   */
  private preflightPublish(
    uuid: string,
    target: PublishTarget,
    input: PublishInput,
    actor: EventActor,
  ): PublishPlan {
    const job = this.ctx.requireJob(uuid);

    // 1. 狀態必須是 APPROVED。
    if (job.state !== 'APPROVED') {
      throw this.rejectPublish(job, actor, `工作項目目前是 ${job.state}，只有已核准（APPROVED）的內容才能發布`);
    }

    // 2. 核准存在，而且綁定的 hash 等於目前 revision 的 hash。
    const approval = this.ctx.repo.activeApproval(job.id);
    const revisionRow = this.ctx.requireRevision(job);
    if (!approval) {
      throw this.rejectPublish(job, actor, '找不到有效的核准紀錄');
    }
    if (approval.content_hash !== revisionRow.content_hash) {
      throw this.rejectPublish(job, actor, '內容在核准之後被改過了，核准已失效。請重新預覽並核准');
    }

    // 3. target 允許這次操作。只認**目前連的站**上的那篇（P8-T002：設定精靈可以換站）。
    //    這篇發到過別的站、在這個站上沒有：不改發到新站、也不去動舊站，講清楚讓使用者決定。
    const existing = this.ctx.repo.publishedObject(job.id, this.ctx.siteId);
    if (existing === null && target.fixedObjectId === null) {
      const elsewhere = this.ctx.repo.publishedObjectOnOtherSite(job.id, this.ctx.siteId);
      if (elsewhere !== null) {
        throw this.rejectPublish(
          job,
          actor,
          `這篇之前發到另一個站（${elsewhere.base_url}，第 ${elsewhere.wordpress_id} 號），現在發布台連的是別的站。` +
            '發布台不會把它改發到新站，也不會去動舊站的那篇：要發到現在這個站，請開一篇新稿把內容貼過去；' +
            '要更新舊站那篇，請把設定換回那個站。',
        );
      }
    }
    const targetId = target.fixedObjectId ?? existing?.wordpress_id ?? null;
    const creating = targetId === null;
    if (creating && !target.allowCreate) {
      throw this.rejectPublish(job, actor, `發布目標 ${target.key} 不允許建立新內容`);
    }
    if (!creating && !target.allowUpdate) {
      throw this.rejectPublish(job, actor, `發布目標 ${target.key} 不允許更新既有內容`);
    }
    if (target.requireSecondConfirmation && input.confirm !== true) {
      throw this.rejectPublish(job, actor, `發布目標 ${target.key} 需要再確認一次才能發布`);
    }

    // 4. 需要精選圖片的 target 一定要有精選圖片。
    const payload = this.ctx.payloadOf(revisionRow);

    // 4-0. 空文章不發（P5-T029）。核准時已經擋過，這裡是最後一道：發出去的空文章在 WordPress 上是一篇空白頁。
    if (isBlankBody(revisionRow.rendered_html)) {
      throw this.rejectPublish(job, actor, EMPTY_BODY_MESSAGE);
    }

    // 4a. 內容裡有 WordPress 應用程式密碼（核准之後才設定密碼的舊內容）就不發（D-023）。
    if (this.ctx.hasAppPassword(payload.templateData, revisionRow.rendered_html)) {
      throw this.rejectPublish(job, actor, APP_PASSWORD_IN_CONTENT_MESSAGE);
    }
    const featured =
      payload.featuredMediaAssetId === null ? null : this.ctx.repo.mediaById(payload.featuredMediaAssetId);
    if (target.requireFeaturedImage && (featured === null || featured.wordpress_media_id === null)) {
      throw this.rejectPublish(job, actor, `發布目標 ${target.key} 必須設定精選圖片`);
    }

    // 4b. 封面與正文裡的圖都要在目前這個站的媒體庫裡。換過站的話，舊站的圖編號在新站上是別的東西
    //     （或不存在），網址也還指著舊站——寧可擋下來講清楚，不要發出一篇掛著別站圖的文章。
    if (featured !== null && this.ctx.mediaOnOtherSite(featured)) {
      throw this.rejectPublish(job, actor, `封面圖是傳到另一個站的。${OTHER_SITE_MEDIA_MESSAGE}`);
    }
    const bodyHtml = revisionRow.rendered_html ?? '';
    const strayImages = this.ctx.repo
      .listMedia(job.id)
      .filter((asset) => asset.wordpress_media_id !== null && this.ctx.mediaOnOtherSite(asset))
      .filter((asset) => containsImage(bodyHtml, asset.wordpress_media_id!));
    if (strayImages.length > 0) {
      throw this.rejectPublish(
        job,
        actor,
        `正文裡有 ${strayImages.length} 張圖是傳到另一個站的。先把它們從正文移除，在現在這個站重新上傳、放進正文，再核准發布。`,
      );
    }

    return { job, approval, revisionRow, payload, featured, existing, targetId, creating };
  }

  /**
   * 更新既有內容時要拿來比對的基準快照。
   *
   * 只有**我們自己寫過**那個物件之後才會有基準。綁定 `fixedObjectId` 的 target
   * （首頁那一類）第一次發布時沒有——以前這裡塞一個空字串當 content hash，跟任何
   * 真實的 SHA-256 都不會相等，於是第一次更新永遠失敗，訊息還說「遠端被改過了」，
   * 是純粹的誤報。
   *
   * 正確的做法不是「沒有基準就照發」——那等於不管線上是什麼都蓋掉，正是首頁最不能
   * 出的事。改成：把遠端現況抓下來存成基準，然後**中止這一次**並說清楚原因。
   * 使用者確認過線上那份確實可以覆蓋，再按一次發布，第二次就有真正的變動偵測了。
   */
  private async baselineFor(
    client: WordPressClient,
    target: PublishTarget,
    plan: PublishPlan,
    actor: EventActor,
  ): Promise<RemoteSnapshot> {
    const targetId = plan.targetId!;
    const existing = plan.existing;

    const stored =
      existing !== null && existing.wordpress_id === targetId
        ? parseSnapshot(existing.remote_snapshot_json, targetId)
        : null;
    if (stored !== null) return stored;

    const snapshot = await fetchSnapshot(client, target, targetId, taxonomyRestBaseOf(target));
    this.ctx.repo.upsertWordPressObject({
      siteId: this.ctx.siteId,
      jobId: plan.job.id,
      objectType: target.postType,
      wordpressId: targetId,
      status: snapshot.status,
      link: existing?.link ?? null,
      remoteHash: snapshot.contentHash,
      remoteModifiedGmt: snapshot.modifiedGmt,
      remoteSnapshotJson: JSON.stringify(snapshot),
    });

    throw this.rejectPublish(
      plan.job,
      actor,
      `發布台還沒有 WordPress 上第 ${targetId} 號內容的比對基準，無法判斷它有沒有被別人改過。` +
        `已經把現況記下來了（狀態 ${snapshot.status}，最後修改 ${snapshot.modifiedGmt ?? '未知'}）。` +
        '請先確認那份內容確實可以被這次發布覆蓋，然後再按一次發布。',
    );
  }

  rejectPublish(job: JobRow, actor: EventActor, message: string): PublishBlockedError {
    this.ctx.repo.insertEvent({
      jobId: job.id,
      revisionId: null,
      approvalId: null,
      actor,
      eventType: 'publish',
      status: 'rejected',
      detail: this.ctx.scrub({ message }),
    });
    return new PublishBlockedError(message);
  }

  private async resolveTargetTerms(
    client: WordPressClient,
    target: PublishTarget,
    templateData: Record<string, unknown>,
  ): Promise<{ ids: readonly number[]; unknown: readonly string[] }> {
    const restBase = taxonomyRestBaseOf(target);
    if (restBase === null) return { ids: [], unknown: [] };

    const names: string[] = [];
    const tags = templateData['tags'];
    if (Array.isArray(tags)) names.push(...tags.filter((tag): tag is string => typeof tag === 'string'));
    const category = templateData['category'];
    if (typeof category === 'string' && category.length > 0) names.push(category);
    if (names.length === 0) return { ids: [], unknown: [] };

    // 用 REST 名稱查：作者站台的分類法 slug＝rest_base，核心的 category 不是（見 docs/specs/wordpress-site.md）。
    const resolution = await resolveTerms(client, restBase, names, {
      allowCreate: target.allowCreateTerms,
    });
    return { ids: resolution.ids, unknown: resolution.unknown };
  }
}
