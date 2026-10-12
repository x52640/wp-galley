import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * Galley.app 背後的服務腳本 `scripts/galley-service.sh`（D-046，P8-T006）。
 *
 * 一律用**假服務**（一支小 node 程式）跑在系統給的空埠上，**絕不碰 3000／5173**（使用者的發布台正在跑）。
 * 資料目錄一律指到暫存目錄（`GALLEY_DATA_DIR`），不碰 `~/Library/Application Support/Galley/`。
 * 用 spawnSync 帶參數陣列，不經過 shell；每次呼叫都有逾時——start 若把 stdout 留給背景服務，這裡就會卡到逾時而失敗。
 */

const repo = join(__dirname, '..');
const serviceScript = join(repo, 'scripts', 'galley-service.sh');
const isMac = process.platform === 'darwin';
const REAL_PORTS = new Set([3000, 5173]);

const tempDirs: string[] = [];
const strayChildren: ChildProcess[] = [];
/** setup() 一建好就登記：測試中途斷言失敗也一定清掉假服務（先 stop，再補殺 pid 檔記的還活著的）。 */
const fakeServices: Env[] = [];
/** 測試自己記下要清的 pid（例如假登入 shell 留在背景的 sleep）。 */
const extraPidFiles: string[] = [];

afterEach(() => {
  for (const t of fakeServices.splice(0)) {
    spawnSync('bash', [serviceScript, 'stop'], { env: t.env, encoding: 'utf8', timeout: 30_000 });
    killAlive(pidsIn(t.pidsFile));
  }
  for (const file of extraPidFiles.splice(0)) killAlive(pidsIn(file));
  for (const child of strayChildren.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function pidsIn(file: string): number[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => /^[1-9]\d*$/.test(line.trim()))
    .map(Number)
    .filter((pid) => pid > 1 && pid !== process.pid);
}

/** 只殺確認還活著的（已經死的不送，免得打到被重用的 pid）。 */
function killAlive(pids: number[]): void {
  for (const pid of pids) {
    if (!alive(pid)) continue;
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // 剛好結束
    }
  }
}

function tempRoot(): string {
  // realpath：macOS 的 /var 是 /private/var 的捷徑。路徑刻意含空白。
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'galley-service-')));
  tempDirs.push(root);
  mkdirSync(join(root, 'My Programs'));
  return join(root, 'My Programs');
}

/** 系統給一個空的埠（不會是 3000／5173）。 */
async function freePort(): Promise<number> {
  for (;;) {
    const port = await new Promise<number>((resolve, reject) => {
      const server = createServer();
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        const value = typeof address === 'object' && address !== null ? address.port : 0;
        server.close(() => resolve(value));
      });
    });
    if (!REAL_PORTS.has(port)) return port;
  }
}

/**
 * 假服務：
 * - ok：起一個同 process group 的子程序、一個自成 session 的子程序（detached），再在兩個埠上回 200。
 * - stubborn：同 ok，但自己和子程序都忽略 SIGTERM（逼 stop 用 SIGKILL）。
 * - never：起子程序但永遠不聽埠（逾時）。
 * - exit：印錯誤後馬上結束（服務提早結束）。
 * 每個程序把自己的 pid 附加到 FAKE_PIDS_FILE，測試據此確認全部死光。
 */
const FAKE_SERVICE = String.raw`
import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { createServer } from 'node:http';

const mode = process.env.FAKE_MODE ?? 'ok';
const pidsFile = process.env.FAKE_PIDS_FILE;
const note = (pid) => pidsFile && appendFileSync(pidsFile, pid + '\n');
note(process.pid);
console.log('fake service up pid=' + process.pid + ' cwd=' + process.cwd());

if (mode === 'exit') {
  console.error('boom: fake service failed');
  process.exit(1);
}
const childCode = (mode === 'stubborn' ? "process.on('SIGTERM', () => {});" : '') + 'setInterval(() => {}, 1000);';
const child = spawn(process.execPath, ['-e', childCode], { stdio: 'ignore' });
note(child.pid);
if (mode !== 'leader-only') {
  const loose = spawn(process.execPath, ['-e', childCode], { stdio: 'ignore', detached: true });
  note(loose.pid);
}
if (mode === 'stubborn') process.on('SIGTERM', () => console.log('ignoring SIGTERM'));
if (mode === 'never') {
  setInterval(() => {}, 1000);
} else {
  const ok = (req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
  };
  createServer(ok).listen(Number(process.env.GALLEY_UI_PORT), '127.0.0.1');
  createServer(ok).listen(Number(process.env.GALLEY_API_PORT), '127.0.0.1');
}
`;

