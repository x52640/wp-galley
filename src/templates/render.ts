import nunjucks from 'nunjucks';
import type { LoadedTemplate } from './types.js';
import { sanitizeBody, type SanitizeReport } from './sanitize.js';
import { validateStructure } from './structure.js';
import { validateAgainstSchema } from './schema-validator.js';
import { computeRevisionHash } from '../core/content-hash.js';

/**
 * 決定性渲染器。
 *
 * 只負責「編排」這五個步驟，每一步的實作都在各自的模組裡：
 *   1. schema-validator  驗證 Agent 給的資料
 *   2. sanitize          清理要發布的 HTML
 *   3. structure         hybrid 模式的版型規則
 *   4. nunjucks          渲染預覽（外框 + 正文）
 *   5. core/content-hash 算出 revision hash
 *
 * 任何一步失敗就整份退回，不會產出「一半的」結果（計畫 §6.3）。
 * 「決定性」的意思是：同樣的資料 + 同樣的模板 => 位元組完全相同的輸出，
 * 所以這裡不碰時間、亂數或任何環境狀態。
 */

export class RenderError extends Error {
  override readonly name = 'RenderError';
  constructor(
    message: string,
    readonly issues: string[] = [],
  ) {
    super(message);
  }
}

export interface RenderContext {
  /** 預覽外框顯示的日期字串。由呼叫端決定，渲染器本身不讀時鐘。 */
  readonly displayDate?: string;
  /** 已上傳的精選圖片資訊，只用於預覽。 */
  readonly featuredImage?: { src: string; alt: string; caption?: string | undefined };
}

export interface RenderResult {
  /** 要送去 WordPress content 欄位的 HTML。只有這個會被發布。 */
  readonly publishHtml: string;
  /** 本機預覽用的完整 HTML，含模擬外框。永遠不會被發布。 */
  readonly previewHtml: string;
  /** revision hash：綁定模板 hash 與 canonical 內容。 */
  readonly contentHash: string;
  readonly sanitizeReport: SanitizeReport;
  readonly templateId: string;
  readonly templateHash: string;
}

const nunjucksEnv = new nunjucks.Environment(null, {
  autoescape: true,
  throwOnUndefined: false,
});

export function renderRevision(
  template: LoadedTemplate,
  data: unknown,
  context: RenderContext = {},
): RenderResult {
  const { manifest } = template;

  // 1. schema 驗證。Agent 說自己合格不算數（計畫 §4.1）。
  const validation = validateAgainstSchema(template.schema, template.hash, data);
  if (!validation.valid) {
    throw new RenderError(`資料不符合模板 ${manifest.id} 的 schema`, validation.issues);
  }
  const record = data as Record<string, unknown>;

  // 2. 清理要發布的 HTML。
  const rawBody = record[manifest.publishSlot];
  if (typeof rawBody !== 'string') {
    throw new RenderError(`publishSlot 欄位 ${manifest.publishSlot} 必須是字串`, [manifest.publishSlot]);
  }
  const sanitizeReport = sanitizeBody(rawBody, manifest);
  const publishHtml = sanitizeReport.html.trim();

  if (publishHtml.length === 0) {
    throw new RenderError('正文清理後變成空的，拒絕發布空內容', [
      `移除的標籤：${sanitizeReport.removedTags.join('、') || '（無）'}`,
    ]);
  }

  // 3. hybrid 才套版型規則；flexible 只要通過 allowlist。
  if (manifest.strictness === 'hybrid') {
    const issues = validateStructure(rawBody, manifest.structureRules);
    if (issues.length > 0) {
      throw new RenderError(
        `正文不符合 ${manifest.id} 的版型規則：${issues[0]!.message}`,
        issues.map((i) => `${i.rule}: ${i.message}`),
      );
    }
  }

  // 4. 渲染預覽。除了正文以外的欄位都會被 autoescape，
  //    Agent 想把標籤塞進標題也只會變成純文字。
  const previewHtml = renderPreview(template, {
    ...record,
    [manifest.publishSlot]: publishHtml,
    displayDate: context.displayDate ?? '',
    featuredImage: context.featuredImage ?? null,
  });

  // 5. revision hash。不含預覽外框與 displayDate——換個預覽日期不該讓核准失效。
  const contentHash = computeRevisionHash({
    templateId: manifest.id,
    templateHash: template.hash,
    publishHtml,
    fields: Object.fromEntries(
      Object.entries(record).filter(([key]) => key !== manifest.publishSlot),
    ),
  });

  return {
    publishHtml,
    previewHtml,
    contentHash,
    sanitizeReport,
    templateId: manifest.id,
    templateHash: template.hash,
  };
}

function renderPreview(template: LoadedTemplate, data: Record<string, unknown>): string {
  try {
    return nunjucksEnv.renderString(template.templateHtml, data);
  } catch (error) {
    throw new RenderError(
      `渲染模板 ${template.manifest.id} 失敗：${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
