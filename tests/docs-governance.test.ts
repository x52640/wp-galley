// P0-T004（D-042）：文件狀態一致性閘門。只用 Node 內建模組讀檔，不連網、不跑子行程。
// 每條規則都是「吃字串、吐問題清單」的純函式，下面先用壞例子自我測試，再套到真實文件。
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..');
const VALID_STATUS = ['ready', 'in_progress', 'done', 'blocked'] as const;
const ACTIVE_STATUS = new Set(['ready', 'in_progress']);
const ACTIVE_SECTIONS = ['進行中', 'Ready'] as const;
const DECISION_MAX = 250;
const CURRENT_TASK_DEFAULT_MAX = 100;
const TASK_ID = /P\d+-T\d{3}/g;

type Issue = string;

function lines(text: string): string[] {
  const all = text.split(/\r?\n/);
  if (all.length > 0 && all[all.length - 1] === '') all.pop();
  return all;
}

// ---------- 規則 1：Task front matter ----------

interface FrontMatter {
  fields: Map<string, { value: string; line: number }>;
}

function parseFrontMatter(text: string): FrontMatter | null {
  const ls = lines(text);
  if (ls[0]?.trim() !== '---') return null;
  const end = ls.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (end < 0) return null;
  const fields = new Map<string, { value: string; line: number }>();
  for (let i = 1; i < end; i++) {
    const m = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(ls[i] ?? '');
    if (!m) continue;
    const value = (m[2] ?? '')
      .replace(/\s+#.*$/, '')
      .trim()
      .replace(/^["'](.*)["']$/, '$1');
    fields.set(m[1] ?? '', { value, line: i + 1 });
  }
  return { fields };
}

function checkTaskFile(file: string, text: string): Issue[] {
  const issues: Issue[] = [];
  const base = file.split('/').pop() ?? file;
  const expectedId = /^(P\d+-T\d{3})/.exec(base)?.[1];
  const fm = parseFrontMatter(text);
  if (!fm) {
    return [`${file}:1 — 沒有 front matter。改法：檔頭加 \`---\` 區塊，欄位照 docs/tasks/_TEMPLATE.md。`];
  }
  const id = fm.fields.get('id');
  if (!id) {
    issues.push(`${file}:1 — front matter 缺 \`id\`。改法：加 \`id: ${expectedId ?? 'P<階段>-T<三位數>'}\`。`);
  } else if (id.value !== expectedId) {
    issues.push(
      `${file}:${id.line} — id 是 \`${id.value}\`，但檔名前綴是 \`${expectedId ?? '(無)'}\`。改法：讓兩者一致（ID 不重用，通常是改 id）。`,
    );
  }
  const status = fm.fields.get('status');
  if (!status) {
    issues.push(`${file}:1 — front matter 缺 \`status\`。改法：加 \`status: ready\`（或 ${VALID_STATUS.join('／')}）。`);
  } else if (!(VALID_STATUS as readonly string[]).includes(status.value)) {
    issues.push(
      `${file}:${status.line} — status 是 \`${status.value}\`，只准 ${VALID_STATUS.join('／')}。改法：改成其中一個。`,
    );
  }
  return issues;
}

// ---------- 規則 2、3：CURRENT_TASK 與 Task status 對得上 ----------

interface Mention {
  id: string;
  line: number;
  section: string;
}

const RANGE = /P\d+-T\d{3}\]?\s*[～~\-–—]\s*\[?(?:P\d+-)?T\d{3}/g;

function sectionMentions(
  text: string,
  sections: readonly string[],
): { mentions: Mention[]; missing: string[]; ranges: Mention[] } {
  const ls = lines(text);
  const mentions: Mention[] = [];
  const ranges: Mention[] = [];
  const found = new Set<string>();
  let current: string | null = null;
  ls.forEach((l, i) => {
    if (/^##\s/.test(l)) {
      // 前綴比對：「## 進行中（2 張）」也算；同名節出現多次都檢查。
      current = sections.find((name) => l.trim().startsWith(`## ${name}`)) ?? null;
      if (current) found.add(current);
      return;
    }
    if (!current) return;
    for (const id of new Set(Array.from(l.matchAll(TASK_ID), (m) => m[0]))) {
      mentions.push({ id, line: i + 1, section: current });
    }
    // 範圍寫法（P5-T041～P5-T045，含連結形式 [P5-T041](..)～[P5-T045](..)）會漏抓中間那幾張。
    const linkText = l.replace(/\]\([^)]*\)/g, ']');
    for (const m of linkText.matchAll(RANGE)) ranges.push({ id: m[0].replace(/[[\]]/g, ''), line: i + 1, section: current });
  });
  return { mentions, missing: sections.filter((n) => !found.has(n)), ranges };
}

function checkCurrentTaskConsistency(
  currentFile: string,
  currentText: string,
  statusById: Map<string, { status: string; file: string }>,
): Issue[] {
  const issues: Issue[] = [];
  const { mentions, missing, ranges } = sectionMentions(currentText, ACTIVE_SECTIONS);
  for (const name of missing) {
    issues.push(`${currentFile} — 找不到「## ${name}」一節。改法：補回這個標題（內容可寫「無。」）。`);
  }
  for (const r of ranges) {
    issues.push(
      `${currentFile}:${r.line} — 「## ${r.section}」用了範圍寫法 \`${r.id}\`，中間的 Task 檢查不到。改法：逐張列出每個 Task ID。`,
    );
  }
  for (const m of mentions) {
    const task = statusById.get(m.id);
    if (!task) {
      issues.push(
        `${currentFile}:${m.line} — 「## ${m.section}」提到 ${m.id}，但 docs/tasks/ 沒有這張 Task。改法：修正 ID，或先開 Task 檔。`,
      );
    } else if (!ACTIVE_STATUS.has(task.status)) {
      issues.push(
        `${currentFile}:${m.line} — 「## ${m.section}」提到 ${m.id}，但它在 ${task.file} 的 status 是 \`${task.status}\`。改法：從這節移走（已完成的寫到「上次停在哪」或待驗證表），或把 Task status 改回 ready／in_progress。`,
      );
    }
  }
  const mentioned = new Set(mentions.map((m) => m.id));
  for (const [id, task] of statusById) {
    if (ACTIVE_STATUS.has(task.status) && !mentioned.has(id)) {
      issues.push(
        `${task.file} — status 是 \`${task.status}\`，但 ${currentFile} 的「## 進行中」「## Ready」都沒提到 ${id}。改法：把它列進對應一節，或把 status 改成 done／blocked。`,
      );
    }
  }
  return issues;
}

// ---------- 規則 4：plan.md 決策記錄 ----------

function visibleLength(line: string): number {
  // 只算看得到的字：Markdown 連結 [文字](目標) 只留 [文字]。
  return [...line.replace(/\[([^\]]*)\]\([^)]*\)/g, '[$1]')].length;
}

