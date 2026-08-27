import { describe, expect, it } from 'vitest';
import { extractJsonPayload, parseAndValidate } from '../src/agents/output-parser.js';

const schema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  required: ['title'],
  properties: { title: { type: 'string', minLength: 1 } },
};

describe('extractJsonPayload：從各家 CLI 的包裝裡挖出資料', () => {
  it('直接就是 JSON 物件', () => {
    expect(extractJsonPayload('{"title":"甲"}')).toEqual({ title: '甲' });
  });

  it('Claude 的 --output-format json 包了一層 result', () => {
    const wrapped = JSON.stringify({ type: 'result', subtype: 'success', result: '{"title":"甲"}' });
    expect(extractJsonPayload(wrapped)).toEqual({ title: '甲' });
  });

  it('result 已經是物件而不是字串', () => {
    const wrapped = JSON.stringify({ type: 'result', result: { title: '甲' } });
    expect(extractJsonPayload(wrapped)).toEqual({ title: '甲' });
  });

  it('包在 markdown code fence 裡', () => {
    expect(extractJsonPayload('前言\n```json\n{"title":"甲"}\n```\n後記')).toEqual({ title: '甲' });
  });

  it('沒有語言標記的 code fence', () => {
    expect(extractJsonPayload('```\n{"title":"甲"}\n```')).toEqual({ title: '甲' });
  });

  it('前後有雜訊文字時撈出最外層的 JSON 物件', () => {
    expect(extractJsonPayload('好的，這是結果：{"title":"甲"} 希望有幫助')).toEqual({ title: '甲' });
  });

  it('JSONL 事件流取最後一個含 JSON 的訊息', () => {
    const jsonl = [
      JSON.stringify({ type: 'thinking', text: 'hmm' }),
      JSON.stringify({ type: 'item.completed', item: { text: '{"title":"甲"}' } }),
    ].join('\n');
    expect(extractJsonPayload(jsonl)).toEqual({ title: '甲' });
  });

  it('Antigravity 的 stream-json 包了兩層', () => {
    const jsonl = [
      JSON.stringify({ event: 'init', init: { cwd: '/tmp', tools: ['a', 'b'] } }),
      JSON.stringify({
        event: 'result',
        result: {
          conversation_id: 'abc',
          status: 'SUCCESS',
          response: '{"title":"甲"}',
          duration_seconds: 1.2,
          usage: { input_tokens: 10 },
        },
      }),
    ].join('\n');
    expect(extractJsonPayload(jsonl)).toEqual({ title: '甲' });
  });

  it('拆包有深度上限，不會無限往下鑽', () => {
    let nested: unknown = { title: '甲' };
    for (let i = 0; i < 12; i += 1) nested = { result: nested };
    // 拆不到底也不該當掉或回傳錯的東西
    expect(() => extractJsonPayload(JSON.stringify(nested))).not.toThrow();
  });

  it('完全沒有 JSON 就回 null', () => {
    expect(extractJsonPayload('我不知道怎麼做')).toBeNull();
    expect(extractJsonPayload('')).toBeNull();
  });

  it('壞掉的 JSON 回 null，不丟例外', () => {
    expect(extractJsonPayload('{"title":')).toBeNull();
  });
});

describe('parseAndValidate', () => {
  it('合格就回傳資料', () => {
    const r = parseAndValidate('{"title":"甲"}', schema, 'k1');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toEqual({ title: '甲' });
  });

  it('挖不出 JSON 時回報 invalid-json', () => {
    const r = parseAndValidate('我不知道', schema, 'k1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('invalid-json');
  });

  it('schema 不合時回報 schema-mismatch 與逐項說明', () => {
    const r = parseAndValidate('{"wrong":1}', schema, 'k1');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('schema-mismatch');
      expect(r.issues.length).toBeGreaterThan(0);
    }
  });

  it('多塞欄位會被擋下——Agent 不能偷加東西', () => {
    const r = parseAndValidate('{"title":"甲","injected":"x"}', schema, 'k1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('schema-mismatch');
  });
});
