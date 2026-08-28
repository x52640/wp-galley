import { splitTopLevelBlocks, type TopLevelBlock } from './html-blocks.js';

/**
 * 校對符號（階段 5 契約第四節）。
 *
 * 版面的簽名元素：改動不用紅綠色塊，用頁邊的校對符號標示。所以這裡產生的不是
 * 「一堆 diff hunk」，而是**每個頂層區塊一個符號**——符號要能定位到某一段的頁邊，
 * 字元級的 hunk 定位不到。
 *
 * summary 由這裡的程式產生，不是 Agent 寫的。理由跟整個系統一樣：Agent 說自己
 * 改了什麼不算數，實際改了什麼要由固定程式比對出來。
 */

export type ProofMarkKind = 'inserted' | 'deleted' | 'replaced' | 'moved';

export interface ProofMark {
  /** 對應正文第幾個頂層區塊（以**目前**這一版的索引為準）。 */
  readonly blockIndex: number;
  readonly kind: ProofMarkKind;
  /** 頁邊顯示的符號。用文字不用圖檔，才能跟著字級縮放。 */
  readonly glyph: '＋' | '－' | '～' | '⇄';
  readonly summary: string;
  readonly before: string | null;
  readonly after: string | null;
}

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
      table[i]![j] =
        previous[i]!.text === current[j]!.text
          ? table[i + 1]![j + 1]! + 1
          : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }

  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (previous[i]!.text === current[j]!.text) {
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

/** 改寫的說明。滑過符號時使用者看到的就是這一句，所以要講「改了什麼」。 */
function describeReplacement(before: string, after: string): string {
  if (stripPunctuation(before) === stripPunctuation(after)) {
    return before.replace(/\s/g, '') === after.replace(/\s/g, '') ? '調整空白' : '調整標點';
  }
  const delta = [...after].length - [...before].length;
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
      const before = previous[deletes[k]!]!.text;
      const after = current[inserts[k]!]!.text;
      marks.push({
        blockIndex: inserts[k]!,
        kind: 'replaced',
        glyph: GLYPHS.replaced,
        summary: describeReplacement(before, after),
        before: excerpt(before),
        after: excerpt(after),
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