function checkDecisionLog(file: string, text: string): Issue[] {
  const issues: Issue[] = [];
  let prev: { n: number; line: number } | null = null;
  const seen = new Map<number, number>();
  const ls = lines(text);
  ls.forEach((l, i) => {
    const m = /^- \*\*D-(\d+)\*\*/.exec(l);
    if (!m) return;
    const lineNo = i + 1;
    const n = Number(m[1]);
    // 縮排的續行（非空、不是新的清單項）算同一條。
    let full = l;
    let extra = 0;
    for (let j = i + 1; j < ls.length; j++) {
      const next = ls[j] ?? '';
      if (!/^\s+\S/.test(next) || /^\s*[-*+]\s/.test(next)) break;
      full += next.trim();
      extra++;
    }
    const len = visibleLength(full);
    if (len > DECISION_MAX) {
      const span = extra > 0 ? `（含下面 ${extra} 行續行）` : '';
      issues.push(
        `${file}:${lineNo} — D-${m[1]} 有 ${len} 字${span}（連結網址不算），上限 ${DECISION_MAX}。改法：只留結論＋「不做 X」＋連到 Task，理由搬到 Task「目標」。`,
      );
    }
    const dup = seen.get(n);
    if (dup !== undefined) {
      issues.push(`${file}:${lineNo} — D-${m[1]} 重複（第 ${dup} 行已有）。改法：給新決策下一個沒用過的編號，編號不重用。`);
    } else if (prev && n <= prev.n) {
      issues.push(
        `${file}:${lineNo} — D-${m[1]} 排在 D-${String(prev.n).padStart(3, '0')}（第 ${prev.line} 行）之後，編號沒有遞增。改法：依編號排序。`,
      );
    }
    seen.set(n, lineNo);
    prev = { n, line: lineNo };
  });
  return issues;
}

