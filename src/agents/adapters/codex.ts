import { writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { runProcess } from '../process-runner.js';
import { parseAndValidate } from '../output-parser.js';
import type { AgentAdapter, AgentRequest, AgentResult, AgentStatus, ModelOption } from '../types.js';
import { buildMeta, notInstalledStatus, probe, RunRegistry, schemaForCli, whichExecutable } from './base.js';
import { stripNulls, toOpenAiStrictSchema } from './openai-strict.js';

/**
 * Codex CLI 適配器。
 *
 * 探查結果（見 docs/AGENT-CLI-PROBE.md，codex 0.147.0）：
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

export class CodexAdapter implements AgentAdapter {
  readonly id = 'codex' as const;
  readonly displayName = DISPLAY_NAME;
  private readonly runs = new RunRegistry();

  async detect(): Promise<AgentStatus> {
    const executablePath = await whichExecutable(COMMAND);
    if (!executablePath) return notInstalledStatus(this.id, DISPLAY_NAME, COMMAND);

    const versionProbe = await probe(COMMAND, ['--version']);
    const version = versionProbe.ok ? versionProbe.stdout.split('\n')[0]!.trim() : null;

    const loginProbe = await probe(COMMAND, ['login', 'status']);
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
        command: COMMAND,
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

  async cancel(runId: string): Promise<void> {
    this.runs.cancel(runId);
  }
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
