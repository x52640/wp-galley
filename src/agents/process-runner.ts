import { spawn } from 'node:child_process';

/**
 * 子行程執行器。所有 Agent CLI 都經過這裡，安全規則只實作一次。
 *
 * 計畫 §6.2 的硬性要求全部落在這個檔案：
 * - 一律 `spawn` + 參數陣列，**永不使用 `shell: true`**
 * - Prompt 走 stdin，不進命令列（避免 injection 與長度限制）
 * - 每次執行都有 timeout、可取消、輸出大小上限
 * - cwd 設為隔離工作區
 * - 環境變數採 allowlist，秘密不外流給 Agent
 * - stdout 與 stderr 分開收集
 *
 * 這個模組不認識 Agent、模板或 WordPress——它只知道怎麼安全地跑一個指令。
 */

export type ProcessOutcome = 'exited' | 'timeout' | 'cancelled' | 'output-too-large' | 'spawn-failed';

export interface RunProcessOptions {
  readonly command: string;
  readonly args: readonly string[];
  /** 寫進子行程 stdin 的內容。寫完立刻關閉 stdin。 */
  readonly stdin: string;
  readonly cwd: string;
  readonly timeoutMs: number;
  /** stdout 與 stderr 各自的上限。任一超過就中止。 */
  readonly maxOutputBytes: number;
  readonly signal?: AbortSignal | undefined;
  /** 額外要傳給子行程的環境變數。會與 allowlist 合併。 */
  readonly extraEnv?: Record<string, string> | undefined;
}

export interface RunProcessResult {
  readonly outcome: ProcessOutcome;
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly durationMs: number;
  /** spawn 失敗時的原因。 */
  readonly error: string | null;
}

/**
 * 傳給 Agent 的環境變數採 allowlist。
 *
 * 官方 CLI 需要 HOME 才找得到自己保存的登入狀態，需要 PATH 才找得到相依工具。
 * 除此之外一律不給——尤其是 WORDPRESS_APP_PASSWORD（計畫 §14.5）。
 */
const ENV_ALLOWLIST = [
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TERM',
  'TMPDIR',
  'XDG_CONFIG_HOME',
  'XDG_CACHE_HOME',
  'XDG_DATA_HOME',
  // macOS 的 Keychain 與使用者容器路徑，官方 CLI 讀登入狀態時會用到。
  'HOMEBREW_PREFIX',
  '__CF_USER_TEXT_ENCODING',
] as const;

function buildEnv(extra: Record<string, string> | undefined): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ENV_ALLOWLIST) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  // 讓 CLI 知道自己不在互動終端機，避免它嘗試開 TUI 或問問題。
  env['CI'] = '1';
  env['NO_COLOR'] = '1';
  env['TERM'] = 'dumb';
  return { ...env, ...extra };
}

/** 邊收邊算大小的緩衝區，超過上限就回報。 */
class BoundedBuffer {
  private readonly chunks: Buffer[] = [];
  private size = 0;

  constructor(private readonly limit: number) {}

  /** @returns 是否已超過上限 */
  push(chunk: Buffer): boolean {
    if (this.size >= this.limit) return true;
    this.chunks.push(chunk);
    this.size += chunk.length;
    return this.size > this.limit;
  }

  toString(): string {
    return Buffer.concat(this.chunks).toString('utf8');
  }
}

export function runProcess(options: RunProcessOptions): Promise<RunProcessResult> {
  const startedAt = process.hrtime.bigint();
  const elapsed = (): number => Number((process.hrtime.bigint() - startedAt) / 1_000_000n);

  return new Promise<RunProcessResult>((resolve) => {
    if (options.signal?.aborted) {
      resolve({
        outcome: 'cancelled',
        stdout: '',
        stderr: '',
        exitCode: null,
        durationMs: elapsed(),
        error: null,
      });
      return;
    }

    const stdout = new BoundedBuffer(options.maxOutputBytes);
    const stderr = new BoundedBuffer(options.maxOutputBytes);

    let child;
    try {
      child = spawn(options.command, [...options.args], {
        cwd: options.cwd,
        env: buildEnv(options.extraEnv),
        // shell: true 絕對不能出現在這裡（計畫 §14.7）。
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      resolve({
        outcome: 'spawn-failed',
        stdout: '',
        stderr: '',
        exitCode: null,
        durationMs: elapsed(),
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    let outcome: ProcessOutcome = 'exited';
    let settled = false;
    let spawnError: string | null = null;

    const finish = (exitCode: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      resolve({
        outcome,
        stdout: stdout.toString(),
        stderr: stderr.toString(),
        exitCode,
        durationMs: elapsed(),
        error: spawnError,
      });
    };

    /** SIGTERM 先禮後兵；兩秒沒退出就 SIGKILL。 */
    const kill = (reason: ProcessOutcome): void => {
      if (settled) return;
      outcome = reason;
      child.kill('SIGTERM');
      const hardKill = setTimeout(() => child.kill('SIGKILL'), 2000);
      hardKill.unref();
    };

    const timer = setTimeout(() => kill('timeout'), options.timeoutMs);
    const onAbort = (): void => kill('cancelled');
    options.signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout.on('data', (chunk: Buffer) => {
      if (stdout.push(chunk)) kill('output-too-large');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.push(chunk)) kill('output-too-large');
    });

    child.on('error', (error) => {
      outcome = 'spawn-failed';
      spawnError = error.message;
      finish(null);
    });

    child.on('close', (code) => finish(code));

    // Prompt 走 stdin。子行程可能提早關閉 stdin，忽略 EPIPE。
    child.stdin.on('error', () => undefined);
    child.stdin.end(options.stdin);
  });
}
