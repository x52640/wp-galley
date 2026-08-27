/**
 * OpenAI 結構化輸出（strict mode）的 schema 轉換。
 *
 * Codex 的 `--output-schema` 最終會變成 OpenAI 的 `response_format`，那邊的
 * 規則比一般 JSON Schema 嚴格得多。實測踩到的三條：
 *
 * 1. 每一層物件都必須明寫 `additionalProperties: false`
 *      → `'additionalProperties' is required to be supplied and to be false`
 * 2. `required` 必須列出 `properties` 的**每一個** key
 *      → `'required' ... to be an array including every key in properties. Missing 'slug'`
 * 3. 不支援 `minLength` / `maxLength` / `pattern` 之類的字串與陣列約束
 *
 * 所以「選填欄位」在那邊只能表達成「必填但可以是 null」。
 *
 * 這是 Codex 專屬的問題——Claude 與 Antigravity 直接吃原本的 schema。
 * 因此這個轉換放在 adapters/ 底下，不會污染共用的 output-contract。
 *
 * ⚠️ 這裡放寬的只是「送給模型端的提示」。後端收到結果後仍然用**原始的**
 * schema 再驗一次，約束一個都沒少（計畫 §4.1）。
 */

/** OpenAI strict mode 不支援、送過去會整份被拒的關鍵字。 */
const UNSUPPORTED_KEYWORDS = new Set([
  'minLength',
  'maxLength',
  'pattern',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'minItems',
  'maxItems',
  'uniqueItems',
  'format',
  'default',
  '$schema',
  '$id',
]);

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 把型別加上 null，表示「這個欄位可以留空」。 */
function makeNullable(schema: Json): Json {
  const type = schema['type'];
  if (typeof type === 'string' && type !== 'null') {
    return { ...schema, type: [type, 'null'] };
  }
  if (Array.isArray(type) && !type.includes('null')) {
    return { ...schema, type: [...type, 'null'] };
  }
  return schema;
}

export function toOpenAiStrictSchema(schema: Json): Json {
  return convert(schema) as Json;
}

function convert(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(convert);
  if (!isObject(node)) return node;

  const out: Json = {};
  for (const [key, value] of Object.entries(node)) {
    if (UNSUPPORTED_KEYWORDS.has(key)) continue;
    // `properties` 底下的 key 是欄位名稱不是 schema 關鍵字，不能套關鍵字過濾——
    // 否則名為 `pattern` 或 `format` 的欄位會被誤刪。
    out[key] = key === 'properties' && isObject(value) ? convertPropertyMap(value) : convert(value);
  }

  if (isObject(out['properties'])) {
    const keys = Object.keys(out['properties']);
    const alreadyRequired = new Set(Array.isArray(out['required']) ? (out['required'] as string[]) : []);

    // 原本非必填的欄位改成 nullable，再全部列進 required。
    const properties = out['properties'] as Json;
    for (const key of keys) {
      if (!alreadyRequired.has(key) && isObject(properties[key])) {
        properties[key] = makeNullable(properties[key]);
      }
    }

    out['required'] = keys;
    out['additionalProperties'] = false;
  }

  return out;
}

function convertPropertyMap(properties: Json): Json {
  return Object.fromEntries(Object.entries(properties).map(([name, sub]) => [name, convert(sub)]));
}

/**
 * 把 strict mode 回傳的 null 拿掉。
 *
 * 模型會照著 nullable 的宣告，對沒填的選填欄位回 `null`。但原始 schema 裡
 * 那些欄位不接受 null（例如 `slug` 是 string 且有 pattern），直接拿去驗會失敗。
 * 送進後端驗證之前先把 null 欄位刪掉，語意就回到「沒有這個欄位」。
 */
export function stripNulls<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => stripNulls(item)) as unknown as T;
  if (!isObject(value)) return value;

  const out: Json = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === null) continue;
    out[key] = stripNulls(item);
  }
  return out as unknown as T;
}
