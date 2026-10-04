import { config as loadDotenv } from 'dotenv';
import { buildApp } from './app.js';
import { ConfigError, loadConfig, redactConfig } from '../config/env.js';
import { DataDirError, paths, projectRoot } from '../config/paths.js';
import { DataMoveError, markDatabaseCreated, prepareUserData, type PreparedUserData } from '../config/user-data.js';
import { openDatabase } from '../db/index.js';
import { runMigrations } from '../db/migrate.js';
import { migrations } from '../db/migrations/index.js';
import { loadTemplateRegistry } from '../templates/registry.js';
import { AgentRegistry } from '../agents/registry.js';
import { loadPublishTargets, PublishTargetError, startupNotice } from '../wordpress/targets.js';
import { TemplateLoadError } from '../templates/registry.js';

async function main(): Promise<void> {
  // 資料目錄（D-035，P8-T003）：第一次啟動把舊資料從程式資料夾複製過去。要在讀 .env 之前，.env 也在搬的東西裡。
  let prepared: PreparedUserData;
  try {
    prepared = prepareUserData();
  } catch (error) {
    if (error instanceof DataDirError || error instanceof DataMoveError) {
      const retry =
        error instanceof DataMoveError ? '\n\n舊資料都還在原處，沒有被動到。處理好上面的問題後重新啟動，會從頭再搬一次。' : '';
      console.error(`\n啟動失敗：${error.message}${retry}\n`);
      process.exit(1);
    }
    throw error;
  }
  const data = prepared.paths;
  if (prepared.notice !== null) console.log(`\n${prepared.notice}\n`);
  if (prepared.warning !== null) console.warn(`\n⚠ ${prepared.warning}\n`);
  console.log(`資料目錄：${data.dir}`);

  // 測試時不讀 .env，避免把本機秘密帶進測試環境。
  if (process.env['WP_PUBLISHER_SKIP_DOTENV'] !== '1') {
    loadDotenv({ path: data.envFile, quiet: true });
  }

  let config;
  try {
    config = loadConfig(process.env);
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(
        `\n啟動失敗：${error.message}\n\n請參考 ${paths.envExampleFile} 修正 ${data.envFile}（或把裡面 WORDPRESS_ 開頭的三行清空，啟動後用設定精靈重填）。\n`,
      );
      process.exit(1);
    }
    throw error;
  }

  const db = openDatabase(data.databaseFile);
  // 舊程式資料夾：migration 010 把 DB 裡以它開頭的絕對路徑改成相對資料目錄。
  runMigrations(db, migrations, { legacyRoot: projectRoot });
  rememberDatabase(data.dir);

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
    targets = await loadPublishTargets(data.siteConfigFile);
  } catch (error) {
    if (error instanceof PublishTargetError) {
      console.error(`\n啟動失敗：發布目標設定錯誤\n${error.message}\n`);
      db.close();
      process.exit(1);
    }
    throw error;
  }

  // 本機站台設定檔不存在不是錯誤（新 clone 本來就沒有），照樣啟動，但要講清楚。
  const notice = startupNotice(targets);
  if (notice !== null) console.warn(`\n⚠ ${notice}\n`);

  const app = await buildApp({
    config,
    db,
    templates,
    agents: new AgentRegistry(),
    targets,
    dataDir: data.dir,
    // 設定精靈（P8-T002）寫這幾個檔。只有正式啟動才給；測試一律注入暫存路徑。
    setupFiles: {
      envFile: data.envFile,
      envExampleFile: paths.envExampleFile,
      siteConfigFile: data.siteConfigFile,
      backupsDir: data.backups,
      rootDir: data.dir,
    },
  });

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

/** 標記檔記下「這裡有過資料庫」（P8-T004）：之後資料庫不見了，啟動會停下來而不是默默建空的。記不下來只警告。 */
function rememberDatabase(dataDir: string): void {
  try {
    markDatabaseCreated(dataDir);
  } catch (error) {
    console.warn(`\n⚠ ${error instanceof Error ? error.message : String(error)}（不影響這次啟動）\n`);
  }
}

void main();
