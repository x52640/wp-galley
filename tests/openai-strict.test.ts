import { describe, expect, it } from 'vitest';
import { toOpenAiStrictSchema, stripNulls } from '../src/agents/adapters/openai-strict.js';

describe('toOpenAiStrictSchema', () => {
  const schema = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    additionalProperties: false,
    required: ['title'],
    properties: {
      title: { type: 'string', minLength: 1, maxLength: 120 },
      slug: { type: 'string', pattern: '^[a-z]+$' },
      tags: { type: 'array', maxItems: 8, items: { type: 'string' } },
    },
  };

  it('required 會列出所有 property——OpenAI strict 的硬性要求', () => {
    const strict = toOpenAiStrictSchema(schema);
    expect(strict['required']).toEqual(['title', 'slug', 'tags']);
  });

  it('原本非必填的欄位改成 nullable', () => {
    const props = toOpenAiStrictSchema(schema)['properties'] as Record<string, { type: unknown }>;
    expect(props['slug']!.type).toEqual(['string', 'null']);
    expect(props['tags']!.type).toEqual(['array', 'null']);
  });

  it('原本必填的欄位不加 null', () => {
    const props = toOpenAiStrictSchema(schema)['properties'] as Record<string, { type: unknown }>;
    expect(props['title']!.type).toBe('string');
  });

  it('拿掉 OpenAI 不支援的關鍵字', () => {
    const dumped = JSON.stringify(toOpenAiStrictSchema(schema));
    for (const keyword of ['minLength', 'maxLength', 'pattern', 'maxItems', '$schema']) {
      expect(dumped).not.toContain(keyword);
    }
  });

  it('每一層物件都補上 additionalProperties: false', () => {
    const nested = toOpenAiStrictSchema({
      type: 'object',
      properties: { inner: { type: 'object', properties: { a: { type: 'string' } } } },
    });
    const inner = (nested['properties'] as Record<string, Record<string, unknown>>)['inner']!;
    expect(nested['additionalProperties']).toBe(false);
    expect(inner['additionalProperties']).toBe(false);
  });

  it('名稱剛好叫 pattern 的欄位不會被誤刪', () => {
    const strict = toOpenAiStrictSchema({
      type: 'object',
      required: ['pattern'],
      properties: { pattern: { type: 'string' }, format: { type: 'string' } },
    });
    expect(Object.keys(strict['properties'] as object)).toEqual(['pattern', 'format']);
  });
});

describe('stripNulls', () => {
  it('刪掉 null 欄位，語意回到「沒有這個欄位」', () => {
    expect(stripNulls({ title: '甲', slug: null, tags: null })).toEqual({ title: '甲' });
  });

  it('遞迴處理巢狀物件與陣列', () => {
    expect(stripNulls({ a: { b: null, c: 1 }, d: [{ e: null, f: 2 }] })).toEqual({
      a: { c: 1 },
      d: [{ f: 2 }],
    });
  });

  it('不動 false、0 與空字串', () => {
    expect(stripNulls({ a: false, b: 0, c: '' })).toEqual({ a: false, b: 0, c: '' });
  });
});
