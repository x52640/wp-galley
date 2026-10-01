/**
 * 抽文字與截斷（factcheck.md「抽文字」）。
 */
import { describe, expect, it } from 'vitest';
import { extractTextIsolated } from '../src/fetch/extract-runner.js';
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

describe('在 worker 裡抽文字（深層巢狀不卡後端）', () => {
  it('正常網頁照常抽出', async () => {
    expect(await extractTextIsolated('<p>你好</p><script>x</script>', 'text/html', 10_000)).toEqual({ ok: true, text: '你好' });
  });

  it('深層 <div>（2 MB 內、parse5 要跑很久）：時間上限內回 too-complex，主執行緒的計時器照常觸發', async () => {
    const html = '<div>'.repeat(400_000);
    const started = Date.now();
    const fired: number[] = [];
    const timers = [100, 300, 600].map((ms) => setTimeout(() => fired.push(Date.now() - started), ms));
    const out = await extractTextIsolated(html, 'text/html', 1_000);
    const elapsed = Date.now() - started;
    timers.forEach(clearTimeout);
    expect(out).toEqual({ ok: false, code: 'too-complex' });
    expect(elapsed).toBeLessThan(3_000);
    // 事件迴圈沒被卡住：三個計時器都在抽文字期間觸發，且延遲不大
    expect(fired).toHaveLength(3);
    fired.forEach((at, i) => expect(at).toBeLessThan([100, 300, 600][i]! + 250));
  }, 10_000);

  it('深層 <span>（6 萬字，會讓遞迴爆 stack）：不丟例外', async () => {
    const html = `${'<span>'.repeat(10_000)}深處`;
    expect(extractTextFromHtml(html)).toBe('深處');
    expect(await extractTextIsolated(html, 'text/html', 10_000)).toEqual({ ok: true, text: '深處' });
  });

  it('text/plain 不開 worker，直接處理', async () => {
    expect(await extractTextIsolated(' a ', 'text/plain', 1)).toEqual({ ok: true, text: 'a' });
  });
});
