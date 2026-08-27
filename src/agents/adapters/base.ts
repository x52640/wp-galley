import { delimiter, join } from 'node:path';
import { access, constants } from 'node:fs/promises';
import { runProcess } from '../process-runner.js';
import type { AgentAdapter, AgentId, AgentRunMeta, AgentStatus } from '../types.js';

/**
 * adapter 共用的小工具。
 *
 * 刻意保持很薄：各家 CLI 的差異應該留在自己的 adapter 檔案裡，
 * 不要為了「共用」把 if (id === 'codex') 這種東西塞進這裡。
 */

/**
 * 找出執行檔的絕對路徑。找不到回 null。
 *
 * 自己走一遍 PATH 而不是呼叫 `which`：少開一個子行程，也不必假設
 * `/usr/bin/which` 存在。
 */
export async function whichExecutable(command: string): Promise<string | null> {
  // 帶路徑分隔符的直接檢查，不去翻 PATH。
  if (command.includes('/')) {
    return (await isExecutable(command)) ? command : null;
  }

  for (const dir of (process.env['PATH'] ?? '').split(delimiter)) {
    if (dir.length === 0) continue;
    const candidate = join(dir, command);
    if (await isExecutable(candidate)) return candidate;
  }
  return null;
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export interface ProbeResult {
  readonly ok: boolean;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * 執行唯讀的探查指令（`--version`、登入狀態等）。
 *
 * 走與正式執行相同的 runProcess，好處是安全規則只有一套：不用 shell、
 * 環境變數 allowlist、輸出上限、逾時，而且**會關閉 stdin**。
 */
export async function probe(
  command: string,
  args: string[],
  timeoutMs = 15_000,
): Promise<ProbeResult> {
  const result = await runProcess({
    command,
    args,
    // 空字串代表「立刻關閉 stdin」。這一步是必要的：CLI 若在等 stdin EOF
    // （`agy models` 就是），不關就會一路等到逾時。
    stdin: '',
    cwd: process.cwd(),
    timeoutMs,
    maxOutputBytes: 512 * 1024,
  });

  return {
    ok: result.outcome === 'exited' && result.exitCode === 0,
    stdout: result.stdout.trim(),
    stderr: (result.stderr || result.error || '').trim(),
  };
}

/** 未安裝時的標準狀態，讓 UI 可以優雅降級。 */
export function notInstalledStatus(id: AgentId, displayName: string, command: string): AgentStatus {
  return {
    id,
    displayName,
    installed: false,
    executablePath: null,
    version: null,
    loginState: 'unknown',
    loginDetail: null,
    supportsJsonSchema: false,
    available: false,
    unavailableReason: `找不到 ${command}，請先安裝官方 CLI 並確認它在 PATH 上`,
  };
}

/**
 * 把 schema 調整成各 CLI 的驗證器吃得下的形狀。
 *
 * 我們的 schema.json 宣告 draft 2020-12，但 Claude Code 的 `--json-schema`
 * 內建的是 draft-07 驗證器，看到那個 `$schema` 會直接報錯：
 *   `no schema with key or ref "https://json-schema.org/draft/2020-12/schema"`
 *
 * 我們用到的語法（type / properties / required / enum / items /
 * additionalProperties / maxLength…）兩版共通，所以拿掉 `$schema` 讓各 CLI
 * 用自己的預設 draft 即可。**後端自己的驗證仍然走 2020-12，不受影響。**
 */
export function schemaForCli(schema: Record<string, unknown>): Record<string, unknown> {
  const { $schema: _ignored, ...rest } = schema;
  return rest;
}

/** stderr 只保留尾端若干字元，避免把整份 log 塞進資料庫。 */
export function tailOf(text: string, maxChars = 2000): string {
  const trimmed = text.trim();
  return trimmed.length <= maxChars ? trimmed : `…${trimmed.slice(-maxChars)}`;
}

export function buildMeta(
  agentId: AgentId,
  runId: string,
  model: string | null,
  durationMs: number,
  stderr: string,
): AgentRunMeta {
  return { runId, agentId, model, durationMs, stderrTail: tailOf(stderr) };
}

/** 進行中的執行，供 cancel() 使用。 */
export class RunRegistry {
  private readonly running = new Map<string, AbortController>();

  register(runId: string): AbortController {
    const controller = new AbortController();
    this.running.set(runId, controller);
    return controller;
  }

  finish(runId: string): void {
    this.running.delete(runId);
  }

  cancel(runId: string): void {
    this.running.get(runId)?.abort();
  }
}

export type { AgentAdapter };
