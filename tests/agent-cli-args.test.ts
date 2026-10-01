import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { ClaudeAdapter } from '../src/agents/adapters/claude.js';
import { CodexAdapter } from '../src/agents/adapters/codex.js';
import type { AgentRequest } from '../src/agents/types.js';

/**
 * P5-T036：每一趟都明確關掉搜尋與外部工具（D-034，ADR-0001）。
 *
 * **不呼叫真實 CLI**（會消耗訂閱額度）：`command` 換成假的 node 腳本，把收到的 argv 記下來，
 * 再吐一份合法的結果。這裡用字面值斷言，不引用 adapter 的常數，常數被改掉時測試才會紅。
 */

let root: string | null = null;

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = null;
});

const SCHEMA = {
  type: 'object',
  properties: { ok: { type: 'boolean' } },
  required: ['ok'],
  additionalProperties: false,
};

/** 假執行檔：argv 記到 `<root>/call.json`，然後跑 `body`（可用 `argv`、`writeFileSync`）。 */
function fakeCli(body: string): { command: string; callFile: string; request: AgentRequest } {
  root = mkdtempSync(join(tmpdir(), 'wp-publisher-cli-args-'));
  const workspace = join(root, 'workspace');
  mkdirSync(workspace, { recursive: true });
  const callFile = join(root, 'call.json');
  const command = join(root, 'fake-cli.mjs');
  writeFileSync(
    command,
    `#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
const argv = process.argv.slice(2);
let stdin = '';
process.stdin.on('data', (chunk) => { stdin += chunk; });
process.stdin.on('end', () => {
  writeFileSync(${JSON.stringify(callFile)}, JSON.stringify({ argv, stdin }));
  ${body}
});
`,
    'utf8',
  );
  chmodSync(command, 0o755);
  return {
    command,
    callFile,
    request: {
      systemPrompt: '系統規則',
      userPrompt: '使用者原稿',
      workspaceDir: workspace,
      timeoutMs: 10_000,
      maxOutputBytes: 1024 * 1024,
    },
  };
}

function readArgv(callFile: string): string[] {
  return (JSON.parse(readFileSync(callFile, 'utf8')) as { argv: string[] }).argv;
}

/** `flag value` 這一對有沒有出現在 argv 裡。 */
function hasPair(argv: readonly string[], flag: string, value: string): boolean {
  return argv.some((arg, i) => arg === flag && argv[i + 1] === value);
}

const CODEX_DISABLED_FEATURES = [
  'browser_use',
  'browser_use_external',
  'browser_use_full_cdp_access',
  'computer_use',
  'in_app_browser',
  'apps',
];

describe('Codex：每一趟都關掉網路搜尋與瀏覽器類功能', () => {
  it('校稿／建議網址（runStructured）帶 web_search="disabled" 與 features.*=false 名單', async () => {
    const { command, callFile, request } = fakeCli(`
      const out = argv[argv.indexOf('--output-last-message') + 1];
      writeFileSync(out, JSON.stringify({ ok: true }));
    `);
    const adapter = new CodexAdapter({ command });
    const result = await adapter.runStructured(request, SCHEMA, 'run-codex');
    expect(result.ok).toBe(true);

    const argv = readArgv(callFile);
    expect(hasPair(argv, '-c', 'web_search="disabled"')).toBe(true);
    for (const feature of CODEX_DISABLED_FEATURES) {
      expect(hasPair(argv, '-c', `features.${feature}=false`)).toBe(true);
    }
    // 原本的隔離仍在。
    expect(hasPair(argv, '--sandbox', 'read-only')).toBe(true);
    expect(argv).toContain('--ignore-user-config');
    expect(argv).toContain('--ephemeral');
    // 不用 --disable：遇到不認得的 feature 名稱會整趟報錯（實測 0.159.3）。
    expect(argv).not.toContain('--disable');
    // 沒有任何打開搜尋的參數。
    expect(argv).not.toContain('--search');
    expect(argv.some((arg) => /web_search="(cached|indexed|live)"/.test(arg))).toBe(false);
    // 生圖要用，不關。
    expect(argv).not.toContain('image_generation');
  });

  it('生圖（generateImage）也帶同一組', async () => {
    const { command, callFile, request } = fakeCli(`process.exit(0);`);
    const adapter = new CodexAdapter({ command, codexHome: join(root!, 'codex-home') });
    await adapter.generateImage(
      { prompt: '一張圖', workspaceDir: request.workspaceDir, timeoutMs: 10_000, maxOutputBytes: 1024 * 1024 },
      'run-image',
    );

    const argv = readArgv(callFile);
    expect(hasPair(argv, '-c', 'web_search="disabled"')).toBe(true);
    for (const feature of CODEX_DISABLED_FEATURES) {
      expect(hasPair(argv, '-c', `features.${feature}=false`)).toBe(true);
    }
    expect(hasPair(argv, '-s', 'read-only')).toBe(true);
  });
});

describe('Claude：不載入使用者的 MCP 與瀏覽器整合', () => {
  it('runStructured 帶 --strict-mcp-config、--no-chrome，不給 --mcp-config，工具全關', async () => {
    const { command, callFile, request } = fakeCli(`
      process.stdout.write(JSON.stringify({ type: 'result', result: JSON.stringify({ ok: true }) }));
    `);
    const adapter = new ClaudeAdapter({ command });
    const result = await adapter.runStructured(request, SCHEMA, 'run-claude');
    expect(result.ok).toBe(true);

    const argv = readArgv(callFile);
    expect(argv).toContain('--strict-mcp-config');
    expect(argv).toContain('--no-chrome');
    expect(argv).not.toContain('--mcp-config');
    expect(argv).not.toContain('--chrome');

    // --disallowed-tools 是可變長度參數：名單要緊接在它後面、在下一個 -- 參數之前。
    const start = argv.indexOf('--disallowed-tools');
    expect(start).toBeGreaterThanOrEqual(0);
    const end = argv.findIndex((arg, i) => i > start && arg.startsWith('--'));
    const denied = argv.slice(start + 1, end);
    for (const tool of ['Bash', 'Read', 'Write', 'Edit', 'WebFetch', 'WebSearch', 'Task', 'Agent']) {
      expect(denied).toContain(tool);
    }
    // 不允許任何工具。
    expect(argv).not.toContain('--allowed-tools');
    expect(argv).not.toContain('--allowedTools');
  });
});
