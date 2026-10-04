import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chmodSync, existsSync, mkdirSync, realpathSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';

/**
 * 所有路徑的家。分兩種（D-035，P8-T003）：
 *
 * - **程式資料夾**（`projectRoot`）：程式本身——模板、範例設定、`.env.example`、建置好的 UI。
 *   升級（之後可能的 Mac App／Homebrew、或作者自己重 clone）會整個換掉。
 * - **資料目錄**（`resolveDataDir()`）：使用者的東西——`.env`、站台設定檔、SQLite、稿件、圖片、備份。
 *   換掉程式資料夾也不會動到。
 */

/** 程式資料夾（src/config/ 往上兩層）。P8-T003 之前使用者資料也放這裡（舊位置）。 */
export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 程式本身的路徑（跟著程式走，不是使用者資料）。 */
export const paths = {
  root: projectRoot,
  /** 模板資料夾（受信任的本機設定）。 */
  templates: join(projectRoot, 'templates'),
  /** 站台設定範例（`publish-targets.example.json`、`examples/`）。本機站台設定檔不在這裡，在資料目錄。 */
  config: join(projectRoot, 'config'),
  envExampleFile: join(projectRoot, '.env.example'),
  uiDist: join(projectRoot, 'dist', 'ui'),
} as const;

export class DataDirError extends Error {
  override readonly name = 'DataDirError';
}

/** 資料目錄的名字（macOS 慣例首字大寫，其他平台照 XDG 慣例小寫）。 */
const APP_DIR_MAC = 'Galley';
const APP_DIR_XDG = 'galley';

/**
 * 資料目錄在哪：
 * - `GALLEY_DATA_DIR`（絕對路徑）優先，給開發或想放別處的人；相對路徑直接報錯，不猜相對誰。
 * - macOS：`~/Library/Application Support/Galley`。
 * - 其他平台：`$XDG_DATA_HOME/galley`（XDG 規定要絕對路徑，相對的忽略），沒設就 `~/.local/share/galley`。
 *
 * **測試行程（vitest 會設 `VITEST`）沒設 `GALLEY_DATA_DIR` 時一律回系統暫存目錄底下的一個資料夾**：
 * 哪個測試忘了注入路徑，也只會寫到暫存目錄，不可能碰到作者真的資料。
 *
 * **程式資料夾是 git worktree（`.git` 是檔案）時預設用 `<程式資料夾>/.galley-data`**：並行開發的 worktree
 * 不共用全機那一個資料目錄（不然會讀到真的 `.env` 與 DB，也會搶先建出資料目錄、讓主 checkout 以為已經搬過）。
 * 主 checkout（`.git` 是資料夾）與不是 git 的安裝照舊。
 */
export function resolveDataDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
  programRoot: string = projectRoot,
): string {
  const override = env['GALLEY_DATA_DIR'];
  if (override !== undefined && override.trim() !== '') {
    if (!isAbsolute(override)) {
      throw new DataDirError(`GALLEY_DATA_DIR 要是絕對路徑（例如 /Users/你/Galley），現在是「${override}」`);
    }
    return resolve(override); // 去掉尾端斜線與 `..`
  }
  if (env['VITEST'] !== undefined) return join(tmpdir(), 'galley-vitest-data');
  if (isGitWorktree(programRoot)) return join(programRoot, WORKTREE_DATA_DIR);
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', APP_DIR_MAC);
  const xdg = env['XDG_DATA_HOME'];
  if (xdg !== undefined && isAbsolute(xdg)) return join(xdg, APP_DIR_XDG);
  return join(home, '.local', 'share', APP_DIR_XDG);
}

/** git worktree 裡的資料目錄名（已在 `.gitignore`）。 */
export const WORKTREE_DATA_DIR = '.galley-data';

/** `.git` 是檔案＝git worktree（主 checkout 的 `.git` 是資料夾）。 */
function isGitWorktree(root: string): boolean {
  try {
    return statSync(join(root, '.git')).isFile();
  } catch {
    return false;
  }
}

export interface DataPaths {
  /** 資料目錄本身。DB 裡存的相對路徑都相對這裡。 */
  readonly dir: string;
  /** WordPress 連線（手動填或設定精靈寫入，權限 0600）。 */
  readonly envFile: string;
  /** 本機站台設定檔（發布目標）。 */
  readonly siteConfigFile: string;
  /** SQLite 所在的資料夾。 */
  readonly data: string;
  readonly databaseFile: string;
  /** 每個 job 的隔離工作區；Agent 的 cwd 只能在這裡面。 */
  readonly drafts: string;
  readonly generatedImages: string;
  /** 發布前快照、設定精靈覆寫站台設定檔前的備份。 */
  readonly backups: string;
}

export function dataPaths(dir: string): DataPaths {
  return {
    dir,
    envFile: join(dir, '.env'),
    siteConfigFile: join(dir, 'publish-targets.json'),
    data: join(dir, 'data'),
    databaseFile: join(dir, 'data', 'publisher.sqlite'),
    drafts: join(dir, 'drafts'),
    generatedImages: join(dir, 'generated-images'),
    backups: join(dir, 'backups'),
  };
}

