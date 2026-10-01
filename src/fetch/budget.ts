/**
 * 「這次查證的額度」（security.md「取回器」的「數量」）：一次查證建一個，所有抓取共用。
 * - 網址嘗試：最多 12 個；同一主機最多 3 個（以原本網址的主機算，跳轉不另外扣）。
 * - 維基百科 API：最多 30 次（搜尋與 extracts 各算一次）；條目網址改走 API 時扣這裡、不扣網址嘗試。
 * - 同時：最多 3 個請求在飛（網址與維基 API 共用），多的排隊等。
 * 只有通過 DNS 前檢查、真的要發請求的才扣額度。
 */
import type { FetchFailureCode, FetchLimits } from './types.js';

export type BudgetCheck = { ok: true } | { ok: false; code: FetchFailureCode };

export class FetchBudget {
  private attempts = 0;
  private wikipediaCalls = 0;
  private readonly perHost = new Map<string, number>();
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(
    private readonly limits: Pick<
      FetchLimits,
      'maxAttempts' | 'maxConcurrent' | 'maxPerHost' | 'maxWikipediaCalls'
    >,
  ) {}

  /** 扣一次網址嘗試（含同主機計數）。超過就不扣、回原因。 */
  takeUrlAttempt(hostname: string): BudgetCheck {
    const host = hostname.toLowerCase();
    if (this.attempts >= this.limits.maxAttempts) return { ok: false, code: 'budget-attempts' };
    const used = this.perHost.get(host) ?? 0;
    if (used >= this.limits.maxPerHost) return { ok: false, code: 'budget-host' };
    this.attempts += 1;
    this.perHost.set(host, used + 1);
    return { ok: true };
  }

  takeWikipediaCall(): BudgetCheck {
    if (this.wikipediaCalls >= this.limits.maxWikipediaCalls) {
      return { ok: false, code: 'budget-wikipedia' };
    }
    this.wikipediaCalls += 1;
    return { ok: true };
  }

  /** 佔一個同時名額跑 `task`，跑完一定釋放。 */
  async withSlot<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.limits.maxConcurrent) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    } else {
      this.active += 1;
    }
    try {
      return await task();
    } finally {
      const next = this.waiting.shift();
      if (next) next(); // 名額直接交給下一個，active 不變
      else this.active -= 1;
    }
  }

  get usage(): { attempts: number; wikipediaCalls: number; active: number } {
    return { attempts: this.attempts, wikipediaCalls: this.wikipediaCalls, active: this.active };
  }
}
