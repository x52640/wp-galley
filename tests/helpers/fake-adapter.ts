import type {
  AgentAdapter,
  AgentId,
  AgentRequest,
  AgentResult,
  AgentStatus,
  GeneratedImage,
  ImageRequest,
  ModelOption,
} from '../../src/agents/types.js';

/** 1×1 的 PNG。假的生圖結果。 */
export const FAKE_GENERATED_PNG = new Uint8Array(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ),
);

export interface FakeImageBehaviour {
  result?: AgentResult<GeneratedImage>;
  delayMs?: number;
  /** 在「已經開始畫、圖還沒回來」的那一刻執行（模擬取消、改稿）。 */
  onRun?: (runId: string) => void | Promise<void>;
}

/**
 * 測試用的假 adapter。
 *
 * 計畫階段 3 要求「使用 fixture 建立不需消耗訂閱額度的 adapter 測試」——
 * 所有 registry 與流程測試都跑這個，不碰真實 CLI。
 */
export class FakeAdapter implements AgentAdapter {
  readonly calls: { runId: string; request: AgentRequest }[] = [];
  readonly cancelled: string[] = [];
  readonly imageCalls: { runId: string; request: ImageRequest }[] = [];
  detectCount = 0;
  /**
   * 只有給了 `image` 的假 adapter 才會生圖——跟真實世界一樣，不是每一家都有這個方法。
   */
  readonly generateImage?: NonNullable<AgentAdapter['generateImage']>;

  constructor(
    readonly id: AgentId,
    readonly displayName: string,
    private readonly behaviour: {
      status?: Partial<AgentStatus>;
      detectThrows?: boolean;
      result?: AgentResult<unknown>;
      delayMs?: number;
      models?: ModelOption[];
      /**
       * 在「Agent 已經開跑、結果還沒回來」的那一刻執行。
       *
       * 用來模擬真實世界唯一會發生但很難重現的事：Agent 跑那幾十秒裡，
       * 使用者去改了內容、或按了取消。真實 CLI 一次要花好幾分鐘又會消耗訂閱額度，
       * 所以那個時間窗只能這樣測。
       */
      onRun?: (runId: string) => void | Promise<void>;
      /** 給了才會有 `generateImage`。 */
      image?: FakeImageBehaviour;
    } = {},
  ) {
    const image = behaviour.image;
    if (image) {
      this.generateImage = async (request, runId) => {
        this.imageCalls.push({ runId, request });
        if (image.delayMs) await new Promise((resolve) => setTimeout(resolve, image.delayMs));
        if (image.onRun) await image.onRun(runId);
        return (
          image.result ?? {
            ok: true,
            data: { bytes: FAKE_GENERATED_PNG, sourceName: 'exec-fake.png' },
            meta: { runId, agentId: this.id, model: null, durationMs: 1, stderrTail: '' },
          }
        );
      };
    }
  }

  async detect(): Promise<AgentStatus> {
    this.detectCount += 1;
    if (this.behaviour.detectThrows) throw new Error('偵測炸了');
    return {
      id: this.id,
      displayName: this.displayName,
      installed: true,
      executablePath: `/fake/${this.id}`,
      version: '1.0.0',
      loginState: 'logged-in',
      loginDetail: null,
      supportsJsonSchema: true,
      available: true,
      unavailableReason: null,
      ...this.behaviour.status,
    };
  }

  async listModels(): Promise<ModelOption[]> {
    return this.behaviour.models ?? [];
  }

  async runStructured<T>(request: AgentRequest, _schema: unknown, runId: string): Promise<AgentResult<T>> {
    this.calls.push({ runId, request });
    if (this.behaviour.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, this.behaviour.delayMs));
    }
    if (this.behaviour.onRun) await this.behaviour.onRun(runId);
    return (this.behaviour.result ?? {
      ok: true,
      data: { title: '假結果' },
      meta: { runId, agentId: this.id, model: null, durationMs: 1, stderrTail: '' },
    }) as AgentResult<T>;
  }

  async cancel(runId: string): Promise<void> {
    this.cancelled.push(runId);
  }
}
