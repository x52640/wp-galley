import type { AgentAdapter, AgentId, AgentRequest, AgentResult, AgentStatus, ModelOption } from './types.js';
import { CodexAdapter } from './adapters/codex.js';
import { ClaudeAdapter } from './adapters/claude.js';
import { GoogleAdapter } from './adapters/google.js';

/**
 * Agent registry：對外的單一入口。
 *
 * 負責三件事：
 * 1. 管理三個 adapter，讓其他模組不必知道有幾家、各叫什麼。
 * 2. 偵測結果快取——`detect()` 要跑子行程，UI 每次重整都重跑會很慢。
 * 3. **同時只跑一個 Agent**（計畫 §6.2 的 concurrency 1）。
 */

/** 偵測結果的快取時間。CLI 登入狀態不會秒變，30 秒夠用。 */
const DETECT_CACHE_MS = 30_000;

export interface AgentRegistryOptions {
  /** 測試時可注入假的 adapter。 */
  readonly adapters?: AgentAdapter[];
  readonly now?: () => number;
}

interface CacheEntry {
  readonly status: AgentStatus;
  readonly at: number;
}

export class AgentUnavailableError extends Error {
  override readonly name = 'AgentUnavailableError';
}

export class AgentRegistry {
  private readonly adapters: Map<AgentId, AgentAdapter>;
  private readonly cache = new Map<AgentId, CacheEntry>();
  private readonly now: () => number;
  /** concurrency 1：後來的請求排在這條 promise 鏈上。 */
  private queue: Promise<unknown> = Promise.resolve();
  private busyWith: string | null = null;

  constructor(options: AgentRegistryOptions = {}) {
    const list = options.adapters ?? [new CodexAdapter(), new ClaudeAdapter(), new GoogleAdapter()];
    this.adapters = new Map(list.map((adapter) => [adapter.id, adapter]));
    this.now = options.now ?? Date.now;
  }

  list(): AgentAdapter[] {
    return [...this.adapters.values()];
  }

  get(id: AgentId): AgentAdapter {
    const adapter = this.adapters.get(id);
    if (!adapter) throw new AgentUnavailableError(`未知的 Agent：${id}`);
    return adapter;
  }

  /** 目前有沒有執行在跑，以及跑的是誰。 */
  get busy(): string | null {
    return this.busyWith;
  }

  /** 偵測全部 Agent。個別 adapter 失敗不影響其他家。 */
  async detectAll(options: { refresh?: boolean } = {}): Promise<AgentStatus[]> {
    return Promise.all(this.list().map((adapter) => this.detect(adapter.id, options)));
  }

  async detect(id: AgentId, options: { refresh?: boolean } = {}): Promise<AgentStatus> {
    const adapter = this.get(id);
    const cached = this.cache.get(id);
    if (!options.refresh && cached && this.now() - cached.at < DETECT_CACHE_MS) {
      return cached.status;
    }

    try {
      const status = await adapter.detect();
      this.cache.set(id, { status, at: this.now() });
      return status;
    } catch (error) {
      // 偵測本身壞掉不該讓整個 UI 掛掉，降級成「無法確認」。
      const status: AgentStatus = {
        id,
        displayName: adapter.displayName,
        installed: false,
        executablePath: null,
        version: null,
        loginState: 'unknown',
        loginDetail: null,
        supportsJsonSchema: false,
        available: false,
        unavailableReason: `偵測失敗：${error instanceof Error ? error.message : String(error)}`,
      };
      this.cache.set(id, { status, at: this.now() });
      return status;
    }
  }

  async listModels(id: AgentId): Promise<ModelOption[]> {
    try {
      return await this.get(id).listModels();
    } catch {
      return [];
    }
  }

  /**
   * 執行一次結構化請求。
   *
   * 會先確認 Agent 可用，再排入佇列。同一時間只有一個 Agent 在跑，
   * 避免多個訂閱型 CLI 同時搶資源或互相干擾。
   */
  async runStructured<T>(
    id: AgentId,
    request: AgentRequest,
    schema: Record<string, unknown>,
    runId: string,
  ): Promise<AgentResult<T>> {
    const adapter = this.get(id);
    const status = await this.detect(id);
    if (!status.available) {
      throw new AgentUnavailableError(status.unavailableReason ?? `${adapter.displayName} 目前無法使用`);
    }

    const task = this.queue.then(async () => {
      this.busyWith = runId;
      try {
        return await adapter.runStructured<T>(request, schema, runId);
      } finally {
        this.busyWith = null;
      }
    });

    // 佇列本身不能因為某次執行失敗就斷掉。
    this.queue = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }

  async cancel(id: AgentId, runId: string): Promise<void> {
    await this.get(id).cancel(runId);
  }
}
