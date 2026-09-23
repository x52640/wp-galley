import { describe, expect, it, beforeAll } from 'vitest';
import { buildReviewSchema, REVIEW_OUTPUT_SCHEMA } from '../src/agents/output-contract.js';
import { validateAgainstSchema } from '../src/templates/schema-validator.js';
import { loadTemplateRegistry, type TemplateRegistry } from '../src/templates/registry.js';
import { paths } from '../src/config/paths.js';

let registry: TemplateRegistry;

beforeAll(async () => {
  registry = await loadTemplateRegistry(paths.templates);
});

const valid = {
  title: '20260522',
  summary: '修了三個錯字',
  correctedSource: '內文',
  changes: [{ type: 'typo', before: '夭', after: '天', reason: '錯字', meaningChanged: false }],
  observations: [],
  templateData: { title: '20260522', body: '<p>內文</p>' },
  imageBriefs: [],
};

describe('buildReviewSchema', () => {
  it('把模板的 schema 嵌進 templateData', () => {
    const schema = buildReviewSchema(registry.get('diary-v1').schema);
    const templateData = (schema['properties'] as Record<string, Record<string, unknown>>)['templateData']!;
    expect(templateData['required']).toEqual(['title', 'body']);
    expect(templateData['additionalProperties']).toBe(false);
  });

  it('不會改到原本的 REVIEW_OUTPUT_SCHEMA', () => {
    const before = JSON.stringify(REVIEW_OUTPUT_SCHEMA);
    buildReviewSchema(registry.get('longform-v1').schema);
    expect(JSON.stringify(REVIEW_OUTPUT_SCHEMA)).toBe(before);
  });

  it('合格的校稿結果會通過', () => {
    const schema = buildReviewSchema(registry.get('diary-v1').schema);
    expect(validateAgainstSchema(schema, 'rv-1', valid).valid).toBe(true);
  });

  it('templateData 多塞欄位會被擋下', () => {
    const schema = buildReviewSchema(registry.get('diary-v1').schema);
    const bad = { ...valid, templateData: { ...valid.templateData, injected: 'x' } };
    expect(validateAgainstSchema(schema, 'rv-2', bad).valid).toBe(false);
  });

  it('changes 缺 meaningChanged 會被擋下——這個欄位攸關使用者判斷', () => {
    const schema = buildReviewSchema(registry.get('diary-v1').schema);
    const bad = { ...valid, changes: [{ type: 'typo', before: 'a', after: 'b', reason: 'c' }] };
    expect(validateAgainstSchema(schema, 'rv-3', bad).valid).toBe(false);
  });

  it('observations 是必填欄位，沒有就給空陣列', () => {
    const schema = buildReviewSchema(registry.get('diary-v1').schema);
    const { observations: _omitted, ...withoutObservations } = valid;
    expect(validateAgainstSchema(schema, 'rv-6', withoutObservations).valid).toBe(false);
  });

  it('observation 要能定位到某一段，blockIndex 不能少也不能是負的', () => {
    const schema = buildReviewSchema(registry.get('diary-v1').schema);
    const observation = {
      kind: 'contradiction',
      blockIndex: 2,
      excerpt: '1985 年',
      detail: '第 3 段寫 1985，第 7 段寫 1987',
      suggestion: '確認哪一個年份才對',
    };
    expect(validateAgainstSchema(schema, 'rv-7', { ...valid, observations: [observation] }).valid).toBe(true);
    expect(
      validateAgainstSchema(schema, 'rv-8', { ...valid, observations: [{ ...observation, blockIndex: -1 }] }).valid,
    ).toBe(false);
    const { blockIndex: _dropped, ...noIndex } = observation;
    expect(validateAgainstSchema(schema, 'rv-9', { ...valid, observations: [noIndex] }).valid).toBe(false);
  });

  it('observation 的 kind 只認得規格裡那四種', () => {
    const schema = buildReviewSchema(registry.get('diary-v1').schema);
    const bad = {
      kind: 'made-up-kind',
      blockIndex: 0,
      excerpt: 'x',
      detail: 'y',
      suggestion: 'z',
    };
    expect(validateAgainstSchema(schema, 'rv-10', { ...valid, observations: [bad] }).valid).toBe(false);
  });

  it('imageBrief 的 key 只能是小寫網址片段格式', () => {
    const schema = buildReviewSchema(registry.get('longform-v1').schema);
    const brief = { purpose: 'p', prompt: 'q', aspectRatio: '16:9', altText: 'a' };
    const base = { ...valid, templateData: { title: 't', body: '<p>x</p>' } };
    expect(validateAgainstSchema(schema, 'rv-4', { ...base, imageBriefs: [{ ...brief, key: 'hero_image' }] }).valid).toBe(true);
    expect(validateAgainstSchema(schema, 'rv-5', { ...base, imageBriefs: [{ ...brief, key: 'Hero Image!' }] }).valid).toBe(false);
  });
});
