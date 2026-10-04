/** 內容（對應後端 `service/content.ts`）：建新版本、渲染、校樣。 */

import { EMPTY_BODY_HTML } from '../../../contract/empty-body.js';
import { checkPlainTitle, sameTitle } from '../../../contract/plain-title.js';
import type { CreateRevisionInput, JobDetail, PublisherApi, RenderOutcome } from '../types.js';
import { countOpenReviewItems, pendingReviewBlocker } from '../../../contract/review-state.js';
import { revision } from './data.js';
import { clone, delay, escapeText, invalidateApproval, mustGet, nextHash } from './context.js';
import { resolveFactCheckByEdit } from './factcheck.js';

/** 模擬 buildPreviewDocument 的輸出：自成一份文件、樣式內嵌、正文在 .preview-body。 */
function previewDocument(job: JobDetail): string {
  const data = job.currentRevision?.templateData ?? {};
  const title = typeof data['title'] === 'string' ? data['title'] : (job.title ?? '未命名');
  const body = typeof data['body'] === 'string' ? data['body'] : '<p>（尚未渲染）</p>';
  const featured = job.media.find((asset) => asset.id === job.featuredMediaId);
  return `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8">
<style>
:root { color-scheme: light; }
/* 跟真的模板一樣不重設 body 的外距（瀏覽器預設 8px）：校樣的高度量測要把它算進去（P5-T029）。 */
body { background:#fff; }
.preview-article { max-width:46rem; margin:0 auto; padding:2rem 1.25rem 4rem;
  font-family:'PingFang TC','Noto Sans TC',system-ui,sans-serif; font-size:1.0625rem;
  line-height:1.9; color:#23262b; }
.preview-frame { border:1px dashed #c8ccd4; border-radius:.5rem; padding:1.25rem 1.25rem 1rem;
  margin-bottom:2.5rem; background:#f7f8fa; }
.preview-frame-note { margin:0 0 1rem; font-size:.75rem; letter-spacing:.04em; color:#8a9099;
  text-transform:uppercase; }
.preview-featured img { width:100%; height:auto; border-radius:.375rem; display:block; }
.preview-title { font-size:1.6rem; line-height:1.4; margin:1rem 0 .5rem; color:#14161a; font-weight:700; }
.preview-meta { margin:0; font-size:.85rem; color:#6b7280; }
.preview-body > :first-child { margin-top:0; }
.preview-body p { margin:0 0 1.5rem; }
.preview-body h3 { font-size:1.25rem; line-height:1.5; margin:2.75rem 0 1rem; color:#14161a; }
.preview-body ul { margin:0 0 1.5rem; padding-left:1.5rem; }
.preview-body li { margin-bottom:.5rem; }
.preview-body blockquote { margin:0 0 1.5rem; padding:.25rem 0 .25rem 1.25rem;
  border-left:3px solid #d6dae1; color:#4b5563; }
.preview-body figure { margin:2rem 0; }
.preview-body figure img { width:100%; height:auto; display:block; border-radius:.25rem; }
</style></head>
<body><article class="preview-article">
<header class="preview-frame" aria-label="佈景主題外框（不會發布）">
<p class="preview-frame-note">以下外框由網站佈景主題產生，發布台不會送出</p>
${featured ? `<figure class="preview-featured"><img src="${featured.url ?? ''}" alt="${featured.altText ?? ''}"></figure>` : ''}
<h1 class="preview-title">${escapeText(title)}</h1>
<p class="preview-meta">2026 年 8 月 28 日</p>
</header>
<div class="preview-body" aria-label="正文（會發布的內容）">
${body}
</div>
</article></body></html>`;
}

