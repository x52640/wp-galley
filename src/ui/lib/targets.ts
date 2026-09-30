/**
 * 停用類型在畫面上的規則（D-032，P5-T032）。
 *
 * 停用＝從「新稿件」隱藏，不是刪除：listTargets 仍然回傳停用的（總覽要靠它顯示舊稿件的類型名稱），
 * 所以每個「建新稿」的入口都要先過 creatableTargets。後端 createJob 另外再擋一次。
 */

interface Toggleable {
  readonly key: string;
  readonly disabled: boolean;
}

/** 新稿件選單、總覽的「新 X」按鈕、拖放／⌘V 建稿能選的類型。 */
export function creatableTargets<T extends Toggleable>(targets: readonly T[]): T[] {
  return targets.filter((target) => !target.disabled);
}

/**
 * 精靈存完之後還剩幾個啟用的類型。0 就不讓存（後端也會拒絕）。
 * `include` 裡跟既有同 key 的是「取代」，算在既有那邊（停不停用看 `disabled`）。
 */
export function enabledCountAfter(
  existing: readonly Toggleable[],
  disabled: readonly string[],
  include: readonly string[],
): number {
  const kept = existing.filter((target) => !disabled.includes(target.key)).length;
  const added = include.filter((key) => !existing.some((target) => target.key === key)).length;
  return kept + added;
}

/** 總覽的類型篩選：啟用的都列；停用的只在還有稿件時列，免得舊稿件找不到。 */
export function shownTypeFilters<T extends Toggleable>(
  targets: readonly T[],
  jobTargetKeys: readonly (string | null)[],
): T[] {
  return targets.filter((target) => !target.disabled || jobTargetKeys.includes(target.key));
}

/**
 * 新稿件畫面拿到類型清單之後，目前選的類型還能不能用。書籤或上一頁進 `#/new/diary`、而日記已經停用時，
 * 不能留著一個選單裡看不到的選擇（按了才吃後端錯誤）：重設成 null；只剩一個能建的就直接選它。
 */
export function resolveTargetKey(current: string | null, creatable: readonly Toggleable[]): string | null {
  if (current !== null && creatable.some((target) => target.key === current)) return current;
  return creatable.length === 1 ? creatable[0]!.key : null;
}

/**
 * 精靈第三步送出的請求。停用清單**只在使用者真的動過開關時才帶**：兩個分頁同開精靈，舊分頁只加「文章」
 * 不該把另一個分頁剛停用的類型默默打開。取代既有 target 時的停用狀態由後端保留（mergeSiteTargets）。
 */
export function destinationsRequest<K extends string>(input: {
  include: K[];
  replace: K[];
  disabled: readonly string[];
  initialDisabled: readonly string[];
}): { include: K[]; replace: K[]; disabled?: string[] } {
  const changed =
    input.disabled.length !== input.initialDisabled.length ||
    input.disabled.some((key) => !input.initialDisabled.includes(key));
  return { include: input.include, replace: input.replace, ...(changed ? { disabled: [...input.disabled] } : {}) };
}
