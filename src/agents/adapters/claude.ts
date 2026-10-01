import { runProcess } from '../process-runner.js';
import { parseAndValidate } from '../output-parser.js';
import type { AgentAdapter, AgentRequest, AgentResult, AgentStatus, ModelOption } from '../types.js';
import {
  buildMeta,
  notInstalledStatus,
  probe,
  rejectToolOptions,
  RunRegistry,
  schemaForCli,
  whichExecutable,
} from './base.js';

/**
 * Claude Code 適配器。
 *
 * 探查結果（見 docs/specs/agent-cli.md，claude 2.1.247）：
 * - `-p` / `--print` 是非互動進入點
 * - `--json-schema` 吃 schema 字串或檔案路徑
 * - `--output-format json` 把結果包成 `{type:"result", result:"<JSON>"}`
 * - `claude auth status --json` 回報登入狀態
 * - `--disallowed-tools` 可以停用工具
 *
 * ⚠️ `claude auth status --json` 的輸出含 email 與 orgId。這裡只取
 * loggedIn / authMethod / subscriptionType，其餘欄位一律丟棄，
 * 不進資料庫、不進 log、不進 API 回應。
 */

const COMMAND = 'claude';
const DISPLAY_NAME = 'Claude Code';

/**
 * 校稿工作不需要任何工具（計畫 §6.2）。全部停用，Agent 只能回文字。
 * 這比依賴 permission mode 更明確：就算 mode 設錯，工具也不存在。
 */
const DISALLOWED_TOOLS = [
  'Bash',
  'Read',
  'Write',
  'Edit',
  'Glob',
  'Grep',
  'WebFetch',
  'WebSearch',
  'Task',
  // 新版的子代理工具叫 Agent；舊名 Task 留著給舊版。
  'Agent',
  'NotebookEdit',
];

/**
 * 外部工具一律不載入（P5-T036，D-034；依據見 docs/specs/agent-cli.md「Claude 不連外參數」）：
 * - `--strict-mcp-config`：只用 `--mcp-config` 給的 MCP server；我們不給，所以一個都沒有。
 *   不帶的話，使用者自己設定的 MCP server（瀏覽器控制、雲端硬碟…）會被載入。
 * - `--no-chrome`：關掉 Claude in Chrome 整合（使用者設定可能預設開著）。
 */
export const CLAUDE_NO_EXTERNAL_TOOLS_ARGS: readonly string[] = ['--strict-mcp-config', '--no-chrome'];

/** 查證「找來源」那一趟唯一打開的工具：Anthropic 伺服器上的搜尋，只回標題與網址（D-034）。 */
const HOSTED_SEARCH_TOOL = 'WebSearch';

/**
 * 工具相關參數（P6-T003；依據見 docs/specs/agent-cli.md「查證兩趟的參數」）。
 *
 * - 預設（校稿、配圖、建議網址）：P5-T036 的禁用名單，一字不改。
 * - `hostedSearch`：`--disallowed-tools` 優先於允許，所以名單**拿掉 `WebSearch`**（`WebFetch` 照舊禁用：它在使用者機器上抓網頁），
 *   再用 `--tools WebSearch` 把可用的內建工具限縮成它一個、`--allowed-tools WebSearch` 讓它不跳權限詢問。
 * - `strictNoTools`：`--tools ""`（參數陣列裡的空字串）一個內建工具都不給；禁用名單照留，多一層保險。
 *
 * `--strict-mcp-config`、`--no-chrome` 三種都帶（`CLAUDE_NO_EXTERNAL_TOOLS_ARGS`，放在這組之後）。
 */
function toolArgs(request: AgentRequest): string[] {
  if (request.hostedSearch === true) {
    return [
      '--disallowed-tools',
      ...DISALLOWED_TOOLS.filter((tool) => tool !== HOSTED_SEARCH_TOOL),
      '--tools',
      HOSTED_SEARCH_TOOL,
      '--allowed-tools',
      HOSTED_SEARCH_TOOL,
    ];
  }
  if (request.strictNoTools === true) {
    return ['--disallowed-tools', ...DISALLOWED_TOOLS, '--tools', ''];
  }
  return ['--disallowed-tools', ...DISALLOWED_TOOLS];
}

