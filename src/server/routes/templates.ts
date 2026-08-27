import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { renderRevision, RenderError } from '../../templates/render.js';
import { TemplateLoadError } from '../../templates/registry.js';
import { buildPreviewDocument } from '../../preview/document.js';
import { AppError, errorCodes } from '../errors.js';

const PreviewBodySchema = z.object({
  data: z.record(z.string(), z.unknown()),
  displayDate: z.string().max(40).optional(),
  featuredImage: z
    .object({ src: z.string().max(2000), alt: z.string().max(300), caption: z.string().max(500).optional() })
    .optional(),
});

export async function templateRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/templates', async () => {
    const ctx = app.ctx;
    return {
      templates: ctx.templates.list().map((template) => ({
        id: template.manifest.id,
        version: template.manifest.version,
        contentType: template.manifest.contentType,
        strictness: template.manifest.strictness,
        publishSlot: template.manifest.publishSlot,
        requiredSlots: template.manifest.requiredSlots,
        optionalSlots: template.manifest.optionalSlots,
        allowedTags: template.manifest.allowedTags,
        previewStrategy: template.manifest.previewStrategy,
        wordpressTargetKey: template.manifest.wordpressTargetKey,
        hash: template.hash,
        schema: template.schema,
        rules: template.rulesMarkdown,
      })),
    };
  });

  app.post<{ Params: { id: string } }>('/api/templates/:id/preview', async (request) => {
    const ctx = app.ctx;

    const parsed = PreviewBodySchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(
        errorCodes.VALIDATION_FAILED,
        '請求格式不正確',
        400,
        parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
      );
    }

    let template;
    try {
      template = ctx.templates.get(request.params.id);
    } catch (error) {
      if (error instanceof TemplateLoadError) {
        throw new AppError(errorCodes.NOT_FOUND, error.message, 404);
      }
      throw error;
    }

    try {
      const rendered = renderRevision(template, parsed.data.data, {
        ...(parsed.data.displayDate === undefined ? {} : { displayDate: parsed.data.displayDate }),
        ...(parsed.data.featuredImage === undefined ? {} : { featuredImage: parsed.data.featuredImage }),
      });

      return {
        templateId: rendered.templateId,
        templateHash: rendered.templateHash,
        contentHash: rendered.contentHash,
        publishHtml: rendered.publishHtml,
        previewDocument: buildPreviewDocument(template, rendered),
        sanitize: {
          changed: rendered.sanitizeReport.changed,
          removedTags: rendered.sanitizeReport.removedTags,
          removedAttributes: rendered.sanitizeReport.removedAttributes,
        },
      };
    } catch (error) {
      if (error instanceof RenderError) {
        // 422：格式對但內容不合模板規則，使用者要改內容而不是改請求。
        throw new AppError(errorCodes.TEMPLATE_VALIDATION_FAILED, error.message, 422, error.issues);
      }
      throw error;
    }
  });
}
