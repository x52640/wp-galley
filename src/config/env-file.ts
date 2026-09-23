import { chmod, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';

/**
 * 設定精靈改寫 `.env`（P8-T002）。規則的家是 docs/specs/security.md「設定精靈寫入的秘密」。
 *
 * - 只換指定的鍵，其他行原樣保留（使用者自己加的註解、APP_PORT…）。
 * - 同一個鍵出現多次：留第一行、刪掉其餘，免得誰生效說不清楚。
 * - 檔案不存在時以 `.env.example` 為底。
 * - 先寫暫存檔再改名，權限 0600。
 *
 * 這裡刻意不碰 process.env：生效靠 app.ts 的就地套用，下次啟動靠 dotenv 讀這個檔。
 */

export class EnvFileError extends Error {
  override readonly name = 'EnvFileError';
}

/** 值能不能不加引號直接寫：只收常見的網址、帳號字元。 */
const BARE_VALUE = /^[A-Za-z0-9._@:/+\-]*$/;

/**
 * 把一個值寫成 dotenv 讀得回原樣的樣子。
 *
 * dotenv 的單引號值是字面值（不展開 `\n`、不吃 `#` 註解），所以有特殊字元時用單引號包。
 * 單引號本身與換行沒辦法安全表示，直接拒絕——不做跳脫，跳脫規則各家 dotenv 不一樣。
 */
export function formatEnvValue(key: string, value: string): string {
  if (/[\r\n]/.test(value)) throw new EnvFileError(`${key} 不能有換行`);
  if (BARE_VALUE.test(value)) return value;
  if (value.includes("'")) throw new EnvFileError(`${key} 不能有單引號（'）`);
  return `'${value}'`;
}

function keyOfLine(line: string): string | null {
  const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
  return match?.[1] ?? null;
}

/** 純函式：把 updates 套進既有內容。測試直接測這個。 */
export function mergeEnvContent(existing: string, updates: Readonly<Record<string, string>>): string {
  const lines = existing.length === 0 ? [] : existing.replace(/\r\n/g, '\n').split('\n');
  // 檔尾的換行會多切出一個空字串；先拿掉，最後統一補一個。
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

  const written = new Set<string>();
  const out: string[] = [];
  for (const line of lines) {
    const key = keyOfLine(line);
    if (key === null || !(key in updates)) {
      out.push(line);
      continue;
    }
    if (written.has(key)) continue; // 重複的鍵：刪掉
    out.push(`${key}=${formatEnvValue(key, updates[key]!)}`);
    written.add(key);
  }
  for (const [key, value] of Object.entries(updates)) {
    if (!written.has(key)) out.push(`${key}=${formatEnvValue(key, value)}`);
  }
  return `${out.join('\n')}\n`;
}

async function readIfExists(file: string): Promise<string | null> {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') return null;
    throw error;
  }
}

/**
 * 把 updates 寫進 envFile。檔案不存在時以 exampleFile 為底（它也不在就從空白開始）。
 * 先驗證所有值（formatEnvValue 會丟錯），才動檔案。
 */
export async function mergeEnvFile(
  envFile: string,
  updates: Readonly<Record<string, string>>,
  options: { exampleFile?: string } = {},
): Promise<void> {
  const current = await readIfExists(envFile);
  const base = current ?? (options.exampleFile ? ((await readIfExists(options.exampleFile)) ?? '') : '');
  const next = mergeEnvContent(base, updates);
  await writeFileAtomic(envFile, next, 0o600);
}

/** 同目錄暫存檔 → 改名。改名在同一個檔案系統上是原子的，當掉不會留下半個檔。 */
export async function writeFileAtomic(file: string, content: string, mode: number): Promise<void> {
  const temp = join(dirname(file), `.${randomBytes(6).toString('hex')}.tmp`);
  try {
    await writeFile(temp, content, { encoding: 'utf8', mode, flag: 'wx' });
    // umask 可能把 mode 砍掉一部分；明確再設一次。
    await chmod(temp, mode);
    await rename(temp, file);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}
