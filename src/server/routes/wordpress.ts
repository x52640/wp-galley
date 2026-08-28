import type { FastifyInstance } from 'fastify';
import { probeSite, unconfiguredProbe } from '../../wordpress/site.js';
import { fetchPostTypes } from '../../wordpress/site.js';
import { validateTargetsAgainstSite, type PublishTarget } from '../../wordpress/targets.js';

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
    const targets = app.ctx.targets.list();

    if (!client) {
      return { ...unconfiguredProbe(), targetIssues: [], publishTargets: summarize(targets) };
    }

    const probe = await probeSite(client, EXPECTED_POST_TYPES);

    // 認證都過不了就沒必要再驗設定，錯誤訊息會變成兩層噪音。
    if (!probe.authenticated) {
      return { ...probe, targetIssues: [], publishTargets: summarize(targets) };
    }

    // 設定檔說要發到哪，跟站台實際有什麼，要對得起來才算真的可用。
    const postTypes = await fetchPostTypes(client);
    const targetIssues = validateTargetsAgainstSite(targets, postTypes);

    return { ...probe, targetIssues, publishTargets: summarize(targets) };
  });
}

/** 只回報 UI 需要的欄位。設定檔沒有秘密，但也沒必要整包吐出去。 */
function summarize(targets: readonly PublishTarget[]) {
  return targets.map((target) => ({
    key: target.key,
    displayName: target.displayName,
    contentType: target.contentType,
    postType: target.postType,
    templateId: target.templateId,
    taxonomy: target.taxonomy,
    requireFeaturedImage: target.requireFeaturedImage,
    allowCreateTerms: target.allowCreateTerms,
  }));
}
