/**
 * 逐條套用校稿建議（階段 5.5-B）。
 *
 * Agent 回來的 `ReviewChange` 是**描述**（把 A 改成 B），不是套用的機制——它交回來
 * 的 `templateData` 才是它自己改好的整份內容。所以「只接受第 1、3 項」沒有現成的
 * 東西可以用，得自己在目前的內容上做定位與替換。
 *
 * 三條規則決定了這裡的做法：
 *
 * 1. **從目前的內容出發，只套上被勾選的那幾項。** 反過來做（拿 Agent 的整份輸出
 *    再把沒勾的還原）會把 Agent 沒申報的改動一起帶進來——「Agent 說自己改了什麼
 *    不算數」是這個專案的前提，所以只套用它申報過的。
 *    「全部接受」是另一回事，那是使用者明講要採用它的整份稿，走別的路。
 *
 * 2. **找不到就承認找不到。** `before` 在目前內容裡找不到（被別的改動吃掉了、
 *    被 HTML 標籤切斷了、Agent 根本寫錯了）就回報 `notFound`，由呼叫端標成
 *    「無法自動套用」。硬猜一個位置替換下去，使用者不會知道文章被改到哪裡。
 *
 * 3. **依序定位，帶著游標往前走。** 「的」這種短字串在一篇文章裡到處都是。
 *    Agent 是照閱讀順序列出改動的，所以照順序找、找到就把游標推到那之後，
 *    第二個「的」才不會被套到第一個「的」的位置上。已經套用過的項目也要參與
 *    定位（找它的 `after`），否則游標會落在錯的地方。
 *
 * 4. **只在標籤外面找。** 正文是 HTML 字串，`class="wp-block-paragraph"` 這種
 *    屬性值也是字串的一部分。純粹用 `indexOf` 找的話，Agent 的 `before` 只要
 *    撞上屬性或標籤名，替換下去改到的就是**標記**而不是文章——而且改出來的
 *    HTML 仍然可能通過模板 schema，沒有人會發現。所以定位前先把標籤的範圍
 *    標出來，落在標籤裡的位置一律不算數。
 *
 * 5. **`after` 不准帶標籤。** 「把 A 改成 B」是文字替換；`after` 裡有 `<` 或 `>`
 *    就等於 Agent 在直接寫 HTML，那條線這個專案不開（計畫 §4.1）。這種項目
 *    當作定位不到，讓使用者自己處理。
 *
 * ⚠️ 這裡產生的 templateData **不是**可信內容。它會照常走 `createRevision` →
 * `renderRevision`，在那裡用模板的 schema.json 再驗一次並 sanitize。這個模組
 * 不做任何安全性判斷。
 */

import { isInsideAligned } from '../contract/text-match.js';

/**
 * 一項要處理的改動。
 *
 * 用 `find` / `replaceWith` 而不是直接收 `ReviewChange`，是因為同一個項目在不同
 * 情況下要找的字串不一樣：還沒套用的要找 `before`，已經套用過的要找 `after`
 * （它只是來讓游標走對位置，不再替換）。把這個判斷留在呼叫端，這裡就只剩下
 * 「定位與替換」一件事，測起來也乾淨。
 */
export interface ChangeSlot {
  /** 對應 review_items 的 ordinal，回報時用得到。 */
  readonly ordinal: number;
  /** 要在目前內容裡找的字串。 */
  readonly find: string;
  /** 找到之後換成什麼；`null` 代表只定位、不替換。 */
  readonly replaceWith: string | null;
  /**
   * 落在這個字串（對齊的完整出現）裡面的 `find` 不算數。找 `before` 時傳 after：「很多事→很多事情」
   * 在文章已經是「很多事情」時，「很多事」就在改好的那句裡，套下去會變成「很多事情情」（P5-T017 審查）。
   */
  readonly skipInside?: string | undefined;
}

export interface ApplyResult {
  readonly templateData: Record<string, unknown>;
  /** 真的被替換掉的項目。 */
  readonly replaced: number[];
  /** 想替換但定位不到的項目。呼叫端要讓使用者知道這幾項得自己改。 */
  readonly notFound: number[];
}

interface Leaf {
  readonly path: readonly (string | number)[];
  value: string;
  /** 這個欄位已經處理到哪個位置；往回找會找到已經處理過的字串。 */
  cursor: number;
  /** 這個欄位裡是不是有 HTML 標籤。有的話 `after` 不准帶標籤。 */
  hasMarkup: boolean;
}

/**
 * 看起來像標籤開頭：`<` 後面接字母、`/`、`!` 或 `?`。
 *
 * 不能看到 `<` 就當標籤。日記裡寫「3 < 5 的證明」是很正常的一句話，
 * 把它當成標籤開頭的話，後面整串文字都會被當成標籤內部而定位不到。
 */
const TAG_START = /[A-Za-z/!?]/;