interface Env {
  root: string;
  dataDir: string;
  pidsFile: string;
  uiPort: number;
  apiPort: number;
  env: NodeJS.ProcessEnv;
}

async function setup(mode = 'ok', extra: NodeJS.ProcessEnv = {}): Promise<Env> {
  const root = tempRoot();
  const fake = join(root, 'fake service.mjs');
  writeFileSync(fake, FAKE_SERVICE);
  const dataDir = join(root, 'data dir');
  const pidsFile = join(root, 'pids.txt');
  const uiPort = await freePort();
  let apiPort = await freePort();
  while (apiPort === uiPort) apiPort = await freePort();
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GALLEY_DATA_DIR: dataDir,
    GALLEY_SERVICE_CMD: `exec node '${fake}'`,
    GALLEY_UI_PORT: String(uiPort),
    GALLEY_API_PORT: String(apiPort),
    GALLEY_WAIT_SECONDS: '20',
    GALLEY_STOP_TIMEOUT: '3',
    FAKE_MODE: mode,
    FAKE_PIDS_FILE: pidsFile,
    ...extra,
  };
  const t = { root, dataDir, pidsFile, uiPort, apiPort, env };
  fakeServices.push(t);
  return t;
}

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

function run(env: NodeJS.ProcessEnv, ...args: string[]): Run {
  const result = spawnSync('bash', [serviceScript, ...args], { env, encoding: 'utf8', timeout: 45_000 });
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  // 殭屍不算活著
  const state = spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }).stdout.trim();
  return state !== '' && !state.startsWith('Z');
}

function recordedPids(file: string): number[] {
  return pidsIn(file);
}

/** 埠有沒有在聽（curl 連不上＝exit 7）。 */
function portOpen(port: number): boolean {
  const result = spawnSync('curl', ['-s', '-o', '/dev/null', '--max-time', '2', `http://127.0.0.1:${port}/`]);
  return result.status !== 7;
}

async function waitUntil(check: () => boolean, ms = 5000): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return check();
}

function pidFile(dataDir: string): string {
  return join(dataDir, 'galley-service.pid');
}

function lstartOf(pid: number): string {
  return spawnSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
    encoding: 'utf8',
    env: { ...process.env, LC_ALL: 'C', TZ: 'UTC0' },
  }).stdout.trim();
}