// ---------- 規則 5：CURRENT_TASK 行數 ----------

function checkLineLimit(file: string, text: string): Issue[] {
  const ls = lines(text);
  const head = ls.slice(0, 5).join('\n');
  const limit = Number(/上限\s*(\d+)\s*行/.exec(head)?.[1] ?? CURRENT_TASK_DEFAULT_MAX);
  if (ls.length > limit) {
    return [
      `${file} — ${ls.length} 行，超過檔頭寫的上限 ${limit} 行（從第 ${limit + 1} 行起超出）。改法：把舊的「上次停在哪」與已驗完的列搬到對應 Task 檔，本檔只留指標。`,
    ];
  }
  return [];
}

// ---------- 規則 6：相對 Markdown 連結 ----------

function stripCode(text: string): string[] {
  // 回傳逐行文字；code block 整行清空、code span 換成空白，行號不變。
  let fence: string | null = null;
  return lines(text).map((l) => {
    const f = /^\s*(`{3,}|~{3,})/.exec(l);
    if (fence) {
      if (f && f[1]?.[0] === fence[0] && (f[1]?.length ?? 0) >= fence.length) fence = null;
      return '';
    }
    if (f) {
      fence = f[1] ?? '```';
      return '';
    }
    return l.replace(/(`+)[^`]*?\1/g, (s) => ' '.repeat(s.length));
  });
}

