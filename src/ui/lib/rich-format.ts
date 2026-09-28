import { safeHref } from '../../contract/rich-text.js';

/**
 * 直接在文章上改的格式工具列：純規則（P5-T028）。DOM 操作在 `rich-commands.ts`，這裡不碰 DOM，有測試。
 */

export type FormatCommand = 'link' | 'bold' | 'italic' | 'h2' | 'h3' | 'paragraph' | 'ul' | 'ol' | 'quote' | 'hr';

/** 工具列上的順序，以及每顆按鈕需要模板允許哪些標籤。 */
const COMMANDS: readonly { command: FormatCommand; needs: readonly string[] }[] = [
  { command: 'link', needs: ['a'] },
  { command: 'bold', needs: ['strong'] },
  { command: 'italic', needs: ['em'] },
  { command: 'h2', needs: ['h2'] },
  { command: 'h3', needs: ['h3'] },
  { command: 'paragraph', needs: ['p'] },
  { command: 'ul', needs: ['ul', 'li'] },
  { command: 'ol', needs: ['ol', 'li'] },
  { command: 'quote', needs: ['blockquote'] },
  { command: 'hr', needs: ['hr'] },
];

/** 依模板的 allowedTags 決定出現哪些按鈕（不是寫死）。 */
export function availableCommands(allowedTags: readonly string[]): FormatCommand[] {
  const allowed = new Set(allowedTags.map((tag) => tag.toLowerCase()));
  return COMMANDS.filter(({ needs }) => needs.every((tag) => allowed.has(tag))).map(({ command }) => command);
}

export interface FormatState {
  readonly bold: boolean;
  readonly italic: boolean;
  readonly link: boolean;
  /** 游標所在的文字區塊。`list`＝清單項目裡。 */
  readonly block: 'paragraph' | 'h2' | 'h3' | 'list';
  /** 最近的那一層清單。 */
  readonly list: 'ul' | 'ol' | null;
  readonly quote: boolean;
}

/**
 * 從游標往外的祖先標籤（最裡面的在前，不含正文容器本身）推出狀態。
 * `b`／`i` 是瀏覽器的產物，也算粗斜體（存檔時才轉成 strong／em）。
 */
export function formatStateFrom(ancestors: readonly string[]): FormatState {
  const tags = ancestors.map((tag) => tag.toLowerCase());
  const list = tags.find((tag) => tag === 'ul' || tag === 'ol') as 'ul' | 'ol' | undefined;
  const textBlock = tags.find((tag) => ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'div'].includes(tag));
  let block: FormatState['block'] = 'paragraph';
  if (textBlock === 'li') block = 'list';
  else if (textBlock === 'h1' || textBlock === 'h2') block = 'h2';
  else if (textBlock !== undefined && /^h[3-6]$/.test(textBlock)) block = 'h3';
  return {
    bold: tags.some((tag) => tag === 'strong' || tag === 'b'),
    italic: tags.some((tag) => tag === 'em' || tag === 'i'),
    link: tags.includes('a'),
    block,
    list: list ?? null,
    quote: tags.includes('blockquote'),
  };
}

/** 按鈕要不要亮起（aria-pressed）。 */
export function isCommandActive(command: FormatCommand, state: FormatState): boolean {
  switch (command) {
    case 'bold':
      return state.bold;
    case 'italic':
      return state.italic;
    case 'link':
      return state.link;
    case 'h2':
    case 'h3':
      return state.block === command;
    case 'paragraph':
      return state.block === 'paragraph';
    case 'ul':
    case 'ol':
      return state.block === 'list' && state.list === command;
    case 'quote':
      return state.quote;
    case 'hr':
      return false;
  }
}

/**
 * 按鈕能不能按。擋掉的是瀏覽器會做壞的組合（P5-T028 實測 Chrome）：
 * - 清單項目裡按 H2／H3，Chrome 會產生 `<h2><ul><li>`；要先按「段落」離開清單。
 * - 標題裡按粗體，Chrome 會因為標題本來就粗而包一層 `font-weight: normal`。
 */
export function isCommandEnabled(command: FormatCommand, state: FormatState): boolean {
  if ((command === 'h2' || command === 'h3') && state.block === 'list') return false;
  if (command === 'bold' && (state.block === 'h2' || state.block === 'h3')) return false;
  return true;
}

export interface ShortcutKey {
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}

/**
 * ⌘B／⌘I／⌘K（非 Mac 用 Ctrl）。⌘U 回 `block`：瀏覽器預設會加底線，但底線不在 allowlist，
 * 攔下來什麼都不做，免得存檔時才被拿掉。其他組合回 null（交給瀏覽器，例如 ⌘Z）。
 */
export function shortcutCommand(event: ShortcutKey): 'bold' | 'italic' | 'link' | 'block' | null {
  if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return null;
  switch (event.key.toLowerCase()) {
    case 'b':
      return 'bold';
    case 'i':
      return 'italic';
    case 'k':
      return 'link';
    case 'u':
      return 'block';
    default:
      return null;
  }
}

export type LinkInputResult = { readonly ok: true; readonly href: string } | { readonly ok: false; readonly message: string };

/**
 * 連結輸入框的網址。只打網域（`example.com/a`、`www.example.com`）就補 `https://`；
 * 其他一律要是模板允許的 scheme 開頭的完整網址（`javascript:`、相對網址都不收）。
 */
export function parseLinkInput(raw: string, schemes: readonly string[]): LinkInputResult {
  const value = raw.trim();
  const accepted = `只接受 ${schemes.join('、')} 開頭的網址`;
  if (value.length === 0) return { ok: false, message: '請填網址' };
  if (/\s/.test(value)) return { ok: false, message: '網址裡不能有空白' };
  const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value);
  if (!hasScheme && /^[^/:?#@]+\.[^/:?#@.]+/.test(value) && schemes.includes('https')) {
    return { ok: true, href: `https://${value}` };
  }
  const href = safeHref(value, schemes);
  return href === null ? { ok: false, message: accepted } : { ok: true, href };
}

/** 工具列按鈕的名稱與提示（含快捷鍵）。 */
export const COMMAND_LABELS: Readonly<Record<FormatCommand, { label: string; hint: string }>> = {
  link: { label: '連結', hint: '連結（⌘K）' },
  bold: { label: '粗體', hint: '粗體（⌘B）' },
  italic: { label: '斜體', hint: '斜體（⌘I）' },
  h2: { label: 'H2', hint: '大標題' },
  h3: { label: 'H3', hint: '小標題' },
  paragraph: { label: '內文', hint: '回到一般段落' },
  ul: { label: '項目清單', hint: '項目清單' },
  ol: { label: '編號清單', hint: '編號清單' },
  quote: { label: '引用', hint: '引用' },
  hr: { label: '分隔線', hint: '在這段後面加分隔線' },
};
