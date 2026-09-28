import { describe, expect, it } from 'vitest';
import { sanitizeBody } from '../src/templates/sanitize.js';
import type { TemplateManifest } from '../src/templates/types.js';

const manifest = {
  allowedTags: ['p', 'h3', 'ul', 'ol', 'li', 'a', 'strong', 'em', 'blockquote', 'figure', 'figcaption', 'img', 'br'],
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
    img: ['src', 'alt', 'width', 'height', 'class'],
    p: ['class'],
    h3: ['class'],
    figure: ['class'],
  },
  allowedClasses: {
    p: ['wp-block-paragraph', 'has-medium-font-size'],
    h3: ['wp-block-heading'],
    figure: ['wp-block-image', 'aligncenter'],
    img: ['wp-image-*'],
  },
  allowedSchemes: ['https', 'http', 'mailto'],
} as unknown as TemplateManifest;

const clean = (html: string) => sanitizeBody(html, manifest).html;

describe('危險內容一律移除', () => {
  it('拿掉 script', () => {
    expect(clean('<p>安全</p><script>alert(1)</script>')).toBe('<p>安全</p>');
  });

  it('拿掉 style 標籤與行內 style 屬性', () => {
    expect(clean('<style>body{display:none}</style><p style="color:red">字</p>')).toBe('<p>字</p>');
  });

  it('拿掉 iframe', () => {
    expect(clean('<iframe src="https://evil.com"></iframe><p>字</p>')).toBe('<p>字</p>');
  });

  it('拿掉事件屬性', () => {
    expect(clean('<p onclick="steal()" onmouseover="x()">字</p>')).toBe('<p>字</p>');
  });

  it('拿掉不在 allowlist 的標籤但保留文字', () => {
    expect(clean('<div><span>保留文字</span></div>')).toBe('保留文字');
  });

  it('擋掉 javascript: 連結', () => {
    // P5-T028 審查 F5：不收的連結整個拆掉、字留著（以前留一個沒有 href 的空殼 <a>）。
    expect(clean('<a href="javascript:alert(1)">點</a>')).toBe('點');
  });

  it('擋掉 data: 連結', () => {
    expect(clean('<a href="data:text/html,<script>x</script>">點</a>')).toBe('點');
  });

  it('保留允許的 scheme', () => {
    expect(clean('<a href="https://example.com">點</a>')).toBe('<a href="https://example.com">點</a>');
    expect(clean('<a href="mailto:a@b.com">信</a>')).toBe('<a href="mailto:a@b.com">信</a>');
  });
});

describe('class allowlist', () => {
  it('保留允許的 class', () => {
    expect(clean('<p class="wp-block-paragraph">字</p>')).toBe('<p class="wp-block-paragraph">字</p>');
  });

  it('移除未允許的 class', () => {
    expect(clean('<p class="wp-block-paragraph ph-hero evil">字</p>')).toBe(
      '<p class="wp-block-paragraph">字</p>',
    );
  });

  it('支援萬用字元 class', () => {
    expect(clean('<img src="https://e.com/a.png" alt="" class="wp-image-1234" />')).toContain(
      'class="wp-image-1234"',
    );
    expect(clean('<img src="https://e.com/a.png" alt="" class="evil-1234" />')).not.toContain('evil');
  });
});

describe('回報被移除了什麼', () => {
  it('列出被拿掉的標籤，讓後端可以拒絕 Agent 的輸出', () => {
    const result = sanitizeBody('<p>好</p><script>x</script><div>壞</div>', manifest);
    expect(result.changed).toBe(true);
    expect(result.removedTags).toEqual(expect.arrayContaining(['script', 'div']));
  });

  it('沒有任何改動時 changed 為 false', () => {
    const result = sanitizeBody('<p class="wp-block-paragraph">好</p>', manifest);
    expect(result.changed).toBe(false);
    expect(result.removedTags).toEqual([]);
  });
});

describe('b／i 轉成 strong／em，不是拆掉（P5-T028）', () => {
  it('allowlist 有 strong／em、沒有 b／i 時轉換', () => {
    expect(clean('<p>一<b>二</b><i>三</i></p>')).toBe('<p>一<strong>二</strong><em>三</em></p>');
  });

  it('轉換過的不算被移除', () => {
    const report = sanitizeBody('<p><b>二</b><u>底</u></p>', manifest);
    expect(report.removedTags).toEqual(['u']);
  });

  it('b 身上的屬性照 strong 的規則處理', () => {
    expect(clean('<p><b style="color:red" onclick="x()">二</b></p>')).toBe('<p><strong>二</strong></p>');
  });
});

describe('連結網址：渲染與編輯同一套規則（P5-T028 審查 F5）', () => {
  it('站內路徑與錨點保留', () => {
    expect(clean('<p><a href="/about">關於</a><a href="#s2">第二節</a></p>')).toBe('<p><a href="/about">關於</a><a href="#s2">第二節</a></p>');
  });

  it('其他相對路徑、協定相對、反斜線變形都拆掉，字留著，並回報', () => {
    for (const href of ['../post', 'post', './x', '?q=1', '//evil.test', '/\\evil.test', ' /\t/evil.test']) {
      const report = sanitizeBody(`<p><a href="${href}">字</a></p>`, manifest);
      expect(report.html, href).toBe('<p>字</p>');
      expect(report.removedAttributes, href).toContain('a.href');
    }
  });
});
