/**
 * 在原文裡找 Agent 引用的片段，**比對時忽略所有空白**。
 *
 * 前後端都要用同一套規則：後端靠它算「第 N 段」，前端靠它在字上標記。兩邊各寫一份，
 * 就會出現「右欄說第 3 段、字上卻沒標」的不一致，所以放在共用契約裡。
 *
 * 為什麼忽略空白：Agent 引用時會自己在中文與數字、英文之間加空格（寫「佔 40%」，
 * 原文是「佔40%」），HTML 的 textContent 也常夾著換行縮排（P5-T001 實測）。
 * 這只用在「定位、標亮」；逐項**套用**改動要精準，照舊逐字比對。
 *
 * 回傳原文中的 [start, end)，範圍包含夾在中間的原文空白。找不到回 null。
 * 給了 `skipInside`（校稿建議的 after）時，落在對齊的 after 裡的出現位置不算（見 `isInsideAligned`）。
 */
export function findIgnoringSpaces(
  haystack: string,
  needle: string,
  skipInside?: string | null,
): { start: number; end: number } | null {
  const target = needle.replace(/\s+/g, '');
  if (target.length === 0) return null;
  const container = skipInside?.replace(/\s+/g, '') ?? '';

  // 去掉空白後的字串，以及每個字元在原文裡的位置。
  const positions: number[] = [];
  let compact = '';
  for (let i = 0; i < haystack.length; i++) {
    const ch = haystack[i]!;
    if (/\s/.test(ch)) continue;
    positions.push(i);
    compact += ch;
  }

  let at = compact.indexOf(target);
  while (at >= 0 && container.length > 0 && isInsideAligned(compact, at, target, container)) {
    at = compact.indexOf(target, at + 1);
  }
  if (at < 0) return null;
  return { start: positions[at]!, end: positions[at + target.length - 1]! + 1 };
}

/**
 * `haystack[at]` 開始的這個 `needle` 是不是落在一個**對齊的** `container` 裡：`container` 是
 * 「前綴＋needle＋後綴」，而這個位置前後的字剛好補成整個 `container`（逐字比對）。
 *
 * 用在校稿建議（P5-T017 審查）：「很多事→很多事情」這種在前後補字的建議，文章已經是「很多事情」時，
 * 「很多事」仍然找得到——就在改好的那句裡面。把它當成還沒改，按接受就會變成「很多事情情」。
 * 所以定位 `before` 時，落在一個完整的 `after` 裡的出現位置不算數（`skipInside` 傳 after）。
 */
export function isInsideAligned(haystack: string, at: number, needle: string, container: string): boolean {
  if (container.length <= needle.length) return false;
  for (let k = container.indexOf(needle); k >= 0; k = container.indexOf(needle, k + 1)) {
    const start = at - k;
    if (start >= 0 && haystack.startsWith(container, start)) return true;
  }
  return false;
}
