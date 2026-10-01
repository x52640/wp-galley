/**
 * 抽文字與截斷（factcheck.md「抽文字」）。
 */
import { describe, expect, it } from 'vitest';
import { extractText, extractTextFromHtml, truncateSources } from '../src/fetch/extract-text.js';

describe('HTML → 純文字', () => {
  it('拿掉 script、style、nav、header、footer、aside、form', () => {
    const html = `<!doctype html><html><head><title>T</title><style>p{}</style></head><body>
      <header>站名</header><nav>選單</nav>
      <main><h1>標題</h1><p>第一段<script>alert(1)</script>文字。</p><style>.x{}</style><p>第二段</p></main>
      <aside>側欄</aside><form><input value="v">表單</form><footer>版權</footer>
      <noscript>請開 JS</noscript><template><p>模板</p></template><svg><text>圖</text></svg>
    </body></html>`;
    expect(extractTextFromHtml(html)).toBe('標題\n第一段文字。\n第二段');
  });

  it('摺疊空白、段落換行、實體解碼', () => {
    expect(extractTextFromHtml('<p>a   b\n\t c&nbsp;&amp;</p><div>d</div>x<br>y')).toBe('a b c &\nd\nx\ny');
  });

  it('壞掉的 HTML 也不丟例外', () => {
    expect(extractTextFromHtml('<p>沒關<div>的<b>標籤')).toBe('沒關\n的標籤');
  });

  it('text/plain 原樣（只統一換行、去頭尾空白）', () => {
    expect(extractText('  <p>不是 HTML</p>\r\n第二行 ', 'text/plain')).toBe('<p>不是 HTML</p>\n第二行');
  });
});

describe('截斷', () => {
  it('每份最多 12,000 字（以字元算，不切壞 emoji）', () => {
    const [a] = truncateSources(['😀'.repeat(13_000)]);
    expect(Array.from(a!)).toHaveLength(12_000);
    expect(a!.endsWith('😀')).toBe(true);
  });

  it('加起來超過 40,000 字時各份等比例截短', () => {
    const out = truncateSources(['a'.repeat(12_000), 'b'.repeat(12_000), 'c'.repeat(12_000), 'd'.repeat(12_000), 'e'.repeat(2_000)]);
    const total = out.reduce((n, t) => n + t.length, 0);
    expect(total).toBeLessThanOrEqual(40_000);
    expect(out[0]!.length).toBe(Math.floor(12_000 * (40_000 / 50_000)));
    expect(out[4]!.length).toBe(Math.floor(2_000 * (40_000 / 50_000)));
  });

  it('沒超過就不動', () => {
    expect(truncateSources(['abc', 'de'])).toEqual(['abc', 'de']);
  });
});
