/**
 * 連結「在新分頁開啟」的規則（D-043，P5-T046）。前端連結編輯框、後端 sanitize 都呼叫這裡，規則只有一份。
 *
 * 輸出照 WordPress 區塊編輯器（format-library 的 `createLinkFormat`，WordPress 7.1 起；站台是 7.1+，D-043）的寫法：
 * `<a href="…" target="_blank" rel="noopener">`。屬性順序 href → target → rel。
 *
 * - `target` 只收 `_blank`（不分大小寫，輸出一律小寫）；其他值（`_self`、`_top`、自訂視窗名）拿掉。
 * - 有 `target="_blank"`：`rel` 一定以 `noopener` 開頭（noopener 是安全要求：新分頁拿不到
 *   `window.opener`）；原本 rel 裡的其他值（例如 `nofollow`）照原順序接在後面，跟 WordPress 的 `noopener nofollow` 一樣。
 *   舊內容（WordPress 7.0 以前）的 `noreferrer noopener` 也算新分頁專用值，整理後只剩 `noopener`。
 * - 沒有 target：rel 只有 `noreferrer`／`noopener`（或空白）＝新分頁留下的孤兒，拿掉；有其他值就照原樣留著。
 *
 * 本檔不得 import 任何東西（`tests/contract.test.ts`）。
 */

export interface LinkAttr {
  readonly name: string;
  readonly value: string;
}

export const NEW_TAB_TARGET = '_blank';
export const NEW_TAB_REL = 'noopener';

const NEW_TAB_REL_TOKENS = new Set(['noreferrer', 'noopener']);

/** target 的值是不是「新分頁」。瀏覽器對 `_blank` 這類關鍵字不分大小寫。 */
export function isNewTabTarget(target: string | null | undefined): boolean {
  return typeof target === 'string' && target.trim().toLowerCase() === NEW_TAB_TARGET;
}

function find(attrs: readonly LinkAttr[], name: string): LinkAttr | undefined {
  return attrs.find((attr) => attr.name.toLowerCase() === name);
}

/** 這個連結會不會在新分頁開啟（只看 target）。 */
export function opensInNewTab(attrs: readonly LinkAttr[]): boolean {
  return isNewTabTarget(find(attrs, 'target')?.value);
}

function relTokens(rel: string): string[] {
  return rel.split(/\s+/).filter((token) => token.length > 0);
}

/** 新分頁專用值（noopener，以及舊版 WordPress 會加的 noreferrer）以外的 rel 值，去重、照原順序。 */
function otherRelTokens(rel: string | undefined): string[] {
  if (rel === undefined) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of relTokens(rel)) {
    const key = token.toLowerCase();
    if (NEW_TAB_REL_TOKENS.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(token);
  }
  return out;
}

/**
 * 依 `newTab` 改寫 target／rel，其他屬性原樣、原順序。
 * - 新分頁：target 改成 `_blank`、rel 改成 `noopener`＋其他值（舊的 noreferrer 拿掉）；本來沒有的接在後面（href 之後依序 target、rel）。
 * - 原視窗：拿掉 target；rel 拿掉 noreferrer／noopener，剩下的值留著，什麼都不剩就整個拿掉。
 */
export function withNewTab(attrs: readonly LinkAttr[], newTab: boolean): LinkAttr[] {
  const rel = find(attrs, 'rel')?.value;
  const others = otherRelTokens(rel);
  if (!newTab) {
    return attrs.flatMap((attr) => {
      const name = attr.name.toLowerCase();
      if (name === 'target') return [];
      if (name === 'rel') return others.length === 0 ? [] : [{ name: attr.name, value: others.join(' ') }];
      return [attr];
    });
  }
  const relValue = [NEW_TAB_REL, ...others].join(' ');
  const out: LinkAttr[] = [];
  let hasTarget = false;
  let hasRel = false;
  for (const attr of attrs) {
    const name = attr.name.toLowerCase();
    if (name === 'target') {
      if (hasTarget) continue;
      hasTarget = true;
      out.push({ name: attr.name, value: NEW_TAB_TARGET });
    } else if (name === 'rel') {
      if (hasRel) continue;
      hasRel = true;
      out.push({ name: attr.name, value: relValue });
    } else {
      out.push(attr);
    }
  }
  if (!hasTarget) out.push({ name: 'target', value: NEW_TAB_TARGET });
  if (!hasRel) out.push({ name: 'rel', value: relValue });
  return out;
}

/**
 * 後端再驗（`templates/sanitize.ts`）：不管連結從哪來（Agent、編輯存檔），target／rel 都整理成上面的規則。
 * 跟 `withNewTab` 的差別：沒有新分頁時，rel 有其他值就**整個照原樣**留著（不是使用者按的，不去動它）。
 */
export function normalizeLinkAttrs(attrs: readonly LinkAttr[]): LinkAttr[] {
  if (opensInNewTab(attrs)) return withNewTab(attrs, true);
  const rel = find(attrs, 'rel')?.value;
  const orphanRel = rel !== undefined && otherRelTokens(rel).length === 0;
  return attrs.filter((attr) => {
    const name = attr.name.toLowerCase();
    if (name === 'target') return false;
    if (name === 'rel') return !orphanRel;
    return true;
  });
}
