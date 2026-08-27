import { describe, expect, it, beforeAll } from 'vitest';
import { buildPreviewDocument } from '../src/preview/document.js';
import { loadTemplateRegistry, type TemplateRegistry } from '../src/templates/registry.js';
import { renderRevision } from '../src/templates/render.js';
import { paths } from '../src/config/paths.js';

let registry: TemplateRegistry;

beforeAll(async () => {
  registry = await loadTemplateRegistry(paths.templates);
});

const data = {
  title: '20260522',
  body: '<p class="wp-block-paragraph">今天錄音一整天。</p>',
};

describe('本機預覽文件', () => {
  it('產出完整 HTML 文件，內含模板的 preview.css', () => {
    const template = registry.get('diary-v1');
    const rendered = renderRevision(template, data, { displayDate: '2026-05-22' });
    const doc = buildPreviewDocument(template, rendered);

    expect(doc).toMatch(/^<!doctype html>/i);
    expect(doc).toContain('今天錄音一整天');
    expect(doc).toContain('.preview-body');
    expect(doc).toContain('lang="zh-Hant"');
  });

  it('帶 CSP，即使正文夾帶東西也不會發出對外請求', () => {
    const template = registry.get('diary-v1');
    const doc = buildPreviewDocument(template, renderRevision(template, data));
    expect(doc).toContain('Content-Security-Policy');
    expect(doc).toContain("default-src 'none'");
  });

  it('不含 script', () => {
    const template = registry.get('diary-v1');
    const doc = buildPreviewDocument(template, renderRevision(template, data));
    expect(doc).not.toMatch(/<script/i);
  });

  it('模板的 preview.css 被跳脫，不能提前結束 style 區塊', () => {
    const template = {
      ...registry.get('diary-v1'),
      previewCss: 'body{}</style><script>alert(1)</script>',
    };
    const doc = buildPreviewDocument(template, renderRevision(registry.get('diary-v1'), data));
    expect(doc).not.toMatch(/<script/i);
  });

  it('同樣的輸入產出完全相同的文件', () => {
    const template = registry.get('longform-v1');
    const input = { title: '標題', body: '<p class="wp-block-paragraph">內文</p>' };
    const a = buildPreviewDocument(template, renderRevision(template, input, { displayDate: '2026-01-01' }));
    const b = buildPreviewDocument(template, renderRevision(template, input, { displayDate: '2026-01-01' }));
    expect(a).toBe(b);
  });
});
