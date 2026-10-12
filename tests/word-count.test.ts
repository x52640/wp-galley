import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { countBodyWords, countWords, countableText } from '../src/contract/word-count.js';
import { createThrottle, formatWordCount } from '../src/ui/lib/word-count.js';

/**
 * P5-T047（D-045）：字數。
 * 中文（含日文假名、韓文）一字算 1；英文／數字一個詞算 1（GPT-5、don't、3.14 算一個詞）；
 * 標點、空白、符號、emoji 不算。只算正文的段落、小標、清單、引用；圖片 alt、圖說不算。
 */

describe('countWords：一段純文字有幾個字', () => {
  it('空字串與只有空白是 0', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('   \n\t　 ')).toBe(0);
  });

  it('純中文一字算 1', () => {
    expect(countWords('今天天氣很好')).toBe(6);
    expect(countWords('繁體中文與简体中文')).toBe(9);
  });

  it('日文假名、韓文也一字算 1', () => {
    expect(countWords('ひらがな')).toBe(4);
    expect(countWords('カタカナ')).toBe(4);
    expect(countWords('ラーメン')).toBe(4); // 長音符號算在假名裡
    expect(countWords('한국어')).toBe(3);
    expect(countWords('人々')).toBe(2);
  });

  it('純英文一個詞算 1', () => {
    expect(countWords('Hello world')).toBe(2);
    expect(countWords('The quick brown fox jumps.')).toBe(5);
  });

  it('連在一起的算一個詞：GPT-5、don\'t、3.14、1,000', () => {
    expect(countWords('GPT-5')).toBe(1);
    expect(countWords("don't")).toBe(1);
    expect(countWords('don’t')).toBe(1);
    expect(countWords('3.14')).toBe(1);
    expect(countWords('1,000')).toBe(1);
    expect(countWords('state-of-the-art')).toBe(1);
  });

  it('日期與時間：數字之間的 / 與 : 不切開（日記常見）', () => {
    expect(countWords('2026/10/12')).toBe(1);
    expect(countWords('10:30')).toBe(1);
    expect(countWords('2026/10/12 10:30 出門')).toBe(4);
    expect(countWords('and/or')).toBe(2);
    expect(countWords('note:that')).toBe(2);
    expect(countWords('時間：10:30')).toBe(3);
  });

  it('全形連接符號：－ ． 跟半形一樣，， 只接數字', () => {
    expect(countWords('ＧＰＴ－５')).toBe(1);
    expect(countWords('３．１４')).toBe(1);
    expect(countWords('１，０００')).toBe(1);
    expect(countWords('ａ，ｂ')).toBe(2);
  });

  it('詞尾的標點不黏進詞，也不自己算一個', () => {
    expect(countWords('Hi, there.')).toBe(2);
    expect(countWords("'quoted'")).toBe(1);
    expect(countWords('a - b')).toBe(2);
    expect(countWords('end.')).toBe(1);
  });

  it('中英數混排：中文逐字、英數逐詞', () => {
    // 我 用 寫 了 篇 文 章（7）＋ GPT-5（1）＋ 3（1）
    expect(countWords('我用GPT-5寫了3篇文章')).toBe(9);
    expect(countWords('第3章 Chapter 3')).toBe(5);
    expect(countWords('iPhone 17很好用')).toBe(5);
  });

  it('標點與全形符號不算', () => {
    expect(countWords('，。！？、；：「」『』（）《》〈〉…—～')).toBe(0);
    expect(countWords('!?.,;:"\'()[]{}<>-_/\\|@#$%^&*+=~`')).toBe(0);
    expect(countWords('你好，世界！')).toBe(4);
    expect(countWords('ＡＢＣ　１２３')).toBe(2); // 全形英數照樣是詞
  });

  it('emoji 不算', () => {
    expect(countWords('😀👍🏽❤️🇹🇼👨‍👩‍👧')).toBe(0);
    expect(countWords('好吃😋')).toBe(2);
    expect(countWords('great👍job')).toBe(2);
  });

  it('已知殘餘（known-issues）：注音連在一起算一個詞、數字鍵帽 emoji 連在一起算一個詞', () => {
    expect(countWords('ㄏㄏㄏ')).toBe(1);
    expect(countWords('1️⃣2️⃣3️⃣')).toBe(1);
  });

  it('全形空白、不換行空白都當分隔', () => {
    expect(countWords('one two　three')).toBe(3);
  });
});

