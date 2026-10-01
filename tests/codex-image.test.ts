import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { CODEX_NO_NETWORK_ARGS, CodexAdapter } from '../src/agents/adapters/codex.js';
import type { ImageRequest } from '../src/agents/types.js';
import { FAKE_GENERATED_PNG } from './helpers/fake-adapter.js';

/**
 * Codex 生圖（D-017）的 adapter 測試。
 *
 * **不呼叫真實的 codex**（會消耗訂閱額度）：`command` 換成一支假的 node 腳本，
 * 它照實測記錄（docs/specs/agent-cli.md「Codex 生圖」）的樣子吐 JSONL 事件，
 * 並把圖寫進假的 `$CODEX_HOME/generated_images/<thread_id>/`。
 */

let root: string | null = null;

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = null;
});

interface Setup {
  readonly adapter: CodexAdapter;
  readonly codexHome: string;
  readonly workspace: string;
  readonly request: ImageRequest;
}

/**
 * 做一支假的 codex。`body` 是腳本主體，可以用 `home`（CODEX_HOME）、`emit(obj)`、
 * `writeImage(threadId, name)`；argv 與 stdin 會記到 `$CODEX_HOME/call.json`。
 */
function setup(body: string, timeoutMs = 10_000, maxImageBytes?: number): Setup {
  root = mkdtempSync(join(tmpdir(), 'wp-publisher-codex-image-'));
  const codexHome = join(root, 'codex-home');
  const workspace = join(root, 'workspace');
  mkdirSync(codexHome, { recursive: true });
  mkdirSync(workspace, { recursive: true });

  const pngBase64 = Buffer.from(FAKE_GENERATED_PNG).toString('base64');
  const script = join(root, 'fake-codex.mjs');
  writeFileSync(
    script,
    `#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const home = process.env.CODEX_HOME;
const emit = (obj) => process.stdout.write(JSON.stringify(obj) + '\\n');
const writeImage = (threadId, name) => {
  const dir = join(home, 'generated_images', threadId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), Buffer.from('${pngBase64}', 'base64'));
};
let stdin = '';
process.stdin.on('data', (chunk) => { stdin += chunk; });
process.stdin.on('end', async () => {
  writeFileSync(join(home, 'call.json'), JSON.stringify({ argv: process.argv.slice(2), stdin, cwd: process.cwd() }));
  ${body}
});
`,
    'utf8',
  );
  chmodSync(script, 0o755);

  return {
    adapter: new CodexAdapter({
      command: script,
      codexHome,
      ...(maxImageBytes === undefined ? {} : { maxImageBytes }),
    }),
    codexHome,
    workspace,
    request: { prompt: '請生成一張雨天路口的圖', workspaceDir: workspace, timeoutMs, maxOutputBytes: 1024 * 1024 },
  };
}

