import { splitTopLevelBlocks, type TopLevelBlock } from './html-blocks.js';
import { diffWords, type DiffSegment } from './word-diff.js';
import type { CompareRow, ProofMark, ProofMarkKind } from '../contract/api.js';

/**
 * 校對符號（docs/specs/http-api.md 的 ProofMark）。
 *
 * 版面的簽名元素：改動不用紅綠色塊，用頁邊的校對符號標示。所以這裡產生的不是
 * 「一堆 diff hunk」，而是**每個頂層區塊一個符號**——符號要能定位到某一段的頁邊，
 * 字元級的 hunk 定位不到。
 *
 * summary 由這裡的程式產生，不是 Agent 寫的。理由跟整個系統一樣：Agent 說自己
 * 改了什麼不算數，實際改了什麼要由固定程式比對出來。
 */


export type { CompareRow, ProofMark, ProofMarkKind };

const GLYPHS: Record<ProofMarkKind, ProofMark['glyph']> = {
  inserted: '＋',
  deleted: '－',
  replaced: '～',
  moved: '⇄',
};

/** 摘要與 before/after 顯示的長度上限。 */
const EXCERPT_LIMIT = 200;

type Op =
  | { readonly kind: 'equal'; readonly prev: number; readonly curr: number }
  | { readonly kind: 'delete'; readonly prev: number }
  | { readonly kind: 'insert'; readonly curr: number };

/**
 * 兩個區塊算不算「同一塊、沒動過」。
 *
 * **文字一樣還不夠**：標題從 h2 改成 h3、連結換了目的地、圖片換了網址或 alt，
 * 純文字看起來一模一樣，但發布出去的東西已經不同了。只比文字的話這些改動會
 * 靜靜地變成「與上一版相同」——使用者核准的是他沒看到的改動，那正是這套
 * 校對符號存在的理由。所以相等要連標記一起比。
 *
 * 摘要（summary）另外處理：那是給人看的，仍然以文字為準，不會把 HTML 吐給使用者。
 */
function sameBlock(a: TopLevelBlock, b: TopLevelBlock): boolean {
  return a.text === b.text && a.html === b.html;
}

/**
 * 最長共同子序列。區塊數是幾十的量級，O(n·m) 的 DP 完全夠用，
 * 而且不必為此多裝一個 diff 套件。
 */
function diffBlocks(previous: readonly TopLevelBlock[], current: readonly TopLevelBlock[]): Op[] {
  const n = previous.length;
  const m = current.length;

  // table[i][j] = previous[i..] 與 current[j..] 的 LCS 長度
  const table: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i]![j] = sameBlock(previous[i]!, current[j]!)
        ? table[i + 1]![j + 1]! + 1
        : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }

  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (sameBlock(previous[i]!, current[j]!)) {
      ops.push({ kind: 'equal', prev: i, curr: j });
      i += 1;
      j += 1;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      ops.push({ kind: 'delete', prev: i });
      i += 1;
    } else {
      ops.push({ kind: 'insert', curr: j });
      j += 1;
    }
  }
  while (i < n) {
    ops.push({ kind: 'delete', prev: i });
    i += 1;
  }
  while (j < m) {
    ops.push({ kind: 'insert', curr: j });
    j += 1;
  }
  return ops;
}

function excerpt(value: string): string {
  return value.length > EXCERPT_LIMIT ? `${value.slice(0, EXCERPT_LIMIT)}…` : value;
}