describe('galley-service.sh 基本', () => {
  it('bash 語法正確', () => {
    const result = spawnSync('bash', ['-n', serviceScript], { encoding: 'utf8' });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('有執行權限（Galley.app 直接執行它）', () => {
    expect(statSync(serviceScript).mode & 0o111).not.toBe(0);
  });

  it('不認得的指令：說明用法、非零結束', () => {
    const result = spawnSync('bash', [serviceScript, 'bogus'], { encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/start\|stop\|status/);
  });
});

describe('資料目錄跟 src/config/paths.ts 同一套規則', () => {
  function copyTo(dir: string): string {
    mkdirSync(join(dir, 'scripts'), { recursive: true });
    const copy = join(dir, 'scripts', 'galley-service.sh');
    cpSync(serviceScript, copy);
    return copy;
  }
  function logpath(script: string, env: NodeJS.ProcessEnv): Run {
    const result = spawnSync('bash', [script, 'logpath'], { env, encoding: 'utf8' });
    return { status: result.status, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
  }
  const baseEnv = (): NodeJS.ProcessEnv => {
    const env = { ...process.env };
    delete env['GALLEY_DATA_DIR'];
    return env;
  };

  it('GALLEY_DATA_DIR 優先；相對路徑直接拒絕', () => {
    const root = tempRoot();
    const script = copyTo(join(root, 'repo'));
    const dir = join(root, 'custom data');
    expect(logpath(script, { ...baseEnv(), GALLEY_DATA_DIR: dir }).stdout).toBe(join(dir, 'logs', 'galley.log'));
    const relative = logpath(script, { ...baseEnv(), GALLEY_DATA_DIR: 'relative/dir' });
    expect(relative.status).not.toBe(0);
    expect(relative.stderr).toContain('絕對路徑');
  });

  it('git worktree（.git 是檔案）用 <repo>/.galley-data', () => {
    const root = tempRoot();
    const repoDir = join(root, 'repo');
    const script = copyTo(repoDir);
    writeFileSync(join(repoDir, '.git'), 'gitdir: /somewhere\n');
    expect(logpath(script, { ...baseEnv(), HOME: join(root, 'home') }).stdout).toBe(
      join(repoDir, '.galley-data', 'logs', 'galley.log'),
    );
  });

  it.skipIf(!isMac)('主 checkout 在 macOS 用 ~/Library/Application Support/Galley（只印路徑，不建目錄）', () => {
    const root = tempRoot();
    const repoDir = join(root, 'repo');
    const script = copyTo(repoDir);
    mkdirSync(join(repoDir, '.git'));
    const home = join(root, 'home');
    const out = logpath(script, { ...baseEnv(), HOME: home });
    expect(out.stdout).toBe(join(home, 'Library', 'Application Support', 'Galley', 'logs', 'galley.log'));
    expect(existsSync(home)).toBe(false);
  });
});

describe.skipIf(!isMac)('用假服務實跑 start／status／stop（別的埠，macOS）', () => {
  it('start → status ours → stop：整個程序樹（含自成 session 的子程序）都死、兩個埠放掉、pid 檔清掉', async () => {
    const t = await setup();
    expect(run(t.env, 'status').stdout).toBe('stopped');

    const started = run(t.env, 'start');
    expect(started.stderr).toBe('');
    expect(started.status).toBe(0);
    expect(started.stdout).toBe('started');
    const pids = recordedPids(t.pidsFile);
    expect(pids.length).toBe(3);
    expect(pids.every(alive)).toBe(true);
    expect(portOpen(t.uiPort)).toBe(true);
    expect(portOpen(t.apiPort)).toBe(true);

    // pid 檔：0600，記 process group 與 leader 的啟動時間
    const file = pidFile(t.dataDir);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const content = readFileSync(file, 'utf8');
    const pgid = Number(/^pgid=(\d+)$/m.exec(content)?.[1]);
    expect(pgid).toBeGreaterThan(1);
    expect(content).toContain(`lstart=${lstartOf(pgid)}`);

    // 服務在 repo 裡跑，輸出進 log
    const log = readFileSync(join(t.dataDir, 'logs', 'galley.log'), 'utf8');
    expect(log).toContain('fake service up');
    expect(log).toContain(`cwd=${realpathSync(repo)}`);

    expect(run(t.env, 'status').stdout).toBe('ours');

    const stopped = run(t.env, 'stop');
    expect(stopped.stderr).toBe('');
    expect(stopped.status).toBe(0);
    expect(stopped.stdout).toBe('stopped');
    expect(await waitUntil(() => pids.every((pid) => !alive(pid)))).toBe(true);
    expect(portOpen(t.uiPort)).toBe(false);
    expect(portOpen(t.apiPort)).toBe(false);
    expect(existsSync(file)).toBe(false);
    expect(run(t.env, 'status').stdout).toBe('stopped');
    // 再 stop 一次：沒事
    expect(run(t.env, 'stop')).toMatchObject({ status: 0, stdout: 'not-running' });
  });

  it('已經在跑（app 當掉後重開）：start 接手、不另起、不輪替 log；之後 stop 一樣關得掉', async () => {
    const t = await setup();
    expect(run(t.env, 'start').stdout).toBe('started');
    const before = recordedPids(t.pidsFile);
    const logBefore = readFileSync(join(t.dataDir, 'logs', 'galley.log'), 'utf8');

    const again = run(t.env, 'start');
    expect(again).toMatchObject({ status: 0, stdout: 'adopted' });
    expect(recordedPids(t.pidsFile)).toEqual(before);
    expect(existsSync(join(t.dataDir, 'logs', 'galley.log.1'))).toBe(false);
    expect(readFileSync(join(t.dataDir, 'logs', 'galley.log'), 'utf8')).toBe(logBefore);

    expect(run(t.env, 'stop').stdout).toBe('stopped');
    expect(await waitUntil(() => before.every((pid) => !alive(pid)))).toBe(true);
  });

  it('不理 SIGTERM 的程序：等 GALLEY_STOP_TIMEOUT 秒後改送 SIGKILL', async () => {
    const t = await setup('stubborn', { GALLEY_STOP_TIMEOUT: '1' });
    expect(run(t.env, 'start').stdout).toBe('started');
    const pids = recordedPids(t.pidsFile);
    const stopped = run(t.env, 'stop');
    expect(stopped.status).toBe(0);
    expect(stopped.stdout).toBe('stopped');
    expect(await waitUntil(() => pids.every((pid) => !alive(pid)))).toBe(true);
    expect(existsSync(pidFile(t.dataDir))).toBe(false);
    expect(readFileSync(join(t.dataDir, 'logs', 'galley.log'), 'utf8')).toContain('ignoring SIGTERM');
  });

  it('leader 先死了、同 group 的子程序還在：仍算我們的，stop 關得掉', async () => {
    const t = await setup('leader-only');
    expect(run(t.env, 'start').stdout).toBe('started');
    const [leader, child] = recordedPids(t.pidsFile);
    process.kill(leader!, 'SIGKILL');
    expect(await waitUntil(() => !alive(leader!))).toBe(true);
    expect(alive(child!)).toBe(true);
    expect(run(t.env, 'status').stdout).toBe('ours');
    expect(run(t.env, 'stop').stdout).toBe('stopped');
    expect(await waitUntil(() => !alive(child!))).toBe(true);
    expect(existsSync(pidFile(t.dataDir))).toBe(false);
  });

  it('服務提早結束：start 失敗、訊息有記錄檔位置、pid 檔清掉', async () => {
    const t = await setup('exit');
    const result = run(t.env, 'start');
    expect(result.status).not.toBe(0);
    const logFile = join(t.dataDir, 'logs', 'galley.log');
    expect(result.stderr).toContain('提早結束');
    expect(result.stderr).toContain(logFile);
    expect(readFileSync(logFile, 'utf8')).toContain('boom: fake service failed');
    expect(existsSync(pidFile(t.dataDir))).toBe(false);
  });

  it('逾時：start 失敗、把自己起的服務關掉、訊息有記錄檔位置', async () => {
    const t = await setup('never', { GALLEY_WAIT_SECONDS: '2' });
    const result = run(t.env, 'start');
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('秒');
    expect(result.stderr).toContain(join(t.dataDir, 'logs', 'galley.log'));
    const pids = recordedPids(t.pidsFile);
    expect(pids.length).toBe(3);
    expect(await waitUntil(() => pids.every((pid) => !alive(pid)))).toBe(true);
    expect(existsSync(pidFile(t.dataDir))).toBe(false);
  });

  it('log 輪替：上一次的留成 galley.log.1（只留一份），權限 0600、logs 資料夾 0700', async () => {
    const t = await setup();
    const logs = join(t.dataDir, 'logs');
    mkdirSync(logs, { recursive: true });
    writeFileSync(join(logs, 'galley.log'), 'PREVIOUS RUN\n');
    writeFileSync(join(logs, 'galley.log.1'), 'OLDER RUN\n');
    chmodSync(join(logs, 'galley.log'), 0o644);
    chmodSync(logs, 0o755);

    expect(run(t.env, 'start').stdout).toBe('started');
    recordedPids(t.pidsFile);
    expect(readFileSync(join(logs, 'galley.log.1'), 'utf8')).toBe('PREVIOUS RUN\n');
    expect(readFileSync(join(logs, 'galley.log'), 'utf8')).toContain('fake service up');
    expect(readFileSync(join(logs, 'galley.log'), 'utf8')).not.toContain('PREVIOUS RUN');
    expect(statSync(join(logs, 'galley.log')).mode & 0o777).toBe(0o600);
    expect(statSync(join(logs, 'galley.log.1')).mode & 0o777).toBe(0o600);
    expect(statSync(logs).mode & 0o777).toBe(0o700);
    expect(run(t.env, 'stop').stdout).toBe('stopped');
  });

  it('全新的資料目錄：建成 0700（跟 paths.ts 的 ensureDataDir 一樣）', async () => {
    const t = await setup();
    expect(existsSync(t.dataDir)).toBe(false);
    expect(run(t.env, 'start').stdout).toBe('started');
    recordedPids(t.pidsFile);
    expect(statSync(t.dataDir).mode & 0o777).toBe(0o700);
    expect(run(t.env, 'stop').stdout).toBe('stopped');
  });

  it('do shell script 的陽春 PATH：從登入 shell 拿 PATH 找 node／npm', async () => {
    const t = await setup();
    const nodeDir = dirname(process.execPath);
    const fakeShell = join(t.root, 'login shell');
    // 假登入 shell：只認最後一個參數（-c 的指令），PATH 加上 node 所在資料夾
    writeFileSync(fakeShell, `#!/bin/bash\nexport PATH='${nodeDir}':"$PATH"\neval "\${@: -1}"\n`);
    chmodSync(fakeShell, 0o755);
    const env = { ...t.env, PATH: '/usr/bin:/bin:/usr/sbin:/sbin', SHELL: fakeShell };
    const started = run(env, 'start');
    expect(started.stderr).toBe('');
    expect(started.stdout).toBe('started');
    recordedPids(t.pidsFile);
    expect(run(env, 'stop').stdout).toBe('stopped');
  });

  it('登入 shell 也找不到 node／npm：start 失敗並說明，不留 pid 檔', async () => {
    const t = await setup();
    const fakeShell = join(t.root, 'bare shell');
    writeFileSync(fakeShell, `#!/bin/bash\neval "\${@: -1}"\n`);
    chmodSync(fakeShell, 0o755);
    const env = { ...t.env, PATH: '/usr/bin:/bin:/usr/sbin:/sbin', SHELL: fakeShell };
    const result = run(env, 'start');
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/node|npm/);
    expect(existsSync(pidFile(t.dataDir))).toBe(false);
  });
});

describe.skipIf(!isMac)('不誤殺：別人起的服務、過期或被重用的 pid（macOS）', () => {
  it('start.command 那種別人起的服務：status other、start 拒絕、stop 不碰它', async () => {
    const t = await setup();
    const fake = join(t.root, 'fake service.mjs');
    const other = spawn(process.execPath, [fake], { env: t.env, stdio: 'ignore' });
    strayChildren.push(other);
    expect(await waitUntil(() => portOpen(t.uiPort) && portOpen(t.apiPort))).toBe(true);
    recordedPids(t.pidsFile);

    expect(run(t.env, 'status').stdout).toBe('other');
    const start = run(t.env, 'start');
    expect(start.status).toBe(3);
    expect(start.stderr).toContain('start.command');
    expect(run(t.env, 'stop')).toMatchObject({ status: 0, stdout: 'not-running' });
    expect(alive(other.pid!)).toBe(true);
    expect(portOpen(t.uiPort)).toBe(true);
    expect(existsSync(pidFile(t.dataDir))).toBe(false);
  });

  it('pid 檔指到別的活程序（pid 被重用，啟動時間對不上）：當成過期、清掉，不殺它', async () => {
    const t = await setup('ok', { GALLEY_SERVICE_DRY_KILL: '1' });
    const sleeper = spawn('sleep', ['60'], { stdio: 'ignore', detached: true });
    strayChildren.push(sleeper);
    const pid = sleeper.pid!;
    mkdirSync(t.dataDir, { recursive: true });
    writeFileSync(pidFile(t.dataDir), `pgid=${pid}\nlstart=Thu Jan  1 00:00:00 2015\nrepo=${repo}\n`);

    expect(run(t.env, 'status').stdout).toBe('stopped');
    expect(existsSync(pidFile(t.dataDir))).toBe(false);

    writeFileSync(pidFile(t.dataDir), `pgid=${pid}\nlstart=Thu Jan  1 00:00:00 2015\nrepo=${repo}\n`);
    expect(run(t.env, 'stop')).toMatchObject({ status: 0, stdout: 'not-running' });
    expect(alive(pid)).toBe(true);
    expect(existsSync(pidFile(t.dataDir))).toBe(false);
  });

  it('pid 檔指到別的 group 的成員（pgid 不是它自己）：不算我們的', async () => {
    const t = await setup('ok', { GALLEY_SERVICE_DRY_KILL: '1' });
    // 這個 sleep 跟 vitest 同一個 group，它的 pid 不是 group id
    const sleeper = spawn('sleep', ['60'], { stdio: 'ignore' });
    strayChildren.push(sleeper);
    const pid = sleeper.pid!;
    expect(await waitUntil(() => lstartOf(pid) !== '')).toBe(true);
    mkdirSync(t.dataDir, { recursive: true });
    writeFileSync(pidFile(t.dataDir), `pgid=${pid}\nlstart=${lstartOf(pid)}\nrepo=${repo}\n`);
    expect(run(t.env, 'stop')).toMatchObject({ status: 0, stdout: 'not-running' });
    expect(alive(pid)).toBe(true);
    expect(alive(process.pid)).toBe(true);
  });

  it('pid 檔內容不合法或程序已死（0、1、負數、亂碼、空檔、死掉的 pid）：清掉，不送任何訊號', async () => {
    // 乾跑：萬一防線退化，也只會印出「要送的訊號」，不會真的 kill -- -1
    const t = await setup('ok', { GALLEY_SERVICE_DRY_KILL: '1' });
    mkdirSync(t.dataDir, { recursive: true });
    const dead = spawnSync('bash', ['-c', 'echo $$']).stdout.toString().trim();
    const launchdStart = lstartOf(1);
    for (const content of [
      'pgid=0\nlstart=x\n',
      `pgid=1\nlstart=${launchdStart}\n`,
      'pgid=-1\nlstart=x\n',
      `pgid=-${process.pid}\nlstart=x\n`,
      'pgid=abc\nlstart=x\n',
      '',
      `pgid=${dead}\nlstart=Thu Jan  1 00:00:00 2015\n`,
    ]) {
      writeFileSync(pidFile(t.dataDir), content);
      const stopped = run(t.env, 'stop');
      expect(stopped).toMatchObject({ status: 0, stdout: 'not-running' });
      expect(stopped.stderr).not.toContain('dry-kill');
      expect(existsSync(pidFile(t.dataDir))).toBe(false);
    }
    expect(alive(process.pid)).toBe(true);
  });
});

describe.skipIf(!isMac)('時區、登入 shell、送訊號的防線（macOS）', () => {
  it('在台北時區起、在倫敦時區看與關：仍認得是我們的（ps 的時間固定用 UTC）', async () => {
    const t = await setup();
    const started = run({ ...t.env, TZ: 'Asia/Taipei' }, 'start');
    expect(started.stdout).toBe('started');
    const pids = recordedPids(t.pidsFile);
    const london = { ...t.env, TZ: 'Europe/London' };
    expect(run(london, 'status').stdout).toBe('ours');
    expect(run(london, 'stop').stdout).toBe('stopped');
    expect(await waitUntil(() => pids.every((pid) => !alive(pid)))).toBe(true);
    expect(existsSync(pidFile(t.dataDir))).toBe(false);
  });

  it('服務本身拿到的是原本的 TZ／語系（只有 ps 固定 UTC、C locale）', async () => {
    const t = await setup('ok', { TZ: 'Asia/Taipei', LC_ALL: '' });
    const root = t.root;
    const probe = join(root, 'probe.sh');
    writeFileSync(probe, `#!/bin/bash\necho "TZ_SEEN=$TZ LC_ALL_SEEN=$LC_ALL"\nexec node '${join(root, 'fake service.mjs')}'\n`);
    chmodSync(probe, 0o755);
    expect(run({ ...t.env, GALLEY_SERVICE_CMD: `exec '${probe}'` }, 'start').stdout).toBe('started');
    const log = readFileSync(join(t.dataDir, 'logs', 'galley.log'), 'utf8');
    expect(log).toContain('TZ_SEEN=Asia/Taipei LC_ALL_SEEN=\n');
  });

  it('登入 shell 在背景留了程序（.zprofile 裡的 &）：start 不等它', async () => {
    const t = await setup();
    const nodeDir = dirname(process.execPath);
    const leftover = join(t.root, 'leftover.pid');
    extraPidFiles.push(leftover);
    const fakeShell = join(t.root, 'login shell');
    writeFileSync(
      fakeShell,
      `#!/bin/bash\n(sleep 30) &\necho $! > '${leftover}'\nexport PATH='${nodeDir}':"$PATH"\neval "\${@: -1}"\n`,
    );
    chmodSync(fakeShell, 0o755);
    const env = { ...t.env, PATH: '/usr/bin:/bin:/usr/sbin:/sbin', SHELL: fakeShell };
    const begin = Date.now();
    const started = run(env, 'start');
    expect(started.stderr).toBe('');
    expect(started.stdout).toBe('started');
    expect(Date.now() - begin).toBeLessThan(8000);
    expect(run(env, 'stop').stdout).toBe('stopped');
  });

  it('登入 shell 卡住：等 GALLEY_LOGIN_SHELL_TIMEOUT 秒就放棄並收掉它', async () => {
    const t = await setup('ok', { GALLEY_LOGIN_SHELL_TIMEOUT: '1' });
    const stuck = join(t.root, 'stuck.pid');
    extraPidFiles.push(stuck);
    const fakeShell = join(t.root, 'stuck shell');
    writeFileSync(fakeShell, `#!/bin/bash\necho $$ > '${stuck}'\nsleep 30\n`);
    chmodSync(fakeShell, 0o755);
    const env = { ...t.env, PATH: '/usr/bin:/bin:/usr/sbin:/sbin', SHELL: fakeShell };
    const begin = Date.now();
    const result = run(env, 'start');
    expect(Date.now() - begin).toBeLessThan(8000);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/node|npm/);
    const [shellPid] = pidsIn(stuck);
    expect(shellPid).toBeGreaterThan(1);
    expect(await waitUntil(() => !alive(shellPid!))).toBe(true);
    expect(existsSync(pidFile(t.dataDir))).toBe(false);
  });

  it('乾跑開關有效：GALLEY_SERVICE_DRY_KILL=1 只印要送的訊號、程序都還在', async () => {
    const t = await setup();
    expect(run(t.env, 'start').stdout).toBe('started');
    const pids = recordedPids(t.pidsFile);
    const dry = run({ ...t.env, GALLEY_SERVICE_DRY_KILL: '1', GALLEY_STOP_TIMEOUT: '1' }, 'stop');
    expect(dry.stderr).toContain('dry-kill TERM');
    expect(pids.every(alive)).toBe(true);
    // 真的關（afterEach 也會再保險一次）
    expect(run(t.env, 'stop').stdout).toBe('stopped');
  });

  it('送訊號的函式自己就拒絕 pgid／pid ≤ 1 與自己所在的 group（不靠讀 pid 檔那關）', () => {
    const source = readFileSync(serviceScript, 'utf8');
    const start = source.indexOf('safe_kill() {');
    const end = source.indexOf('\n}\n', start);
    expect(start).toBeGreaterThan(-1);
    const fn = source.slice(start, end + 2);
    // 除了 safe_kill 本身，腳本裡沒有別的地方直接 kill -s
    const outside = source.slice(0, start) + source.slice(end + 2);
    expect(outside).not.toMatch(/\bkill -s\b/);

    const check = (target: string): Run => {
      const script = `${fn}\nMY_PGID="$(ps -o pgid= -p $$ | tr -d ' ')"\nsafe_kill TERM ${target}\necho "rc=$?"\n`;
      const result = spawnSync('bash', ['-c', script], {
        env: { ...process.env, GALLEY_SERVICE_DRY_KILL: '1' },
        encoding: 'utf8',
      });
      return { status: result.status, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
    };
    for (const bad of ['-1', '1', '0', '-0', '--1', 'abc', '""', '-$$', '$$', '-$MY_PGID']) {
      const result = check(bad);
      expect(result.stdout, bad).not.toBe('rc=0');
      expect(result.stderr, bad).not.toContain('dry-kill');
    }
    const ok = check('-99999');
    expect(ok.stdout).toBe('rc=0');
    expect(ok.stderr).toContain('dry-kill TERM -99999');
  });
});
