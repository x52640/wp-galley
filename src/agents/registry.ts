import type {
  AgentAdapter,
  AgentId,
  AgentRequest,
  AgentResult,
  AgentStatus,
  GeneratedImage,
  ImageRequest,
  ModelOption,
} from './types.js';
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
  /**
   * 排在佇列裡就被取消的 runId。`adapter.cancel()` 只碰得到已經開跑的那一個，
   * 排隊中的會照樣跑——生圖每一張都花額度，所以輪到它時先看這裡，被取消就不跑。
   */
  private readonly cancelledRuns = new Set<string>();

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

  /**
   * 能生圖的那一家。**目前只有 Codex**（D-017）：靠 adapter 有沒有 `generateImage`
   * 決定，不在這裡寫死名字。一家都沒有就是 null。
   */
  imageGeneratorId(): AgentId | null {
    return this.list().find((adapter) => typeof adapter.generateImage === 'function')?.id ?? null;
  }

  /** 現在能不能生圖，不能的話為什麼。給畫面決定按鈕要不要給按。 */
  async imageGenerationStatus(): Promise<{ available: boolean; provider: AgentId | null; reason: string | null }> {
    const id = this.imageGeneratorId();
    if (id === null) {
      return { available: false, provider: null, reason: '沒有能生圖的 Agent。只有 Codex 能生圖' };
    }
    const status = await this.detect(id);
    if (status.available) return { available: true, provider: id, reason: null };
    return {
      available: false,
      provider: id,
      reason: `只有 ${status.displayName} 能生圖，但它現在不能用：${status.unavailableReason ?? '原因不明'}`,
    };
  }

  /**
   * 生圖。跟 `runStructured` 排**同一條**佇列：生圖也是一個 Agent 動作，
   * 同一時間只跑一個。
   */
  async generateImage(id: AgentId, request: ImageRequest, runId: string): Promise<AgentResult<GeneratedImage>> {
    const adapter = this.get(id);
    const generate = adapter.generateImage?.bind(adapter);
    if (!generate) {
      throw new AgentUnavailableError(`${adapter.displayName} 不能生圖。只有 Codex 能生圖`);
    }
    const status = await this.detect(id);
    if (!status.available) {
      throw new AgentUnavailableError(status.unavailableReason ?? `${adapter.displayName} 目前無法使用`);
    }

    const task = this.queue.then(async (): Promise<AgentResult<GeneratedImage>> => {
      if (this.cancelledRuns.delete(runId)) {
        return {
          ok: false,
          reason: 'cancelled',
          message: '還沒開始畫就取消了',
          issues: [],
          meta: { runId, agentId: id, model: null, durationMs: 0, stderrTail: '' },
        };
      }
      this.busyWith = runId;
      try {
        return await generate(request, runId);
      } finally {
        this.busyWith = null;
        this.cancelledRuns.delete(runId);
      }
    });
    this.queue = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }

  async cancel(id: AgentId, runId: string): Promise<void> {
    // 正在跑的那一個不記：它由 adapter 自己中止，記了反而會留在集合裡。
    if (this.busyWith !== runId) this.cancelledRuns.add(runId);
    await this.get(id).cancel(runId);
  }
}
