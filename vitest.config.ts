import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: false,
    // 測試不得讀取真實 .env，避免把本機秘密帶進測試。
    env: { WP_PUBLISHER_SKIP_DOTENV: '1' },
  },
});
