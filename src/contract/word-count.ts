/**
 * 字數（D-045，P5-T047）。編輯區底部與發布面板都呼叫這裡，規則只有一份；之後後端要用也是這一份。
 *
 * 算法（使用者 2026-10-12 同意）：
 * - 中文（漢字）、日文假名、韓文：一字算 1。日文長音「ー」算在假名裡。
 * - 英文／數字（含全形英數、其他拼音文字）：一個詞算 1。詞裡夾著的 `-`、`'`、`’`、`.` 不切開詞
 *   （`GPT-5`、`don't`、`3.14`、`state-of-the-art` 各算 1；全形 `－`、`．` 一樣），數字之間的 `,`、`，`、`/`、`:` 也不切
 *   （`1,000`、`2026/10/12`、`10:30` 各算 1）。
 * - 標點、空白、符號、emoji：不算。
 *
 * 只算正文：`countableText` 從正文 HTML 取出段落、小標、清單、引用裡的字；圖片（含 alt）、圖說（figcaption）、
 * 影音與嵌入等非內文元件整段跳過。標題不在正文 HTML 裡，本來就不算。
 *
 * 用字串處理而不是 DOM：前端與後端（沒有 DOM）才能共用。這不是安全關卡，只是顯示用的數字。
 * 本檔不得 import 任何東西（`tests/contract.test.ts`）。
 */

/** 漢字、平假名、片假名、韓文，以及長音符號（全形 U+30FC、半形 U+FF70；Unicode 把它歸在共用而不是假名）。 */
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}ーｰ]/u;
/** 詞的字母與數字（CJK 已經先判斷掉）。 */
const WORD = /[\p{L}\p{N}]/u;
const DIGIT = /\p{Nd}/u;
/** 結合符號（重音、變音）：只接在詞後面才算詞的一部分；單獨出現（例如 emoji 的變體選擇符）不算。 */
const MARK = /\p{M}/u;
/** 夾在兩個詞字元中間時不切開詞的符號（含全形 `－`、`．`）。 */
const JOINERS = new Set(['-', '\u2010', '\u2011', '\uFF0D', "'", '\u2019', '.', '\uFF0E']);
/** 只在數字與數字之間才不切開的符號：千分位 `,`／`，`、日期 `2026/10/12`、時間 `10:30`。 */
const DIGIT_JOINERS = new Set([',', '\uFF0C', '/', ':']);

function isAsciiWordChar(code: number): boolean {
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

/** 一段純文字有幾個字（規則見檔頭）。 */
export function countWords(text: string): number {
  let count = 0;
  let inWord = false;
  /** 詞後面剛出現一個連接符號，還不知道下一個字元會不會接上。 */
  let joiner: string | null = null;
  let lastDigit = false;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    const ascii = code < 128;
    if (ascii ? isAsciiWordChar(code) : !CJK.test(ch) && WORD.test(ch)) {
      const digit = ascii ? code <= 57 : DIGIT.test(ch);
      // 接得上：前面是詞、中間沒有符號，或夾著連接符號（只接數字的那幾個要兩邊都是數字）。
      const continues = inWord && (joiner === null || !DIGIT_JOINERS.has(joiner) || (lastDigit && digit));
      if (!continues) count += 1;
      inWord = true;
      joiner = null;
      lastDigit = digit;
      continue;
    }
    if (!ascii && CJK.test(ch)) {
      count += 1;
      inWord = false;
      joiner = null;
      continue;
    }
    if (inWord && joiner === null) {
      if (JOINERS.has(ch) || (lastDigit && DIGIT_JOINERS.has(ch))) {
        joiner = ch;
        continue;
      }
      if (!ascii && MARK.test(ch)) continue;
    }
    inWord = false;
    joiner = null;
  }
  return count;
}

/** 整段跳過的非內文元件（連同裡面的字）。`img` 的 alt 是屬性，本來就不會被當成字。 */
const SKIPPED = new Set([
  'figure',
  'figcaption',
  'img',
  'picture',
  'video',
  'audio',
  'iframe',
  'embed',
  'object',
  'svg',
  'math',
  'canvas',
  'script',
  'style',
  'noscript',
  'template',
  'button',
  'select',
  'textarea',
  'input',
]);

/** 沒有結束標籤的元素。 */
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

/** 行內元素：標籤兩邊的字是連著的（`<strong>GPT</strong>-5` 是一個詞）。其他標籤都當作分隔。 */
const INLINE = new Set([
  'a',
  'abbr',
  'b',
  'bdi',
  'bdo',
  'cite',
  'code',
  'data',
  'del',
  'dfn',
  'em',
  'i',
  'ins',
  'kbd',
  'mark',
  'q',
  's',
  'samp',
  'small',
  'span',
  'strong',
  'sub',
  'sup',
  'time',
  'u',
  'var',
]);

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  hellip: '…',
  mdash: '—',
  ndash: '–',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  middot: '·',
  bull: '•',
  copy: '©',
  reg: '®',
  trade: '™',
  shy: '',
  zwj: '',
  zwnj: '',
  ensp: ' ',
  emsp: ' ',
  thinsp: ' ',
};

const ENTITY = /&(#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/gi;

function decodeEntities(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(ENTITY, (_whole, body: string) => {
    if (body[0] === '#') {
      const hex = body[1] === 'x' || body[1] === 'X';
      const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ' ';
    }
    // 不認得的具名實體（重音字母、箭頭…）：拿掉。夾在詞裡不會切開詞，單獨出現也不多算。
    return NAMED_ENTITIES[body.toLowerCase()] ?? '';
  });
}

/** 註解、或一個開始／結束標籤（屬性值用引號包著時，裡面的 `>` 不算標籤結尾）。 */
const TOKEN = /<!--[\s\S]*?(?:-->|$)|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;

/** 從正文 HTML 取出要算字數的純文字（規則見檔頭）。區塊之間補空白，行內標籤兩邊的字直接接起來。 */
export function countableText(html: string): string {
  const parts: string[] = [];
  /** 目前在幾層非內文元件裡面；大於 0 時字都不算。 */
  let skipDepth = 0;
  let last = 0;
  TOKEN.lastIndex = 0;
  for (let match = TOKEN.exec(html); match !== null; match = TOKEN.exec(html)) {
    if (skipDepth === 0 && match.index > last) parts.push(html.slice(last, match.index));
    last = TOKEN.lastIndex;
    const name = match[2]?.toLowerCase();
    if (name === undefined) continue; // 註解
    const closing = match[1] === '/';
    if (SKIPPED.has(name)) {
      const selfClosing = VOID.has(name) || /\/\s*$/.test(match[3] ?? '');
      if (closing) skipDepth = VOID.has(name) ? skipDepth : Math.max(0, skipDepth - 1);
      else if (!selfClosing) skipDepth += 1;
    }
    if (skipDepth === 0 && !INLINE.has(name)) parts.push(' ');
  }
  if (skipDepth === 0 && last < html.length) parts.push(html.slice(last));
  return decodeEntities(parts.join(''));
}

/** 正文 HTML 有幾個字：`countWords(countableText(html))`。 */
export function countBodyWords(html: string | null | undefined): number {
  if (typeof html !== 'string' || html.length === 0) return 0;
  return countWords(countableText(html));
}
