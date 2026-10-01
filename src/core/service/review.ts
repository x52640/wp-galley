/** 待處理清單（階段 5.5）：提案的逐項處理、整份採用、丟棄、對照。 */

import type {
  Comparison as ComparisonView,
  Revision,
  ReviewItem as ReviewItemView,
  ReviewProposal as ReviewProposalView,
  ReviewResolveResult,
} from '../../contract/api.js';
import { computeComparison } from '../diff.js';
import { describeMediaForDiff, diffFields } from '../field-diff.js';
import { ContentChangedError, InvalidInputError } from '../errors.js';
import { findBlockContaining, splitTopLevelBlocks, type TopLevelBlock } from '../html-blocks.js';
import type { JobRow, RevisionRow, ReviewItemRow, ReviewItemState, ReviewProposalRow } from '../repository.js';
import type { Observation, ReviewChange, ReviewOutput } from '../../agents/output-contract.js';
import { applyChanges, isAlreadyDone, type ChangeSlot } from '../review-apply.js';
import type { AgentId } from '../../agents/types.js';
import type { ResolveReviewInput, ProposalRef } from './types.js';
import type { CoreContext } from './context.js';

export class ReviewModule {
  constructor(private readonly ctx: CoreContext) {}

  /** 目前的待處理清單。沒有未結案的提案就是 null。 */
  getReview(uuid: string): ReviewProposalView | null {
    const job = this.ctx.requireJob(uuid);
    const revisionRow = this.ctx.repo.latestRevision(job.id);
    return this.reviewView(job.id, revisionRow ? this.ctx.toRevision(revisionRow) : null);
  }

