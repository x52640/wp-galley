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

/** 游標所在處實際的粗／斜（瀏覽器算出來的樣式）。 */
export interface ComputedEmphasis {
  readonly bold: boolean;
  readonly italic: boolean;
}

/** `getComputedStyle` 的 font-weight／font-style → 粗不粗、斜不斜。600 以上算粗。 */
export function emphasisFromComputed(fontWeight: string, fontStyle: string): ComputedEmphasis {
  const weight = fontWeight === 'bold' || fontWeight === 'bolder' ? 700 : Number(fontWeight);
  return { bold: Number.isFinite(weight) && weight >= 600, italic: fontStyle === 'italic' || fontStyle.startsWith('oblique') };
}

/**
 * 從游標往外的祖先標籤（最裡面的在前，不含正文容器本身）推出狀態。
 * `b`／`i` 是瀏覽器的產物，也算粗斜體（存檔時才轉成 strong／em）。
 *
 * 給了 `computed`（游標處實際的樣式）時，粗／斜照實際樣式：`<strong>A<span style="font-weight:normal">B</span></strong>`
 * 的 B 不粗，粗體按鈕不能亮（第三輪審查 #6）。標題本來就粗，標題裡的粗體按鈕只看有沒有 strong／b。
 */
export function formatStateFrom(ancestors: readonly string[], computed?: ComputedEmphasis | null): FormatState {
  const tags = ancestors.map((tag) => tag.toLowerCase());
  const list = tags.find((tag) => tag === 'ul' || tag === 'ol') as 'ul' | 'ol' | undefined;
  const textBlock = tags.find((tag) => ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'div'].includes(tag));
  let block: FormatState['block'] = 'paragraph';
  // 在清單項目裡就是清單情境，不管中間夾了 p／div／標題（Google 文件貼上的 `<li><p>…`，審查 F6）：
  // 不然清單按鈕不亮、H2 防護被繞過、「內文」按了不會離開清單。
  if (tags.includes('li')) block = 'list';
  else if (textBlock === 'h1' || textBlock === 'h2') block = 'h2';
  else if (textBlock !== undefined && /^h[3-6]$/.test(textBlock)) block = 'h3';
  const taggedBold = tags.some((tag) => tag === 'strong' || tag === 'b');
  const taggedItalic = tags.some((tag) => tag === 'em' || tag === 'i');
  const inHeading = block === 'h2' || block === 'h3';
  return {
    bold: computed == null || inHeading ? taggedBold : computed.bold,
    italic: computed == null ? taggedItalic : computed.italic,
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
  const accepted = `只接受 ${schemes.join('、')} 開頭的網址，或站內的 /路徑、#錨點`;
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

/** 連結輸入框的一次開啟。 */
export interface LinkEditorState {
  /** 已經是連結時的網址；新連結是 null。 */
  readonly current: string | null;
  /**
   * 第幾次打開。輸入框以它當 key：開著 A 的輸入框時改選連結 B 再按連結，要換成 B 的網址重新開始，
   * 不能留著 A 打到一半的字——不然按「更新」會把 B 改成 A 的網址（審查 #6）。
   */
  readonly session: number;
}

/** 打開（或在開著的時候重新打開）連結輸入框。每次都是新的一次，輸入框內容從 `current` 重新開始。 */
export function nextLinkEditor(previous: LinkEditorState | null, current: string | null, counter: number): LinkEditorState {
  return { current, session: Math.max(counter, (previous?.session ?? 0) + 1) };
}

export type EditSaveDecision = 'unchanged' | 'confirm-drop' | 'save';

/**
 * 按「儲存」之後要做什麼。
 * - `unchanged`：整理後跟進入編輯時一樣（例如只按了 Enter 多一個空段落）。不送出，但**畫面要還原成進入編輯時的正文**
 *   並重量：不還原的話校樣多一個空區塊，之後「在第 n 段後插圖」的索引就跟後端對不上（審查 #1）。
 * - `confirm-drop`：有模板不支援、會被拿掉的格式，先講出來。
 * - `save`：送出。
 */
export function decideEditSave(input: {
  readonly cleaned: string;
  readonly originalClean: string;
  readonly dropped: readonly string[];
  readonly force: boolean;
}): EditSaveDecision {
  if (input.cleaned === input.originalClean) return 'unchanged';
  if (input.dropped.length > 0 && !input.force) return 'confirm-drop';
  return 'save';
}