export interface ClaudeAdapterOptions {
  /** 測試用：換成假的執行檔。正式環境一律是 PATH 上的 `claude`。 */
  readonly command?: string;
}

interface AuthStatus {
  loggedIn?: boolean;
  authMethod?: string;
  subscriptionType?: string;
}

export class ClaudeAdapter implements AgentAdapter {
  readonly id = 'claude' as const;
  readonly displayName = DISPLAY_NAME;
  /** 有 `WebSearch`（D-034）。 */
  readonly supportsHostedSearch = true;
  private readonly runs = new RunRegistry();
  private readonly command: string;

  constructor(options: ClaudeAdapterOptions = {}) {
    this.command = options.command ?? COMMAND;
  }

  async detect(): Promise<AgentStatus> {
    const executablePath = await whichExecutable(this.command);
    if (!executablePath) return notInstalledStatus(this.id, DISPLAY_NAME, this.command);

    const versionProbe = await probe(this.command, ['--version']);
    const version = versionProbe.ok ? versionProbe.stdout.split('\n')[0]!.trim() : null;

    const authProbe = await probe(this.command, ['auth', 'status', '--json']);
    const auth = parseAuthStatus(authProbe.stdout);

    const loginState = auth === null ? 'unknown' : auth.loggedIn ? 'logged-in' : 'logged-out';
    const loginDetail =
      auth?.loggedIn === true
        ? [auth.authMethod, auth.subscriptionType].filter(Boolean).join(' · ') || null
        : null;

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
      unavailableReason:
        loginState === 'logged-in'
          ? null
          : loginState === 'logged-out'
            ? '尚未登入，請執行 `claude auth login`'
            : '無法確認登入狀態',
    };
  }

  async listModels(): Promise<ModelOption[]> {
    // Claude Code 沒有列出模型的指令；交給使用者在 UI 自行填寫。
    return [];
  }

  async runStructured<T>(
    request: AgentRequest,
    schema: Record<string, unknown>,
    runId: string,
  ): Promise<AgentResult<T>> {
    const rejected = rejectToolOptions(request, this, runId);
    if (rejected) return rejected;

    const controller = this.runs.register(runId);

    try {
      const args = [
        '--print',
        '--output-format',
        'json',
        '--json-schema',
        JSON.stringify(schemaForCli(schema)),
        ...toolArgs(request),
        ...CLAUDE_NO_EXTERNAL_TOOLS_ARGS,
        '--append-system-prompt',
        request.systemPrompt,
      ];
      if (request.model) args.push('--model', request.model);

      const result = await runProcess({
        command: this.command,
        args,
        // 只有不受信任的使用者原稿走 stdin；系統規則走 --append-system-prompt。
        stdin: request.userPrompt,
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

      if (result.exitCode !== 0 && result.stdout.trim().length === 0) {
        return {
          ok: false,
          reason: 'non-zero-exit',
          message: `claude 以 exit code ${result.exitCode} 結束`,
          issues: [],
          meta,
        };
      }

      const parsed = parseAndValidate(result.stdout, schema, `claude:${runId}`);
      if (!parsed.ok) {
        return { ok: false, reason: parsed.reason, message: parsed.message, issues: parsed.issues, meta };
      }
      return { ok: true, data: parsed.data as T, meta };
    } finally {
      this.runs.finish(runId);
    }
  }

  async cancel(runId: string): Promise<void> {
    this.runs.cancel(runId);
  }
}

/** 只挑出三個非識別性欄位，其餘（email、orgId）直接丟掉。 */
function parseAuthStatus(stdout: string): AuthStatus | null {
  try {
    const raw = JSON.parse(stdout) as Record<string, unknown>;
    return {
      ...(typeof raw['loggedIn'] === 'boolean' ? { loggedIn: raw['loggedIn'] } : {}),
      ...(typeof raw['authMethod'] === 'string' ? { authMethod: raw['authMethod'] } : {}),
      ...(typeof raw['subscriptionType'] === 'string' ? { subscriptionType: raw['subscriptionType'] } : {}),
    };
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
      return error ?? '無法啟動 claude';
  }
}