  /**
   * 逐項處理清單上的建議。
   *
   * 套用是**從目前的內容出發，只套上被勾選的那幾項**（見 review-apply.ts 的說明）。
   * 走的是一般的 `createRevision`，所以核准失效、狀態退回、稽核紀錄全都跟手動編輯
   * 走同一條路——校稿建議沒有任何特權。
   *
   * 定位不到的項目標成 `unappliable` 而不是靜靜跳過：使用者按了「套用」卻什麼都
   * 沒發生，比明講「這一項要自己改」糟得多。
   */
  resolveReviewItems(uuid: string, input: ResolveReviewInput): ReviewResolveResult {
    const job = this.ctx.requireJob(uuid);
    this.ctx.assertMutable(job);

    const proposal = this.requireOpenProposal(job);
    const items = this.ctx.repo.listReviewItems(proposal.id);
    const byId = new Map(items.map((row) => [row.id, row]));

    const unknown = input.itemIds.filter((id) => !byId.has(id));
    if (unknown.length > 0) {
      throw new InvalidInputError(`這幾項不屬於目前的校稿提案：${unknown.join('、')}`);
    }
    const wanted = new Set(input.itemIds);
    if (wanted.size === 0) throw new InvalidInputError('沒有選到任何項目');

    if (input.decision === 'skip') {
      // 已經套用進文章的項目不能被標成「已略過」——文字還在，清單卻說沒套用，
      // 那份清單就開始說謊了。畫面上兩個動作共用同一個 busy 旗標，但兩個分頁
      // 或重送的請求還是疊得起來，所以擋在這裡而不是只擋在畫面上。
      const skipped = [...wanted].filter((id) => byId.get(id)!.state !== 'applied');
      for (const id of skipped) this.ctx.repo.updateReviewItemState(id, 'skipped', null);
      this.ctx.repo.insertEvent({
        jobId: job.id,
        revisionId: null,
        approvalId: null,
        actor: 'ui',
        eventType: 'review_items_skipped',
        status: 'succeeded',
        detail: { proposalId: proposal.id, count: skipped.length, ignored: wanted.size - skipped.length },
      });
      this.closeProposalIfDone(proposal.id);
      return {
        revision: null,
        applied: [],
        skipped,
        unappliable: [],
        alreadyDone: [],
        review: this.getReview(uuid),
      };
    }

    // 觀察不是改動，沒有「套用」這回事——它要的是人去確認，不是程式去替換字串。
    const observations = [...wanted].filter((id) => byId.get(id)!.item_type === 'observation');
    if (observations.length > 0) {
      throw new InvalidInputError('觀察不是可以自動套用的改動，只能標成已處理或自己去改內容');
    }

    const changeRows = items.filter((row) => row.item_type === 'change');
    const chosen = changeRows.filter((row) => wanted.has(row.id) && row.state !== 'applied');
    if (chosen.length === 0) {
      return {
        revision: null,
        applied: [],
        skipped: [],
        unappliable: [],
        alreadyDone: [],
        review: this.getReview(uuid),
      };
    }
    const chosenIds = new Set(chosen.map((row) => row.id));

    // 每一項都要參與定位，連沒被勾選的也是——游標得走過它們，後面同樣的字串
    // 才不會被套到前面那個位置上。已經套用過的要找 `after`，它現在長那樣。
    const slots: ChangeSlot[] = changeRows.map((row) => {
      const change = JSON.parse(row.payload_json) as ReviewChange;
      if (row.state === 'applied') return { ordinal: row.ordinal, find: change.after, replaceWith: null };
      // 落在完整 after 裡的 before 不算（「很多事→很多事情」，文章已經是「很多事情」），否則會套成「很多事情情」。
      if (chosenIds.has(row.id)) {
        return { ordinal: row.ordinal, find: change.before, replaceWith: change.after, skipInside: change.after };
      }
      return { ordinal: row.ordinal, find: change.before, replaceWith: null, skipInside: change.after };
    });

    const revisionRow = this.ctx.requireRevision(job);
    const outcome = applyChanges(this.ctx.payloadOf(revisionRow).templateData, slots);
    const replacedOrdinals = new Set(outcome.replaced);

    // 定位不到的再分兩種（P5-T017）：文章裡已經是改好的樣子（before 不在、after 在）就不是
    // 「找不到」，是「已經改好了」——不寫進資料庫，讀取時照目前的內容算（見 toReviewView）。
    // 看的是套用之後的內容：同一批裡前一項改出來的字，也算數。
    const missed = chosen.filter((row) => !replacedOrdinals.has(row.ordinal));
    const alreadyDone = missed
      .filter((row) => isAlreadyDone(outcome.templateData, JSON.parse(row.payload_json) as ReviewChange))
      .map((row) => row.id);
    const doneIds = new Set(alreadyDone);
    const notFound = missed.filter((row) => !doneIds.has(row.id));

    if (replacedOrdinals.size === 0) {
      for (const row of notFound) this.ctx.repo.updateReviewItemState(row.id, 'unappliable', null);
      if (notFound.length > 0) {
        this.ctx.repo.insertEvent({
          jobId: job.id,
          revisionId: revisionRow.id,
          approvalId: null,
          actor: 'ui',
          eventType: 'review_items_unappliable',
          status: 'rejected',
          detail: { proposalId: proposal.id, ordinals: notFound.map((row) => row.ordinal) },
        });
      }
      return {
        revision: null,
        applied: [],
        skipped: [],
        unappliable: notFound.map((row) => row.id),
        alreadyDone,
        review: this.getReview(uuid),
      };
    }

    const revision = this.ctx.content.createRevision(job.uuid, {
      origin: 'agent_review',
      templateData: outcome.templateData,
      reason: `套用校稿建議 ${replacedOrdinals.size} 項`,
    });

    const applied: number[] = [];
    const unappliable: number[] = [];
    for (const row of chosen) {
      if (replacedOrdinals.has(row.ordinal)) {
        this.ctx.repo.updateReviewItemState(row.id, 'applied', revision.id);
        applied.push(row.id);
      } else if (!doneIds.has(row.id)) {
        this.ctx.repo.updateReviewItemState(row.id, 'unappliable', null);
        unappliable.push(row.id);
      }
    }

    // 提案還沒過期時，比對基準跟著換到新版本：這次的改動是我們自己造成的，不算外力，
    // 之後仍可整份採用；「內容被別的動作改過」也仍然分辨得出來（見 stale 的說明）。
    // 已經過期的就不換（審查 #8）：換了等於把中間的手改洗掉，整份採用會用舊稿蓋掉它。
    if (proposal.base_content_hash === revisionRow.content_hash) {
      this.ctx.repo.rebaseReviewProposal(proposal.id, revision.id, revision.contentHash);
    }
    this.ctx.repo.insertEvent({
      jobId: job.id,
      revisionId: revision.id,
      approvalId: null,
      actor: 'ui',
      eventType: 'review_items_applied',
      status: 'succeeded',
      detail: {
        proposalId: proposal.id,
        applied: applied.length,
        unappliable: unappliable.length,
        alreadyDone: alreadyDone.length,
      },
    });
    this.closeProposalIfDone(proposal.id);

    return { revision, applied, skipped: [], unappliable, alreadyDone, review: this.getReview(uuid) };
  }

