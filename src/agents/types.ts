/**
 * Agent 適配器的共用契約（計畫 §6.2）。
 *
 * 這個模組刻意不 import 任何 CLI、HTTP 或資料庫相關的東西——它只描述
 * 「發布台需要 Agent 做什麼」，各家 CLI 的差異全部關在 adapters/ 裡面。
 */

export type AgentId = 'codex' | 'claude' | 'google';

/** Agent 目前的可用狀態。刻意不含任何憑證或 token。 */
export interface AgentStatus {
  readonly id: AgentId;
  readonly displayName: string;
  /** 執行檔在不在 PATH 上。 */
  readonly installed: boolean;
  /** 執行檔路徑，未安裝時為 null。 */
  readonly executablePath: string | null;
  readonly version: string | null;
  /**
   * 登入狀態。`unknown` 代表偵測指令失敗或逾時，不代表未登入——
   * UI 要據此顯示「無法確認」而不是「未登入」。
   */
  readonly loginState: 'logged-in' | 'logged-out' | 'unknown';
  /** 補充說明，例如訂閱方案或登入方式。絕不含 email、token 或 orgId。 */
  readonly loginDetail: string | null;
  /** 這個 adapter 能不能強制結構化輸出。false 者標為 experimental。 */
  readonly supportsJsonSchema: boolean;
  /** 現在能不能派工。 */
  readonly available: boolean;
  /** available 為 false 時，給使用者看的原因。 */
  readonly unavailableReason: string | null;
}

/** 一次 Agent 執行的請求。 */
export interface AgentRequest {
  /** 系統指令：模板的 rules.md 加上發布台的固定規則。受信任內容。 */
  readonly systemPrompt: string;
  /** 使用者原稿等不受信任內容。 */
  readonly userPrompt: string;
  /** 這次執行的隔離工作區絕對路徑。Agent 的 cwd 就是這裡。 */
  readonly workspaceDir: string;
  readonly model?: string | undefined;
  /** 逾時毫秒數。 */
  readonly timeoutMs: number;
  /** stdout 上限；超過就中止並判定失敗，避免記憶體被吃光。 */
  readonly maxOutputBytes: number;
}

export interface ModelOption {
  readonly id: string;
  readonly displayName: string;
}

export type AgentFailureReason =
  | 'not-available'
  | 'timeout'
  | 'cancelled'
  | 'output-too-large'
  | 'non-zero-exit'
  | 'invalid-json'
  | 'schema-mismatch'
  | 'spawn-failed'
  /** 生圖那一趟跑完了，但找不到它生出來的圖。 */
  | 'no-image';

export interface AgentRunMeta {
  readonly runId: string;
  readonly agentId: AgentId;
  readonly model: string | null;
  readonly durationMs: number;
  /** 執行過程的摘要訊息，已過秘密遮蔽，可安全寫進 log。 */
  readonly stderrTail: string;
}

export type AgentResult<T> =
  | { readonly ok: true; readonly data: T; readonly meta: AgentRunMeta }
  | {
      readonly ok: false;
      readonly reason: AgentFailureReason;
      readonly message: string;
      /** schema 不符時的逐項說明。 */
      readonly issues: string[];
      readonly meta: AgentRunMeta;
    };

/**
 * 一次生圖的請求（D-017）。prompt 由後端的固定程式組出來，不是使用者直接打的字。
 */
export interface ImageRequest {
  readonly prompt: string;
  /** 隔離工作區。Agent 的 cwd 在這裡，而且維持唯讀——圖不是由它寫進來的。 */
  readonly workspaceDir: string;
  readonly timeoutMs: number;
  /** stdout（事件流）的上限。 */
  readonly maxOutputBytes: number;
}

/** 生出來的圖。位元組還沒驗過，呼叫端要自己過 `src/media/validate.ts`。 */
export interface GeneratedImage {
  readonly bytes: Uint8Array;
  /** 檔名主體（不含路徑），只供稽核與除錯。 */
  readonly sourceName: string;
}

/**
 * 所有 adapter 都實作這個介面。新增一家 Agent＝新增一個 adapters/*.ts，
 * 其他模組完全不用改。
 */
export interface AgentAdapter {
  readonly id: AgentId;
  readonly displayName: string;
  /** 唯讀偵測：安裝、版本、登入狀態。不得取出憑證。 */
  detect(): Promise<AgentStatus>;
  listModels(): Promise<ModelOption[]>;
  /** 執行並回傳符合 schema 的結構化結果。schema 由呼叫端提供。 */
  runStructured<T>(
    request: AgentRequest,
    schema: Record<string, unknown>,
    runId: string,
  ): Promise<AgentResult<T>>;
  /** 取消進行中的執行（校稿與生圖都用這個）。 */
  cancel(runId: string): Promise<void>;
  /**
   * 生圖。**只有做得到的 adapter 才有這個方法**（目前只有 Codex，見
   * docs/specs/agent-cli.md「Codex 生圖」）；沒有就代表這一家不能生圖。
   */
  readonly generateImage?: (request: ImageRequest, runId: string) => Promise<AgentResult<GeneratedImage>>;
}
