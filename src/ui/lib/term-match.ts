import type { Term } from '../service/types.js';

/**
 * 建立新分類項目前，找站上名稱相近的既有項目（P5-T051，D-050）。
 *
 * 只用畫面已經載入的清單比對，不另打 WordPress。目的是在使用者按「建立」前讓他看到
 * 「經濟學」已經在了，不要再建一個「經濟學思考」——D-004 擔心的垃圾場不只來自 Agent。
 *
 * 規則刻意簡單、看得懂：正規化後**相等**＝同名（直接選既有的，不建）；**包含或被包含**＝相近（列出來給人判斷）。
 * 意思相近但字不同（「經濟」與「財經」）抓不到，這是已知限制，見 docs/known-issues.md。
 */

/** 比對用的正規化：全形轉半形（NFKC，全形空白也變成一般空白）、連續空白變一個、去頭尾空白、不分大小寫。 */
export function normalizeTermName(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
}

export interface TermMatches {
  /** 正規化後同名的既有項目；沒有是 null。 */
  readonly exact: Term | null;
  /** 名稱互相包含的既有項目（不含 exact），照原清單順序。 */
  readonly similar: readonly Term[];
}

export function matchTerms(query: string, terms: readonly Term[]): TermMatches {
  const wanted = normalizeTermName(query);
  if (wanted.length === 0) return { exact: null, similar: [] };

  let exact: Term | null = null;
  const similar: Term[] = [];
  for (const term of terms) {
    const name = normalizeTermName(term.name);
    if (name.length === 0) continue;
    if (name === wanted) {
      exact ??= term;
    } else if (name.includes(wanted) || wanted.includes(name)) {
      similar.push(term);
    }
  }
  return { exact, similar };
}

/**
 * 建好新項目（或後端說站上已有、回了既有的）之後講什麼（P5-T051 跟進）。選上之後會直接存到這篇；
 * 存失敗時講清楚「還沒套到這篇」與怎麼重試，選取留著。
 */
export function termAddedNote(input: {
  readonly name: string;
  readonly created: boolean;
  readonly saveError: string | null;
}): { readonly tone: 'good' | 'bad'; readonly text: string } {
  const { name, created, saveError } = input;
  if (saveError === null) {
    return { tone: 'good', text: created ? `已建立「${name}」，已選上並套用到這篇。` : `站上已有「${name}」，已選上並套用。` };
  }
  const head = created ? `已建立「${name}」並選上` : `站上已有「${name}」，已選上`;
  return { tone: 'bad', text: `${head}，但還沒套到這篇（${saveError}）。按「儲存分類」再試一次。` };
}