  /**
   * 接受 Agent 的整份稿。
   *
   * 這跟「把每一項都勾起來」**不一樣**，差別要講清楚：逐項套用只會套上 Agent
   * 申報過的改動，這裡是直接採用它交回來的整份 `templateData`，包含它沒寫進
   * `changes` 的調整。使用者明說要整份接受時才走這條。
   *
   * 提案之後內容被改過（手動編輯、插圖、換封面）就擋下來——這條路是整份覆蓋，
   * 那些修改會無聲消失。
   */
  acceptWholeProposal(uuid: string, ref: ProposalRef = {}): ReviewResolveResult {
    const job = this.ctx.requireJob(uuid);
    this.ctx.assertMutable(job);

    const proposal = this.requireOpenProposal(job, ref.proposalId);
    const revisionRow = this.ctx.requireRevision(job);
    if (proposal.base_content_hash !== revisionRow.content_hash) {
      throw new ContentChangedError(
        '內容在這次校稿之後被改過了。「全部接受」會用 Agent 當時看到的稿整份蓋掉目前的內容，' +
          '中間的修改會消失。請改用逐項套用，或丟棄這份提案重新校稿。',
        { proposalBase: proposal.base_content_hash, current: revisionRow.content_hash },
      );
    }

    const proposed = JSON.parse(proposal.proposed_data_json) as Record<string, unknown>;
    const revision = this.ctx.content.createRevision(job.uuid, {
      origin: 'agent_review',
      templateData: proposed,
      reason: '接受 Agent 的整份校稿',
    });

    const applied: number[] = [];
    for (const row of this.ctx.repo.listReviewItems(proposal.id)) {
      if (row.item_type !== 'change') continue;
      this.ctx.repo.updateReviewItemState(row.id, 'applied', revision.id);
      applied.push(row.id);
    }

    this.ctx.repo.rebaseReviewProposal(proposal.id, revision.id, revision.contentHash);
    this.ctx.repo.insertEvent({
      jobId: job.id,
      revisionId: revision.id,
      approvalId: null,
      actor: 'ui',
      eventType: 'review_accepted_whole',
      status: 'succeeded',
      detail: { proposalId: proposal.id, applied: applied.length },
    });
    this.closeProposalIfDone(proposal.id);

    return { revision, applied, skipped: [], unappliable: [], alreadyDone: [], review: this.getReview(uuid) };
  }

  /** 丟掉整份提案。內容不動——本來就還沒動過。 */
  discardReview(uuid: string, reason: string, ref: ProposalRef = {}): void {
    const job = this.ctx.requireJob(uuid);
    const proposal = this.requireOpenProposal(job, ref.proposalId);
    this.ctx.repo.closeReviewProposal(proposal.id, reason);
    this.ctx.repo.insertEvent({
      jobId: job.id,
      revisionId: null,
      approvalId: null,
      actor: 'ui',
      eventType: 'review_discarded',
      status: 'succeeded',
      detail: this.ctx.scrub({ proposalId: proposal.id, reason }),
    });
  }

