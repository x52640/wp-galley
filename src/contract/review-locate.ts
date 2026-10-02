import { findIgnoringSpaces } from './text-match.js';

/**
 * 觀察引用的原句，經過同一份校稿已經落地的修改之後，現在應該長什麼樣（P5-T037）。
 *
 * 例子（使用者 job 17）：同一份校稿裡改錯字的那條（「大腕→大碗」）已接受，另一條觀察引用的是改之前的
 * 「那是被湯匙跟高麗菜撐出來的大腕」——文章裡已經是「大碗」，原句找不到，卡片就跳不過去、也標不出來。
 * 把 excerpt 裡**完整包含**的 `before` 換成 `after`（依傳進來的順序，也就是 ordinal 順序），再拿去找。
 *
 * - 只用 excerpt 完整包含的 `before`；只交疊一段的不處理（猜位置比不能跳更糟）。
 * - 比對忽略空白，跟定位同一套規則（`findIgnoringSpaces`）：Agent 引用時常自己加空格。
 * - 一條 `before` 在 excerpt 裡出現幾次就換幾次。
 * - 沒有任何一條用得上就回 null（呼叫端照舊算找不到）。
 *
 * 呼叫端只傳已套用（`applied`）或已經改好了（`alreadyDone`）的 change；還沒處理的不能拿來換——
 * 文章裡還是原句。前後端都要這條規則（後端算段落、示範資料算字），所以放在共用契約。
 */
export function excerptAfterChanges(
  excerpt: string,
  changes: readonly { readonly before: string; readonly after: string }[],
): string | null {
  let text = excerpt;
  let touched = false;
  for (const change of changes) {
    let from = 0;
    for (;;) {
      const hit = findIgnoringSpaces(text.slice(from), change.before);
      if (hit === null) break;
      const start = from + hit.start;
      const end = from + hit.end;
      text = text.slice(0, start) + change.after + text.slice(end);
      from = start + change.after.length;
      touched = true;
    }
  }
  return touched ? text : null;
}
