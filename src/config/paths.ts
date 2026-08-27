import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

/** 專案根目錄（src/config/ 往上兩層）。 */
export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const paths = {
  root: projectRoot,
  /** SQLite 與其他本機狀態。 */
  data: join(projectRoot, 'data'),
  /** 每個 job 的隔離工作區；Agent 的 cwd 只能在這裡面。 */
  drafts: join(projectRoot, 'drafts'),
  generatedImages: join(projectRoot, 'generated-images'),
  /** 發布前快照。 */
  backups: join(projectRoot, 'backups'),
  /** 模板資料夾（受信任的本機設定）。 */
  templates: join(projectRoot, 'templates'),
  config: join(projectRoot, 'config'),
  uiDist: join(projectRoot, 'dist', 'ui'),
} as const;

export const databaseFile = join(paths.data, 'publisher.sqlite');

/** 啟動時建立需要的本機目錄；全部已列入 .gitignore。 */
export function ensureRuntimeDirectories(): void {
  for (const dir of [paths.data, paths.drafts, paths.generatedImages, paths.backups]) {
    mkdirSync(dir, { recursive: true });
  }
}
