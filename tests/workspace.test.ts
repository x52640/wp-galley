import { describe, expect, it, afterEach, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJobWorkspace, resolveInsideWorkspace, WorkspaceError } from '../src/agents/workspace.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'wp-ws-test-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('建立工作區', () => {
  it('每個 job 有自己的目錄', () => {
    const a = createJobWorkspace(root, 'job-a');
    const b = createJobWorkspace(root, 'job-b');
    expect(a).not.toBe(b);
    expect(existsSync(a)).toBe(true);
    expect(existsSync(b)).toBe(true);
  });

  it('同一個 job id 得到同一個目錄', () => {
    expect(createJobWorkspace(root, 'job-a')).toBe(createJobWorkspace(root, 'job-a'));
  });

  it('目錄在指定的 root 底下', () => {
    expect(createJobWorkspace(root, 'job-a').startsWith(root)).toBe(true);
  });

  it.each(['../escape', 'a/b', 'a\\b', '..', '.', '', 'a'.repeat(200)])(
    '拒絕會逃出 root 或不合法的 job id：%s',
    (id) => {
      expect(() => createJobWorkspace(root, id)).toThrow(WorkspaceError);
    },
  );
});

describe('resolveInsideWorkspace：擋 path traversal', () => {
  it('接受工作區內的相對路徑', () => {
    const ws = createJobWorkspace(root, 'job-a');
    writeFileSync(join(ws, 'note.txt'), 'x');
    expect(resolveInsideWorkspace(ws, 'note.txt')).toBe(join(ws, 'note.txt'));
    expect(resolveInsideWorkspace(ws, './sub/deep.txt')).toBe(join(ws, 'sub/deep.txt'));
  });

  it.each([
    '../outside.txt',
    '../../etc/passwd',
    'sub/../../outside.txt',
    '/etc/passwd',
    '/tmp/elsewhere',
  ])('拒絕逃出工作區的路徑：%s', (candidate) => {
    const ws = createJobWorkspace(root, 'job-a');
    expect(() => resolveInsideWorkspace(ws, candidate)).toThrow(WorkspaceError);
  });

  it('拒絕另一個 job 的工作區', () => {
    const a = createJobWorkspace(root, 'job-a');
    const b = createJobWorkspace(root, 'job-b');
    expect(() => resolveInsideWorkspace(a, join(b, 'x.txt'))).toThrow(WorkspaceError);
  });

  it('錯誤訊息不洩漏工作區以外的絕對路徑', () => {
    const ws = createJobWorkspace(root, 'job-a');
    try {
      resolveInsideWorkspace(ws, '/etc/passwd');
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).not.toContain('/etc/passwd');
    }
  });
});