function checkLinks(file: string, text: string, exists: (absPath: string) => boolean, root = ROOT): Issue[] {
  const issues: Issue[] = [];
  const dir = dirname(join(root, file));
  stripCode(text).forEach((l, i) => {
    for (const m of l.matchAll(/!?\[[^\]]*\]\(\s*(<[^>]*>|[^)\s]*)(?:\s+"[^"]*")?\s*\)/g)) {
      let target = (m[1] ?? '').replace(/^<|>$/g, '');
      if (!target || target.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
      target = target.replace(/[#?].*$/, '');
      let decoded = target;
      try {
        decoded = decodeURIComponent(target);
      } catch {
        // 保留原字串
      }
      const abs = resolve(dir, decoded);
      if (!exists(abs)) {
        issues.push(
          `${file}:${i + 1} — 連結 \`${m[1]}\` 指到的檔不存在（解析成 ${relative(root, abs)}）。改法：修正路徑（相對於 ${relative(root, dir) || '.'}/），或拿掉連結。`,
        );
      }
    }
  });
  return issues;
}

// ---------- 讀真實文件 ----------

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8');
}

function mdFiles(relDir: string, pattern = /\.md$/): string[] {
  return readdirSync(join(ROOT, relDir))
    .filter((f) => pattern.test(f))
    .sort()
    .map((f) => `${relDir}/${f}`);
}

const taskFiles = mdFiles('docs/tasks', /^P\d+-T\d+.*\.md$/);

function report(issues: Issue[]): string {
  return `\n${issues.length} 個問題：\n${issues.map((s) => `  • ${s}`).join('\n')}\n`;
}

// ---------- 自我測試：每條規則對壞例子要紅 ----------

describe('docs-governance 規則自我測試（壞例子必須被抓到）', () => {
  it('規則 1：沒有 front matter、id 對不上檔名、status 不合法', () => {
    expect(checkTaskFile('docs/tasks/P1-T001-x.md', '# 沒有 front matter\n')).toHaveLength(1);
    const bad = '---\nid: P1-T002\nstatus: doing   # 註解\n---\n';
    const issues = checkTaskFile('docs/tasks/P1-T001-x.md', bad);
    expect(issues).toHaveLength(2);
    expect(issues[0]).toContain('docs/tasks/P1-T001-x.md:2');
    expect(issues[1]).toContain(':3');
    expect(checkTaskFile('docs/tasks/P1-T001-x.md', '---\nid: P1-T001\nstatus: ready   # ok\n---\n')).toEqual([]);
  });

  it('規則 2：進行中／Ready 提到已完成或不存在的 Task', () => {
    const tasks = new Map([['P1-T001', { status: 'done', file: 'docs/tasks/P1-T001-x.md' }]]);
    const text = '# C\n\n## 進行中\n\nP1-T001 做到一半\n\n## Ready\n\nP1-T999\n\n## 其他\n\nP1-T001 這裡不算\n';
    const issues = checkCurrentTaskConsistency('docs/CURRENT_TASK.md', text, tasks);
    expect(issues).toHaveLength(2);
    expect(issues[0]).toContain('docs/CURRENT_TASK.md:5');
    expect(issues[1]).toContain('P1-T999');
  });

  it('規則 3：ready／in_progress 的 Task 沒列進 CURRENT_TASK；缺節也會紅', () => {
    const tasks = new Map([['P1-T001', { status: 'in_progress', file: 'docs/tasks/P1-T001-x.md' }]]);
    const issues = checkCurrentTaskConsistency('docs/CURRENT_TASK.md', '## 進行中\n\n無。\n\n## Ready\n\n無。\n', tasks);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('P1-T001');
    expect(checkCurrentTaskConsistency('docs/CURRENT_TASK.md', '## 進行中\nP1-T001\n', tasks)).toHaveLength(1);
    expect(
      checkCurrentTaskConsistency('docs/CURRENT_TASK.md', '## 進行中\n[P1-T001](tasks/x.md)\n## Ready\n無\n', tasks),
    ).toEqual([]);
  });

  it('規則 4：決策過長、重複、沒遞增；連結網址不算字數', () => {
    const long = `- **D-002** ${'字'.repeat(DECISION_MAX)}`;
    const text = ['- **D-001** ok', long, '- **D-002** 重複', '- **D-001** 倒退'].join('\n');
    const issues = checkDecisionLog('plan.md', text);
    expect(issues).toHaveLength(3);
    expect(issues[0]).toContain('plan.md:2');
    expect(issues[1]).toContain('plan.md:3');
    expect(issues[2]).toContain('plan.md:4');
    const withLinks = `- **D-001** ${'字'.repeat(200)} ${'[T](docs/tasks/P5-T041-proofview-selection.md)'.repeat(5)}`;
    expect(checkDecisionLog('plan.md', withLinks)).toEqual([]);
  });

  it('規則 2：兩節裡的範圍寫法（～、~、-、–，含連結形式）直接報錯', () => {
    const tasks = new Map([
      ['P1-T001', { status: 'in_progress', file: 'docs/tasks/P1-T001-x.md' }],
      ['P1-T003', { status: 'in_progress', file: 'docs/tasks/P1-T003-x.md' }],
    ]);
    for (const sep of ['～', '~', '-', '–', ' ～ ']) {
      const text = `## 進行中\nP1-T001${sep}P1-T003\n## Ready\n無\n`;
      const issues = checkCurrentTaskConsistency('docs/CURRENT_TASK.md', text, tasks);
      expect(issues, sep).toHaveLength(1);
      expect(issues[0]).toContain('docs/CURRENT_TASK.md:2');
      expect(issues[0]).toContain('逐張列出');
    }
    const linked = '## 進行中\n[P1-T001](tasks/P1-T001-x.md)～[P1-T003](tasks/P1-T003-x.md)\n## Ready\n無\n';
    expect(checkCurrentTaskConsistency('docs/CURRENT_TASK.md', linked, tasks)).toHaveLength(1);
    // 檔名裡的 P1-T001-x 不是範圍
    const plain = '## 進行中\n[P1-T001](tasks/P1-T001-x.md)、P1-T003\n## Ready\n無\n';
    expect(checkCurrentTaskConsistency('docs/CURRENT_TASK.md', plain, tasks)).toEqual([]);
  });

  it('規則 2、3：節標題前綴比對、同名節出現兩次都檢查', () => {
    const tasks = new Map([
      ['P1-T001', { status: 'in_progress', file: 'docs/tasks/P1-T001-x.md' }],
      ['P1-T002', { status: 'done', file: 'docs/tasks/P1-T002-x.md' }],
    ]);
    const text = '## 進行中（1 張）\nP1-T001\n## 其他\nx\n## Ready\n無\n## 進行中\nP1-T002\n';
    const issues = checkCurrentTaskConsistency('docs/CURRENT_TASK.md', text, tasks);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('docs/CURRENT_TASK.md:8');
    expect(issues[0]).toContain('P1-T002');
  });

  it('規則 4：縮排續行併進那條的字數', () => {
    const text = [`- **D-001** ${'字'.repeat(200)}`, `  ${'續'.repeat(60)}`, '- **D-002** ok', '  短續行'].join('\n');
    const issues = checkDecisionLog('plan.md', text);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('plan.md:1');
    expect(issues[0]).toContain('1 行續行');
  });

  it('規則 5：超過檔頭註解寫的上限', () => {
    const text = `# C\n\n<!-- 上限 3 行 -->\n第四行\n`;
    expect(checkLineLimit('docs/CURRENT_TASK.md', text)[0]).toContain('上限 3 行');
    expect(checkLineLimit('docs/CURRENT_TASK.md', '# C\n<!-- 上限 3 行 -->\n')).toEqual([]);
  });

  it('規則 6：壞的相對連結；略過網址、錨點、code', () => {
    const text = [
      '[壞](missing.md) [好](ok.md#x) [網](https://x.y/a.md) [錨](#a)',
      '`[code](missing2.md)`',
      '```',
      '[block](missing3.md)',
      '```',
      '![圖](../img/nope.png)',
    ].join('\n');
    const exists = (p: string) => p === join(ROOT, 'docs', 'ok.md');
    const issues = checkLinks('docs/README.md', text, exists);
    expect(issues).toHaveLength(2);
    expect(issues[0]).toContain('docs/README.md:1');
    expect(issues[1]).toContain('docs/README.md:6');
  });
});

// ---------- 真實文件 ----------

describe('docs-governance（真實文件；npm run verify:docs）', () => {
  it('規則 1：每張 Task 都有 front matter、id 等於檔名前綴、status 合法', () => {
    const issues = taskFiles.flatMap((f) => checkTaskFile(f, read(f)));
    expect(issues.length, report(issues)).toBe(0);
  });

  it('規則 2、3：CURRENT_TASK「進行中」「Ready」跟 Task status 對得上', () => {
    const statusById = new Map<string, { status: string; file: string }>();
    for (const f of taskFiles) {
      const fm = parseFrontMatter(read(f));
      const id = fm?.fields.get('id')?.value;
      if (id) statusById.set(id, { status: fm?.fields.get('status')?.value ?? '', file: f });
    }
    const issues = checkCurrentTaskConsistency('docs/CURRENT_TASK.md', read('docs/CURRENT_TASK.md'), statusById);
    expect(issues.length, report(issues)).toBe(0);
  });

  it(`規則 4：plan.md 決策記錄每條 ≤ ${DECISION_MAX} 字、編號遞增不重複`, () => {
    const issues = checkDecisionLog('plan.md', read('plan.md'));
    expect(issues.length, report(issues)).toBe(0);
  });

  it('規則 5：CURRENT_TASK 不超過檔頭寫的行數上限', () => {
    const issues = checkLineLimit('docs/CURRENT_TASK.md', read('docs/CURRENT_TASK.md'));
    expect(issues.length, report(issues)).toBe(0);
  });

  it('規則 6：冷啟動文件裡的相對連結都指到存在的檔', () => {
    const files = [
      'CLAUDE.md',
      'plan.md',
      'docs/README.md',
      'docs/CURRENT_TASK.md',
      ...mdFiles('docs/specs'),
      ...mdFiles('docs/adr'),
      ...mdFiles('docs/tasks'),
    ];
    const issues = files.flatMap((f) => checkLinks(f, read(f), existsSync));
    expect(issues.length, report(issues)).toBe(0);
  });
});
