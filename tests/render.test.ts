import { describe, expect, it, beforeAll } from 'vitest';
import { loadTemplateRegistry, type TemplateRegistry } from '../src/templates/registry.js';
import { renderRevision, RenderError } from '../src/templates/render.js';
import { paths } from '../src/config/paths.js';

let registry: TemplateRegistry;

const longformData = {
  title: '權利、權力、特權',
  slug: 'right_power',
  body: '<p class="wp-block-paragraph">第一段。</p><h3 class="wp-block-heading"><strong>小標</strong></h3><p class="wp-block-paragraph">第二段。</p>',
  tags: ['思考'],
};

const diaryData = {
  title: '20260522',
  slug: '20260522',
  body: '<p class="wp-block-paragraph">今天錄音一整天。</p>',
};

const ctx = { displayDate: '2026-05-22' };

beforeAll(async () => {
  registry = await loadTemplateRegistry(paths.templates);
});

describe('決定性渲染', () => {
  it('同樣的資料與模板產出完全相同的 HTML 與 hash', () => {
    const a = renderRevision(registry.get('longform-v1'), longformData, ctx);
    const b = renderRevision(registry.get('longform-v1'), longformData, ctx);
    expect(a.publishHtml).toBe(b.publishHtml);
    expect(a.previewHtml).toBe(b.previewHtml);
    expect(a.contentHash).toBe(b.contentHash);
  });

  it('內容改一個字，hash 就變', () => {
    const a = renderRevision(registry.get('longform-v1'), longformData, ctx);
    const b = renderRevision(
      registry.get('longform-v1'),
      { ...longformData, body: longformData.body.replace('第一段', '第一叚') },
      ctx,
    );
    expect(a.contentHash).not.toBe(b.contentHash);
  });

  it('hash 綁定模板 hash：換模板就算內容一樣也不同', () => {
    const a = renderRevision(registry.get('longform-v1'), { title: 'x', body: '<p>y</p>' }, ctx);
    const b = renderRevision(registry.get('diary-v1'), { title: 'x', body: '<p>y</p>' }, ctx);
    expect(a.contentHash).not.toBe(b.contentHash);
  });
});

describe('只有 publishSlot 會被發布', () => {
  it('publishHtml 不含預覽外框', () => {
    const r = renderRevision(registry.get('longform-v1'), longformData, ctx);
    expect(r.publishHtml).not.toContain('preview-');
    expect(r.publishHtml).not.toContain(longformData.title);
    expect(r.publishHtml).toContain('第一段');
  });

  it('previewHtml 含外框也含正文', () => {
    const r = renderRevision(registry.get('longform-v1'), longformData, ctx);
    expect(r.previewHtml).toContain('preview-frame');
    expect(r.previewHtml).toContain(longformData.title);
    expect(r.previewHtml).toContain('第一段');
  });

  it('標題等欄位在預覽中被 HTML escape，不會變成標籤', () => {
    const r = renderRevision(
      registry.get('diary-v1'),
      { ...diaryData, title: '<img src=x onerror=alert(1)>' },
      ctx,
    );
    expect(r.previewHtml).not.toContain('<img src=x');
    expect(r.previewHtml).toContain('&lt;img');
  });
});

describe('schema 驗證', () => {
  it('缺少必填欄位就拒絕', () => {
    expect(() => renderRevision(registry.get('longform-v1'), { title: '只有標題' }, ctx)).toThrow(RenderError);
  });

  it('多出 schema 沒定義的欄位就拒絕，Agent 不能偷塞東西', () => {
    expect(() =>
      renderRevision(registry.get('longform-v1'), { ...longformData, injected: '<script>x</script>' }, ctx),
    ).toThrow(RenderError);
  });

  it('slug 格式不合就拒絕', () => {
    expect(() => renderRevision(registry.get('longform-v1'), { ...longformData, slug: 'Bad Slug!' }, ctx)).toThrow(
      RenderError,
    );
  });

  it('錯誤訊息說得出是哪個欄位', () => {
    try {
      renderRevision(registry.get('longform-v1'), { title: '只有標題' }, ctx);
      expect.unreachable();
    } catch (error) {
      expect((error as RenderError).issues.join(' ')).toMatch(/body/);
    }
  });
});

describe('正文清理', () => {
  it('危險標籤被移除，並回報給呼叫端', () => {
    const r = renderRevision(
      registry.get('diary-v1'),
      { ...diaryData, body: '<p>好</p><script>alert(1)</script>' },
      ctx,
    );
    expect(r.publishHtml).not.toContain('script');
    expect(r.sanitizeReport.changed).toBe(true);
    expect(r.sanitizeReport.removedTags).toContain('script');
  });

  it('清理後正文變空就拒絕，不發布空文章', () => {
    expect(() =>
      renderRevision(registry.get('diary-v1'), { ...diaryData, body: '<script>alert(1)</script>' }, ctx),
    ).toThrow(RenderError);
  });
});

describe('hybrid 的結構規則（長文）', () => {
  it('允許 h2 與 h3', () => {
    const r = renderRevision(
      registry.get('longform-v1'),
      { ...longformData, body: '<h2 class="wp-block-heading">章</h2><h3>節</h3><p>字</p>' },
      ctx,
    );
    expect(r.publishHtml).toContain('<h2');
    expect(r.publishHtml).toContain('<h3');
  });

  it('用了 h4 就拒絕', () => {
    expect(() =>
      renderRevision(registry.get('longform-v1'), { ...longformData, body: '<h4>太細</h4><p>字</p>' }, ctx),
    ).toThrow(/h4|標題/);
  });

  it('允許 hr 當分隔線', () => {
    const r = renderRevision(
      registry.get('longform-v1'),
      { ...longformData, body: '<p>上</p><hr class="wp-block-separator" /><p>下</p>' },
      ctx,
    );
    expect(r.publishHtml).toContain('<hr');
  });

  it('日記是 flexible，不套結構規則', () => {
    const r = renderRevision(
      registry.get('diary-v1'),
      { ...diaryData, body: '<h3 class="wp-block-heading">可以</h3><p>字</p>' },
      ctx,
    );
    expect(r.publishHtml).toContain('h3');
  });
});
