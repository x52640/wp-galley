import { describe, expect, it } from 'vitest';
import { runProcess } from '../src/agents/process-runner.js';
import { tmpdir } from 'node:os';

const base = { cwd: tmpdir(), timeoutMs: 10_000, maxOutputBytes: 1024 * 1024 };

describe('基本執行', () => {
  it('回傳 stdout、stderr 與 exit code', async () => {
    const r = await runProcess({
      ...base,
      command: 'node',
      args: ['-e', 'process.stdout.write("out");process.stderr.write("err")'],
      stdin: '',
    });
    expect(r.outcome).toBe('exited');
    expect(r.stdout).toBe('out');
    expect(r.stderr).toBe('err');
    expect(r.exitCode).toBe(0);
  });

  it('prompt 透過 stdin 傳入，不出現在命令列參數', async () => {
    const secret = '這段文字絕不能出現在 argv';
    const r = await runProcess({
      ...base,
      command: 'node',
      args: ['-e', 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>process.stdout.write(d+"|argv="+process.argv.slice(2).join(",")))'],
      stdin: secret,
    });
    expect(r.stdout).toContain(secret);
    expect(r.stdout.split('|argv=')[1]).not.toContain(secret);
  });

  it('非零 exit code 會如實回報', async () => {
    const r = await runProcess({ ...base, command: 'node', args: ['-e', 'process.exit(3)'], stdin: '' });
    expect(r.outcome).toBe('exited');
    expect(r.exitCode).toBe(3);
  });

  it('執行檔不存在時回報 spawn 失敗，不丟例外', async () => {
    const r = await runProcess({
      ...base,
      command: '/nonexistent/definitely-not-here',
      args: [],
      stdin: '',
    });
    expect(r.outcome).toBe('spawn-failed');
    expect(r.error).toBeTruthy();
  });
});

describe('逾時', () => {
  it('超時就中止並回報 timeout', async () => {
    const r = await runProcess({
      ...base,
      timeoutMs: 200,
      command: 'node',
      args: ['-e', 'setTimeout(()=>{},60000)'],
      stdin: '',
    });
    expect(r.outcome).toBe('timeout');
    expect(r.durationMs).toBeLessThan(5000);
  });

  it('逾時仍保留已收到的輸出', async () => {
    const r = await runProcess({
      ...base,
      timeoutMs: 300,
      command: 'node',
      args: ['-e', 'process.stdout.write("先輸出這段");setTimeout(()=>{},60000)'],
      stdin: '',
    });
    expect(r.outcome).toBe('timeout');
    expect(r.stdout).toContain('先輸出這段');
  });
});

describe('輸出大小上限', () => {
  it('stdout 超過上限就中止', async () => {
    const r = await runProcess({
      ...base,
      maxOutputBytes: 1000,
      command: 'node',
      args: ['-e', 'for(let i=0;i<100000;i++)process.stdout.write("x".repeat(100))'],
      stdin: '',
    });
    expect(r.outcome).toBe('output-too-large');
    expect(Buffer.byteLength(r.stdout)).toBeLessThanOrEqual(2000);
  });

  it('stderr 也有上限，不會被灌爆', async () => {
    const r = await runProcess({
      ...base,
      maxOutputBytes: 1000,
      command: 'node',
      args: ['-e', 'for(let i=0;i<100000;i++)process.stderr.write("y".repeat(100))'],
      stdin: '',
    });
    expect(r.outcome).toBe('output-too-large');
  });
});

describe('取消', () => {
  it('abort signal 觸發時中止並回報 cancelled', async () => {
    const controller = new AbortController();
    const promise = runProcess({
      ...base,
      command: 'node',
      args: ['-e', 'setTimeout(()=>{},60000)'],
      stdin: '',
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 100);
    const r = await promise;
    expect(r.outcome).toBe('cancelled');
  });

  it('已經 abort 的 signal 會直接回報 cancelled，不啟動行程', async () => {
    const r = await runProcess({
      ...base,
      command: 'node',
      args: ['-e', 'process.stdout.write("不該執行")'],
      stdin: '',
      signal: AbortSignal.abort(),
    });
    expect(r.outcome).toBe('cancelled');
    expect(r.stdout).toBe('');
  });
});

describe('環境隔離', () => {
  it('cwd 設在指定目錄', async () => {
    const r = await runProcess({
      ...base,
      command: 'node',
      args: ['-e', 'process.stdout.write(process.cwd())'],
      stdin: '',
    });
    expect(r.stdout).toContain(tmpdir().replace(/\/$/, '').split('/').pop()!);
  });

  it('不繼承敏感環境變數', async () => {
    process.env['WORDPRESS_APP_PASSWORD'] = 'zzzz-should-not-leak';
    try {
      const r = await runProcess({
        ...base,
        command: 'node',
        args: ['-e', 'process.stdout.write(JSON.stringify(Object.keys(process.env)))'],
        stdin: '',
      });
      expect(r.stdout).not.toContain('WORDPRESS_APP_PASSWORD');
    } finally {
      delete process.env['WORDPRESS_APP_PASSWORD'];
    }
  });

  it('保留 PATH 與 HOME，否則官方 CLI 找不到自己的登入狀態', async () => {
    const r = await runProcess({
      ...base,
      command: 'node',
      args: ['-e', 'process.stdout.write([!!process.env.PATH,!!process.env.HOME].join(","))'],
      stdin: '',
    });
    expect(r.stdout).toBe('true,true');
  });
});
