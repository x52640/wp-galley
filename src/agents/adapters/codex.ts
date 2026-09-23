import { constants } from 'node:fs';
import { lstat, open, readdir, writeFile, readFile, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { runProcess } from '../process-runner.js';
import { parseAndValidate } from '../output-parser.js';
import type {
  AgentAdapter,
  AgentRequest,
  AgentResult,
  AgentStatus,
  GeneratedImage,
  ImageRequest,
  ModelOption,
} from '../types.js';
import { buildMeta, notInstalledStatus, probe, RunRegistry, schemaForCli, whichExecutable } from './base.js';
import { stripNulls, toOpenAiStrictSchema } from './openai-strict.js';

/**
 * Codex CLI 適配器。
 *
 * 探查結果（見 docs/specs/agent-cli.md，codex 0.147.0）：
 * - `codex exec` 是非互動進入點
 * - `--output-schema FILE` 吃 JSON Schema 檔案，強制最終回應的形狀
 * - `-o FILE` 把最終訊息寫進檔案，比解析 JSONL 事件流可靠
 * - `-s read-only` 沙箱；`--cd DIR` 指定工作根目錄
 * - `codex login status` 回報登入狀態（exit code 非 0 代表未登入）
 *
 * ⚠️ `codex exec` **不接受** `--ask-for-approval`，那是互動模式的參數；
 * exec 本身就是非互動的，不會停下來等人回答。
 */

const COMMAND = 'codex';
const DISPLAY_NAME = 'Codex';

/** 生出來的圖檔上限。實測一張 PNG 約 1.7 MB；超過這個多半不是我們要的東西。 */
const MAX_GENERATED_IMAGE_BYTES = 20 * 1024 * 1024;
const IMAGE_EXTENSIONS = /\.(png|jpe?g|webp)$/i;
/** thread_id 會被拿去組路徑，只接受這個形狀（實測是 UUID）。 */
const THREAD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/;

export interface CodexAdapterOptions {
  /** 測試用：換成假的執行檔。正式環境一律是 PATH 上的 `codex`。 */
  readonly command?: string;
  /** Codex 的資料夾，預設 `$CODEX_HOME`，再不然 `~/.codex`。生出來的圖在它底下。 */
  readonly codexHome?: string;
  /** 測試用：生出來的圖檔上限。預設 20 MB。 */
  readonly maxImageBytes?: number;
}

export class CodexAdapter implements AgentAdapter {
  readonly id = 'codex' as const;
  readonly displayName = DISPLAY_NAME;
  private readonly runs = new RunRegistry();
  private readonly command: string;
  private readonly codexHome: string;
  private readonly maxImageBytes: number;

  constructor(options: CodexAdapterOptions = {}) {
    this.command = options.command ?? COMMAND;
    this.codexHome = options.codexHome ?? process.env['CODEX_HOME'] ?? join(homedir(), '.codex');
    this.maxImageBytes = options.maxImageBytes ?? MAX_GENERATED_IMAGE_BYTES;
  }

  async detect(): Promise<AgentStatus> {
    const executablePath = await whichExecutable(this.command);
    if (!executablePath) return notInstalledStatus(this.id, DISPLAY_NAME, this.command);

    const versionProbe = await probe(this.command, ['--version']);
    const version = versionProbe.ok ? versionProbe.stdout.split('\n')[0]!.trim() : null;

    const loginProbe = await probe(this.command, ['login', 'status']);
    // 輸出形如 "Logged in using ChatGPT"。只保留登入方式，不保留任何識別資訊。
    const loginState = loginProbe.ok ? 'logged-in' : 'logged-out';
    const loginDetail = loginProbe.ok ? loginProbe.stdout.split('\n')[0]!.slice(0, 80) : null;

    return {
      id: this.id,
      displayName: DISPLAY_NAME,
      installed: true,
      executablePath,
      version,
      loginState,
      loginDetail,
      supportsJsonSchema: true,
      available: loginState === 'logged-in',
      unavailableReason: loginState === 'logged-in' ? null : '尚未登入，請執行 `codex login`',
    };
  }

  async listModels(): Promise<ModelOption[]> {
    // Codex 沒有列出模型的指令；交給使用者在 UI 自行填寫模型名稱。
    return [];
  }

  async runStructured<T>(
    request: AgentRequest,
    schema: Record<string, unknown>,
    runId: string,
  ): Promise<AgentResult<T>> {
    const controller = this.runs.register(runId);
    const schemaFile = join(request.workspaceDir, `.codex-schema-${runId}.json`);
    const outputFile = join(request.workspaceDir, `.codex-output-${runId}.txt`);

    try {
      // Codex 會把這份 schema 轉成 OpenAI 的 response_format，規則比一般
      // JSON Schema 嚴格；詳見 openai-strict.ts。
      await writeFile(schemaFile, JSON.stringify(toOpenAiStrictSchema(schemaForCli(schema))), 'utf8');

      const args = [
        'exec',
        '--json',
        '--output-schema',
        schemaFile,
        '--output-last-message',
        outputFile,
        '--sandbox',
        'read-only',
        '--skip-git-repo-check',
        // 不留 session 檔，發布台不該在使用者機器上累積對話紀錄。
        '--ephemeral',
        // 不載入 ~/.codex/config.toml：避免使用者設定的模型、指令或 MCP
        // 工具影響校稿結果。官方說明指出登入狀態仍走 CODEX_HOME，不受影響。
        '--ignore-user-config',
        '--color',
        'never',
        '--cd',
        request.workspaceDir,
      ];
      if (request.model) args.push('--model', request.model);

      const result = await runProcess({
        command: this.command,
        args,
        // Codex 從 stdin 讀 prompt，指令不帶 PROMPT 參數。
        stdin: `${request.systemPrompt}\n\n---\n\n${request.userPrompt}`,
        cwd: request.workspaceDir,
        timeoutMs: request.timeoutMs,
        maxOutputBytes: request.maxOutputBytes,
        signal: controller.signal,
      });

      const meta = buildMeta(this.id, runId, request.model ?? null, result.durationMs, result.stderr);

      if (result.outcome !== 'exited') {
        return {
          ok: false,
          reason: result.outcome === 'spawn-failed' ? 'spawn-failed' : result.outcome,
          message: describeOutcome(result.outcome, result.error),
          issues: [],
          meta,
        };
      }

      // 優先讀 --output-last-message 的檔案；它只含最終訊息，沒有事件雜訊。
      const raw = (await readFileOrNull(outputFile)) ?? result.stdout;

      if (result.exitCode !== 0 && raw.trim().length === 0) {
        return {
          ok: false,
          reason: 'non-zero-exit',
          message: `codex exec 以 exit code ${result.exitCode} 結束`,
          issues: [],
          meta,
        };
      }

      // strict mode 會把沒填的選填欄位回成 null，先拿掉再用原始 schema 驗證。
      const parsed = parseAndValidate(raw, schema, `codex:${runId}`, stripNulls);
      if (!parsed.ok) {
        return { ok: false, reason: parsed.reason, message: parsed.message, issues: parsed.issues, meta };
      }
      return { ok: true, data: parsed.data as T, meta };
    } finally {
      this.runs.finish(runId);
      await Promise.all([rm(schemaFile, { force: true }), rm(outputFile, { force: true })]);
    }
  }

  /**
   * 用訂閱生圖（D-017；實測記錄見 docs/specs/agent-cli.md「Codex 生圖」）。
   *
   * 圖**一定**落在 `$CODEX_HOME/generated_images/<thread_id>/`，thread_id 來自事件流的
   * 第一個 `thread.started`。所以這裡不叫 Codex 把圖複製到工作目錄——那需要
   * `workspace-write`——而是等它結束後自己去那個資料夾拿，Agent 維持 `read-only`。
   *
   * 參數照實測那一次，再加上跟校稿（runStructured）一樣的隔離：`-s read-only`、
   * `--ephemeral`（不留 session）、`--ignore-user-config`（不載入使用者的 config.toml：
   * MCP、網路搜尋、自訂指令）。stdin 裡有 Agent 寫的 brief 文字，是不受信任內容，
   * 不能讓它拿到比校稿更多的能力（D-009）。
   *
   * ⚠️ 這兩個參數**沒有在真實生圖上驗證過**（實測那一次沒帶）。如果它們讓圖不見了，
   * 會回 `no-image`，訊息講明去哪裡找過——使用者第一次真實生圖就是驗證。
   */
  async generateImage(request: ImageRequest, runId: string): Promise<AgentResult<GeneratedImage>> {
    const controller = this.runs.register(runId);
    try {
      const result = await runProcess({
        command: this.command,
        args: [
          'exec',
          '--json',
          '--skip-git-repo-check',
          '-C',
          request.workspaceDir,
          '-s',
          'read-only',
          '--ephemeral',
          '--ignore-user-config',
          '--color',
          'never',
        ],
        // prompt 走 stdin（security.md 硬性禁令），不放進命令列。
        stdin: request.prompt,
        cwd: request.workspaceDir,
        timeoutMs: request.timeoutMs,
        maxOutputBytes: request.maxOutputBytes,
        signal: controller.signal,
        // 子行程與我們讀圖的位置必須是同一個 CODEX_HOME；process-runner 的 allowlist 不含它。
        extraEnv: { CODEX_HOME: this.codexHome },
      });

      const meta = buildMeta(this.id, runId, null, result.durationMs, result.stderr);

      if (result.outcome !== 'exited') {
        return {
          ok: false,
          reason: result.outcome === 'spawn-failed' ? 'spawn-failed' : result.outcome,
          message: describeOutcome(result.outcome, result.error),
          issues: [],
          meta,
        };
      }

      const events = parseJsonLines(result.stdout);
      const threadId = firstThreadId(events);
      if (threadId === null) {
        return {
          ok: false,
          reason: result.exitCode === 0 ? 'no-image' : 'non-zero-exit',
          message:
            result.exitCode === 0
              ? 'Codex 沒有回報這一趟的編號（thread.started），找不到它生的圖'
              : `codex exec 以 exit code ${result.exitCode} 結束${lastErrorOf(events)}`,
          issues: [],
          meta,
        };
      }

      const image = await this.findGeneratedImage(threadId);
      if (image === null) {
        return {
          ok: false,
          reason: result.exitCode === 0 ? 'no-image' : 'non-zero-exit',
          message:
            (result.exitCode === 0
              ? `Codex 跑完了，但在 generated_images/${threadId} 找不到圖`
              : `codex exec 以 exit code ${result.exitCode} 結束，generated_images/${threadId} 裡沒有圖`) +
            `${lastErrorOf(events)}。如果每次都這樣，可能是這個 Codex 版本不帶設定檔就不生圖或圖存到別處，` +
            '見 docs/specs/agent-cli.md「Codex 生圖」',
          issues: [],
          meta,
        };
      }
      return { ok: true, data: image, meta };
    } finally {
      this.runs.finish(runId);
    }
  }

  /**
   * 這一趟生的圖。資料夾裡有好幾張就拿最新的。
   *
   * 資料夾本身、檔案都不跟符號連結（資料夾用 lstat，檔案用 O_NOFOLLOW 開）；大小以
   * **開起來那個檔**的 fstat 為準，讀的時候也只讀那麼多，檢查完才被換掉也讀不爆。
   */
  private async findGeneratedImage(threadId: string): Promise<GeneratedImage | null> {
    const dir = join(this.codexHome, 'generated_images', threadId);
    const dirInfo = await lstat(dir).catch(() => null);
    if (!dirInfo || !dirInfo.isDirectory()) return null;

    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      return null;
    }

    const candidates: { name: string; mtimeMs: number }[] = [];
    for (const name of names) {
      if (!IMAGE_EXTENSIONS.test(name)) continue;
      const info = await lstat(join(dir, name)).catch(() => null);
      if (!info || !info.isFile()) continue;
      candidates.push({ name, mtimeMs: info.mtimeMs });
    }
    candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);

    for (const { name } of candidates) {
      const bytes = await this.readCapped(join(dir, name));
      if (bytes !== null) return { bytes, sourceName: name };
    }
    return null;
  }

  private async readCapped(path: string): Promise<Uint8Array | null> {
    let handle;
    try {
      handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch {
      return null;
    }
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size === 0 || info.size > this.maxImageBytes) return null;
      const buffer = Buffer.alloc(info.size);
      const { bytesRead } = await handle.read(buffer, 0, info.size, 0);
      return new Uint8Array(buffer.subarray(0, bytesRead));
    } finally {
      await handle.close();
    }
  }

  async cancel(runId: string): Promise<void> {
    this.runs.cancel(runId);
  }
}

