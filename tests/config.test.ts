import { describe, expect, it } from 'vitest';
import { loadConfig, redactConfig, ConfigError } from '../src/config/env.js';
import { createSecretScrubber } from '../src/config/secrets.js';

const base = { APP_HOST: '127.0.0.1', APP_PORT: '3000' };

describe('loadConfig', () => {
  it('預設綁定 loopback 與 port 3000', () => {
    const cfg = loadConfig({});
    expect(cfg.appHost).toBe('127.0.0.1');
    expect(cfg.appPort).toBe(3000);
  });

  it('接受 localhost 與 ::1', () => {
    expect(loadConfig({ ...base, APP_HOST: 'localhost' }).appHost).toBe('localhost');
    expect(loadConfig({ ...base, APP_HOST: '::1' }).appHost).toBe('::1');
  });

  it.each(['0.0.0.0', '::', '192.168.1.10', 'example.com', '127.0.0.1 '])(
    '拒絕非 loopback 的 APP_HOST：%s',
    (host) => {
      expect(() => loadConfig({ ...base, APP_HOST: host })).toThrow(ConfigError);
    },
  );

  it('拒絕不合法的 port', () => {
    expect(() => loadConfig({ ...base, APP_PORT: '0' })).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, APP_PORT: '70000' })).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, APP_PORT: 'abc' })).toThrow(ConfigError);
  });

  it('WordPress 設定未填時視為未設定，不算錯誤', () => {
    const cfg = loadConfig(base);
    expect(cfg.wordpress).toBeNull();
  });

  it('WordPress 設定只填一半時報錯，不默默半啟用', () => {
    expect(() => loadConfig({ ...base, WORDPRESS_URL: 'https://example.com' })).toThrow(ConfigError);
  });

  it('WordPress URL 必須是 http(s)', () => {
    expect(() =>
      loadConfig({
        ...base,
        WORDPRESS_URL: 'ftp://example.com',
        WORDPRESS_USERNAME: 'bot',
        WORDPRESS_APP_PASSWORD: 'aaaa bbbb cccc dddd',
      }),
    ).toThrow(ConfigError);
  });

  it('完整 WordPress 設定會被解析', () => {
    const cfg = loadConfig({
      ...base,
      WORDPRESS_URL: 'https://example.com/',
      WORDPRESS_USERNAME: 'bot',
      WORDPRESS_APP_PASSWORD: 'aaaa bbbb cccc dddd',
    });
    expect(cfg.wordpress?.url).toBe('https://example.com');
    expect(cfg.wordpress?.appPassword).toBe('aaaa bbbb cccc dddd');
  });

  it('錯誤訊息不得洩漏 Application Password', () => {
    const secret = 'aaaa bbbb cccc dddd';
    try {
      loadConfig({ ...base, APP_HOST: '0.0.0.0', WORDPRESS_APP_PASSWORD: secret });
      expect.unreachable('應該要拋出 ConfigError');
    } catch (error) {
      expect(JSON.stringify(error, Object.getOwnPropertyNames(error))).not.toContain(secret);
    }
  });
});

describe('redactConfig', () => {
  it('遮蔽 Application Password，但保留是否已設定', () => {
    const cfg = loadConfig({
      ...base,
      WORDPRESS_URL: 'https://example.com',
      WORDPRESS_USERNAME: 'bot',
      WORDPRESS_APP_PASSWORD: 'aaaa bbbb cccc dddd',
    });
    const safe = redactConfig(cfg);
    expect(JSON.stringify(safe)).not.toContain('aaaa bbbb cccc dddd');
    expect(safe.wordpress).toEqual({
      url: 'https://example.com',
      username: 'bot',
      appPasswordConfigured: true,
    });
  });
});

describe('createSecretScrubber', () => {
  it('把秘密從任意字串中移除', () => {
    const scrub = createSecretScrubber(['aaaa bbbb cccc dddd']);
    expect(scrub('Authorization: Basic aaaa bbbb cccc dddd end')).toBe(
      'Authorization: Basic [REDACTED] end',
    );
  });

  it('遞迴處理巢狀物件與陣列', () => {
    const scrub = createSecretScrubber(['s3cret']);
    expect(scrub({ a: ['x s3cret'], b: { c: 's3cret' } })).toEqual({
      a: ['x [REDACTED]'],
      b: { c: '[REDACTED]' },
    });
  });

  it('忽略空字串與過短的秘密，避免把整份 log 洗掉', () => {
    const scrub = createSecretScrubber(['', 'ab']);
    expect(scrub('ab cd')).toBe('ab cd');
  });
});
