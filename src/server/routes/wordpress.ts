import type { FastifyInstance } from 'fastify';
import { probeSite, unconfiguredProbe } from '../../wordpress/site.js';

/**
 * WordPress 連線狀態 API。
 *
 * 跟 /api/agents 一樣的定位：讓 UI 在使用者按下發布**之前**就知道連得上沒、
 * 權限夠不夠、內容類型在不在。發布失敗才發現問題就太晚了。
 *
 * 絕不回傳 Application Password，連「有沒有填」以外的資訊都不給。
 */

/** 發布台會用到的內容類型。首頁已移出 MVP（見 docs/SITE-FINDINGS.md）。 */
const EXPECTED_POST_TYPES = ['read-think', 'diary'] as const;

export async function wordpressRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/wordpress', async () => {
    const client = app.ctx.wordpress;
    if (!client) return unconfiguredProbe();
    return probeSite(client, EXPECTED_POST_TYPES);
  });
}
