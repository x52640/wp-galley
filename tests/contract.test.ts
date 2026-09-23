import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { JOB_STATES as contractStates } from '../src/contract/api.js';
import { JOB_STATES as coreStates } from '../src/core/state-machine.js';

/**
 * 共用契約（src/contract/）前後端都會 import。它只要 import 任何東西，就可能把
 * 後端（node:*、Fastify、src/core）拖進瀏覽器 bundle，或讓依賴方向繞一圈回來。
 * 型別檢查抓不到這件事，所以用測試守著。
 */
describe('共用契約', () => {
  const dir = join(import.meta.dirname, '..', 'src', 'contract');
  const files = readdirSync(dir).filter((name) => name.endsWith('.ts'));

  it('資料夾裡有東西', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('%s 不 import 任何模組', (name) => {
    const source = readFileSync(join(dir, name), 'utf8');
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/^\s*export\s+[^;]*\sfrom\s+['"]/m);
    expect(source).not.toMatch(/\brequire\(/);
  });

  it('狀態機用的就是契約裡那一份狀態清單', () => {
    expect(coreStates).toBe(contractStates);
  });
});
