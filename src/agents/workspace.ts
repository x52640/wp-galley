import { mkdirSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

/**
 * Job 隔離工作區。
 *
 * 計畫 §6.2 要求 Agent 的 cwd 是隔離工作區而不是使用者家目錄；
 * §10 要求 MCP 的檔案參數只接受工作區內 resolve 過的路徑，防 path traversal。
 * 兩者共用這一個模組，規則只寫一次。
 */

export class WorkspaceError extends Error {
  override readonly name = 'WorkspaceError';
}

/** job id 只允許這個形狀，避免帶出目錄分隔符或 `..`。 */
const JOB_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export function createJobWorkspace(root: string, jobId: string): string {
  if (!JOB_ID_PATTERN.test(jobId)) {
    throw new WorkspaceError(
      'job id 只能是 1–64 個英數、底線或連字號，且需以英數開頭',
    );
  }

  const dir = join(resolve(root), jobId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * 把使用者或 Agent 給的路徑 resolve 到工作區內，逃得出去就拒絕。
 *
 * 錯誤訊息刻意不回述被拒絕的路徑，避免把系統路徑反射回呼叫端。
 */
export function resolveInsideWorkspace(workspaceDir: string, candidate: string): string {
  const base = resolve(workspaceDir);
  const target = isAbsolute(candidate) ? resolve(candidate) : resolve(base, candidate);

  const rel = relative(base, target);
  const escapes = rel.startsWith('..') || rel.split(sep).includes('..') || isAbsolute(rel);

  if (escapes || target === base) {
    throw new WorkspaceError('路徑必須位於這個工作項目的工作區內');
  }
  return target;
}
