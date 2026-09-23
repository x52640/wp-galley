import type { FastifyInstance } from 'fastify';
import type { AppConfig, WordPressConfig } from '../config/env.js';
import { WordPressClient } from '../wordpress/client.js';
import type { PublishTargetRegistry } from '../wordpress/targets.js';

/**
 * 設定換掉之後怎麼當場生效（P8-T002）。app.ts 建立時與設定精靈存檔時共用，
 * 放在自己的檔案是為了不讓 app.ts 與 routes/setup.ts 互相 import。
 */

export function siteOf(wordpress: WordPressConfig): { key: string; displayName: string; baseUrl: string; username: string } {
  return { key: wordpress.url, displayName: wordpress.url, baseUrl: wordpress.url, username: wordpress.username };
}

/**
 * 設定精靈存了新的 WordPress 連線：當場換掉，不用重新啟動（P8-T002）。
 *
 * 順序有意義：**先**把新密碼加進遮蔽器，之後任何一步出錯寫 log 都已經會被抹掉。
 * 呼叫端要先確認沒有發布在跑（core.isPublishing()）。
 */
export function applyWordPressConfig(app: FastifyInstance, wordpress: WordPressConfig): void {
  const ctx = app.ctx;
  ctx.secrets.add([wordpress.appPassword]);
  ctx.config = { ...ctx.config, wordpress };
  ctx.wordpress = createWordPressClient(ctx.config, app);
  ctx.core.reconfigure({ wordpress: ctx.wordpress, site: siteOf(wordpress) });
}

/** 設定精靈寫了新的站台設定檔：換掉發布目標（同上，不用重新啟動）。 */
export function applyTargets(app: FastifyInstance, targets: PublishTargetRegistry): void {
  app.ctx.targets = targets;
  app.ctx.core.reconfigure({ targets });
}

/**
 * 設定齊全才建立 client。重試會寫進 server log，方便使用者看到「正在重試」
 * 而不是以為卡住了——RetryInfo 已經在 client 內部過了 scrubber。
 */
export function createWordPressClient(config: AppConfig, app: FastifyInstance): WordPressClient | null {
  if (!config.wordpress) return null;
  return new WordPressClient({
    baseUrl: config.wordpress.url,
    username: config.wordpress.username,
    appPassword: config.wordpress.appPassword,
    onRetry: (info) => app.log.warn(info, 'WordPress 請求重試中'),
  });
}
