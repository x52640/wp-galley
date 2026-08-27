import type { FastifyInstance } from 'fastify';
import { redactConfig } from '../../config/env.js';
import { listAppliedMigrations } from '../../db/migrate.js';

/**
 * 健康檢查與診斷。回傳內容全部經過 redactConfig，
 * 絕不含 Application Password（計畫 §13）。
 */
export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/health', async () => {
    const ctx = app.ctx;
    const safe = redactConfig(ctx.config);

    let database: { ok: boolean; migrations: number; error?: string };
    try {
      const applied = listAppliedMigrations(ctx.db);
      database = { ok: true, migrations: applied.length };
    } catch (error) {
      database = {
        ok: false,
        migrations: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    return {
      status: database.ok ? 'ok' : 'degraded',
      stage: 1,
      version: ctx.version,
      startedAt: ctx.startedAt,
      uptimeSeconds: Math.round(process.uptime()),
      server: { host: safe.appHost, port: safe.appPort, nodeEnv: safe.nodeEnv },
      database,
      wordpress: safe.wordpress,
      // 階段 3 才會填入真實 Agent 偵測結果。
      agents: { detected: false, note: '階段 3 才實作 Agent 偵測' },
    };
  });
}