describe('countableText：從正文 HTML 取出要算的字', () => {
  it('段落、小標、清單、引用都算', () => {
    const html =
      '<h2>小標</h2><p>段落</p><ul><li>清單一</li><li>清單二</li></ul><ol><li>第三</li></ol><blockquote><p>引用</p></blockquote><h3>小小標</h3>';
    expect(countBodyWords(html)).toBe(2 + 2 + 3 + 3 + 2 + 2 + 3);
  });

  it('圖片 alt 與圖說（figcaption）不算', () => {
    const html =
      '<p>前面</p><figure class="wp-block-image"><img src="a.jpg" alt="一隻貓在睡覺"><figcaption>圖說文字</figcaption></figure><p>後面</p>';
    expect(countBodyWords(html)).toBe(4);
    expect(countableText(html)).not.toContain('圖說');
    expect(countableText(html)).not.toContain('貓');
  });

  it('單獨的 img、figcaption 與其他非內文元件不算', () => {
    expect(countBodyWords('<p>字</p><img alt="很長的替代文字"><figcaption>說明</figcaption>')).toBe(1);
    expect(countBodyWords('<p>字</p><script>var x = "不算";</script><style>p{}</style><video>不支援</video>')).toBe(1);
    expect(countBodyWords('<p>字</p><iframe src="x">嵌入</iframe><svg><text>圖</text></svg>')).toBe(1);
  });

  it('區塊之間是分隔，行內格式不切開詞', () => {
    expect(countBodyWords('<p>Hello</p><p>world</p>')).toBe(2);
    expect(countBodyWords('<li>one</li><li>two</li>')).toBe(2);
    expect(countBodyWords('<p>line<br>break</p>')).toBe(2);
    expect(countBodyWords('<p><strong>GPT</strong>-5 和 <a href="https://x.test/a-b">連結</a></p>')).toBe(4);
    expect(countBodyWords('<p>wo<em>rd</em></p>')).toBe(1);
  });

  it('連結網址與屬性不算', () => {
    expect(countBodyWords('<p><a href="https://example.com/very-long-path" title="標題提示">這裡</a></p>')).toBe(2);
  });

  it('HTML 註解（區塊標記）不算', () => {
    expect(countBodyWords('<!-- wp:paragraph --><p>內文</p><!-- /wp:paragraph -->')).toBe(2);
  });

  it('&nbsp; 等實體照實際的字算', () => {
    expect(countBodyWords('<p>one&nbsp;two</p>')).toBe(2);
    expect(countBodyWords('<p>Tom&amp;Jerry</p>')).toBe(2);
    expect(countBodyWords('<p>&lt;div&gt;</p>')).toBe(1);
    expect(countBodyWords('<p>don&#39;t</p>')).toBe(1);
    expect(countBodyWords('<p>don&#x2019;t</p>')).toBe(1);
    expect(countBodyWords('<p>&#20013;&#25991;</p>')).toBe(2);
    expect(countBodyWords('<p>等等&hellip;&mdash;好</p>')).toBe(3);
    expect(countBodyWords('<p>&quot;quoted&quot;</p>')).toBe(1);
  });

  it('空正文與只有空段落是 0', () => {
    expect(countBodyWords('')).toBe(0);
    expect(countBodyWords('<p class="wp-block-paragraph"></p>')).toBe(0);
    expect(countBodyWords('<p><br></p>')).toBe(0);
    expect(countBodyWords('<hr>')).toBe(0);
  });

  it('屬性裡有 > 也不會把屬性值漏成字', () => {
    expect(countBodyWords('<p title="a > b 不算">算</p>')).toBe(1);
  });

  it('巢狀的非內文元件整段跳過，結束之後照算', () => {
    expect(countBodyWords('<figure><figure><figcaption>內</figcaption></figure><figcaption>外</figcaption></figure><p>好</p>')).toBe(1);
  });

  it('長文也算得快', () => {
    const para = '<p>這是一段很長的中文段落，裡面有 English words 與 GPT-5、3.14 這些東西。</p>';
    const html = para.repeat(5000);
    const started = performance.now();
    const count = countBodyWords(html);
    expect(performance.now() - started).toBeLessThan(500);
    expect(count).toBe(countBodyWords(para) * 5000);
  });
});

describe('formatWordCount：畫面上的「N 字」', () => {
  it('千分位、後面接「字」', () => {
    expect(formatWordCount(0)).toBe('0 字');
    expect(formatWordCount(12)).toBe('12 字');
    expect(formatWordCount(12345)).toBe('12,345 字');
  });
});

describe('createThrottle：打字中重算字數的節流', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('第一下馬上跑，接著一段時間內最多再跑一次（尾巴一定跑到）', () => {
    const fn = vi.fn();
    const throttle = createThrottle(fn, 200);
    throttle.call();
    expect(fn).toHaveBeenCalledTimes(1);
    throttle.call();
    throttle.call();
    throttle.call();
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(200);
    expect(fn).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('停一陣子之後再打，又是馬上跑', () => {
    const fn = vi.fn();
    const throttle = createThrottle(fn, 200);
    throttle.call();
    vi.advanceTimersByTime(500);
    throttle.call();
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('cancel 之後尾巴不跑', () => {
    const fn = vi.fn();
    const throttle = createThrottle(fn, 200);
    throttle.call();
    throttle.call();
    throttle.cancel();
    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