/** P8-T003 之前的位置：程式資料夾底下的原路徑。第一次啟動從這裡複製到資料目錄。 */
export function legacyDataPaths(root: string = projectRoot): Omit<DataPaths, 'dir'> {
  return {
    envFile: join(root, '.env'),
    siteConfigFile: join(root, 'config', 'publish-targets.json'),
    data: join(root, 'data'),
    databaseFile: join(root, 'data', 'publisher.sqlite'),
    drafts: join(root, 'drafts'),
    generatedImages: join(root, 'generated-images'),
    backups: join(root, 'backups'),
  };
}

/** 建立資料目錄本身。是新建的才設 0700（裡面有 .env 與稿件）；已經有的不改使用者的設定。 */
export function ensureDataDir(dir: string): void {
  if (existsSync(dir)) return;
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700); // mkdir 的 mode 會被 umask 吃掉，再設一次
}

/** 建立資料目錄與底下要用的資料夾。 */
export function ensureDataDirectories(p: DataPaths): void {
  ensureDataDir(p.dir);
  for (const dir of [p.data, p.drafts, p.generatedImages, p.backups]) {
    mkdirSync(dir, { recursive: true });
  }
}

/** `child` 是否在 `parent` 底下（不含 `parent` 本身）。兩者都要先 resolve 過。 */
export function isInsideDir(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel !== '' && !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`);
}

/**
 * DB 要存的路徑：在資料目錄裡就存相對路徑（`drafts/<uuid>`），以後資料目錄再搬也不會壞；
 * 不在裡面（測試把目錄注入到別處）才存絕對路徑。
 */
export function toStoredPath(dataDir: string, absolute: string): string {
  const base = resolve(dataDir);
  const target = resolve(absolute);
  return isInsideDir(base, target) ? relative(base, target) : target;
}

/** 資料目錄裡、DB 會存路徑的那兩個資料夾。 */
const STORED_DIRS = ['drafts', 'generated-images'];

/**
 * DB 讀出的路徑：相對的以資料目錄解析；舊資料的絕對路徑照舊用。
 *
 * 容錯：絕對路徑不在資料目錄底下時（例如重 clone 到別的資料夾、把舊 clone 的資料複製過來，migration 010
 * 拿到的是新根目錄、這些舊根目錄的路徑一筆都沒轉），取路徑裡**最後一個** `/drafts/` 或 `/generated-images/`
 * 段，對應到資料目錄的同一個相對位置；**那裡真的有檔才用**，沒有就照原路徑。
 */
export function fromStoredPath(dataDir: string, stored: string): string {
  if (!isAbsolute(stored)) return resolve(dataDir, stored);
  const base = resolve(dataDir);
  if (isInsideDir(base, resolve(stored))) return stored;
  let cut = -1;
  for (const dir of STORED_DIRS) cut = Math.max(cut, stored.lastIndexOf(`/${dir}/`));
  if (cut < 0) return stored;
  const candidate = resolve(base, stored.slice(cut + 1));
  return isInsideDir(base, candidate) && existsSync(candidate) ? candidate : stored;
}

/** 媒體檔在 DB 路徑裡的資料夾名（舊根目錄容錯只認這一段）。 */
const MEDIA_SEGMENT = '/generated-images/';

/**
 * DB 讀出的**媒體**路徑（`media_assets.local_path`、`image_candidates.local_path`）→ 實際檔案位置（P8-T004）。
 *
 * 跟 `fromStoredPath` 不同，結果**一定在媒體資料夾（`generated-images/`）底下**，不然回 null（當成檔案不見了）：
 * - 路徑裡有任何 `..` 段（或 NUL）就不解析。
 * - 相對的以資料目錄解析、絕對的照用；兩者都要落在媒體資料夾裡。
 * - 舊根目錄容錯（絕對路徑、不在資料目錄底下）：只取最後一個 `/generated-images/` 之後那段，對應到媒體資料夾，那裡真的有檔才用。
 * - 檔案已經存在時，再確認**實體路徑**（解開符號連結）也在媒體資料夾的實體路徑底下。
 *
 * 讀檔、刪檔都只用這裡回傳的路徑：DB 被改過也碰不到 `.env`、資料庫或資料目錄裡的其他檔。
 */
export function fromStoredMediaPath(dataDir: string, mediaDir: string, stored: string): string | null {
  if (stored === '' || stored.includes('\0') || stored.split(/[\\/]/).includes('..')) return null;
  const base = resolve(dataDir);
  const media = resolve(mediaDir);
  const target = isAbsolute(stored) ? resolve(stored) : resolve(base, stored);
  if (isInsideDir(media, target)) return confirmRealInside(media, target);
  if (!isAbsolute(stored) || isInsideDir(base, target)) return null;
  const cut = stored.lastIndexOf(MEDIA_SEGMENT);
  if (cut < 0) return null;
  const candidate = resolve(media, stored.slice(cut + MEDIA_SEGMENT.length));
  if (!isInsideDir(media, candidate) || !existsSync(candidate)) return null;
  return confirmRealInside(media, candidate);
}

/** 檔案存在時，實體路徑也要在 `parent` 的實體路徑底下；不存在就回原路徑（讀會失敗、刪不到東西）。 */
function confirmRealInside(parent: string, target: string): string | null {
  let real: string;
  try {
    real = realpathSync(target);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === 'ENOENT' || code === 'ENOTDIR' ? target : null;
  }
  try {
    return isInsideDir(realpathSync(parent), real) ? target : null;
  } catch {
    return null;
  }
}
