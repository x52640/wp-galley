import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * 啟動腳本與 Galley.app（D-044 P8-T005；D-046 P8-T006 改成常開、在背景跑服務）。
 *
 * 不跑 start.command、不打開產出的 app（會真的啟動服務、撞到使用者正在跑的 3000／5173）。
 * 背景服務腳本本身用假服務實跑，見 `galley-service.test.ts`。
 * 只檢查腳本內容、`--print-script` 印出的 AppleScript，以及在 macOS 上把 app 產到暫存目錄看結構。
 * 一律用 execFileSync 帶參數陣列，不經過 shell。
 */

const repo = join(__dirname, '..');
const startCommand = join(repo, 'scripts', 'start.command');
const makeApp = join(repo, 'scripts', 'make-app.sh');
const serviceScript = join(repo, 'scripts', 'galley-service.sh');
const iconPng = join(repo, 'scripts', 'app', 'icon.png');
const isMac = process.platform === 'darwin';

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** 把 make-app 需要的檔案複製到一個路徑很刁鑽的假 repo（空白、雙引號、反斜線、$）。 */
function fakeRepo(): { root: string; repoDir: string } {
  // realpath：macOS 的 /var 是 /private/var 的捷徑，腳本寫進 app 的是真正路徑。
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'galley-launcher-')));
  tempDirs.push(root);
  const repoDir = join(root, 'My Programs', 'we "ird" \\b $HOME');
  mkdirSync(join(repoDir, 'scripts', 'app'), { recursive: true });
  cpSync(makeApp, join(repoDir, 'scripts', 'make-app.sh'));
  cpSync(startCommand, join(repoDir, 'scripts', 'start.command'));
  cpSync(serviceScript, join(repoDir, 'scripts', 'galley-service.sh'));
  cpSync(iconPng, join(repoDir, 'scripts', 'app', 'icon.png'));
  return { root, repoDir };
}

function printScript(repoDir: string): string {
  return execFileSync('bash', [join(repoDir, 'scripts', 'make-app.sh'), '--print-script'], {
    encoding: 'utf8',
  });
}

describe('start.command', () => {
  const source = readFileSync(startCommand, 'utf8');

  it('bash 語法正確（bash -n 只檢查第一個檔，所以一個一個跑）', () => {
    for (const file of [startCommand, makeApp, serviceScript]) execFileSync('bash', ['-n', file]);
  });

  it('開瀏覽器前同時等前端 5173 和後端 /api/health（只等 Vite 會 502）', () => {
    expect(source).toContain('http://127.0.0.1:5173/');
    expect(source).toContain('http://127.0.0.1:3000/api/health');
    // 後端要用 -f：4xx／5xx 不算好了
    expect(source).toMatch(/curl -sf[^\n]*"\$HEALTH_URL"/);
    // 冷啟動的 /api/health 要偵測 Agent CLI，逾時太短會一直重送
    expect(source).toMatch(/curl -sf -o \/dev\/null --max-time 10 "\$HEALTH_URL"/);
    const waitUi = source.indexOf('"$UI_URL"');
    const waitHealth = source.indexOf('"$HEALTH_URL"');
    const openBrowser = source.indexOf('open "http://127.0.0.1:5173"');
    expect(waitUi).toBeGreaterThan(-1);
    expect(waitHealth).toBeGreaterThan(-1);
    expect(openBrowser).toBeGreaterThan(Math.max(waitUi, waitHealth));
  });

  it('等待上限放寬到 2 分鐘、照經過的秒數算，逾時訊息講清楚', () => {
    expect(source).toMatch(/WAIT_SECONDS=120/);
    // 數圈數的話，埠接了連線卻不回時每圈都等滿逾時，會拖到十幾分鐘
    expect(source).toContain('deadline=$((SECONDS + WAIT_SECONDS))');
    expect(source).toMatch(/while \[ "\$SECONDS" -lt "\$deadline" \]/);
    expect(source).not.toMatch(/seq 1/);
    expect(source).toContain('服務還沒起來，請看上面的錯誤訊息');
  });
});

