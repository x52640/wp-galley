import { config as loadDotenv } from 'dotenv';
import { join } from 'node:path';
import { buildApp } from './app.js';
import { ConfigError, loadConfig, redactConfig } from '../config/env.js';
import { databaseFile, ensureRuntimeDirectories, paths } from '../config/paths.js';
import { openDatabase } from '../db/index.js';
import { runMigrations } from '../db/migrate.js';
import { loadTemplateRegistry } from '../templates/registry.js';
import { AgentRegistry } from '../agents/registry.js';
import { loadPublishTargets, PublishTargetError } from '../wordpress/targets.js';
import { TemplateLoadError } from '../templates/registry.js';

// 測試時不讀 .env，避免把本機秘密帶進測試環境。
if (process.env['WP_PUBLISHER_SKIP_DOTENV'] !== '1') {
  loadDotenv({ path: join(paths.root, '.env'), quiet: true });
}

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig(process.env);
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(`\n啟動失敗：${error.message}\n\n請參考 .env.example 修正 .env。\n`);
      process.exit(1);
    }
    throw error;
  }

  ensureRuntimeDirectories();
  const db = openDatabase(databaseFile);
  runMigrations(db);

  let templates;
  try {
    templates = await loadTemplateRegistry(paths.templates);
  } catch (error) {
    if (error instanceof TemplateLoadError) {
      console.error(`\n啟動失敗：模板載入錯誤\n${error.message}\n`);
      db.close();
      process.exit(1);
    }
    throw error;
  }

  let targets;
  try {
    targets = await loadPublishTargets(join(paths.config, 'publish-targets.json'));
  } catch (error) {
    if (error instanceof PublishTargetError) {
      console.error(`\n啟動失敗：發布目標設定錯誤\n${error.message}\n`);
      db.close();
      process.exit(1);
    }
    throw error;
  }

  const app = await buildApp({ config, db, templates, agents: new AgentRegistry(), targets });

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, '收到關閉訊號，正在停止服務');
    await app.close();
    db.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  try {
    // 只監聽 loopback。APP_HOST 已在 loadConfig 驗證過不可能是 0.0.0.0。
    await app.listen({ host: config.appHost, port: config.appPort });
  } catch (error) {
    app.log.error({ err: error }, '無法啟動服務');
    db.close();
    process.exit(1);
  }

  const url = `http://${config.appHost === '::1' ? '[::1]' : config.appHost}:${config.appPort}`;
  app.log.info({ config: redactConfig(config) }, '發布台已啟動');
  console.log(`\n本機 WordPress 發布台：${url}\n健康檢查：${url}/api/health\n`);
}

void main();