/**
 * 依序套用。`slots` 必須照 Agent 列出的順序給，游標邏輯才有意義。
 */
export function applyChanges(
  base: Record<string, unknown>,
  slots: readonly ChangeSlot[],
): ApplyResult {
  const data = structuredClone(base) as Record<string, unknown>;
  const leaves = collectStringLeaves(data);

  const replaced: number[] = [];
  const notFound: number[] = [];

  for (const slot of slots) {
    // 空字串定位不到任何位置（純新增的建議就會長這樣）。承認做不到，不要亂塞。
    if (slot.find.length === 0) {
      if (slot.replaceWith !== null) notFound.push(slot.ordinal);
      continue;
    }

    const hit = locate(leaves, slot.find, slot.skipInside);
    if (!hit) {
      if (slot.replaceWith !== null) notFound.push(slot.ordinal);
      continue;
    }

    const { leaf, index } = hit;

    // 要替換進 HTML 欄位的內容不准自己帶標籤——那是 Agent 在寫 HTML，不是校稿。
    if (slot.replaceWith !== null && leaf.hasMarkup && tagRanges(slot.replaceWith).length > 0) {
      notFound.push(slot.ordinal);
      leaf.cursor = index + slot.find.length;
      continue;
    }

    if (slot.replaceWith === null) {
      // 只推游標。這一項不是這次要套用的，但它佔著位置。
      leaf.cursor = index + slot.find.length;
      continue;
    }

    leaf.value = leaf.value.slice(0, index) + slot.replaceWith + leaf.value.slice(index + slot.find.length);
    leaf.cursor = index + slot.replaceWith.length;
    replaced.push(slot.ordinal);
  }

  for (const leaf of leaves) writePath(data, leaf.path, leaf.value);
  return { templateData: data, replaced, notFound };
}

/**
 * 找一個字串該落在哪裡。
 *
 * 先從各欄位的游標往後找（正常情況：Agent 照閱讀順序列改動）。全部找不到才
 * 從頭再找一次——Agent 沒照順序列的時候還救得回來，只是這時候「第幾個出現」
 * 就不保證了，所以只當作退路。
 */
function locate(
  leaves: readonly Leaf[],
  needle: string,
  skipInside: string | undefined,
): { leaf: Leaf; index: number } | null {
  for (const leaf of leaves) {
    const index = indexOfText(leaf.value, needle, leaf.cursor, skipInside);
    if (index >= 0) return { leaf, index };
  }
  for (const leaf of leaves) {
    const index = indexOfText(leaf.value, needle, 0, skipInside);
    if (index >= 0) return { leaf, index };
  }
  return null;
}

/**
 * `after` 至少要有幾個**字母或數字**才拿來判斷「已經改好了」。標點與空白不算：
 * 「的時候，」只有 3 個字，整篇到處都可能有，找到它說明不了任何事（P5-T017 審查）。
 */
export const ALREADY_DONE_MIN_AFTER = 6;

function letterCount(text: string): number {
  return (text.match(/[\p{L}\p{N}]/gu) ?? []).length;
}

/**
 * 這一項是不是**已經改好了**（P5-T017，D-021）：原句找不到，但要改成的字已經在目前的內容裡。
 *
 * 典型情況：使用者早就自己改掉了，或 AI 是從過期的原稿挑出來的。這種項目按「接受」一定
 * 定位不到，標成「找不到」只會讓人以為還有事要做。
 *
 * 定位規則跟套用**完全一樣**（逐字、只在標籤外面找、跨標籤不算），差別只在判斷的條件：
 *
 * 1. `before` 在目前內容裡**找不到**。找得到就還沒改，交給正常的套用。落在完整 after 裡的
 *    不算「找得到」（「很多事→很多事情」，文章已經是「很多事情」）——跟套用同一條規則。
 * 2. `after` 在目前內容裡**找得到**。
 * 3. `after` 至少 `ALREADY_DONE_MIN_AFTER` 個字母或數字（標點不算）——太短的字串到處都有，找到不代表改過了。
 * 4. `after` 不是 `before` 的一部分——刪字的建議（「這本書這本書」→「這本書」）的 after
 *    本來就在原文裡，找到它證明不了什麼。
 * 5. `before` 不是空的——純新增的建議沒有「原句」可比。
 *
 * **為什麼不限縮在「那一段」**：定位段落靠的就是 before，before 找不到就沒有「那一段」可以限縮，
 * 只能整篇找；所以用 3、4 兩條把誤判壓下來。誤判的代價也小：before 已經不在文章裡，
 * 這一項本來就套不上去，誤判只是少了一張「自己改」的提醒。
 */
export function isAlreadyDone(
  base: Record<string, unknown>,
  change: { readonly before: string; readonly after: string },
): boolean {
  const { before, after } = change;
  if (before.length === 0 || after === before) return false;
  if (letterCount(after) < ALREADY_DONE_MIN_AFTER) return false;
  if (before.includes(after)) return false;

  const leaves = collectStringLeaves(base);
  const found = (needle: string, skipInside?: string): boolean =>
    leaves.some((leaf) => indexOfText(leaf.value, needle, 0, skipInside) >= 0);
  return !found(before, after) && found(after);
}

