import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Vite 用戶端跟 dev server 的 WebSocket 斷線（休眠、網路閃斷、dev server 重啟）後會每秒 ping，
 * 連得回去就 `location.reload()`——打字模式還沒存的字跟著不見（D-047，P5-T048）。
 *
 * 這裡把用戶端那一行換掉：連回去之後**不重新整理頁面**，改成重新接上 HMR 的 WebSocket。
 * - 只是斷線（dev server 沒重啟，例如休眠醒來）：重新接上，HMR 照常。
 * - dev server 真的重啟了：新的 server 換了 WebSocket token，接不回去；頁面照舊能用（API 走 proxy），
 *   但之後改了 UI 檔案要自己重新整理一次才看得到。主控台會講一句。
 *
 * 只在 `vite`（dev）時作用；正式啟動（`npm start`）由 Fastify 提供 dist/ui，沒有 Vite 用戶端。
 * 換 Vite 版本時用戶端那一段字可能變了：找不到就在 dev server 終端機警告（不默默失效），
 * `tests/vite-no-reload.test.ts` 也會對著裝好的 Vite 用戶端檢查。
 */
export const VITE_RECONNECT_RELOAD = 'await waitForSuccessfulPing(url.href);\n\t\t\t\t\tlocation.reload();';

export const VITE_RECONNECT_KEEP = [
  'await waitForSuccessfulPing(url.href);',
  // 不重新整理（D-047）：重新接上 HMR。
  'console.log("[galley] dev server 連回來了，不自動重新整理頁面（沒存的字留著）。");',
  // 接不接得回去看有沒有收到 vite:ws:connect：Vite 的 connect 包裝在沒設 hmr 埠時失敗是 return 不是 throw（審查 7b）。
  '{ let galleyBack = false; const galleyHandler = createHMRHandler(handleMessage);',
  'transport.connect((payload) => { if (payload && payload.type === "custom" && payload.event === "vite:ws:connect") galleyBack = true; return galleyHandler(payload); })',
  '.catch(() => {}).then(() => { if (!galleyBack) console.log("[galley] HMR 接不回去（dev server 重啟過）；要看新的 UI 請自己重新整理頁面。"); }); }',
].join('\n\t\t\t\t\t');

/** 把 Vite 用戶端「連回來就重新整理」那一行換掉；找不到（或不只一處）回 null。 */
export function patchViteClient(code: string): string | null {
  const at = code.indexOf(VITE_RECONNECT_RELOAD);
  if (at < 0 || code.indexOf(VITE_RECONNECT_RELOAD, at + 1) >= 0) return null;
  return code.slice(0, at) + VITE_RECONNECT_KEEP + code.slice(at + VITE_RECONNECT_RELOAD.length);
}

/** 只改 Vite 自己的用戶端（`/@vite/client` → `vite/dist/client/client.mjs`）。 */
export function isViteClient(id: string): boolean {
  return /[\\/]vite[\\/]dist[\\/]client[\\/]client\.mjs(?:\?.*)?$/.test(id);
}

export function keepPageOnReconnect(): Plugin {
  let warned = false;
  return {
    name: 'galley:keep-page-on-reconnect',
    apply: 'serve',
    transform(code, id) {
      if (!isViteClient(id)) return null;
      const patched = patchViteClient(code);
      if (patched === null) {
        if (!warned) {
          warned = true;
          this.warn('找不到 Vite 用戶端「連回來就重新整理」那一段（Vite 版本變了？）：休眠醒來頁面會自己重新整理（D-047）。');
        }
        return null;
      }
      return { code: patched, map: null };
    },
  };
}

// UI 只在本機開發時由 Vite 提供；正式啟動時由 Fastify 提供 dist/ui 靜態檔。
export default defineConfig({
  root: 'src/ui',
  plugins: [react(), keepPageOnReconnect()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: '../../dist/ui',
    emptyOutDir: true,
  },
});
