import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, chmodSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'dotenv';
import { afterEach, describe, expect, it } from 'vitest';
import { EnvFileError, formatEnvValue, mergeEnvContent, mergeEnvFile } from '../src/config/env-file.js';
import { createMutableScrubber, REDACTED } from '../src/config/secrets.js';

/**
 * 設定精靈改寫 .env（P8-T002，docs/specs/security.md「設定精靈寫入的秘密」）。
 * 一律寫暫存資料夾，絕不碰專案真的 .env。
 */

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'wp-publisher-env-'));
  dirs.push(dir);
  return dir;
}

const UPDATES = {
  WORDPRESS_URL: 'https://example.com',
  WORDPRESS_USERNAME: 'ming@example.com',
  WORDPRESS_APP_PASSWORD: 'abcdEFGH1234ijklMNOP5678',
};

describe('mergeEnvContent', () => {
  it('只換那三行，其他行（註解、APP_PORT、使用者自己加的）原樣保留', () => {
    const before = [
      '# 我的設定',
      'APP_PORT=3100',
      'WORDPRESS_URL=https://old.example.com',
      'WORDPRESS_USERNAME=old',
      'WORDPRESS_APP_PASSWORD=oldoldoldoldoldoldoldold',
      'MY_THING=keep me',
      '',
    ].join('\n');
    const after = mergeEnvContent(before, UPDATES);
    expect(after).toBe(
      [
        '# 我的設定',
        'APP_PORT=3100',
        'WORDPRESS_URL=https://example.com',
        'WORDPRESS_USERNAME=ming@example.com',
        'WORDPRESS_APP_PASSWORD=abcdEFGH1234ijklMNOP5678',
        'MY_THING=keep me',
        '',
      ].join('\n'),
    );
    expect(parse(after)).toMatchObject({ ...UPDATES, APP_PORT: '3100', MY_THING: 'keep me' });
  });

  it('沒有的鍵加在最後；重複的鍵留第一行、刪掉其餘', () => {
    const after = mergeEnvContent('WORDPRESS_URL=a\nX=1\nWORDPRESS_URL=b\nexport WORDPRESS_URL=c', UPDATES);
    expect(after.match(/WORDPRESS_URL=/g)).toHaveLength(1);
    expect(parse(after)).toMatchObject({ ...UPDATES, X: '1' });
  });

  it('有特殊字元的帳號用單引號包，dotenv 讀回來一模一樣', () => {
    const after = mergeEnvContent('', { WORDPRESS_USERNAME: '王 小明 #1' });
    expect(parse(after).WORDPRESS_USERNAME).toBe('王 小明 #1');
  });

  it('單引號與換行直接拒絕，不做跳脫', () => {
    expect(() => formatEnvValue('WORDPRESS_USERNAME', "o'neil")).toThrow(EnvFileError);
    expect(() => formatEnvValue('WORDPRESS_USERNAME', 'a\nb')).toThrow(EnvFileError);
  });
});

describe('mergeEnvFile', () => {
  it('檔案不存在：以 .env.example 為底，權限 0600', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, '.env.example'), 'APP_HOST=127.0.0.1\nWORDPRESS_URL=\nWORDPRESS_USERNAME=\nWORDPRESS_APP_PASSWORD=\n');
    await mergeEnvFile(join(dir, '.env'), UPDATES, { exampleFile: join(dir, '.env.example') });
    const text = readFileSync(join(dir, '.env'), 'utf8');
    expect(parse(text)).toMatchObject({ ...UPDATES, APP_HOST: '127.0.0.1' });
    expect(statSync(join(dir, '.env')).mode & 0o777).toBe(0o600);
    // 範例檔沒被動到。
    expect(readFileSync(join(dir, '.env.example'), 'utf8')).toContain('WORDPRESS_URL=\n');
  });

  it('原本 0644 的 .env 也收緊成 0600，沒留下暫存檔', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, '.env'), 'APP_PORT=3000\n');
    chmodSync(join(dir, '.env'), 0o644);
    await mergeEnvFile(join(dir, '.env'), UPDATES);
    expect(statSync(join(dir, '.env')).mode & 0o777).toBe(0o600);
    expect(readdirSync(dir)).toEqual(['.env']);
    expect(parse(readFileSync(join(dir, '.env'), 'utf8'))).toMatchObject({ APP_PORT: '3000', ...UPDATES });
  });

  it('值不合法時檔案完全不動', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, '.env'), 'APP_PORT=3000\n');
    await expect(mergeEnvFile(join(dir, '.env'), { WORDPRESS_USERNAME: "o'neil" })).rejects.toThrow(EnvFileError);
    expect(readFileSync(join(dir, '.env'), 'utf8')).toBe('APP_PORT=3000\n');
  });
});

describe('可更新的遮蔽器', () => {
  it('同一個函式，加了新秘密之後立刻抹得掉；舊的也還在', () => {
    const secrets = createMutableScrubber(['oldsecret123']);
    const { scrub } = secrets;
    expect(scrub('x newsecret456 y')).toBe('x newsecret456 y');
    secrets.add(['newsecret456']);
    expect(scrub('x newsecret456 y oldsecret123')).toBe(`x ${REDACTED} y ${REDACTED}`);
  });
});
