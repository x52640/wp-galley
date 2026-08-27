import { validateAgainstSchema } from '../templates/schema-validator.js';
import type { AgentFailureReason } from './types.js';

/**
 * Agent 輸出解析。
 *
 * 三家 CLI 就算都吃 `--json-schema`，外層包裝仍然各不相同：
 * Claude 包成 `{type:"result", result:"<JSON 字串>"}`，Codex 是 JSONL 事件流，
 * Antigravity 又是另一種。這個模組負責把各種包裝拆開，拿到裡面那個物件。
 *
 * 拆解順序由嚴格到寬鬆，能用嚴格的就不退讓——避免從思考過程裡誤抓到 JSON。
 */

type Json = Record<string, unknown>;

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 各家 CLI 用來包裝真正結果的鍵名。 */
const WRAPPER_KEYS = ['result', 'output', 'response', 'content', 'text'] as const;

/**
 * 從 `{result: ...}` 這類包裝裡取出裡層資料。
 *
 * 必須遞迴：Antigravity 是包兩層的
 *   {"event":"result","result":{...,"response":"<真正的 JSON 字串>"}}
 * 拆一層只會拿到帶著 conversation_id、status、usage 的中介物件。
 *
 * 字串優先於物件：`response: "<JSON>"` 幾乎一定是最終結果，而物件型的
 * 中介層（例如 `result`）還要再往下找。
 */
function unwrapResult(value: unknown, depth = 0): unknown {
  if (depth >= 5 || !isObject(value)) return value;

  for (const key of WRAPPER_KEYS) {
    const inner = value[key];
    if (typeof inner === 'string') {
      const parsed = tryParse(inner);
      if (isObject(parsed)) return unwrapResult(parsed, depth + 1);
    }
  }
  for (const key of WRAPPER_KEYS) {
    const inner = value[key];
    if (isObject(inner)) return unwrapResult(inner, depth + 1);
  }
  return value;
}

/** 從 markdown code fence 裡取出內容。 */
function fromCodeFence(text: string): unknown {
  const match = /```(?:json)?\s*\n([\s\S]*?)\n?```/.exec(text);
  if (!match) return undefined;
  const parsed = tryParse(match[1]!.trim());
  return isObject(parsed) ? parsed : undefined;
}

/** 掃描出第一個成對的 `{...}`，處理前後有雜訊文字的情況。 */
function fromBraceScan(text: string): unknown {
  const start = text.indexOf('{');
  if (start === -1) return undefined;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i += 1) {
    const ch = text[i]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        const parsed = tryParse(text.slice(start, i + 1));
        return isObject(parsed) ? parsed : undefined;
      }
    }
  }
  return undefined;
}

/** JSONL 事件流：由後往前找第一個能挖出物件的事件。 */
function fromJsonLines(text: string): unknown {
  const lines = text.split('\n').filter((line) => line.trim().startsWith('{'));
  if (lines.length < 2) return undefined;

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const event = tryParse(lines[i]!);
    if (!isObject(event)) continue;

    // 事件本身可能就帶著結果，也可能包在 item / message 裡。
    for (const candidate of [event, event['item'], event['message']]) {
      const unwrapped = unwrapResult(candidate);
      if (isObject(unwrapped) && unwrapped !== event) return unwrapped;
    }
  }
  return undefined;
}

/**
 * 從 CLI 的原始 stdout 挖出結構化資料。挖不到就回 null。
 */
export function extractJsonPayload(raw: string): Json | null {
  const text = raw.trim();
  if (text.length === 0) return null;

  const direct = tryParse(text);
  if (isObject(direct)) {
    const unwrapped = unwrapResult(direct);
    return isObject(unwrapped) ? unwrapped : direct;
  }

  for (const strategy of [fromJsonLines, fromCodeFence, fromBraceScan]) {
    const found = strategy(text);
    if (isObject(found)) {
      const unwrapped = unwrapResult(found);
      return isObject(unwrapped) ? unwrapped : found;
    }
  }

  return null;
}

export type ParseResult =
  | { readonly ok: true; readonly data: Json }
  | { readonly ok: false; readonly reason: AgentFailureReason; readonly message: string; readonly issues: string[] };

/**
 * 挖出資料並用 schema 驗證。
 *
 * 這是計畫 §6.3 的守門：輸出不是合法 JSON、schema 不合格或漏欄位，
 * 一律拒絕該結果，讓呼叫端重試——絕不讓半成品污染草稿。
 *
 * `transform` 讓各 adapter 在驗證前修正自家 CLI 的怪癖（例如 Antigravity 會
 * 多塞 toolAction 欄位、Codex 的 strict mode 會把選填欄位填成 null）。
 * 它只能刪改已知的雜訊，**不能放寬 schema**——驗證仍然照原樣跑。
 */
export function parseAndValidate(
  raw: string,
  schema: Record<string, unknown>,
  cacheKey: string,
  transform?: (payload: Json) => Json,
): ParseResult {
  const extracted = extractJsonPayload(raw);
  const payload = extracted && transform ? transform(extracted) : extracted;
  if (!payload) {
    return {
      ok: false,
      reason: 'invalid-json',
      message: 'Agent 的輸出裡找不到合法的 JSON 物件',
      issues: [],
    };
  }

  const validation = validateAgainstSchema(schema, cacheKey, payload);
  if (!validation.valid) {
    return {
      ok: false,
      reason: 'schema-mismatch',
      message: 'Agent 的輸出不符合約定的格式',
      issues: validation.issues,
    };
  }

  return { ok: true, data: payload };
}