/**
 * 在**標籤外面**的文字裡找。找不到回 -1。
 *
 * 為什麼不先把 HTML 解析成樹再找：解析完要改的是節點，改完再序列化回去，
 * 整份正文的空白與引號都會被正規化，content hash 就平白變了、核准全部失效
 * （`wrapBareTopLevelText` 也是為了這個理由「沒東西要包就原樣回傳」）。
 * 這裡只需要知道「哪些位置是標籤」，掃一遍就夠，不必動到字串的其他部分。
 */
function indexOfText(haystack: string, needle: string, from: number, skipInside?: string): number {
  const tags = tagRanges(haystack);
  let at = haystack.indexOf(needle, from);
  while (at >= 0) {
    const end = at + needle.length;
    // 整段都要落在標籤之外；跨過標籤邊界的（例如 `今天<em>讀完` 對上「今天讀完」）
    // 也不算——換掉的話會把標籤吃掉。落在一個完整的 after 裡的也不算（見 ChangeSlot.skipInside）。
    const inTag = tags.some((range) => at < range.end && end > range.start);
    const inAfter = skipInside !== undefined && isInsideAligned(haystack, at, needle, skipInside);
    if (!inTag && !inAfter) return at;
    at = haystack.indexOf(needle, at + 1);
  }
  return -1;
}

/**
 * 標籤佔用的區間。沒有標籤就回空陣列（那個欄位是純文字）。
 *
 * 兩個容易寫錯的地方：
 * - 屬性值裡可以合法地出現 `>`（`alt="a > b"`），所以要追引號狀態，
 *   看到 `>` 就收尾會把標籤算短。
 * - 沒有收尾的 `<` **不是**標籤。「3 < 5」那個 `<` 如果被當成標籤開頭，
 *   後面整句話都會被當成標籤內部，一個字都定位不到。
 */
function tagRanges(html: string): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  let index = 0;
  while (index < html.length) {
    const start = html.indexOf('<', index);
    if (start < 0) break;

    const next = html[start + 1];
    if (next === undefined || !TAG_START.test(next)) {
      index = start + 1;
      continue;
    }

    let quote: string | null = null;
    let cursor = start + 1;
    let closed = false;
    while (cursor < html.length) {
      const char = html[cursor]!;
      if (quote !== null) {
        if (char === quote) quote = null;
      } else if (char === '"' || char === "'") {
        quote = char;
      } else if (char === '>') {
        closed = true;
        break;
      }
      cursor += 1;
    }

    if (!closed) {
      // 開了沒關的不是標籤，是文章裡的一個角括號。
      index = start + 1;
      continue;
    }
    ranges.push({ start, end: cursor + 1 });
    index = cursor + 1;
  }
  return ranges;
}

/**
 * 走訪出所有字串欄位，**長的排前面**。
 *
 * 順序決定了「同一個詞在 title 與 body 都出現時要改哪一個」。照 key 的宣告順序
 * 的話 `title` 永遠排在 `body` 前面，於是一個本來要改正文的建議會去改標題——
 * 長文的標題本身就是一句話，撞上的機率不低。最長的那個欄位在每個模板裡都是正文，
 * 而校稿建議絕大多數落在正文，所以照長度排。
 *
 * 長度一樣時照路徑排，確保同一份輸入永遠得到同一個結果——套用必須是可重現的。
 * 只收字串：數字與布林值不是文章內容，校稿建議不會改到它們。
 */
function collectStringLeaves(node: unknown, path: readonly (string | number)[] = []): Leaf[] {
  return walkStringLeaves(node, path).sort(
    (a, b) => b.value.length - a.value.length || pathKey(a).localeCompare(pathKey(b)),
  );
}

function pathKey(leaf: Leaf): string {
  return leaf.path.join('.');
}

function walkStringLeaves(node: unknown, path: readonly (string | number)[]): Leaf[] {
  if (typeof node === 'string') {
    return [{ path, value: node, cursor: 0, hasMarkup: tagRanges(node).length > 0 }];
  }
  if (Array.isArray(node)) {
    return node.flatMap((item, index) => walkStringLeaves(item, [...path, index]));
  }
  if (typeof node === 'object' && node !== null) {
    return Object.entries(node).flatMap(([key, value]) => walkStringLeaves(value, [...path, key]));
  }
  return [];
}

function writePath(root: Record<string, unknown>, path: readonly (string | number)[], value: string): void {
  if (path.length === 0) return;
  let cursor: unknown = root;
  for (const key of path.slice(0, -1)) {
    cursor = (cursor as Record<string | number, unknown>)[key];
  }
  (cursor as Record<string | number, unknown>)[path[path.length - 1]!] = value;
}
