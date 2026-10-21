/**
 * 段落與小標的對齊（D-049，P5-T050）。前端格式工具列、編輯整理（`rich-text.ts`）、後端 sanitize、
 * 區塊轉換（`wordpress/block-parse.ts`／`block-serialize.ts`）都用這裡，規則只有一份。
 *
 * 寫法照 WordPress 7.0 起的核心（站台是 7.1+，D-043；查證與出處見 docs/specs/wordpress-site.md「段落與小標的對齊」）：
 * 正文 HTML 只用 class `has-text-align-left|center|right`，**不用 inline style**（`text-align:` 一律不收）。
 *
 * - 只有這三個值；`justify` 等其他 `has-text-align-*` 一律拿掉（不做兩端對齊，D-049）。
 * - 只有段落與小標（`p`、`h2`、`h3`）帶得了；其他標籤（清單、引用、圖說…）身上的對齊 class 拿掉。
 * - 一個區塊只留一個對齊 class（第一個合法的）。
 * - 工具列的「靠左」＝拿掉對齊設定（不輸出 class）；讀回的 `has-text-align-left`（WordPress 後台設的）照樣保留。
 *
 * 本檔不得 import 任何東西（`tests/contract.test.ts`）。
 */

export const TEXT_ALIGNS = ['left', 'center', 'right'] as const;

export type TextAlign = (typeof TEXT_ALIGNS)[number];

/** 存檔後帶得了對齊 class 的標籤。h1、h4～h6 整理時會變成 h2／h3，div 會變成段落，所以整理途中也算。 */
export const TEXT_ALIGN_TAGS: readonly string[] = ['p', 'h2', 'h3'];

const ALIGNABLE_WHILE_CLEANING = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'div']);

const PREFIX = 'has-text-align-';

export function isTextAlign(value: unknown): value is TextAlign {
  return typeof value === 'string' && (TEXT_ALIGNS as readonly string[]).includes(value);
}

/** `center` → `has-text-align-center`。 */
export function textAlignClass(align: TextAlign): string {
  return `${PREFIX}${align}`;
}

/** sanitize 的 allowedClasses 要多收的那三個 class。 */
export const TEXT_ALIGN_CLASSES: readonly string[] = TEXT_ALIGNS.map((align) => textAlignClass(align));

function tokens(classValue: string | null | undefined): string[] {
  return (classValue ?? '').split(/\s+/).filter((token) => token.length > 0);
}

/** class 字串裡的對齊（第一個合法的）；沒有就是 null。 */
export function textAlignOf(classValue: string | null | undefined): TextAlign | null {
  for (const token of tokens(classValue)) {
    if (token.startsWith(PREFIX)) {
      const value = token.slice(PREFIX.length);
      if (isTextAlign(value)) return value;
    }
  }
  return null;
}

/**
 * 換掉 class 裡的對齊。其他 class 原樣、順序不動；舊的（含不合法的）對齊 class 全部拿掉，
 * 新的接在最後。`null`＝不對齊。整個 class 變空就回 null（呼叫端拿掉 class 屬性）。
 */
export function withTextAlign(classValue: string | null | undefined, align: TextAlign | null): string | null {
  const kept = tokens(classValue).filter((token) => !token.startsWith(PREFIX));
  if (align !== null) kept.push(textAlignClass(align));
  return kept.length === 0 ? null : kept.join(' ');
}

/**
 * 編輯整理用：標籤 `tag` 身上的 class 裡，對齊 class 照規則整理（不合法的拿掉、只留第一個、不能對齊的標籤全拿掉），
 * 其他 class 一個字都不動。沒有對齊 class 的就原樣回傳（不重排空白）。整個 class 變空回 null。
 */
export function normalizeTextAlignClass(tag: string, classValue: string): string | null {
  const list = tokens(classValue);
  if (!list.some((token) => token.startsWith(PREFIX))) return classValue;
  const align = ALIGNABLE_WHILE_CLEANING.has(tag.toLowerCase()) ? textAlignOf(classValue) : null;
  let placed = false;
  const out: string[] = [];
  for (const token of list) {
    if (!token.startsWith(PREFIX)) {
      out.push(token);
      continue;
    }
    if (align !== null && !placed && token === textAlignClass(align)) {
      out.push(token);
      placed = true;
    }
  }
  return out.length === 0 ? null : out.join(' ');
}

/**
 * 校樣（預覽文件與示範資料）用的對齊樣式。照 WordPress 核心 `block-library/src/common.scss`（前台每頁都載入）逐條抄，
 * 校樣跟前台看起來一樣。不寫進各模板的 preview.css：這是核心的 class，不是某個站的樣式。
 */
export const TEXT_ALIGN_CSS =
  ':root .has-text-align-center{text-align:center}\n' +
  ':root .has-text-align-left{text-align:left}\n' +
  ':root .has-text-align-right{text-align:right}';