  /**
   * 左右對照。
   *
   * 有未結案的提案就跟提案比（左＝現在的文章，右＝全部接受會變成的樣子），
   * 沒有就跟上一版比。兩種都比不了時回 `none`，讓畫面說「沒有可以對照的東西」，
   * 而不是給一片空白。
   */
  getComparison(uuid: string, against?: 'proposal' | 'previous'): ComparisonView {
    const job = this.ctx.requireJob(uuid);
    const revisionRow = this.ctx.repo.latestRevision(job.id);
    const none: ComparisonView = { against: 'none', leftLabel: '', rightLabel: '', rows: [], fieldChanges: [] };
    if (!revisionRow) return none;

    const proposal = this.ctx.repo.openReviewProposal(job.id);
    const mode = against ?? (proposal ? 'proposal' : 'previous');
    const current = this.ctx.payloadOf(revisionRow);
    // 跟上一版比不需要模板；發布目標被拿掉的舊稿件也要比得出來，正文欄位就當成 body。
    const publishSlot = this.ctx.targetOf(job) ? this.ctx.requireTemplate(job).manifest.publishSlot : 'body';

    if (mode === 'proposal' && proposal) {
      const template = this.ctx.requireTemplate(job);
      const proposed = JSON.parse(proposal.proposed_data_json) as Record<string, unknown>;
      const rendered = this.ctx.renderPayload(template, {
        templateData: proposed,
        featuredMediaAssetId: current.featuredMediaAssetId,
      });
      return {
        against: 'proposal',
        leftLabel: `目前 r${revisionRow.revision_number}`,
        rightLabel: `${proposal.provider} 的提案`,
        rows: computeComparison(revisionRow.rendered_html ?? '', rendered.result.publishHtml),
        // 提案不動精選圖片（全部接受也沿用目前那一張），所以只比 templateData。
        fieldChanges: diffFields({
          before: current.templateData,
          after: proposed,
          publishSlot,
        }),
      };
    }

    const previous = this.ctx.repo.previousRevision(job.id, revisionRow.revision_number);
    if (!previous) return none;
    const earlier = this.ctx.payloadOf(previous);
    return {
      against: 'previous',
      leftLabel: `r${previous.revision_number}`,
      rightLabel: `r${revisionRow.revision_number}`,
      rows: computeComparison(previous.rendered_html ?? '', revisionRow.rendered_html ?? ''),
      fieldChanges: diffFields({
        before: earlier.templateData,
        after: current.templateData,
        publishSlot,
        featured: {
          beforeId: earlier.featuredMediaAssetId,
          afterId: current.featuredMediaAssetId,
          before: this.featuredLabel(earlier.featuredMediaAssetId),
          after: this.featuredLabel(current.featuredMediaAssetId),
        },
      }),
    };
  }

  /** 對照摘要裡精選圖片的名字：檔名／替代文字，不是 id（D-019）。 */
  private featuredLabel(assetId: number | null): string | null {
    if (assetId === null) return null;
    const asset = this.ctx.repo.mediaById(assetId);
    if (!asset) return '一張已經移除的圖片';
    return describeMediaForDiff({ url: this.ctx.mediaUrl(asset), altText: asset.alt_text });
  }

  /** 把 Agent 的輸出存成提案。舊的未結案提案會先結掉——清單上只能有一份。 */
  openProposal(
    job: JobRow,
    agentRunId: number,
    baseRevision: RevisionRow,
    provider: AgentId,
    data: ReviewOutput,
  ): ReviewProposalView {
    const previous = this.ctx.repo.openReviewProposal(job.id);
    if (previous) this.ctx.repo.closeReviewProposal(previous.id, '被新的校稿取代');

    const proposal = this.ctx.repo.insertReviewProposal({
      jobId: job.id,
      agentRunId,
      baseRevisionId: baseRevision.id,
      baseContentHash: baseRevision.content_hash,
      provider,
      summary: data.summary,
      proposedDataJson: JSON.stringify(data.templateData),
    });

    // ordinal 是 Agent 列出來的順序，逐項套用靠它依序定位，所以改動排在前面、
    // 觀察接在後面，兩者共用同一串編號。
    let ordinal = 0;
    for (const change of data.changes) {
      this.ctx.repo.insertReviewItem({ proposalId: proposal.id, ordinal, itemType: 'change', payload: change });
      ordinal += 1;
    }
    for (const observation of data.observations) {
      this.ctx.repo.insertReviewItem({
        proposalId: proposal.id,
        ordinal,
        itemType: 'observation',
        payload: observation,
      });
      ordinal += 1;
    }

    this.ctx.repo.insertEvent({
      jobId: job.id,
      revisionId: baseRevision.id,
      approvalId: null,
      actor: 'ui',
      eventType: 'review_proposed',
      status: 'succeeded',
      detail: {
        proposalId: proposal.id,
        changes: data.changes.length,
        observations: data.observations.length,
      },
    });

    return this.toReviewView(
      proposal,
      baseRevision.content_hash,
      baseRevision.rendered_html ?? '',
      this.ctx.payloadOf(baseRevision).templateData,
    );
  }

