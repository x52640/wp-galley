/** 設定精靈要問 CoreService 的事：有沒有在發布、換連線與發布目標（P8-T002）。 */

import { InvalidInputError } from '../errors.js';
import { JOB_STATES } from '../state-machine.js';
import type { WordPressClient } from '../../wordpress/client.js';
import type { PublishTargetRegistry } from '../../wordpress/targets.js';
import type { CoreContext } from './context.js';

export class SetupModule {
  constructor(private readonly ctx: CoreContext) {}

  /** 有沒有發布正在進行。設定精靈在這時候不換連線（發到一半換站是最糟的情況）。 */
  isPublishing(): boolean {
    return this.ctx.publishing.size > 0;
  }

  /**
   * 設定精靈要開始換設定。有發布、上傳在跑就回原因（不開始）；否則立起旗子回 null，
   * 之後新的 WordPress 動作都會被擋，直到 endReconfigure()。
   */
  tryBeginReconfigure(): string | null {
    if (this.ctx.reconfiguring) return '設定正在儲存中，等它完成再試';
    if (this.ctx.publishing.size > 0) return '現在有一篇正在發布。等它發完再儲存設定，不然會發到一半換掉連線';
    if (this.ctx.wordpressOps > 0) return '現在有圖片正在上傳到 WordPress。等它完成再儲存設定';
    this.ctx.reconfiguring = true;
    return null;
  }

  endReconfigure(): void {
    this.ctx.reconfiguring = false;
  }

  /** 目前連的站上發過幾篇、傳過幾張圖。還沒連站是 null。 */
  currentSiteUsage(): { publishedJobs: number; uploadedMedia: number } | null {
    return this.ctx.siteId === null ? null : this.ctx.repo.siteUsage(this.ctx.siteId);
  }

  /**
   * 每個類型還有幾篇進行中的稿件（沒發布、沒取消、沒被取代；FAILED 還能重試，算）。
   * 設定精靈停用類型時講一句「還有 N 篇，停用後照常可以編輯」（D-032）；沒有稿件的類型不列。
   */
  openJobCountsByTarget(): Record<string, number> {
    const counts: Record<string, number> = {};
    const open = JOB_STATES.filter((state) => state !== 'PUBLISHED' && state !== 'CANCELLED' && state !== 'SUPERSEDED');
    for (const job of this.ctx.repo.listJobs(open)) {
      const key = this.ctx.repo.targetKeyOf(job.target_id);
      if (key !== null) counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  }

  /**
   * 設定精靈存檔後就地換掉連線、站台、發布目標（P8-T002），不用重新啟動。
   *
   * 只換給了的部分。站台或目標變了就重新同步 `sites`／`publish_targets` 兩張表，跟建構時一樣。
   * 進行中的 Agent 執行不受影響（它們不碰 WordPress）；正在發布時由呼叫端先擋掉（isPublishing）。
   * 遮蔽器不在這裡換：建構時拿到的就是可更新的那一個（createMutableScrubber）。
   */
  reconfigure(options: {
    readonly wordpress?: WordPressClient | null;
    readonly site?: { key: string; displayName: string; baseUrl: string; username: string } | null;
    readonly targets?: PublishTargetRegistry;
  }): void {
    // 最後一道檢查：呼叫端應該已經 tryBeginReconfigure() 過，這裡再確認沒有人正在跟 WordPress 講話。
    if (this.ctx.publishing.size > 0 || this.ctx.wordpressOps > 0) {
      throw new InvalidInputError('有發布或上傳正在進行，現在不能換設定');
    }
    if (options.wordpress !== undefined) this.ctx.wordpress = options.wordpress;
    if (options.site !== undefined) this.ctx.siteId = this.ctx.repo.syncSite(options.site);
    if (options.targets !== undefined) this.ctx.targets = options.targets;
    if (options.site !== undefined || options.targets !== undefined) {
      this.ctx.targetIds = this.ctx.repo.syncTargets(this.ctx.targets.list(), this.ctx.siteId);
    }
  }
}