describe('CodexAdapter.generateImage', () => {
  it('從第一個 thread.started 拿 thread_id，去 generated_images 拿圖', async () => {
    const { adapter, codexHome, workspace, request } = setup(`
      emit({ type: 'thread.started', thread_id: '0199aa-bb' });
      emit({ type: 'turn.started' });
      writeImage('0199aa-bb', 'exec-1.png');
      emit({ type: 'turn.completed' });
    `);

    const result = await adapter.generateImage(request, 'run-1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Buffer.from(result.data.bytes).equals(Buffer.from(FAKE_GENERATED_PNG))).toBe(true);
    expect(result.data.sourceName).toBe('exec-1.png');

    // 參數照實測那一次，加 read-only；prompt 走 stdin，不進命令列。
    const call = JSON.parse(readFileSync(join(codexHome, 'call.json'), 'utf8')) as {
      argv: string[];
      stdin: string;
    };
    expect(call.argv).toEqual([
      'exec',
      '--json',
      '--skip-git-repo-check',
      '-C',
      workspace,
      '-s',
      'read-only',
      '--ephemeral',
      '--ignore-user-config',
      ...CODEX_NO_NETWORK_ARGS,
      '--color',
      'never',
    ]);
    expect(call.stdin).toBe(request.prompt);
    expect(call.argv.join(' ')).not.toContain('雨天');
  });

  it('只拿這一趟的資料夾，不會拿到別趟的圖；同一趟有好幾張就拿最新的', async () => {
    const { adapter, request } = setup(`
      writeImage('other-thread', 'exec-old.png');
      emit({ type: 'thread.started', thread_id: 'mine' });
      writeImage('mine', 'exec-a.png');
      await new Promise((r) => setTimeout(r, 30));
      writeImage('mine', 'exec-b.png');
    `);
    const result = await adapter.generateImage(request, 'run-2');
    expect(result.ok && result.data.sourceName).toBe('exec-b.png');
  });

  it('沒有 thread.started 就回 no-image', async () => {
    const { adapter, request } = setup(`emit({ type: 'turn.completed' });`);
    const result = await adapter.generateImage(request, 'run-3');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('no-image');
    expect(result.message).toContain('thread.started');
  });

  it('跑完了但資料夾裡沒有圖：回 no-image，並帶出事件流裡的錯誤', async () => {
    const { adapter, request } = setup(`
      emit({ type: 'thread.started', thread_id: 'empty' });
      emit({ type: 'error', message: '這次不能生圖' });
    `);
    const result = await adapter.generateImage(request, 'run-4');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('no-image');
    expect(result.message).toContain('generated_images/empty');
    expect(result.message).toContain('這次不能生圖');
  });

  it('thread_id 形狀不對（想跳出資料夾）就不拿來組路徑', async () => {
    const { adapter, request } = setup(`
      writeImage('escape', 'exec-1.png');
      emit({ type: 'thread.started', thread_id: '../generated_images/escape' });
    `);
    const result = await adapter.generateImage(request, 'run-5');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('no-image');
  });

  it('符號連結不跟過去', async () => {
    const { adapter, codexHome, request } = setup(`
      emit({ type: 'thread.started', thread_id: 'linked' });
    `);
    const outside = join(codexHome, '..', 'secret.png');
    writeFileSync(outside, Buffer.from(FAKE_GENERATED_PNG));
    mkdirSync(join(codexHome, 'generated_images', 'linked'), { recursive: true });
    symlinkSync(outside, join(codexHome, 'generated_images', 'linked', 'exec-1.png'));

    const result = await adapter.generateImage(request, 'run-6');
    expect(result.ok).toBe(false);
  });

  it('generated_images/<thread> 本身是符號連結：不跟過去', async () => {
    const { adapter, codexHome, request } = setup(`emit({ type: 'thread.started', thread_id: 'dirlink' });`);
    const elsewhere = join(codexHome, '..', 'elsewhere');
    mkdirSync(elsewhere, { recursive: true });
    writeFileSync(join(elsewhere, 'exec-1.png'), Buffer.from(FAKE_GENERATED_PNG));
    mkdirSync(join(codexHome, 'generated_images'), { recursive: true });
    symlinkSync(elsewhere, join(codexHome, 'generated_images', 'dirlink'));

    const result = await adapter.generateImage(request, 'run-6b');
    expect(result.ok).toBe(false);
  });

  it('圖檔超過上限就不讀', async () => {
    const { adapter, request } = setup(
      `emit({ type: 'thread.started', thread_id: 'big' }); writeImage('big', 'exec-1.png');`,
      10_000,
      10,
    );
    const result = await adapter.generateImage(request, 'run-6c');
    expect(result.ok).toBe(false);
  });

  it('exit code 非 0 又沒有圖：回 non-zero-exit', async () => {
    const { adapter, request } = setup(`
      emit({ type: 'thread.started', thread_id: 'boom' });
      emit({ type: 'turn.failed', error: { message: '額度用完了' } });
      process.exit(2);
    `);
    const result = await adapter.generateImage(request, 'run-7');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('non-zero-exit');
    expect(result.message).toContain('額度用完了');
  });

  it('逾時就中止', async () => {
    const { adapter, request } = setup(`await new Promise((r) => setTimeout(r, 10_000));`, 400);
    const result = await adapter.generateImage(request, 'run-8');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('timeout');
  });

  it('可以取消；取消了就算圖已經生出來也不拿', async () => {
    const { adapter, request } = setup(`
      emit({ type: 'thread.started', thread_id: 'late' });
      writeImage('late', 'exec-1.png');
      await new Promise((r) => setTimeout(r, 10_000));
    `);
    const pending = adapter.generateImage(request, 'run-9');
    await new Promise((resolve) => setTimeout(resolve, 300));
    await adapter.cancel('run-9');
    const result = await pending;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('cancelled');
  });
});

describe('在文章上請 AI 配一張（P5-T018）', () => {
  it('使用者那句話與前後段落只走 stdin，不進命令列', async () => {
    const { buildPositionImagePrompt } = await import('../src/core/image-generation.js');
    const { adapter, codexHome, request } = setup(`
      emit({ type: 'thread.started', thread_id: 't1' });
      writeImage('t1', 'exec-1.png');
    `);
    const prompt = buildPositionImagePrompt({
      before: ['巷口的早餐店排了隊'],
      after: ['雨下得很急'],
      note: '水彩風 --dangerously-bypass-approvals-and-sandbox',
      aspectRatio: '16:9',
    });
    const result = await adapter.generateImage({ ...request, prompt }, 'run-pos');
    expect(result.ok).toBe(true);
    const call = JSON.parse(readFileSync(join(codexHome, 'call.json'), 'utf8')) as { argv: string[]; stdin: string };
    expect(call.stdin).toBe(prompt);
    const argv = call.argv.join(' ');
    for (const text of ['水彩風', '早餐店', '雨下得很急', 'bypass']) expect(argv).not.toContain(text);
    expect(call.argv).toContain('read-only');
    expect(call.argv).toContain('--ephemeral');
    expect(call.argv).toContain('--ignore-user-config');
  });
});