describe('make-app.sh --print-script', () => {
  it('repo 路徑正確跳脫（空白、雙引號、反斜線、$ 都原樣）', () => {
    const { repoDir } = fakeRepo();
    const script = printScript(repoDir);
    const escaped = repoDir.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    expect(script).toContain(`set repoPath to "${escaped}"`);
  });

  it('常開 applet：on run 起服務（或接手）、on reopen 開瀏覽器或重起、on quit 先 stop 再 continue quit', () => {
    const { repoDir } = fakeRepo();
    const script = printScript(repoDir);
    const handler = (name: string): string => {
      const start = script.indexOf(`\non ${name}`);
      const end = script.indexOf(`\nend ${name}`, start);
      expect(start).toBeGreaterThan(-1);
      expect(end).toBeGreaterThan(start);
      return script.slice(start, end);
    };
    expect(handler('serviceScript')).toContain('return repoPath & "/scripts/galley-service.sh"');
    expect(handler('uiURL')).toContain('"http://127.0.0.1:5173"');

    // 啟動：先問 status；別人開的（start.command）只開瀏覽器、不接手、自己結束；其餘交給 launchService
    const run = handler('run');
    expect(run).toContain('do shell script quoted form of svc & " status"');
    expect(run).toMatch(/if serviceState is "other" then[\s\S]*?open location uiURL\(\)[\s\S]*?quit[\s\S]*?end if/);
    expect(run.indexOf('launchService(svc, serviceState)')).toBeGreaterThan(run.indexOf('" status"'));

    // 起服務（或接手）：start 成功才開瀏覽器；起不來對話框帶錯誤訊息（含記錄檔位置），app 結束
    const launch = handler('launchService');
    const start = launch.indexOf('do shell script quoted form of svc & " start"');
    expect(start).toBeGreaterThan(-1);
    expect(launch).toContain('if serviceState is not "ours" then display notification');
    expect(launch.lastIndexOf('open location uiURL()')).toBeGreaterThan(start);
    expect(launch).toMatch(/on error errMsg[\s\S]*display dialog "發布台沒有起來：" & return & return & errMsg[\s\S]*quit/);

    // 點 Dock：先問 status；我們的服務死了（stopped）就照開啟流程重起，否則只開瀏覽器
    const reopen = handler('reopen');
    expect(reopen).toContain('do shell script quoted form of svc & " status"');
    expect(reopen).toMatch(/if serviceState is "stopped" then\s+launchService\(svc, serviceState\)\s+else\s+open location uiURL\(\)\s+end if/);

    // with timeout 對 do shell script 沒有作用，不要放（會讓人以為有逾時保護）
    expect(script).not.toContain('with timeout');

    // 結束：stop 包在 try 裡（失敗也要能結束，登出才不會卡住），之後才 continue quit
    const quit = handler('quit');
    const stop = quit.indexOf('do shell script quoted form of serviceScript() & " stop"');
    expect(stop).toBeGreaterThan(-1);
    expect(quit.indexOf('continue quit')).toBeGreaterThan(stop);
    expect(quit.indexOf('try')).toBeLessThan(stop);
    expect(quit.indexOf('end try')).toBeLessThan(quit.indexOf('continue quit'));

    // P8-T005 的開終端機與連點時間戳都不要了
    expect(script).not.toContain('start.command"');
    expect(script).not.toContain('galley-launch.stamp');
    expect(script).not.toContain('launchedRecently');
    // 不用 property（applet 執行時會寫回腳本檔、弄壞簽章）
    expect(script).not.toMatch(/^\s*property\s/m);
    // 執行時一律 quoted form，不自己拼引號
    expect(script).not.toMatch(/do shell script "[^"]*' /);
  });

  it.skipIf(!isMac)('AppleScript 讀回來的路徑跟原本一模一樣（macOS）', () => {
    const { repoDir } = fakeRepo();
    const line = printScript(repoDir)
      .split('\n')
      .find((l) => l.includes('set repoPath to'));
    expect(line).toBeDefined();
    const out = execFileSync('osascript', ['-e', line!.trim(), '-e', 'return repoPath'], {
      encoding: 'utf8',
    });
    expect(out.replace(/\n$/, '')).toBe(repoDir);
  });
});

describe('make-app.sh 產生 app（macOS，只產到暫存目錄）', () => {
  it.skipIf(!isMac)('app 結構、常開、自己的圖示、簽章完整、腳本指向 repo', () => {
    const { root, repoDir } = fakeRepo();
    const outDir = join(root, 'out dir');
    execFileSync('bash', [join(repoDir, 'scripts', 'make-app.sh'), outDir], { stdio: 'pipe' });

    const app = join(outDir, 'Galley.app');
    const resources = join(app, 'Contents', 'Resources');
    expect(existsSync(join(resources, 'applet.icns'))).toBe(true);
    // osacompile 附的 Assets.car 會蓋過自己的圖示，要拿掉
    expect(existsSync(join(resources, 'Assets.car'))).toBe(false);

    const plist = JSON.parse(
      execFileSync('plutil', ['-convert', 'json', '-o', '-', join(app, 'Contents', 'Info.plist')], {
        encoding: 'utf8',
      }),
    ) as Record<string, unknown>;
    expect(plist.CFBundleIconFile).toBe('applet');
    expect(plist.CFBundleIconName).toBeUndefined();
    expect(plist.CFBundleName).toBe('Galley');
    // osacompile -s：常開的 applet，⌘Q 之前一直在 Dock 上
    expect(plist.OSAAppletStayOpen).toBe(true);

    execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'pipe' });

    const decompiled = execFileSync('osadecompile', [join(resources, 'Scripts', 'main.scpt')], {
      encoding: 'utf8',
    });
    const escaped = repoDir.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    expect(decompiled).toContain(`set repoPath to "${escaped}"`);
    for (const name of ['run', 'reopen', 'quit']) expect(decompiled).toMatch(new RegExp(`^on ${name}\\b`, 'm'));
    expect(decompiled).toContain('continue quit');

    // 圖示確實是 scripts/app/icon.png 轉出來的：icns 裡有 1024 的 ic10
    const icns = readFileSync(join(resources, 'applet.icns'));
    expect(icns.subarray(0, 4).toString('latin1')).toBe('icns');
    expect(icns.includes(Buffer.from('ic10', 'latin1'))).toBe(true);
  });
});

describe('make-app.sh 失敗時講清楚', () => {
  it('codesign 失敗不會默默結束：留著錯誤輸出、印中文說明', () => {
    const source = readFileSync(makeApp, 'utf8');
    expect(source).not.toMatch(/codesign[^\n]*2>&1/);
    expect(source).toMatch(/codesign --force --deep --sign - "\$BUILT" >\/dev\/null \|\|\n\s*fail "codesign/);
  });
});

describe('圖示來源與 git', () => {
  it('scripts/app/icon.png 是 1024×1024 PNG', () => {
    const png = readFileSync(iconPng);
    expect(png.subarray(1, 4).toString('latin1')).toBe('PNG');
    expect(png.readUInt32BE(16)).toBe(1024);
    expect(png.readUInt32BE(20)).toBe(1024);
  });

  it('產生的 Galley.app 不進 git', () => {
    expect(readFileSync(join(repo, '.gitignore'), 'utf8')).toMatch(/^Galley\.app\/$/m);
  });
});
