import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
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

/**
 * 檔案裡引用到的所有模組路徑（import、export … from、import x = require、動態 import）。
 * 交給 TypeScript 自己的掃描器，不用 regex：同一行兩個敘述、前面有註解都抓得到。
 */
function moduleSpecifiers(source: string): string[] {
  return ts.preProcessFile(source, true, true).importedFiles.map((file) => file.fileName);
}

/** 規則：引用到的每一個模組都是同資料夾的 `./xxx.js`，而且不用 require。 */
function onlySameFolder(source: string): boolean {
  return moduleSpecifiers(source).every((specifier) => SAME_FOLDER.test(specifier)) && !/\brequire\s*\(/.test(source);
}

describe('共用契約', () => {
  const dir = join(import.meta.dirname, '..', 'src', 'contract');
  const files = readdirSync(dir).filter((name) => name.endsWith('.ts'));

  it('資料夾裡有東西', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('%s 只 import 同資料夾的檔', (name) => {
    const source = readFileSync(join(dir, name), 'utf8');
    for (const specifier of moduleSpecifiers(source)) expect(specifier).toMatch(SAME_FOLDER);
    expect(source).not.toMatch(/\brequire\s*\(/);
  });

  it('守門規則本身：外面的模組一律擋，同資料夾的放行', () => {
    // 放行
    expect(onlySameFolder("import type { Job } from './api-job.js';")).toBe(true);
    expect(onlySameFolder("export * from './api-job.js';")).toBe(true);
    expect(onlySameFolder("import type {\n  A,\n  B,\n} from './api-job.js';")).toBe(true);
    expect(onlySameFolder("export interface A { readonly from: string }")).toBe(true);
    // 擋：外面的模組
    expect(onlySameFolder("import { readFileSync } from 'node:fs';")).toBe(false);
    expect(onlySameFolder("import type { CoreService } from '../core/service.js';")).toBe(false);
    expect(onlySameFolder("export * from '../core/service.js';")).toBe(false);
    expect(onlySameFolder("import type {\n  A,\n} from '../core/service.js';")).toBe(false);
    expect(onlySameFolder("import './side-effect';")).toBe(false);
    expect(onlySameFolder("import 'node:fs';")).toBe(false);
    expect(onlySameFolder("import React from 'react';")).toBe(false);
    expect(onlySameFolder("import * as x from './sub/x.js';")).toBe(false);
    expect(onlySameFolder("const m = await import('node:fs');")).toBe(false);
    expect(onlySameFolder("import fs = require('node:fs');")).toBe(false);
    expect(onlySameFolder("const fs = require('node:fs');")).toBe(false);
    // 擋：同一行兩個敘述、前面有別的敘述或註解
    expect(onlySameFolder("import type { A } from './api-job.js'; import { readFileSync } from 'node:fs';")).toBe(false);
    expect(onlySameFolder("export type { A } from './api-job.js'; export * from 'node:fs';")).toBe(false);
    expect(onlySameFolder("const a = 1; export * from '../core/service.js';")).toBe(false);
    expect(onlySameFolder("/* x */ import { readFileSync } from 'node:fs';")).toBe(false);
    expect(onlySameFolder("/* x */ export * from '../core/service.js';")).toBe(false);
  });

  it('狀態機用的就是契約裡那一份狀態清單', () => {
    expect(coreStates).toBe(contractStates);
  });
});
