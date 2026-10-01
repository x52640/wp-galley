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
import { rejectToolOptions } from '../../src/agents/adapters/base.js';
import {
  FACTCHECK_FIND_SCHEMA,
  FACTCHECK_JUDGE_SCHEMA,
  type FactCheckFindOutput,
  type FactCheckJudgeOutput,
} from '../../src/agents/output-contract.js';

/** 查證第一趟的示範輸出（P6-T004 用）。excerpt 要對得上測試文章才會被留下，請自己給 `respond`。 */
export const FAKE_FACTCHECK_FIND_OUTPUT: FactCheckFindOutput = {
  claims: [
    {
      excerpt: '這部片 1995 年上映',
      claim: '《刺激1995》在 1995 年上映。',
      queries: [
        { q: '刺激1995', lang: 'zh' },
        { q: 'The Shawshank Redemption', lang: 'en' },
      ],
      candidateUrls: [{ url: 'https://www.imdb.com/title/tt0111161/', title: 'The Shawshank Redemption (1994)' }],
    },
  ],
};

/** 查證第二趟的示範輸出。沒有 `correction`（選填）——跟 Codex 回 null 經 stripNulls 之後同一個樣子。 */
export const FAKE_FACTCHECK_JUDGE_OUTPUT: FactCheckJudgeOutput = {
  findings: [
    {
      claimIndex: 0,
      verdict: 'contradicted',
      evidence: '來源寫 1994 年 9 月首映。',
      citations: [{ ref: 'S1', quote: '本片於1994年9月10日在多倫多國際電影節首映' }],
    },
  ],
};

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
  readonly calls: { runId: string; request: AgentRequest; schema: unknown }[] = [];
  readonly cancelled: string[] = [];
  readonly imageCalls: { runId: string; request: ImageRequest }[] = [];
  detectCount = 0;
  listModelsCount = 0;
  /**
   * 只有給了 `image` 的假 adapter 才會生圖——跟真實世界一樣，不是每一家都有這個方法。
   */
  readonly generateImage?: NonNullable<AgentAdapter['generateImage']>;
  /** 跟真的一樣：沒給 `hostedSearch: true` 的假 adapter 收到 `hostedSearch` 會拒絕。 */
  readonly supportsHostedSearch: boolean;

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
      /** 能不能只開搜尋（AI 查證第一趟）。預設 false。 */
      hostedSearch?: boolean;
      /**
       * 依這一趟的請求與 schema 決定結果（查證兩趟用不同 schema）。給了就優先於 `result`。
       * 只回 data 也可以，會包成成功的結果。
       */
      respond?: (call: { request: AgentRequest; schema: unknown; runId: string }) => AgentResult<unknown> | { data: unknown };
    } = {},
  ) {
    this.supportsHostedSearch = behaviour.hostedSearch === true;
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
    this.listModelsCount += 1;
    return this.behaviour.models ?? [];
  }

  async runStructured<T>(request: AgentRequest, schema: unknown, runId: string): Promise<AgentResult<T>> {
    // 做不到的工具選項：跟真的 adapter 一樣直接拒絕，不記成一次呼叫（真的也不會啟動 CLI）。
    const rejected = rejectToolOptions(request, this, runId);
    if (rejected) return rejected as AgentResult<T>;

    this.calls.push({ runId, request, schema });
    if (this.behaviour.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, this.behaviour.delayMs));
    }
    if (this.behaviour.onRun) await this.behaviour.onRun(runId);
    const meta = { runId, agentId: this.id, model: null, durationMs: 1, stderrTail: '' };
    if (this.behaviour.respond) {
      const response = this.behaviour.respond({ request, schema, runId });
      return ('ok' in response ? response : { ok: true, data: response.data, meta }) as AgentResult<T>;
    }
    if (this.behaviour.result) return this.behaviour.result as AgentResult<T>;
    const data =
      schema === FACTCHECK_FIND_SCHEMA
        ? FAKE_FACTCHECK_FIND_OUTPUT
        : schema === FACTCHECK_JUDGE_SCHEMA
          ? FAKE_FACTCHECK_JUDGE_OUTPUT
          : { title: '假結果' };
    return { ok: true, data, meta } as AgentResult<T>;
  }

  async cancel(runId: string): Promise<void> {
    this.cancelled.push(runId);
  }
}