  private requireOpenProposal(job: JobRow, expectedId?: number): ReviewProposalRow {
    const proposal = this.ctx.repo.openReviewProposal(job.id);
    if (!proposal) throw new InvalidInputError('這個工作項目沒有待處理的校稿提案');
    if (expectedId !== undefined && proposal.id !== expectedId) {
      throw new ContentChangedError(
        '這份校稿建議已經被另一次校稿取代了，畫面上的不是目前那一份。重新讀取之後再決定。',
        { expected: expectedId, current: proposal.id },
      );
    }
    return proposal;
  }

  /**
   * 全部處理完就把提案結掉，清單自己消失，不用使用者再去按一次。
   *
   * `unappliable` 也算沒處理完：那一項是「想套用但定位不到」，使用者還沒決定要
   * 自己改還是不要了。把它當成完成的話，清單會連同「這一項要自己改」的提示
   * 一起消失，使用者不會知道有東西沒做到。
   */
  closeProposalIfDone(proposalId: number): void {
    // 只看**存下來的**狀態。「已經改好了」是讀取時推算的（內容改回去就不算了），拿它來結案等於
    // 用推算的結果把提案永久關掉——結掉之後文章改回去，那張卡片也回不來。
    const remaining = this.ctx.repo
      .listReviewItems(proposalId)
      .filter((row) => row.state === 'pending' || row.state === 'unappliable');
    if (remaining.length === 0) this.ctx.repo.closeReviewProposal(proposalId, '所有項目都處理完了');
  }

  /** 列表用的輕量版：只數數量，不重算每一項的段落位置。 */
  pendingReviewCount(jobId: number): number {
    const proposal = this.ctx.repo.openReviewProposal(jobId);
    if (!proposal) return 0;
    return this.openReviewRows(this.ctx.repo.listReviewItems(proposal.id), this.latestTemplateData(jobId)).length;
  }

  private latestTemplateData(jobId: number): Record<string, unknown> | null {
    const row = this.ctx.repo.latestRevision(jobId);
    return row ? this.ctx.payloadOf(row).templateData : null;
  }

  /**
   * 還沒有下場的項目：`pending` 加上 `unappliable`，扣掉「已經改好了」的（P5-T017）。
   * 清單、blockers、總覽的數字都用這一個判斷，才不會各說各話。「要不要結案」**不用**它，
   * 只看存下來的狀態（見 closeProposalIfDone）。
   */
  private openReviewRows(rows: readonly ReviewItemRow[], templateData: Record<string, unknown> | null): ReviewItemRow[] {
    const done = this.alreadyDoneIds(rows, templateData);
    return rows.filter((row) => (row.state === 'pending' || row.state === 'unappliable') && !done.has(row.id));
  }

  /**
   * 哪幾項「已經改好了」：還沒有下場的改動裡，原句找不到、要改成的字已經在目前內容裡的
   * （規則見 `isAlreadyDone`）。**讀取時照目前的內容算，不寫回資料庫**——打開舊提案就看到
   * 正確的狀態，GET 也不會去改使用者的資料；內容改回去的話那一項自然回到原本的狀態。
   *
   * 按過「保留原文」的也重判：字已經改好了還寫「保留原文」是在說謊（使用者 job 2 的「吃得苦」
   * 就是看不懂卡片才按了保留原文）。兩者都算已處理，數字不受影響。已接受、「自己改了」不重判——
   * 那兩個本來就講對了。
   */
  private alreadyDoneIds(rows: readonly ReviewItemRow[], templateData: Record<string, unknown> | null): Set<number> {
    const done = new Set<number>();
    if (templateData === null) return done;
    for (const row of rows) {
      if (row.item_type !== 'change') continue;
      const plainSkip = row.state === 'skipped' && row.revision_id === null;
      if (row.state !== 'pending' && row.state !== 'unappliable' && !plainSkip) continue;
      if (isAlreadyDone(templateData, JSON.parse(row.payload_json) as ReviewChange)) done.add(row.id);
    }
    return done;
  }