/** 中英文常見標點。用來分辨「只是補標點」與「真的改了字」。 */
const PUNCTUATION = /[\s，。、；：？！「」『』（）〈〉《》—…·,.;:?!"'()[\]{}\-–—]/g;

function stripPunctuation(value: string): string {
  return value.replace(PUNCTUATION, '');
}

/** 標記變了但文字沒變時的說明。講標籤名稱與哪一類屬性，不把 HTML 倒給使用者看。 */
function describeMarkupChange(before: TopLevelBlock, after: TopLevelBlock): string {
  if (before.tag !== after.tag) return `區塊改變：${before.tag} → ${after.tag}`;
  if (before.tag === 'figure' || before.tag === 'img') return '文字沒變，換的是圖片或圖片說明';
  return '文字沒變，改的是標記（連結、強調或屬性）';
}

/** 改寫的說明。滑過符號時使用者看到的就是這一句，所以要講「改了什麼」。 */
function describeReplacement(before: TopLevelBlock, after: TopLevelBlock): string {
  // 文字一字不差卻被判定成改動＝改的是標記。這種改動最容易被忽略，要講清楚。
  if (before.text === after.text) return describeMarkupChange(before, after);

  if (stripPunctuation(before.text) === stripPunctuation(after.text)) {
    return before.text.replace(/\s/g, '') === after.text.replace(/\s/g, '') ? '調整空白' : '調整標點';
  }
  const delta = [...after.text].length - [...before.text].length;
  if (delta > 0) return `改寫，多了 ${delta} 字`;
  if (delta < 0) return `改寫，少了 ${-delta} 字`;
  return '改寫，字數不變';
}

/**
 * 比對兩版正文，產生校對符號。
 *
 * `previousHtml` 為 null（第一個 revision）時回傳空陣列——沒有「相對於上一版的
 * 改動」這回事，硬把整篇標成新增只會讓頁邊爆滿。
 */
export function computeProofMarks(previousHtml: string | null, currentHtml: string): ProofMark[] {
  if (previousHtml === null) return [];

  const previous = splitTopLevelBlocks(previousHtml);
  const current = splitTopLevelBlocks(currentHtml);
  const ops = diffBlocks(previous, current);

  const marks: ProofMark[] = [];
  /** 已經走過幾個「目前版本」的區塊，刪除符號要靠它定位。 */
  let cursor = 0;
  let index = 0;

  while (index < ops.length) {
    const op = ops[index]!;
    if (op.kind === 'equal') {
      cursor = op.curr + 1;
      index += 1;
      continue;
    }

    // 連續的刪除＋新增算同一個「改動區」，才分得出「改寫」與「一刪一增」。
    const deletes: number[] = [];
    const inserts: number[] = [];
    while (index < ops.length && ops[index]!.kind !== 'equal') {
      const change = ops[index]!;
      if (change.kind === 'delete') deletes.push(change.prev);
      else inserts.push(change.curr);
      index += 1;
    }

    const paired = Math.min(deletes.length, inserts.length);
    for (let k = 0; k < paired; k += 1) {
      const before = previous[deletes[k]!]!;
      const after = current[inserts[k]!]!;
      marks.push({
        blockIndex: inserts[k]!,
        kind: 'replaced',
        glyph: GLYPHS.replaced,
        summary: describeReplacement(before, after),
        before: excerpt(before.text),
        after: excerpt(after.text),
      });
    }
    for (let k = paired; k < inserts.length; k += 1) {
      const after = current[inserts[k]!]!.text;
      marks.push({
        blockIndex: inserts[k]!,
        kind: 'inserted',
        glyph: GLYPHS.inserted,
        summary: `新增一段（${[...after].length} 字）`,
        before: null,
        after: excerpt(after),
      });
    }
    for (let k = paired; k < deletes.length; k += 1) {
      const before = previous[deletes[k]!]!.text;
      marks.push({
        blockIndex: Math.min(cursor, Math.max(current.length - 1, 0)),
        kind: 'deleted',
        glyph: GLYPHS.deleted,
        summary: `刪除一段（${[...before].length} 字）`,
        before: excerpt(before),
        after: null,
      });
    }

    if (inserts.length > 0) cursor = inserts[inserts.length - 1]! + 1;
  }

  return promoteMoves(marks);
}

/**
 * 一段被刪掉、同樣的文字又在別處出現＝搬家，不是刪掉再重寫。
 * 兩個符號合成一個 ⇄，使用者才不會以為內容真的被刪過。
 */
function promoteMoves(marks: readonly ProofMark[]): ProofMark[] {
  const deleted = marks.filter((mark) => mark.kind === 'deleted');
  if (deleted.length === 0) return [...marks];

  const consumedDeletes = new Set<ProofMark>();
  const result: ProofMark[] = [];

  for (const mark of marks) {
    if (mark.kind !== 'inserted') {
      result.push(mark);
      continue;
    }
    const match = deleted.find((candidate) => !consumedDeletes.has(candidate) && candidate.before === mark.after);
    if (!match) {
      result.push(mark);
      continue;
    }
    consumedDeletes.add(match);
    result.push({
      blockIndex: mark.blockIndex,
      kind: 'moved',
      glyph: GLYPHS.moved,
      summary: '段落移動了位置',
      before: match.before,
      after: mark.after,
    });
  }

  return result
    .filter((mark) => !consumedDeletes.has(mark))
    .sort((a, b) => a.blockIndex - b.blockIndex);
}

// --- 對照（階段 5.5-B；D-019 改單欄） -------------------------------------------------

/*
 * 對照的一列（CompareRow，形狀定義在 src/contract/api.ts）。
 *
 * 粒度是**頂層區塊**，跟校對符號、跟「把圖片插在第 n 段後面」用的是同一套索引。
 * 三者共用同一套索引是刻意的：使用者在對照畫面點某一段、在校樣上看到的符號、
 * 送給後端的插入位置，指的必須是同一個東西。
 *
 * 欄位裡放的是**純文字**不是 HTML：這個畫面的用途是逐字比對，不是再看一次排版
 * （排版看校樣）。而且逐詞標記要疊在文字上，把 HTML 一起丟進來只會兩邊打架。
 */

/**
 * 兩版正文的逐段對照。
 *
 * 區塊配對沿用校對符號那一套 LCS，所以兩個畫面永遠說同一件事；
 * 配好對之後，每一對再用 `diffWords` 做逐詞比對。
 */
export function computeComparison(leftHtml: string, rightHtml: string): CompareRow[] {
  const previous = splitTopLevelBlocks(leftHtml);
  const current = splitTopLevelBlocks(rightHtml);
  const ops = diffBlocks(previous, current);

  const rows: CompareRow[] = [];
  let index = 0;

  while (index < ops.length) {
    const op = ops[index]!;
    if (op.kind === 'equal') {
      const text = current[op.curr]!.text;
      rows.push({
        kind: 'same',
        leftIndex: op.prev,
        rightIndex: op.curr,
        left: text.length === 0 ? [] : [{ op: 'same', text }],
        right: text.length === 0 ? [] : [{ op: 'same', text }],
        segments: text.length === 0 ? [] : [{ op: 'same', text }],
        note: null,
      });
      index += 1;
      continue;
    }

    const deletes: number[] = [];
    const inserts: number[] = [];
    while (index < ops.length && ops[index]!.kind !== 'equal') {
      const change = ops[index]!;
      if (change.kind === 'delete') deletes.push(change.prev);
      else inserts.push(change.curr);
      index += 1;
    }

    const paired = Math.min(deletes.length, inserts.length);
    for (let k = 0; k < paired; k += 1) {
      const before = previous[deletes[k]!]!;
      const after = current[inserts[k]!]!;
      const segments = diffWords(before.text, after.text);
      rows.push({
        kind: 'replaced',
        leftIndex: deletes[k]!,
        rightIndex: inserts[k]!,
        left: segments.filter((segment) => segment.op !== 'added'),
        right: segments.filter((segment) => segment.op !== 'removed'),
        segments,
        note: before.text === after.text ? describeMarkupChange(before, after) : null,
      });
    }
    for (let k = paired; k < inserts.length; k += 1) {
      const text = current[inserts[k]!]!.text;
      // 沒有文字的段落（沒圖說的圖、分隔線）給空陣列：畫面會改說「這一段沒有文字」，
      // 不然只會出現一個空的標記，看起來像什麼都沒改。
      const added: DiffSegment[] = text.length === 0 ? [] : [{ op: 'added', text }];
      rows.push({
        kind: 'inserted',
        leftIndex: null,
        rightIndex: inserts[k]!,
        left: null,
        right: added,
        segments: added,
        note: null,
      });
    }
    for (let k = paired; k < deletes.length; k += 1) {
      const text = previous[deletes[k]!]!.text;
      const removed: DiffSegment[] = text.length === 0 ? [] : [{ op: 'removed', text }];
      rows.push({
        kind: 'deleted',
        leftIndex: deletes[k]!,
        rightIndex: null,
        left: removed,
        right: null,
        segments: removed,
        note: null,
      });
    }
  }

  return rows;
}
