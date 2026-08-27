import type {
  AgentAdapter,
  AgentId,
  AgentRequest,
  AgentResult,
  AgentStatus,
  ModelOption,
} from '../../src/agents/types.js';

/**
 * 測試用的假 adapter。
 *
 * 計畫階段 3 要求「使用 fixture 建立不需消耗訂閱額度的 adapter 測試」——
 * 所有 registry 與流程測試都跑這個，不碰真實 CLI。
 */
export class FakeAdapter implements AgentAdapter {
  readonly calls: { runId: string; request: AgentRequest }[] = [];
  readonly cancelled: string[] = [];
  detectCount = 0;

  constructor(
    readonly id: AgentId,
    readonly displayName: string,
    private readonly behaviour: {
      status?: Partial<AgentStatus>;
      detectThrows?: boolean;
      result?: AgentResult<unknown>;
      delayMs?: number;
      models?: ModelOption[];
    } = {},
  ) {}

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
