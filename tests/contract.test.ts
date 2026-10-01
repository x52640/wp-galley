import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { JOB_STATES as contractStates } from '../src/contract/api.js';
import { JOB_STATES as coreStates } from '../src/core/state-machine.js';

/**
 * 共用契約（src/contract/）前後端都會 import。它只要 import 外面的東西，就可能把
 * 後端（node:*、Fastify、src/core）拖進瀏覽器 bundle，或讓依賴方向繞一圈回來。
 * 型別檢查抓不到這件事，所以用測試守著。
 *
 * 唯一的例外是同資料夾的相對路徑（`./xxx.js`）：api.ts 拆成 api-*.ts 之後（P5-T004），
 * 各檔要互相引用型別、api.ts 要全部轉出。同資料夾裡的檔也受這條規則管，所以繞不出去。
 */
const SAME_FOLDER = /^\.\/[\w.-]+\.js$/;

/** 檔案裡所有 import／export … from 的模組路徑；另外回報 import 敘述的總數，對不上就代表有沒抓到的寫法。 */
function moduleSpecifiers(source: string): { specifiers: string[]; importStatements: number; matchedImports: number } {
  const specifiers: string[] = [];
  let matchedImports = 0;
  for (const match of source.matchAll(/^\s*(import|export)\b[^;'"]*?\bfrom\s+['"]([^'"]+)['"]/gm)) {
    specifiers.push(match[2]!);
    if (match[1] === 'import') matchedImports += 1;
  }
  for (const match of source.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)) {
    specifiers.push(match[1]!);
    matchedImports += 1;
  }
  const importStatements = source.match(/^\s*import\s/gm)?.length ?? 0;
  return { specifiers, importStatements, matchedImports };
}

describe('共用契約', () => {
  const dir = join(import.meta.dirname, '..', 'src', 'contract');
  const files = readdirSync(dir).filter((name) => name.endsWith('.ts'));

  it('資料夾裡有東西', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('%s 只 import 同資料夾的檔', (name) => {
    const source = readFileSync(join(dir, name), 'utf8');
    const { specifiers, importStatements, matchedImports } = moduleSpecifiers(source);
    for (const specifier of specifiers) expect(specifier).toMatch(SAME_FOLDER);
    expect(matchedImports).toBe(importStatements);
    expect(source).not.toMatch(/\bimport\s*\(/);
    expect(source).not.toMatch(/\brequire\(/);
  });

  it('守門規則本身：外面的模組一律擋，同資料夾的放行', () => {
    const check = (source: string) => {
      const { specifiers, importStatements, matchedImports } = moduleSpecifiers(source);
      return matchedImports === importStatements && specifiers.every((specifier) => SAME_FOLDER.test(specifier));
    };
    expect(check("import type { Job } from './api-job.js';")).toBe(true);
    expect(check("export * from './api-job.js';")).toBe(true);
    expect(check("import type {\n  A,\n  B,\n} from './api-job.js';")).toBe(true);
    expect(check("import { readFileSync } from 'node:fs';")).toBe(false);
    expect(check("import type { CoreService } from '../core/service.js';")).toBe(false);
    expect(check("export * from '../core/service.js';")).toBe(false);
    expect(check("import './side-effect';")).toBe(false);
    expect(check("import 'node:fs';")).toBe(false);
    expect(check("import React from 'react';")).toBe(false);
    expect(check("import * as x from './sub/x.js';")).toBe(false);
  });

  it('狀態機用的就是契約裡那一份狀態清單', () => {
    expect(coreStates).toBe(contractStates);
  });
});