/** JSONL 事件流。壞掉的行直接略過——我們只找得到認得的事件就好。 */
function parseJsonLines(stdout: string): Record<string, unknown>[] {
  const events: Record<string, unknown>[] = [];
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const value: unknown = JSON.parse(trimmed);
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        events.push(value as Record<string, unknown>);
      }
    } catch {
      /* 不是 JSON 的行（例如雜訊）略過。 */
    }
  }
  return events;
}

/** 第一個 `thread.started` 的 thread_id；形狀不對就當作沒有，避免被拿去組出別的路徑。 */
function firstThreadId(events: readonly Record<string, unknown>[]): string | null {
  const started = events.find((event) => event['type'] === 'thread.started');
  const id = started?.['thread_id'];
  return typeof id === 'string' && THREAD_ID_PATTERN.test(id) ? id : null;
}

/** 事件流裡最後一則錯誤，給使用者看「為什麼沒圖」。沒有就回空字串。 */
function lastErrorOf(events: readonly Record<string, unknown>[]): string {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i]!;
    if (event['type'] !== 'error' && event['type'] !== 'turn.failed') continue;
    const direct = event['message'];
    const nested = (event['error'] as Record<string, unknown> | undefined)?.['message'];
    const message = typeof direct === 'string' ? direct : typeof nested === 'string' ? nested : null;
    if (message) return `：${message.slice(0, 300)}`;
  }
  return '';
}

async function readFileOrNull(path: string): Promise<string | null> {
  try {
    const content = await readFile(path, 'utf8');
    return content.trim().length > 0 ? content : null;
  } catch {
    return null;
  }
}

function describeOutcome(outcome: string, error: string | null): string {
  switch (outcome) {
    case 'timeout':
      return '執行逾時，已中止';
    case 'cancelled':
      return '執行已取消';
    case 'output-too-large':
      return '輸出超過上限，已中止';
    default:
      return error ?? '無法啟動 codex';
  }
}