  reviewView(jobId: number, revision: Revision | null): ReviewProposalView | null {
    const proposal = this.ctx.repo.openReviewProposal(jobId);
    if (!proposal) return null;
    return this.toReviewView(
      proposal,
      revision?.contentHash ?? null,
      revision?.publishHtml ?? '',
      revision?.templateData ?? null,
    );
  }

  private toReviewView(
    proposal: ReviewProposalRow,
    currentHash: string | null,
    currentHtml: string,
    currentData: Record<string, unknown> | null,
  ): ReviewProposalView {
    // 正文只拆一次，幾百個項目共用；每一項各拆一次會把 parse5 叫爆。
    const blocks = currentHtml.length === 0 ? [] : splitTopLevelBlocks(currentHtml);
    const rows = this.ctx.repo.listReviewItems(proposal.id);
    const done = this.alreadyDoneIds(rows, currentData);
    const items = rows.map((row) => this.toReviewItem(row, blocks, done.has(row.id)));
    return {
      id: proposal.id,
      provider: proposal.provider,
      summary: proposal.summary,
      createdAt: proposal.created_at,
      baseContentHash: proposal.base_content_hash,
      stale: currentHash !== null && currentHash !== proposal.base_content_hash,
      // 已經改好了的在 toReviewItem 已經是 skipped，不會被數進來。
      pendingCount: items.filter((item) => item.state === 'pending' || item.state === 'unappliable')
        .length,
      items,
    };
  }

  private toReviewItem(row: ReviewItemRow, blocks: readonly TopLevelBlock[], alreadyDone: boolean): ReviewItemView {
    const payload = JSON.parse(row.payload_json) as unknown;
    const change = row.item_type === 'change' ? (payload as ReviewChange) : null;
    const observation = row.item_type === 'observation' ? (payload as Observation) : null;

    return {
      id: row.id,
      ordinal: row.ordinal,
      type: row.item_type,
      // 已經改好了的算已處理（跟「自己改了」一樣是 skipped＋旗標），資料庫裡的狀態不動。
      state: alreadyDone ? 'skipped' : row.state,
      change,
      observation,
      // 已經改好了的，文章裡現在是 after——跟已套用的一樣照 after 找段落。
      blockIndex: this.locateItem(blocks, change, observation, alreadyDone ? 'applied' : row.state),
      resolvedAt: row.resolved_at,
      // 略過本身不寫 revision_id；只有「從卡片進去改、存檔結案」會寫。
      resolvedByEdit: row.state === 'skipped' && row.revision_id !== null,
      alreadyDone,
    };
  }

  /**
   * 這一項現在落在第幾段。
   *
   * **一律以目前的內容為準去找，找不到就是 null。** 觀察雖然自帶一個 `blockIndex`，
   * 但那是 Agent 看它那一版時算的，內容改過就指到別的段落了；拿它當退路等於
   * 回傳一個沒有驗證過的跳轉目標，跳到錯的段落比不能跳更糟。
   */
  private locateItem(
    blocks: readonly TopLevelBlock[],
    change: ReviewChange | null,
    observation: Observation | null,
    state: ReviewItemState,
  ): number | null {
    if (blocks.length === 0) return null;
    // 已經套用過的那一項，文章裡現在是 after。還沒套用的找 before，但落在完整 after 裡的不算——
    // 跟套用同一條規則，卡片指的段落才會是按接受真的會改的那一段。
    if (change) {
      return state === 'applied'
        ? findBlockContaining(blocks, change.after)
        : findBlockContaining(blocks, change.before, change.after);
    }
    return observation === null ? null : findBlockContaining(blocks, observation.excerpt);
  }
}
