import type { CompareRow, Comparison } from '../../contract/api.js';

/**
 * 對照畫面怎麼排（D-019，git diff 式）。
 *
 * 比對本身在後端算（review-proposals.md「中文 diff」）；這裡只決定**哪些列要列出來、哪些收起來**，
 * 以及最上面那一句摘要。純函式，node 裡測得到（tests/diff-view.test.ts）。
 *
 * 段號一律以「目前的文章」為準，跟右欄卡片的 `blockIndex` 同一套：跟上一版比時目前的文章在右邊，
 * 跟提案比時在左邊。目前的文章裡沒有的段落（上一版被刪掉的、提案新增的）只能講它在另一邊的位置。
 */

export type DiffEntry =
  | {
      readonly type: 'change';
      readonly key: string;
      readonly row: CompareRow;
      /** 「第 3 段」「原第 3 段」「提案第 3 段」。 */
      readonly position: string;
      readonly kindLabel: '改寫' | '新增' | '刪除' | '改了標記';
    }
  | {
      readonly type: 'unchanged';
      readonly key: string;
      readonly rows: readonly CompareRow[];
      /** 1 起算，目前的文章的段號。 */
      readonly first: number;
      readonly last: number;
      readonly count: number;
    };

type Against = Comparison['against'];

/** 這一列在「目前的文章」裡是第幾塊（0 起算）；目前的文章沒有這一段就是 null。 */
export function currentIndexOf(row: CompareRow, against: Against): number | null {
  return against === 'proposal' ? row.leftIndex : row.rightIndex;
}

export function buildDiffEntries(comparison: Comparison): DiffEntry[] {
  const { against } = comparison;
  const entries: DiffEntry[] = [];
  let run: CompareRow[] = [];
  let runStart = 0;

  const flush = (): void => {
    if (run.length === 0) return;
    const first = (currentIndexOf(run[0]!, against) ?? 0) + 1;
    const last = (currentIndexOf(run[run.length - 1]!, against) ?? 0) + 1;
    entries.push({ type: 'unchanged', key: `u-${runStart}`, rows: run, first, last, count: run.length });
    run = [];
  };

  comparison.rows.forEach((row, index) => {
    if (row.kind === 'same') {
      if (run.length === 0) runStart = index;
      run.push(row);
      return;
    }
    flush();
    entries.push({ type: 'change', key: `c-${index}`, row, position: positionOf(row, against), kindLabel: kindLabelOf(row) });
  });
  flush();
  return entries;
}

function positionOf(row: CompareRow, against: Against): string {
  const current = currentIndexOf(row, against);
  if (current !== null) return `第 ${current + 1} 段`;
  if (against === 'proposal') return `提案第 ${(row.rightIndex ?? 0) + 1} 段`;
  return `原第 ${(row.leftIndex ?? 0) + 1} 段`;
}

function kindLabelOf(row: CompareRow): '改寫' | '新增' | '刪除' | '改了標記' {
  if (row.kind === 'inserted') return '新增';
  if (row.kind === 'deleted') return '刪除';
  const textChanged = row.segments.some((segment) => segment.op !== 'same');
  return !textChanged && row.note !== null ? '改了標記' : '改寫';
}

/**
 * 卡片指到的段落如果被收在某一組沒變的段落裡，回那一組的 key（要把它展開）；
 * 已經列出來或找不到就是 null。
 */
export function runKeyForBlock(entries: readonly DiffEntry[], blockIndex: number, against: Against): string | null {
  for (const entry of entries) {
    if (entry.type !== 'unchanged') continue;
    if (entry.rows.some((row) => currentIndexOf(row, against) === blockIndex)) return entry.key;
  }
  return null;
}

/** 最上面那一句：先講結論。 */
export function summarizeComparison(comparison: Comparison): string {
  let replaced = 0;
  let inserted = 0;
  let deleted = 0;
  for (const row of comparison.rows) {
    if (row.kind === 'replaced') replaced += 1;
    else if (row.kind === 'inserted') inserted += 1;
    else if (row.kind === 'deleted') deleted += 1;
  }
  const body = [
    replaced > 0 ? `改了 ${replaced} 段` : null,
    inserted > 0 ? `新增 ${inserted} 段` : null,
    deleted > 0 ? `刪掉 ${deleted} 段` : null,
  ].filter((part): part is string => part !== null);
  // 動詞照實講：原本沒有的是「設了」，拿掉的是「拿掉了」，兩邊都有才是「換了」。
  const fields = comparison.fieldChanges
    .map((change) => `${change.before === null ? '設了' : change.after === null ? '拿掉了' : '換了'}${change.label}`)
    .join('、');

  if (body.length === 0 && fields.length === 0) return '兩邊一模一樣，什麼都沒改';
  if (body.length === 0) return `正文沒變，只${fields}`;
  if (fields.length === 0) return `正文${body.join('、')}`;
  return `正文${body.join('、')}；另外${fields}`;
}
