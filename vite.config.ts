import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// UI 只在本機開發時由 Vite 提供；正式啟動時由 Fastify 提供 dist/ui 靜態檔。
export default defineConfig({
  root: 'src/ui',
  plugins: [react()],
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
