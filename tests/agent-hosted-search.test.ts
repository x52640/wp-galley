import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { ClaudeAdapter } from '../src/agents/adapters/claude.js';
import { CodexAdapter } from '../src/agents/adapters/codex.js';
import { GoogleAdapter } from '../src/agents/adapters/google.js';
import {
  correctionOf,
  FACTCHECK_FIND_SCHEMA,
  FACTCHECK_JUDGE_SCHEMA,
  type FactCheckFindOutput,
  type FactCheckJudgeOutput,
} from '../src/agents/output-contract.js';
import { AgentRegistry, AgentUnavailableError } from '../src/agents/registry.js';
import type { AgentAdapter, AgentRequest } from '../src/agents/types.js';
import { FakeAdapter } from './helpers/fake-adapter.js';

/**
 * P6-T003：查證第一趟「只開廠商端搜尋」（hostedSearch）、第二趟「最嚴格無工具」（strictNoTools）。
 *
 * **不呼叫真實 CLI**（會消耗訂閱額度）：`command` 換成假的 node 腳本，把 argv 記下來再吐結果。
 * 斷言一律用字面值，不引用 adapter 的常數——常數被改掉時測試才會紅。
 * 「沒給選項時參數完全不變」用整串 argv 逐項比對，鎖住 P5-T036 之後的樣子。
 */

let root: string | null = null;

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = null;
});

const SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  properties: { ok: { type: 'boolean' } },
  required: ['ok'],
  additionalProperties: false,
};
const SCHEMA_FOR_CLI = JSON.stringify({
  type: 'object',
  properties: { ok: { type: 'boolean' } },
  required: ['ok'],
  additionalProperties: false,
});

interface Fake {
  readonly command: string;
  readonly callFile: string;
  readonly workspace: string;
  readonly request: AgentRequest;
}

