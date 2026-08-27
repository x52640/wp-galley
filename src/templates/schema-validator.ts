// ajv 是 CommonJS 套件，在 ESM 下要用具名匯入才拿得到建構子；
// 預設匯入拿到的是模組命名空間，TypeScript 會判定不可 new。
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { ValidateFunction } from 'ajv';
import addFormatsModule from 'ajv-formats';
import type { FormatsPlugin } from 'ajv-formats';

/**
 * JSON Schema 驗證。
 *
 * 模板的 schema.json 用 draft 2020-12，所以要用 Ajv 的 2020 進入點——
 * 預設進入點只支援 draft-07。
 *
 * 獨立成一個模組的原因：階段 3 要用同一套機制驗證 Agent 的校稿輸出（計畫 §6.3），
 * 階段 6 的 MCP 工具也要驗證輸入參數。編譯過的 validator 有快取，
 * 不會每次渲染都重新編譯 schema。
 */

const ajv = new Ajv2020({ allErrors: true, strict: false });
// 執行時拿到的就是那個函式（CJS 的 module.exports），只有型別判定需要修正。
(addFormatsModule as unknown as FormatsPlugin)(ajv);

const cache = new Map<string, ValidateFunction>();

export interface SchemaValidationResult {
  readonly valid: boolean;
  /** 人看得懂的錯誤描述，格式為 `欄位路徑 訊息`。 */
  readonly issues: string[];
}

/**
 * 依 cacheKey 快取編譯結果。呼叫端應該傳入會隨 schema 內容改變的值
 * （例如模板 hash），schema 改了才會重新編譯。
 */
export function validateAgainstSchema(
  schema: Record<string, unknown>,
  cacheKey: string,
  data: unknown,
): SchemaValidationResult {
  let validate = cache.get(cacheKey);
  if (!validate) {
    validate = ajv.compile(schema);
    cache.set(cacheKey, validate);
  }

  if (validate(data)) return { valid: true, issues: [] };

  return {
    valid: false,
    issues: (validate.errors ?? []).map((err) => `${err.instancePath || '(root)'} ${err.message ?? ''}`.trim()),
  };
}

/** 測試用：清掉快取，避免不同測試之間互相影響。 */
export function clearSchemaCache(): void {
  cache.clear();
}
