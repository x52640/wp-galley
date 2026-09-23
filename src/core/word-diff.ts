import type { DiffSegment, SegmentOp } from '../contract/api.js';

/**
 * 逐詞比對（階段 5.5-B）。
 *
 * **中文沒有空格。** Git 那種靠空格切詞的 diff 直接套到中文，會退化成逐字比對，
 * 產出一堆看不出改了什麼的碎片：
 *
 *     今[天]讀完[了]這本書      ← 難讀，而且看不出改了什麼
 *
 * 所以先用 `Intl.Segmenter`（Node 內建、有完整 ICU，不必裝套件）把字串斷成詞，
 * 再對「詞」做 LCS。同一句話就變成：
 *
 *     今天讀完[了]這本書        ← 「了」是一個詞，這才是人看得懂的粒度
 *
 * 這是**不特別處理就會默默產出垃圾**的地方，所以獨立成一個模組，直接測得到。
 */

export type { DiffSegment, SegmentOp };

/**
 * 斷詞用 `zh-Hant`。中英數混排也吃得下——Segmenter 會把 `hello`、`123` 各自
 * 當成一個詞，標點與空白則各自成段（`isWordLike` 為 false），照樣保留。
 *
 * 保留標點與空白這件事很重要：把它們丟掉的話，接回去的字串就不等於原文，
 * 使用者會在對照畫面上看到一段跟文章不一樣的東西。
 */
const SEGMENTER = new Intl.Segmenter('zh-Hant', { granularity: 'word' });

/**
 * LCS 是 O(n·m)。一般段落幾十到幾百個詞，完全沒問題；但正文可能被塞進一整篇
 * 沒有分段的長文，那就會變成幾千乘幾千。超過上限就不逐詞比了，整段標成
 * 「換掉了」——慢到讓畫面卡住比看不到詞級差異糟得多。
 */
const MAX_TOKENS = 1500;

export function segmentWords(text: string): string[] {
  const tokens: string[] = [];
  for (const part of SEGMENTER.segment(text)) tokens.push(part.segment);
  return tokens;
}

/**
 * 兩段文字的逐詞差異。
 *
 * 回傳的是**一條共用的序列**，不是左右兩份：左欄只畫 `same` + `removed`，
 * 右欄只畫 `same` + `added`。兩欄因此自動對齊，畫面不必再對一次位置。
 */
export function diffWords(before: string, after: string): DiffSegment[] {
  if (before === after) return before.length === 0 ? [] : [{ op: 'same', text: before }];
  if (before.length === 0) return [{ op: 'added', text: after }];
  if (after.length === 0) return [{ op: 'removed', text: before }];

  const left = segmentWords(before);
  const right = segmentWords(after);
  if (left.length > MAX_TOKENS || right.length > MAX_TOKENS) {
    return [
      { op: 'removed', text: before },
      { op: 'added', text: after },
    ];
  }

  return merge(lcsOps(left, right));
}

type RawOp = { readonly op: SegmentOp; readonly text: string };

/**
 * 最長共同子序列。用扁平的 `Int32Array` 而不是巢狀陣列：1500×1500 的表格是
 * 兩百多萬格，巢狀陣列在這個量級會明顯拖慢，而且每一列都是一個獨立物件。
 */
function lcsOps(left: readonly string[], right: readonly string[]): RawOp[] {
  const n = left.length;
  const m = right.length;
  const width = m + 1;
  const table = new Int32Array((n + 1) * width);

  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i * width + j] =
        left[i] === right[j]
          ? table[(i + 1) * width + j + 1]! + 1
          : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
    }
  }

  const ops: RawOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (left[i] === right[j]) {
      ops.push({ op: 'same', text: left[i]! });
      i += 1;
      j += 1;
    } else if (table[(i + 1) * width + j]! >= table[i * width + j + 1]!) {
      ops.push({ op: 'removed', text: left[i]! });
      i += 1;
    } else {
      ops.push({ op: 'added', text: right[j]! });
      j += 1;
    }
  }
  while (i < n) {
    ops.push({ op: 'removed', text: left[i]! });
    i += 1;
  }
  while (j < m) {
    ops.push({ op: 'added', text: right[j]! });
    j += 1;
  }
  return ops;
}

/**
 * 把連續同類的詞併成一段。
 *
 * 不併的話「這本書」會被拆成三個相鄰的 removed 標記，畫面上是三個色塊而不是
 * 一句話——那正好又回到我們要避免的碎片。
 */
function merge(ops: readonly RawOp[]): DiffSegment[] {
  const out: DiffSegment[] = [];
  for (const item of ops) {
    const last = out[out.length - 1];
    if (last && last.op === item.op) out[out.length - 1] = { op: last.op, text: last.text + item.text };
    else out.push(item);
  }
  return out;
}

/** 這段差異裡真的有東西被改動嗎。全部 `same` 代表兩邊文字一樣。 */
export function hasWordChanges(segments: readonly DiffSegment[]): boolean {
  return segments.some((segment) => segment.op !== 'same');
}