/** 假執行檔：argv 記到 `<root>/call.json`，然後跑 `body`（可用 `argv`、`readFileSync`、`writeFileSync`）。 */
function fakeCli(body: string): Fake {
  root = mkdtempSync(join(tmpdir(), 'wp-publisher-hosted-search-'));
  const workspace = join(root, 'workspace');
  mkdirSync(workspace, { recursive: true });
  const callFile = join(root, 'call.json');
  const command = join(root, 'fake-cli.mjs');
  writeFileSync(
    command,
    `#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
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
    workspace,
    request: {
      systemPrompt: '系統規則',
      userPrompt: '使用者原稿',
      workspaceDir: workspace,
      timeoutMs: 10_000,
      maxOutputBytes: 1024 * 1024,
    },
  };
}

function readCall(callFile: string): { argv: string[]; stdin: string } {
  return JSON.parse(readFileSync(callFile, 'utf8')) as { argv: string[]; stdin: string };
}

/** 可變長度參數（`--tools a b`）的值：緊接在 flag 後、到下一個 `--` 參數之前。 */
function valuesOf(argv: readonly string[], flag: string): string[] | null {
  const start = argv.indexOf(flag);
  if (start === -1) return null;
  const end = argv.findIndex((arg, i) => i > start && arg.startsWith('--'));
  return argv.slice(start + 1, end === -1 ? undefined : end);
}

function hasPair(argv: readonly string[], flag: string, value: string): boolean {
  return argv.some((arg, i) => arg === flag && argv[i + 1] === value);
}

// --- 字面值：P5-T036 之後各趟的參數 ----------------------------------------------------

const CODEX_FEATURE_ARGS = [
  '-c',
  'features.browser_use=false',
  '-c',
  'features.browser_use_external=false',
  '-c',
  'features.browser_use_full_cdp_access=false',
  '-c',
  'features.computer_use=false',
  '-c',
  'features.in_app_browser=false',
  '-c',
  'features.apps=false',
];

function codexArgv(workspace: string, runId: string, webSearch: string): string[] {
  return [
    'exec',
    '--json',
    '--output-schema',
    join(workspace, `.codex-schema-${runId}.json`),
    '--output-last-message',
    join(workspace, `.codex-output-${runId}.txt`),
    '--sandbox',
    'read-only',
    '--skip-git-repo-check',
    '--ephemeral',
    '--ignore-user-config',
    '-c',
    `web_search="${webSearch}"`,
    ...CODEX_FEATURE_ARGS,
    '--color',
    'never',
    '--cd',
    workspace,
  ];
}

const CLAUDE_DENIED = ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Task', 'Agent', 'NotebookEdit'];

function claudeArgv(middle: readonly string[]): string[] {
  return [
    '--print',
    '--output-format',
    'json',
    '--json-schema',
    SCHEMA_FOR_CLI,
    ...middle,
    '--append-system-prompt',
    '系統規則',
  ];
}

function googleArgv(workspace: string): string[] {
  return [
    '--print=',
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--json-schema',
    SCHEMA_FOR_CLI,
    '--sandbox',
    '--disable-slash-commands',
    '--add-dir',
    workspace,
  ];
}

const CODEX_WRITE_OK = `
  const out = argv[argv.indexOf('--output-last-message') + 1];
  writeFileSync(out, JSON.stringify({ ok: true }));
`;
const CLAUDE_WRITE_OK = `process.stdout.write(JSON.stringify({ type: 'result', result: JSON.stringify({ ok: true }) }));`;
const GOOGLE_WRITE_OK = `process.stdout.write(JSON.stringify({ ok: true }));`;

// --- 沒給選項：參數跟 P5-T036 之後完全一樣 ------------------------------------------------

describe('沒給 hostedSearch／strictNoTools（或給 false）時，參數跟 P5-T036 之後逐項相同', () => {
  const variants: { label: string; extra: Partial<AgentRequest> }[] = [
    { label: '沒給', extra: {} },
    { label: 'hostedSearch: false', extra: { hostedSearch: false } },
    { label: '兩個都 false', extra: { hostedSearch: false, strictNoTools: false } },
  ];

  for (const { label, extra } of variants) {
    it(`Codex（${label}）`, async () => {
      const fake = fakeCli(CODEX_WRITE_OK);
      const result = await new CodexAdapter({ command: fake.command }).runStructured({ ...fake.request, ...extra }, SCHEMA, 'r1');
      expect(result.ok).toBe(true);
      expect(readCall(fake.callFile).argv).toEqual(codexArgv(fake.workspace, 'r1', 'disabled'));
    });

    it(`Claude（${label}）`, async () => {
      const fake = fakeCli(CLAUDE_WRITE_OK);
      const result = await new ClaudeAdapter({ command: fake.command }).runStructured({ ...fake.request, ...extra }, SCHEMA, 'r1');
      expect(result.ok).toBe(true);
      expect(readCall(fake.callFile).argv).toEqual(
        claudeArgv(['--disallowed-tools', ...CLAUDE_DENIED, '--strict-mcp-config', '--no-chrome']),
      );
    });

    it(`Antigravity（${label}）`, async () => {
      const fake = fakeCli(GOOGLE_WRITE_OK);
      const result = await new GoogleAdapter({ command: fake.command }).runStructured({ ...fake.request, ...extra }, SCHEMA, 'r1');
      expect(result.ok).toBe(true);
      expect(readCall(fake.callFile).argv).toEqual(googleArgv(fake.workspace));
    });
  }
});

// --- 第一趟：只開廠商端搜尋 -------------------------------------------------------------

describe('第一趟（hostedSearch: true）', () => {
  it('Codex：web_search 換成 "cached"，其餘照 P5-T036；沒有 live／indexed', async () => {
    const fake = fakeCli(CODEX_WRITE_OK);
    const result = await new CodexAdapter({ command: fake.command }).runStructured(
      { ...fake.request, hostedSearch: true },
      SCHEMA,
      'r2',
    );
    expect(result.ok).toBe(true);

    const argv = readCall(fake.callFile).argv;
    // 整串只差 web_search 那一個值。
    expect(argv).toEqual(codexArgv(fake.workspace, 'r2', 'cached'));
    expect(hasPair(argv, '-c', 'web_search="cached"')).toBe(true);
    expect(argv).not.toContain('web_search="disabled"');
    expect(argv.filter((arg) => arg.includes('web_search'))).toEqual(['web_search="cached"']);
    expect(argv.some((arg) => /\b(live|indexed)\b/.test(arg))).toBe(false);
    expect(argv).not.toContain('--search');
    for (let i = 1; i < CODEX_FEATURE_ARGS.length; i += 2) {
      expect(hasPair(argv, '-c', CODEX_FEATURE_ARGS[i]!)).toBe(true);
    }
  });

  it('Claude：工具只有 WebSearch；WebSearch 不在禁用名單、WebFetch 仍在；MCP 與 Chrome 照關', async () => {
    const fake = fakeCli(CLAUDE_WRITE_OK);
    const result = await new ClaudeAdapter({ command: fake.command }).runStructured(
      { ...fake.request, hostedSearch: true },
      SCHEMA,
      'r2',
    );
    expect(result.ok).toBe(true);

    const argv = readCall(fake.callFile).argv;
    expect(valuesOf(argv, '--tools')).toEqual(['WebSearch']);
    expect(valuesOf(argv, '--allowed-tools')).toEqual(['WebSearch']);
    const denied = valuesOf(argv, '--disallowed-tools')!;
    expect(denied).not.toContain('WebSearch');
    expect(denied).toEqual(CLAUDE_DENIED.filter((tool) => tool !== 'WebSearch'));
    expect(denied).toContain('WebFetch');
    expect(argv).toContain('--strict-mcp-config');
    expect(argv).toContain('--no-chrome');
    expect(argv).not.toContain('--mcp-config');
    expect(argv).not.toContain('--chrome');
    expect(argv).toEqual(
      claudeArgv([
        '--disallowed-tools',
        ...CLAUDE_DENIED.filter((tool) => tool !== 'WebSearch'),
        '--tools',
        'WebSearch',
        '--allowed-tools',
        'WebSearch',
        '--strict-mcp-config',
        '--no-chrome',
      ]),
    );
  });

  it('Antigravity：直接拒絕，不默默降級、不啟動 CLI', async () => {
    const fake = fakeCli(GOOGLE_WRITE_OK);
    const result = await new GoogleAdapter({ command: fake.command }).runStructured(
      { ...fake.request, hostedSearch: true },
      SCHEMA,
      'r2',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('not-available');
      expect(result.message).toContain('不能只開搜尋');
    }
    expect(existsSync(fake.callFile)).toBe(false);
  });
});

// --- 第二趟：最嚴格無工具 ---------------------------------------------------------------

describe('第二趟（strictNoTools: true）', () => {
  it('Claude：--tools 的值是空字串、沒有 --allowed-tools、MCP 與 Chrome 照關，禁用名單照留', async () => {
    const fake = fakeCli(CLAUDE_WRITE_OK);
    const result = await new ClaudeAdapter({ command: fake.command }).runStructured(
      { ...fake.request, strictNoTools: true },
      SCHEMA,
      'r3',
    );
    expect(result.ok).toBe(true);

    const argv = readCall(fake.callFile).argv;
    expect(valuesOf(argv, '--tools')).toEqual(['']);
    expect(argv).not.toContain('--allowed-tools');
    expect(argv).not.toContain('--allowedTools');
    expect(argv).toContain('--strict-mcp-config');
    expect(argv).toContain('--no-chrome');
    expect(argv).toEqual(
      claudeArgv(['--disallowed-tools', ...CLAUDE_DENIED, '--tools', '', '--strict-mcp-config', '--no-chrome']),
    );
  });

  it('Codex：跟校稿那趟一樣（web_search="disabled"＋關掉 features）', async () => {
    const fake = fakeCli(CODEX_WRITE_OK);
    await new CodexAdapter({ command: fake.command }).runStructured({ ...fake.request, strictNoTools: true }, SCHEMA, 'r3');
    expect(readCall(fake.callFile).argv).toEqual(codexArgv(fake.workspace, 'r3', 'disabled'));
  });

  it('Antigravity：跟校稿那趟一樣', async () => {
    const fake = fakeCli(GOOGLE_WRITE_OK);
    const result = await new GoogleAdapter({ command: fake.command }).runStructured(
      { ...fake.request, strictNoTools: true },
      SCHEMA,
      'r3',
    );
    expect(result.ok).toBe(true);
    expect(readCall(fake.callFile).argv).toEqual(googleArgv(fake.workspace));
  });
});

describe('hostedSearch 與 strictNoTools 同時為 true：自相矛盾，三家都拒絕、不啟動 CLI', () => {
  const cases: { name: string; make: (command: string) => AgentAdapter; body: string }[] = [
    { name: 'Codex', make: (command) => new CodexAdapter({ command }), body: CODEX_WRITE_OK },
    { name: 'Claude', make: (command) => new ClaudeAdapter({ command }), body: CLAUDE_WRITE_OK },
    { name: 'Antigravity', make: (command) => new GoogleAdapter({ command }), body: GOOGLE_WRITE_OK },
  ];
  for (const { name, make, body } of cases) {
    it(name, async () => {
      const fake = fakeCli(body);
      const result = await make(fake.command).runStructured(
        { ...fake.request, hostedSearch: true, strictNoTools: true },
        SCHEMA,
        'r4',
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('not-available');
      expect(existsSync(fake.callFile)).toBe(false);
    });
  }
});

// --- registry -----------------------------------------------------------------------

describe('registry：能不能只開搜尋', () => {
  it('真的 adapter：Codex、Claude 可以，Antigravity 不行（只讀屬性，不跑任何指令）', () => {
    const registry = new AgentRegistry();
    expect(registry.supportsHostedSearch('codex')).toBe(true);
    expect(registry.supportsHostedSearch('claude')).toBe(true);
    expect(registry.supportsHostedSearch('google')).toBe(false);
  });

  it('不支援的那一家收到 hostedSearch：在排隊前就擋下，adapter 不會被叫', async () => {
    const google = new FakeAdapter('google', 'Antigravity');
    const registry = new AgentRegistry({ adapters: [google] });
    const fake = fakeCli('');
    await expect(
      registry.runStructured('google', { ...fake.request, hostedSearch: true }, FACTCHECK_FIND_SCHEMA, 'r5'),
    ).rejects.toBeInstanceOf(AgentUnavailableError);
    expect(google.calls).toHaveLength(0);
  });

  it('支援的那一家照常派工，請求原樣傳下去', async () => {
    const claude = new FakeAdapter('claude', 'Claude Code', { hostedSearch: true });
    const registry = new AgentRegistry({ adapters: [claude] });
    const fake = fakeCli('');
    const result = await registry.runStructured<FactCheckFindOutput>(
      'claude',
      { ...fake.request, hostedSearch: true },
      FACTCHECK_FIND_SCHEMA,
      'r6',
    );
    expect(result.ok).toBe(true);
    expect(claude.calls[0]!.request.hostedSearch).toBe(true);
    expect(claude.calls[0]!.schema).toBe(FACTCHECK_FIND_SCHEMA);
    // 假 adapter 依 schema 回對應形狀的示範輸出，給 P6-T004 用。
    if (result.ok) expect(result.data.claims.length).toBeGreaterThan(0);
  });
});

// --- 解析：走完整的 adapter 流程 ---------------------------------------------------------

const JUDGE_FROM_CODEX_STRICT = {
  findings: [
    {
      claimIndex: 0,
      verdict: 'supported',
      evidence: '維基百科寫 1994 年首映，跟文章一致。',
      correction: null,
      citations: [{ ref: 'S1', quote: '本片於1994年9月10日首映' }],
    },
    {
      claimIndex: 1,
      verdict: 'contradicted',
      evidence: '來源寫的是 142 分鐘。',
      correction: '片長應該是 142 分鐘',
      citations: [],
    },
  ],
};

const FIND_FROM_CODEX_STRICT = {
  claims: [
    {
      excerpt: '這部片 1994 年上映',
      claim: '《刺激1995》在 1994 年上映。',
      queries: [{ q: '刺激1995', lang: 'zh' }],
      candidateUrls: [],
    },
  ],
};

describe('解析：假執行檔吐出 CLI 會給的 JSON，經 adapter 的完整流程', () => {
  it('Codex 判斷趟：送出的 schema 裡 correction 可 null；回 "correction": null → stripNulls → 原 schema 合格，視為 null', async () => {
    const fake = fakeCli(`
      const schemaFile = argv[argv.indexOf('--output-schema') + 1];
      writeFileSync(process.argv[1] + '.schema.json', readFileSync(schemaFile, 'utf8'));
      const out = argv[argv.indexOf('--output-last-message') + 1];
      writeFileSync(out, ${JSON.stringify(JSON.stringify(JUDGE_FROM_CODEX_STRICT))});
    `);
    const result = await new CodexAdapter({ command: fake.command }).runStructured<FactCheckJudgeOutput>(
      { ...fake.request, strictNoTools: true },
      FACTCHECK_JUDGE_SCHEMA,
      'r7',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [first, second] = result.data.findings;
    expect(first).not.toHaveProperty('correction');
    expect(correctionOf(first!)).toBeNull();
    expect(correctionOf(second!)).toBe('片長應該是 142 分鐘');

    const sent = JSON.parse(readFileSync(`${fake.command}.schema.json`, 'utf8')) as Record<string, unknown>;
    expect(JSON.stringify(sent)).toContain('"correction":{"type":["string","null"]');
  });

  it('Codex 找來源趟：合格的輸出照收', async () => {
    const fake = fakeCli(`
      const out = argv[argv.indexOf('--output-last-message') + 1];
      writeFileSync(out, ${JSON.stringify(JSON.stringify(FIND_FROM_CODEX_STRICT))});
    `);
    const result = await new CodexAdapter({ command: fake.command }).runStructured<FactCheckFindOutput>(
      { ...fake.request, hostedSearch: true },
      FACTCHECK_FIND_SCHEMA,
      'r8',
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.claims[0]!.candidateUrls).toEqual([]);
  });

  it('Codex 判斷趟：超過上限的輸出被原 schema 擋下（strict 送出時沒有上限，後端仍驗）', async () => {
    const tooLong = { findings: [{ ...JUDGE_FROM_CODEX_STRICT.findings[0], evidence: 'a'.repeat(401) }] };
    const fake = fakeCli(`
      const out = argv[argv.indexOf('--output-last-message') + 1];
      writeFileSync(out, ${JSON.stringify(JSON.stringify(tooLong))});
    `);
    const result = await new CodexAdapter({ command: fake.command }).runStructured(
      { ...fake.request, strictNoTools: true },
      FACTCHECK_JUDGE_SCHEMA,
      'r9',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('schema-mismatch');
  });

  it('Claude 判斷趟：沒有 correction 欄位照樣合格，視為 null', async () => {
    const output = {
      findings: [{ claimIndex: 0, verdict: 'unverifiable', evidence: '給的來源裡沒提到。', citations: [] }],
    };
    const fake = fakeCli(
      `process.stdout.write(JSON.stringify({ type: 'result', result: ${JSON.stringify(JSON.stringify(output))} }));`,
    );
    const result = await new ClaudeAdapter({ command: fake.command }).runStructured<FactCheckJudgeOutput>(
      { ...fake.request, strictNoTools: true },
      FACTCHECK_JUDGE_SCHEMA,
      'r10',
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(correctionOf(result.data.findings[0]!)).toBeNull();
  });
});
