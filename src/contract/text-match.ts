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
 */
export function findIgnoringSpaces(haystack: string, needle: string): { start: number; end: number } | null {
  const target = needle.replace(/\s+/g, '');
  if (target.length === 0) return null;

  // 去掉空白後的字串，以及每個字元在原文裡的位置。
  const positions: number[] = [];
  let compact = '';
  for (let i = 0; i < haystack.length; i++) {
    const ch = haystack[i]!;
    if (/\s/.test(ch)) continue;
    positions.push(i);
    compact += ch;
  }

  const at = compact.indexOf(target);
  if (at < 0) return null;
  return { start: positions[at]!, end: positions[at + target.length - 1]! + 1 };
}
