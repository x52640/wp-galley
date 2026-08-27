import { describe, expect, it, beforeAll } from 'vitest';
import { loadTemplateRegistry, type TemplateRegistry } from '../src/templates/registry.js';
import { paths } from '../src/config/paths.js';

let registry: TemplateRegistry;

beforeAll(async () => {
  registry = await loadTemplateRegistry(paths.templates);
});

describe('模板 registry', () => {
  it('載入專案內的兩套模板', () => {
    expect(registry.list().map((t) => t.manifest.id).sort()).toEqual(['diary-v1', 'longform-v1']);
  });

  it('每套模板都有 manifest、schema、template.html、rules.md、preview.css', () => {
    for (const template of registry.list()) {
      expect(template.manifest.id).toBeTruthy();
      expect(template.schema).toBeTypeOf('object');
      expect(template.templateHtml.length).toBeGreaterThan(0);
      expect(template.rulesMarkdown.length).toBeGreaterThan(0);
      expect(template.previewCss.length).toBeGreaterThan(0);
    }
  });

  it('計算 SHA-256 hash，且同樣的檔案得到同樣的 hash', async () => {
    const again = await loadTemplateRegistry(paths.templates);
    for (const template of registry.list()) {
      const other = again.get(template.manifest.id);
      expect(template.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(other.hash).toBe(template.hash);
    }
  });

  it('不同模板的 hash 不同', () => {
    const [a, b] = registry.list();
    expect(a!.hash).not.toBe(b!.hash);
  });

  it('長文的嚴格度是 hybrid，日記是 flexible', () => {
    expect(registry.get('longform-v1').manifest.strictness).toBe('hybrid');
    expect(registry.get('diary-v1').manifest.strictness).toBe('flexible');
  });

  it('長文允許 h2 與 h3，不允許 h1 與 h4', () => {
    const m = registry.get('longform-v1').manifest;
    expect(m.allowedTags).toEqual(expect.arrayContaining(['h2', 'h3']));
    expect(m.allowedTags).not.toContain('h1');
    expect(m.allowedTags).not.toContain('h4');
    expect(m.structureRules.allowedHeadingLevels).toEqual([2, 3]);
  });

  it('取不存在的模板會丟出明確錯誤', () => {
    expect(() => registry.get('nope-v1')).toThrow(/nope-v1/);
  });

  it('publishSlot 必須是 schema 的必填欄位', () => {
    for (const template of registry.list()) {
      expect(template.manifest.requiredSlots).toContain(template.manifest.publishSlot);
      expect(template.schema.required).toContain(template.manifest.publishSlot);
    }
  });
});
