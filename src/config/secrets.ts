/**
 * 秘密遮蔽工具。
 *
 * 計畫 §8.1：Application Password 不得出現在 browser bundle、React state、
 * HTML source、log 或 MCP output。這裡提供「最後一道防線」——把已知秘密的字面值
 * 從任何要輸出的字串或物件中抹掉，即使上游程式不小心把它塞進了訊息裡。
 */

export const REDACTED = '[REDACTED]';

/** 短於此長度的字串不當成秘密處理，避免把整份 log 洗成 [REDACTED]。 */
const MIN_SECRET_LENGTH = 6;

export type Scrubber = <T>(value: T) => T;

export function createSecretScrubber(secrets: readonly (string | null | undefined)[]): Scrubber {
  const active = [...new Set(secrets.filter((s): s is string => typeof s === 'string' && s.length >= MIN_SECRET_LENGTH))]
    // 長的先換，避免短秘密是長秘密子字串時換出殘骸。
    .sort((a, b) => b.length - a.length);

  const scrubString = (input: string): string => {
    let output = input;
    for (const secret of active) {
      if (output.includes(secret)) output = output.split(secret).join(REDACTED);
    }
    return output;
  };

  const walk = (value: unknown, depth: number): unknown => {
    if (depth > 8) return value;
    if (typeof value === 'string') return scrubString(value);
    if (Array.isArray(value)) return value.map((item) => walk(item, depth + 1));
    if (value instanceof Error) {
      const clone = new Error(scrubString(value.message));
      clone.name = value.name;
      if (value.stack) clone.stack = scrubString(value.stack);
      return clone;
    }
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value)) out[key] = walk(item, depth + 1);
      return out;
    }
    return value;
  };

  return (<T,>(value: T): T => (active.length === 0 ? value : (walk(value, 0) as T))) as Scrubber;
}
