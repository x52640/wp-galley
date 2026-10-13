import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createServer } from 'vite';
import { describe, expect, it } from 'vitest';

import config, { isViteClient, keepPageOnReconnect, patchViteClient, VITE_RECONNECT_KEEP, VITE_RECONNECT_RELOAD } from '../vite.config.js';

/**
 * D-047（P5-T048）：Vite 斷線重連不准自己重新整理頁面。
 * 裝好的 Vite 用戶端一定要找得到那一段字（升級 Vite 時這裡先紅，不是休眠醒來才發現又會重新整理）。
 */

const require = createRequire(import.meta.url);
const viteClient = readFileSync(join(dirname(require.resolve('vite/package.json')), 'dist/client/client.mjs'), 'utf8');

describe('Vite 用戶端：連回來不重新整理', () => {
  it('裝好的 Vite 用戶端有「連回來就重新整理」那一段，而且只有一處', () => {
    expect(viteClient.split(VITE_RECONNECT_RELOAD)).toHaveLength(2);
    // 那一段就在斷線事件裡（不是 full-reload 之類別的重新整理）。
    const at = viteClient.indexOf(VITE_RECONNECT_RELOAD);
    expect(viteClient.lastIndexOf('payload.event === "vite:ws:disconnect"', at)).toBeGreaterThan(at - 400);
  });

  it('換掉之後：斷線那一段不再 location.reload，改成重新接上 HMR；其他重新整理（full-reload）不動', () => {
    const patched = patchViteClient(viteClient);
    expect(patched).not.toBeNull();
    expect(patched).toContain(VITE_RECONNECT_KEEP);
    expect(patched).not.toContain(VITE_RECONNECT_RELOAD);
    const start = patched!.indexOf('payload.event === "vite:ws:disconnect"');
    expect(start).toBeGreaterThan(0);
    const block = patched!.slice(start, patched!.indexOf('break;', start));
    expect(block).not.toContain('location.reload');
    expect(block).toContain('transport.connect(');
    expect(block).toContain('createHMRHandler(handleMessage)');
    // 只拿掉一個 location.reload。
    const count = (code: string): number => code.split('location.reload()').length - 1;
    expect(count(patched!)).toBe(count(viteClient) - 1);
  });

  it('重新接上用到的名稱在用戶端裡都有（transport、createHMRHandler、handleMessage）', () => {
    expect(viteClient).toMatch(/const transport = /);
    expect(viteClient).toMatch(/function createHMRHandler\(/);
    expect(viteClient).toMatch(/async function handleMessage\(/);
  });

  it('找不到那一段字：回 null（外掛會在終端機警告，不默默失效）', () => {
    expect(patchViteClient('location.reload();')).toBeNull();
    expect(patchViteClient(`${VITE_RECONNECT_RELOAD}\n${VITE_RECONNECT_RELOAD}`)).toBeNull();
  });

  it('只改 Vite 自己的用戶端', () => {
    expect(isViteClient('/x/node_modules/vite/dist/client/client.mjs')).toBe(true);
    expect(isViteClient('/x/node_modules/vite/dist/client/client.mjs?v=1')).toBe(true);
    expect(isViteClient('C:\\x\\node_modules\\vite\\dist\\client\\client.mjs')).toBe(true);
    expect(isViteClient('/x/src/ui/main.tsx')).toBe(false);
    expect(isViteClient('/x/node_modules/vite/dist/client/env.mjs')).toBe(false);
  });

  it('外掛只在 dev（serve）掛上，設定檔有用它', () => {
    expect(keepPageOnReconnect().apply).toBe('serve');
    const names = (config.plugins ?? []).flat().map((plugin) => (plugin && typeof plugin === 'object' && 'name' in plugin ? plugin.name : null));
    expect(names).toContain('galley:keep-page-on-reconnect');
  });
});

describe('審查 7a：Vite 真的解析出來的用戶端模組會被改到', () => {
  it('不 listen 任何埠（middlewareMode、不開 WebSocket）：/@vite/client 的 id 命中 isViteClient，轉出來的程式碼已經換掉', async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), 'galley-vite-test-'));
    const server = await createServer({
      configFile: false,
      root: new URL('../src/ui', import.meta.url).pathname,
      cacheDir,
      logLevel: 'silent',
      plugins: [keepPageOnReconnect()],
      server: { middlewareMode: true, ws: false, watch: null },
      optimizeDeps: { noDiscovery: true, include: [] },
    });
    try {
      const resolved = await server.pluginContainer.resolveId('/@vite/client');
      expect(resolved).not.toBeNull();
      expect(isViteClient(resolved!.id)).toBe(true);
      const transformed = await server.transformRequest('/@vite/client');
      expect(transformed?.code).toContain('[galley] dev server 連回來了');
      expect(transformed?.code).not.toContain(VITE_RECONNECT_RELOAD);
    } finally {
      await server.close();
      rmSync(cacheDir, { recursive: true, force: true });
    }
  }, 20_000);
});

describe('審查 7b：接不回去時要講得出來', () => {
  it('Vite 的 connect 包裝在沒設 hmr 埠時失敗是 return、不是 throw：所以不能只靠 catch 判斷', () => {
    const at = viteClient.indexOf('[vite] failed to connect to websocket.');
    expect(at).toBeGreaterThan(0);
    expect(viteClient.slice(at, at + 1200)).toMatch(/\}\s*\}\s*return;/);
  });

  it('連上時用戶端會發 vite:ws:connect；換掉的那段用它判斷接回來沒有，沒有就講', () => {
    expect(viteClient).toContain('event: "vite:ws:connect"');
    expect(VITE_RECONNECT_KEEP).toContain('"vite:ws:connect"');
    expect(VITE_RECONNECT_KEEP).toMatch(/if \(!galleyBack\) console\.log\("\[galley\] HMR 接不回去/);
  });
});

