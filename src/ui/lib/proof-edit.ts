import { flattenTitleText } from '../../contract/plain-title.js';
import { shortcutCommand, type FormatState, type ShortcutKey } from './rich-format.js';

/**
 * 「直接在文章上改」的鍵盤、貼上、拖放規則（P5-T010、P5-T028、P5-T029；P5-T035 從 `ProofView` 抽出）。
 * 純函式：只回「該做什麼」，真的去動 iframe 文件是 `proof-edit-dom.ts` 的事，這樣 node 環境測得到。
 */

/** 快捷鍵在目前游標的格式下能不能用：標題（H2／H3）裡不加粗；連結、斜體一律可以。 */
export function isShortcutEnabled(command: 'bold' | 'italic' | 'link', state: FormatState): boolean {
  return command === 'link' || !(command === 'bold' && (state.block === 'h2' || state.block === 'h3'));
}

export interface EditKey extends ShortcutKey {
  readonly isComposing: boolean;
}

/**
 * 編輯中按鍵要怎麼處理。
 *
 * - `pass`：交給瀏覽器（一般打字、⌘Z…）。
 * - `swallow`：擋掉預設、什麼都不做（⌘U、標題裡的格式快捷鍵、目前格式下不能用的快捷鍵）。
 * - `to-body`：標題是一行，Enter（不在選字中）跳到正文開頭。
 * - `run`：擋掉預設、執行那個格式指令。
 */
export type EditKeyAction =
  | { readonly kind: 'pass' }
  | { readonly kind: 'swallow' }
  | { readonly kind: 'to-body' }
  | { readonly kind: 'run'; readonly command: 'bold' | 'italic' | 'link' };

export function editKeyAction(event: EditKey, inTitle: boolean, state: FormatState | null): EditKeyAction {
  if (inTitle) {
    if (event.key === 'Enter' && !event.isComposing) return { kind: 'to-body' };
    return shortcutCommand(event) === null ? { kind: 'pass' } : { kind: 'swallow' };
  }
  const shortcut = shortcutCommand(event);
  if (shortcut === null) return { kind: 'pass' };
  if (shortcut === 'block') return { kind: 'swallow' };
  if (state !== null && !isShortcutEnabled(shortcut, state)) return { kind: 'swallow' };
  return { kind: 'run', command: shortcut };
}

/**
 * 貼上要插什麼（一律擋掉瀏覽器預設的貼上）。
 *
 * - 標題：只收純文字、一行（換行攤平成空格、去頭尾空白）。
 * - 正文：有格式的剪貼簿先用 `clean`（模板 allowlist）整理，整理完還有東西就插 HTML；否則插純文字。
 */
export function pasteAction(
  clip: { readonly html: string; readonly plain: string },
  inTitle: boolean,
  clean: (html: string) => string,
): { readonly command: 'insertText' | 'insertHTML'; readonly value: string } {
  if (inTitle) return { command: 'insertText', value: flattenTitleText(clip.plain).trim() };
  const cleaned = clip.html.trim().length > 0 ? clean(clip.html) : '';
  if (cleaned.trim().length > 0) return { command: 'insertHTML', value: cleaned };
  return { command: 'insertText', value: clip.plain };
}

/** 拖放要不要擋：拖檔案進來（瀏覽器會把圖塞進正文、不經過媒體庫）與拖進標題的一律擋。 */
export function shouldBlockDrop(types: readonly string[], inTitle: boolean): boolean {
  return types.includes('Files') || inTitle;
}
