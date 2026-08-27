import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError, errorCodes } from '../errors.js';

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
  app.get<{ Querystring: { refresh?: string } }>('/api/agents', async (request) => {
    const refresh = request.query.refresh === '1';
    const statuses = await app.ctx.agents.detectAll({ refresh });
    return {
      agents: statuses,
      busy: app.ctx.agents.busy !== null,
    };
  });

  app.get<{ Params: { id: string } }>('/api/agents/:id/models', async (request) => {
    const parsed = AgentIdSchema.safeParse(request.params.id);
    if (!parsed.success) {
      throw new AppError(errorCodes.NOT_FOUND, `未知的 Agent：${request.params.id}`, 404);
    }
    return { models: await app.ctx.agents.listModels(parsed.data) };
  });
}