export const contentApi: Pick<PublisherApi, 'createRevision' | 'listRevisions' | 'render' | 'fetchPreview' | 'fetchPreviewHash'> = {
  async createRevision(uuid: string, input: CreateRevisionInput) {
    await delay();
    const job = mustGet(uuid);
    // 先驗完再動資料：跟後端一樣，錯的請求不能撤銷核准、不能換版本（P5-T031，Codex 審查）。
    if (input.resolveItemId !== undefined && input.editedBody === undefined && input.editedTitle === undefined) {
      throw new Error('resolveItemId 只能跟 editedBody 或 editedTitle 一起用（從卡片進去直接改文章）');
    }
    if (input.resolveFactCheckId !== undefined && input.editedBody === undefined && input.editedTitle === undefined) {
      throw new Error('resolveFactCheckId 只能跟 editedBody 或 editedTitle 一起用（從查證卡片進去直接改文章）');
    }
    // 查證跑的期間不鎖內容（D-036），跟後端一樣。
    // 在文章上改的標題（P5-T029）：跟後端同一條規則。
    let editedTitle: string | undefined;
    if (input.editedTitle !== undefined) {
      const checked = checkPlainTitle(input.editedTitle, {
        diary: job.target?.contentType === 'diary',
        maxLength: job.template?.titleMaxLength ?? null,
      });
      if (!checked.ok) throw new Error(checked.message);
      editedTitle = checked.title;
    }
    const current = job.currentRevision;
    // 沒有實質改動（標題只差在空白、正文沒送）：跟後端一樣不建版本、卡片不動（P5-T031）。
    const currentTitle = current?.templateData['title'];
    if (editedTitle !== undefined && typeof currentTitle === 'string' && sameTitle(editedTitle, currentTitle)) {
      editedTitle = undefined;
    }
    const onlyTitle = Object.keys(input).every((key) =>
      ['editedTitle', 'resolveItemId', 'resolveFactCheckId', 'origin', 'reason', 'expectedContentHash'].includes(key),
    );
    if (current && input.editedTitle !== undefined && editedTitle === undefined && onlyTitle) {
      return clone(current);
    }
    if (editedTitle !== undefined) job.title = editedTitle;
    invalidateApproval(job, '內容有新的修改');
    const next = revision(
      (current?.number ?? 0) + 1,
      input.origin ?? 'manual',
      {
        ...(current?.templateData ?? {}),
        ...(input.templateData ?? {}),
        // 示範資料不做後端的整理（normalizeEditedBody），原樣收下。
        ...(input.editedBody === undefined
          ? {}
          : { body: input.editedBody.trim() === '' ? EMPTY_BODY_HTML : input.editedBody }),
        ...(editedTitle === undefined ? {} : { title: editedTitle }),
      },
      nextHash(),
    );
    job.currentRevision = next;
    if (input.sourceText !== undefined) job.sourceText = input.sourceText;
    // 從查證卡片「去原文改」進來的：那條跟著結案（resolved-by-edit）。
    if (input.resolveFactCheckId !== undefined) resolveFactCheckByEdit(uuid, input.resolveFactCheckId);
    // 從卡片進去改的：那一項跟著結案（後端 createRevision 的 resolveItemId）；只改標題也算（P5-T031）。
    if (input.resolveItemId !== undefined && job.review) {
      job.review = {
        ...job.review,
        items: job.review.items.map((item) =>
          item.id === input.resolveItemId && item.state !== 'applied'
            ? { ...item, state: 'skipped' as const, resolvedAt: new Date().toISOString(), resolvedByEdit: true }
            : item,
        ),
      };
      job.review.pendingCount = countOpenReviewItems(job.review.items);
      job.blockers = job.blockers.filter((line) => !line.includes('項校稿建議沒處理'));
      if (job.review.pendingCount > 0) job.blockers.unshift(pendingReviewBlocker(job.review.pendingCount));
    }
    return clone(next);
  },

  async listRevisions(uuid: string) {
    await delay(80);
    const job = mustGet(uuid);
    return job.currentRevision ? [clone(job.currentRevision)] : [];
  },

  async render(uuid: string): Promise<RenderOutcome> {
    await delay(420);
    const job = mustGet(uuid);
    job.state = 'RENDERED';
    job.blockers = ['還沒核准'];
    const current = job.currentRevision;
    return {
      revisionId: current?.id ?? 0,
      revisionNumber: current?.number ?? 1,
      contentHash: current?.contentHash ?? nextHash(),
      publishHtml: current?.publishHtml ?? '',
      previewDocument: previewDocument(job),
      sanitize: { changed: false, removedTags: [], removedAttributes: [] },
      state: job.state,
    };
  },

  // 跟真的後端一樣：載入校樣＝使用者看過了，RENDERED 推進 PREVIEWED（核准只能從那裡出發）。
  async fetchPreview(uuid: string) {
    await delay(160);
    const job = mustGet(uuid);
    if (job.state === 'RENDERED') {
      job.state = 'PREVIEWED';
      job.blockers = job.blockers.filter((blocker) => blocker !== '還沒渲染，先按「渲染」產生校樣');
    }
    return previewDocument(job);
  },

  // 示範資料沒有真的 HTTP 回應，校樣一定是照目前這一版畫的，所以直接回它的 hash。
  async fetchPreviewHash(uuid: string) {
    await delay(60);
    return mustGet(uuid).currentRevision?.contentHash ?? null;
  },
};
