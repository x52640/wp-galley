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
const SAME_FOLDER = /^\.\/([\w.-]+)\.js$/;

/**
 * 檢查一個 contract 檔，回傳違規清單（空的就是合格）。用 TypeScript 解析成 AST 再走過每個節點，
 * 不用 regex：同一行兩個敘述、前面有註解、字串或註解裡剛好寫了 require 都不會判錯。
 *
 * - import／export … from／`import('x')` 型別：路徑必須是字面值 `./x.js`，而且資料夾裡真的有 `x.ts`
 *   （不然 `./x.js` 可能解析到別的副檔名的檔，繞過這個測試）。
 * - 動態 `import(...)`：參數必須是字面值字串且符合上一條；變數、模板字串一律擋。
 * - `require(...)`、`import x = require(...)`：一律擋。
 */
function contractViolations(source: string, tsFiles: ReadonlySet<string>): string[] {
  const violations: string[] = [];
  const checkSpecifier = (node: ts.Node | undefined, what: string) => {
    if (!node || !ts.isStringLiteral(node)) {
      violations.push(`${what}：路徑不是字面值字串`);
      return;
    }
    const match = SAME_FOLDER.exec(node.text);
    if (!match) violations.push(`${what}：${node.text} 不是同資料夾的 ./xxx.js`);
    else if (!tsFiles.has(`${match[1]}.ts`)) violations.push(`${what}：${node.text} 在資料夾裡找不到對應的 .ts`);
  };
  const sourceFile = ts.createSourceFile('contract.ts', source, ts.ScriptTarget.Latest, true);
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) checkSpecifier(node.moduleSpecifier, 'import');
    else if (ts.isExportDeclaration(node) && node.moduleSpecifier) checkSpecifier(node.moduleSpecifier, 'export from');
    else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      violations.push('import = require');
    } else if (ts.isImportTypeNode(node)) {
      const argument = node.argument;
      checkSpecifier(ts.isLiteralTypeNode(argument) ? argument.literal : undefined, 'import() 型別');
    } else if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        checkSpecifier(node.arguments.length === 1 ? node.arguments[0] : undefined, '動態 import');
      } else if (ts.isIdentifier(node.expression) && node.expression.text === 'require') {
        violations.push('require()');
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return violations;
}

describe('共用契約', () => {
  const dir = join(import.meta.dirname, '..', 'src', 'contract');
  const entries = readdirSync(dir);
  const files = entries.filter((name) => name.endsWith('.ts'));
  const tsFiles = new Set(files);

  it('資料夾裡有東西', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('資料夾裡只有 .ts 檔（別的副檔名可能被 ./x.js 解析到，這個測試就掃不到）', () => {
    expect(entries.filter((name) => !name.endsWith('.ts'))).toEqual([]);
  });

  it.each(files)('%s 只 import 同資料夾的檔', (name) => {
    expect(contractViolations(readFileSync(join(dir, name), 'utf8'), tsFiles)).toEqual([]);
  });

  it('守門規則本身：外面的模組一律擋，同資料夾的放行', () => {
    const known = new Set(['api-job.ts', 'api.ts']);
    const ok = (source: string) => contractViolations(source, known).length === 0;
    // 放行
    expect(ok("import type { Job } from './api-job.js';")).toBe(true);
    expect(ok("export * from './api-job.js';")).toBe(true);
    expect(ok("import type {\n  A,\n  B,\n} from './api-job.js';")).toBe(true);
    expect(ok('export interface A { readonly from: string }')).toBe(true);
    expect(ok("const m = await import('./api-job.js');")).toBe(true);
    expect(ok("// 不要用 require('node:fs')\nexport const a = 1;")).toBe(true);
    expect(ok("/* require('x') */ export const a = 1;")).toBe(true);
    expect(ok("export const hint = \"require('node:fs') 不准用\";")).toBe(true);
    // 擋：外面的模組
    expect(ok("import { readFileSync } from 'node:fs';")).toBe(false);
    expect(ok("import type { CoreService } from '../core/service.js';")).toBe(false);
    expect(ok("export * from '../core/service.js';")).toBe(false);
    expect(ok("import type {\n  A,\n} from '../core/service.js';")).toBe(false);
    expect(ok("import './side-effect';")).toBe(false);
    expect(ok("import 'node:fs';")).toBe(false);
    expect(ok("import React from 'react';")).toBe(false);
    expect(ok("import * as x from './sub/x.js';")).toBe(false);
    expect(ok("export type T = import('../core/service.js').CoreService;")).toBe(false);
    // 擋：./x.js 對不到資料夾裡的 x.ts（例如其實是 bridge.tsx）
    expect(ok("import { a } from './bridge.js';")).toBe(false);
    expect(ok("export * from './bridge.js';")).toBe(false);
    // 擋：動態 import
    expect(ok("const m = await import('node:fs');")).toBe(false);
    expect(ok("const p = '../core/service.js'; const m = await import(p);")).toBe(false);
    expect(ok('const m = await import(`../core/${name}.js`);')).toBe(false);
    expect(ok('const m = await import(`./api-job.js`);')).toBe(false);
    // 擋：require
    expect(ok("import fs = require('node:fs');")).toBe(false);
    expect(ok("const fs = require('node:fs');")).toBe(false);
    // 擋：同一行兩個敘述、前面有別的敘述或註解
    expect(ok("import type { A } from './api-job.js'; import { readFileSync } from 'node:fs';")).toBe(false);
    expect(ok("export type { A } from './api-job.js'; export * from 'node:fs';")).toBe(false);
    expect(ok("const a = 1; export * from '../core/service.js';")).toBe(false);
    expect(ok("/* x */ import { readFileSync } from 'node:fs';")).toBe(false);
    expect(ok("/* x */ export * from '../core/service.js';")).toBe(false);
  });

  it('狀態機用的就是契約裡那一份狀態清單', () => {
    expect(coreStates).toBe(contractStates);
  });
});
