import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError, errorCodes } from '../errors.js';
import type { ImageGenerationStatus } from '../../contract/api.js';

/**
 * Agent 狀態 API。
 *
 * 只回報「裝了沒、登入了沒、能不能用」——絕不回傳 token、email 或 orgId
 * （計畫 §6.2「不要在 UI 顯示登入 token」）。
 *
 * 階段 3 只做偵測與模型列表；實際派工要等階段 5 有了 job 與 revision 才接得上。
 */

const AgentIdSchema = z.enum(['codex', 'claude', 'google']);

export async function agentRoutes(app: FastifyInstance): Promise<void> {
  // 不再接受 ?refresh=1（P8-T002）：強制重跑偵測會啟動 CLI 子行程，是有副作用的讀取，
  // 改由 POST /api/setup/agents（JSON＋同源守門）負責。這裡只給快取（30 秒內不重跑）。
  app.get('/api/agents', async () => {
    const statuses = await app.ctx.agents.detectAll();
    return {
      agents: statuses,
      busy: app.ctx.agents.busy !== null,
    };
  });

  /** 能不能生圖（只有 Codex 能，D-017）。配圖卡片靠它決定「用 Codex 生圖」給不給按。 */
  app.get('/api/image-generation', async (): Promise<ImageGenerationStatus> => app.ctx.core.imageGenerationStatus());

  app.get<{ Params: { id: string } }>('/api/agents/:id/models', async (request) => {
    const parsed = AgentIdSchema.safeParse(request.params.id);
    if (!parsed.success) {
      throw new AppError(errorCodes.NOT_FOUND, `未知的 Agent：${request.params.id}`, 404);
    }
    return { models: await app.ctx.agents.listModels(parsed.data) };
  });
}
